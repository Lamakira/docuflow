import { beforeEach, describe, expect, it } from "vitest";
import { PARALLEL_WORKSPACE_ID } from "../../shared/schema";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerAdmin, registerUser, setWorkspaceRole } from "../helpers/auth";
import { createCrmProject, createDocument, tiptap } from "../helpers/fixtures";
import { addWorkspaceMembership, plantParallelWorkspace, removeAllMemberships } from "../helpers/workspace";
import { chatCalls } from "../fakes/openai";

/**
 * #307: a Project Document is "visible exactly to members who can access that
 * project" (CONTEXT.md). The project-document routes answered the whole
 * Workspace, and v2 only hid another Project's pages. A Member who is not on
 * the Project now gets the answer a Project they cannot see gets.
 */
describe("Project Document access (#307)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("answers a Member who is not on the Project as if the Project were not there", async () => {
    const app = await makeApp();
    const lead = await registerUser(app);
    const outsider = await registerUser(app);
    const { project } = await createCrmProject(lead.agent);
    const page = await createDocument(lead.agent, project.id, { title: "Scope" });

    const list = await outsider.agent.get(`/api/projects/${project.id}/documents`);
    expect(list.status).toBe(404);
    expect(list.body).toEqual({ message: "Project not found" });

    const read = await outsider.agent.get(`/api/documents/${page.id}`);
    expect(read.status).toBe(404);
    expect(read.body).toEqual({ message: "Document not found" });
  });

  it("lets a Member who is not on the Project change nothing in its documentation", async () => {
    const app = await makeApp();
    const lead = await registerUser(app);
    const outsider = await registerUser(app);
    const { project } = await createCrmProject(lead.agent);
    const page = await createDocument(lead.agent, project.id, { title: "Scope" });

    const create = await outsider.agent.post(`/api/projects/${project.id}/documents`).send({ title: "Intruder" });
    expect(create.status).toBe(404);
    expect(create.body).toEqual({ message: "Project not found" });

    const refused = [
      await outsider.agent.get(`/api/documents/${page.id}/ancestors`),
      await outsider.agent.patch(`/api/documents/${page.id}`).send({ title: "Defaced" }),
      await outsider.agent.post(`/api/documents/${page.id}/duplicate`),
      await outsider.agent
        .post(`/api/projects/${project.id}/documents/reorder`)
        .send({ documentId: page.id, newParentId: null, newPosition: 3 }),
      await outsider.agent.get(`/api/documents/${page.id}/transcripts`),
      await outsider.agent.post(`/api/documents/${page.id}/sync-transcripts`),
      await outsider.agent.delete(`/api/documents/${page.id}`),
    ];
    for (const res of refused) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: "Document not found" });
    }

    const after = await lead.agent.get(`/api/projects/${project.id}/documents`);
    expect(after.body.map((d: { title: string; position: number }) => [d.title, d.position])).toEqual([
      ["Scope", 0],
    ]);
  });

  it("leaves another Project's pages out of a Member's recent documents and search", async () => {
    const app = await makeApp();
    const lead = await registerUser(app);
    const outsider = await registerUser(app);
    const theirs = await createCrmProject(lead.agent, { name: "Harbor" });
    await createDocument(lead.agent, theirs.project.id, { title: "Harbor runbook" });
    const mine = await createCrmProject(outsider.agent, { name: "Lighthouse" });
    await createDocument(outsider.agent, mine.project.id, { title: "Lighthouse runbook" });

    const recent = await outsider.agent.get("/api/documents/recent");
    expect(recent.status).toBe(200);
    expect(recent.body.map((d: { title: string }) => d.title)).toEqual(["Lighthouse runbook"]);

    const search = await outsider.agent.get("/api/search").query({ q: "runbook" });
    expect(search.status).toBe(200);
    expect(
      search.body
        .filter((hit: { type: string }) => hit.type === "document")
        .map((hit: { title: string; projectName: string }) => [hit.title, hit.projectName]),
    ).toEqual([["Lighthouse runbook", "Lighthouse"]]);
  });

  it("keeps another Project's pages out of a Member's Ask prompt and citations", async () => {
    const app = await makeApp();
    const lead = await registerUser(app);
    const outsider = await registerUser(app);
    const theirs = await createCrmProject(lead.agent, { name: "Harbor" });
    const secret = await createDocument(lead.agent, theirs.project.id, {
      title: "Harbor runbook",
      content: tiptap("Harbor zebra quantum ledger"),
    });
    const mine = await createCrmProject(outsider.agent, { name: "Lighthouse" });
    await createDocument(outsider.agent, mine.project.id, {
      title: "Lighthouse runbook",
      content: tiptap("Lighthouse quantum ledger"),
    });
    const cited = (res: { body: { citations: Array<{ id: string }> } }) => res.body.citations.map((c) => c.id);

    // With no embeddings yet, Ask reads the pages themselves.
    const fallback = await outsider.agent.post("/api/chat").send({ message: "quantum ledger", mode: "projects" });
    expect(fallback.status).toBe(200);
    expect(fallback.body.usedFallback).toBe(true);
    expect(chatCalls().at(-1)!.messages[0].content).toContain("Lighthouse");
    expect(chatCalls().at(-1)!.messages[0].content).not.toMatch(/zebra|Harbor/);
    expect(cited(fallback)).not.toContain(secret.id);

    // With embeddings, the search reads only the Projects the Member may see.
    expect((await lead.agent.post("/api/embeddings/rebuild")).status).toBe(200);
    const searched = await outsider.agent.post("/api/chat").send({ message: "quantum ledger", mode: "projects" });
    expect(searched.status).toBe(200);
    expect(searched.body.usedFallback).toBe(false);
    expect(chatCalls().at(-1)!.messages[0].content).not.toMatch(/zebra|Harbor/);
    expect(cited(searched)).not.toContain(secret.id);
  });

  it("lets in the Project's Members, its assignee while it has no Members, and Owners and Administrators", async () => {
    const app = await makeApp();
    const lead = await registerUser(app);
    const teammate = await registerUser(app);
    const assignee = await registerUser(app);
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");

    const staffed = await createCrmProject(lead.agent, { memberIds: [lead.id, teammate.id] });
    const staffedPage = await createDocument(lead.agent, staffed.project.id, { title: "Staffed page" });
    for (const reader of [teammate, admin, owner]) {
      const res = await reader.agent.get(`/api/documents/${staffedPage.id}`);
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Staffed page");
    }

    // Naming an assignee makes them a Member too; removing that Membership
    // leaves a Project with no Members, which its assignee still reaches.
    const unstaffed = await createCrmProject(admin.agent, { memberIds: [], assigneeId: assignee.id });
    const removed = await admin.agent.delete(`/api/crm/projects/${unstaffed.crmProject.id}/members/${assignee.id}`);
    expect(removed.status).toBeLessThan(300);
    const unstaffedPage = await createDocument(assignee.agent, unstaffed.project.id, { title: "Assigned page" });
    expect((await lead.agent.get(`/api/documents/${unstaffedPage.id}`)).status).toBe(404);
  });

  it("keeps another Workspace's Project Documents out, Administrators included", async () => {
    const app = await makeApp();
    await plantParallelWorkspace();
    const elsewhere = await registerUser(app);
    await removeAllMemberships(elsewhere.id);
    await addWorkspaceMembership(elsewhere.id, PARALLEL_WORKSPACE_ID, "owner");
    const { project } = await createCrmProject(elsewhere.agent, { name: "Zebra account" });
    const page = await createDocument(elsewhere.agent, project.id, { title: "Zebra runbook" });
    const admin = await registerAdmin(app);

    const list = await admin.agent.get(`/api/projects/${project.id}/documents`);
    expect(list.status).toBe(404);
    const edit = await admin.agent.patch(`/api/documents/${page.id}`).send({ title: "Defaced" });
    expect(edit.status).toBe(404);
    expect((await elsewhere.agent.get(`/api/documents/${page.id}`)).body.title).toBe("Zebra runbook");
  });

  it("edits one Project's templated documentation without touching another Project's", async () => {
    const app = await makeApp();
    const lead = await registerUser(app);
    const alpha = await createCrmProject(lead.agent, { name: "Alpha" });
    const beta = await createCrmProject(lead.agent, { name: "Beta" });
    for (const { crmProject } of [alpha, beta]) {
      const enabled = await lead.agent
        .patch(`/api/crm/projects/${crmProject.id}/documentation`)
        .send({ enabled: true });
      expect(enabled.status).toBe(200);
    }
    const requirementsOf = async (projectId: string) => {
      const pages = await lead.agent.get(`/api/projects/${projectId}/documents`);
      return pages.body.find((page: { title: string }) => page.title === "Requirements");
    };
    const alphaRequirements = await requirementsOf(alpha.project.id);
    const betaBefore = await requirementsOf(beta.project.id);
    expect(alphaRequirements.id).not.toBe(betaBefore.id);

    const edited = await lead.agent
      .patch(`/api/documents/${alphaRequirements.id}`)
      .send({ content: tiptap("Alpha only: SSO before launch") });
    expect(edited.status).toBe(200);

    const betaAfter = await lead.agent.get(`/api/documents/${betaBefore.id}`);
    expect(betaAfter.body.content).toEqual(betaBefore.content);
    expect(JSON.stringify(betaAfter.body.content)).not.toContain("Alpha only");
  });
});
