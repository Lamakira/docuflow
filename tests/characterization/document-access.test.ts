import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerAdmin, registerUser, type TestUser } from "../helpers/auth";
import { createCrmProject, createFolder, tiptap } from "../helpers/fixtures";
import { completeUpload } from "../helpers/objects";
import { chatCalls, setChatReply } from "../fakes/openai";

/**
 * Document Access (#278): Everyone, Restricted to named Members, or
 * Administrators only, on a Workspace Document, File, or Folder.
 *
 *  - An item inherits its Folder's access and can be more restricted, never
 *    more open. The server refuses a change that would open it.
 *  - The member who added an item and Administrators change its access; any
 *    other Member is refused.
 *  - A Member without access meets a closed item nowhere: the Folder list, the
 *    Document list, search, a direct read, the stream, and Ask answers all
 *    answer as though it did not exist.
 *  - A Project File is a File on one Project, reachable by Members assigned
 *    to that Project.
 */

async function writeDocument(user: TestUser, name: string, folderId?: string) {
  const res = await user.agent
    .post("/api/company-documents")
    .send({ name, content: tiptap(`${name} body text`), ...(folderId ? { folderId } : {}) });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

async function setAccess(
  user: TestUser,
  kind: "document" | "folder",
  id: string,
  level: string,
  memberIds: string[] = [],
) {
  const path = kind === "folder" ? `/api/company-document-folders/${id}/access` : `/api/company-documents/${id}/access`;
  return user.agent.put(path).send({ level, memberIds });
}

describe("Document Access (#278)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("hides everything in a Restricted Folder from a Member it does not name, everywhere", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const named = await registerUser(app);
    const outsider = await registerUser(app);

    const folder = await createFolder(admin.agent, { name: "Payroll" });
    const ledger = await writeDocument(admin, "Salary ledger", folder.id);
    expect((await setAccess(admin, "folder", folder.id, "restricted", [named.id])).status).toBe(200);

    // The outsider: no Folder, no Document, no search hit, no direct read.
    const folders = await outsider.agent.get("/api/company-document-folders");
    expect(folders.body.map((row: { id: string }) => row.id)).not.toContain(folder.id);
    expect((await outsider.agent.get(`/api/company-document-folders/${folder.id}`)).status).toBe(404);
    const listed = await outsider.agent.get("/api/company-documents").query({ folderId: folder.id });
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([]);
    const search = await outsider.agent.get("/api/company-documents/search").query({ q: "Salary" });
    expect(search.body.documents).toEqual([]);
    expect(search.body.folders).toEqual([]);
    expect(JSON.stringify(search.body)).not.toMatch(/hidden/i);
    const direct = await outsider.agent.get(`/api/company-documents/${ledger.id}`);
    expect(direct.status).toBe(404);
    expect(direct.body).toEqual({ message: "Document not found" });
    expect((await outsider.agent.get(`/api/company-documents/${ledger.id}/access`)).status).toBe(404);
    expect((await outsider.agent.patch(`/api/company-documents/${ledger.id}`).send({ name: "x" })).status).toBe(404);
    expect(
      (await outsider.agent.post("/api/company-documents").send({ name: "Sneak", folderId: folder.id })).status,
    ).toBe(400);

    // The named Member sees the Folder and what is in it, stamped with the level that applies.
    const namedList = await named.agent.get("/api/company-documents").query({ folderId: folder.id });
    expect(namedList.body).toEqual([
      expect.objectContaining({ id: ledger.id, effectiveAccess: "restricted", canManageAccess: false }),
    ]);
    const namedSearch = await named.agent.get("/api/company-documents/search").query({ q: "Salary" });
    expect(namedSearch.body.documents.map((row: { id: string }) => row.id)).toEqual([ledger.id]);
    expect((await named.agent.get(`/api/company-documents/${ledger.id}`)).status).toBe(200);

    // Administrators see everything.
    const adminRead = await admin.agent.get(`/api/company-documents/${ledger.id}`);
    expect(adminRead.body).toMatchObject({ effectiveAccess: "restricted", canManageAccess: true });
  });

  it("keeps a closed Document out of Ask answers and citations for a Member without access", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);
    const secret = await writeDocument(admin, "Board minutes");
    await writeDocument(admin, "Holiday policy");
    expect((await setAccess(admin, "document", secret.id, "administrators")).status).toBe(200);
    setChatReply("Here is what I found.");

    const res = await member.agent.post("/api/chat").send({ message: "What is in the minutes?", mode: "company" });
    expect(res.status).toBe(200);
    const prompt = chatCalls().at(-1)!.messages[0].content;
    expect(prompt).not.toContain("Board minutes");
    expect(prompt).toContain("Holiday policy");
    expect(JSON.stringify(res.body.citations ?? [])).not.toContain(secret.id);
  });

  it("inherits the Folder's access, and refuses a level more open than it", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const named = await registerUser(app);
    const other = await registerUser(app);

    const vault = await createFolder(admin.agent, { name: "Vault" });
    const inner = await createFolder(admin.agent, { name: "Inner", parentId: vault.id });
    const plan = await writeDocument(admin, "Exit plan", inner.id);
    expect((await setAccess(admin, "folder", vault.id, "restricted", [named.id])).status).toBe(200);

    const state = await admin.agent.get(`/api/company-documents/${plan.id}/access`);
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      kind: "document",
      level: "workspace",
      effectiveLevel: "restricted",
      inherited: { level: "restricted", from: { id: vault.id, name: "Vault" } },
      allowedLevels: ["workspace", "restricted", "administrators"],
      canChange: true,
    });
    expect(state.body.inherited.memberIds).toEqual([admin.id, named.id].sort());

    // Naming a Member the Folder does not name would open it wider.
    const wider = await setAccess(admin, "document", plan.id, "restricted", [other.id]);
    expect(wider.status).toBe(400);
    expect(wider.body.message).toBe("Only Members who can see Vault can be named here.");
    expect((await other.agent.get(`/api/company-documents/${plan.id}`)).status).toBe(404);

    // Restricted with nobody named is refused.
    const nobody = await setAccess(admin, "document", plan.id, "restricted", []);
    expect(nobody.status).toBe(400);

    // Under an Administrators-only Folder, Restricted would be more open.
    expect((await setAccess(admin, "folder", inner.id, "administrators")).status).toBe(200);
    const underAdmins = await setAccess(admin, "document", plan.id, "restricted", [named.id]);
    expect(underAdmins.status).toBe(400);
    expect(underAdmins.body.message).toBe("This item cannot be more open than Inner, which is Administrators only.");
    const narrowed = await admin.agent.get(`/api/company-documents/${plan.id}/access`);
    expect(narrowed.body.allowedLevels).toEqual(["workspace", "administrators"]);
    expect((await named.agent.get(`/api/company-documents/${plan.id}`)).status).toBe(404);

    // Everyone inside a closed Folder leaves the Folder in charge; it opens nothing.
    const same = await setAccess(admin, "document", plan.id, "workspace");
    expect(same.status).toBe(200);
    expect(same.body).toMatchObject({ level: "workspace", effectiveLevel: "administrators" });
    expect((await other.agent.get(`/api/company-documents/${plan.id}`)).status).toBe(404);

    // Reopening the Folders reopens what is inside them.
    expect((await setAccess(admin, "folder", inner.id, "workspace")).status).toBe(200);
    expect((await setAccess(admin, "folder", vault.id, "workspace")).status).toBe(200);
    expect((await other.agent.get(`/api/company-documents/${plan.id}`)).status).toBe(200);
  });

  it("lets the member who added an item and Administrators change its access, and refuses anyone else", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const author = await registerUser(app);
    const colleague = await registerUser(app);

    const draft = await writeDocument(author, "Draft proposal");
    const refused = await setAccess(colleague, "document", draft.id, "administrators");
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({
      message: "Only the owner of this item or an Administrator can change its access",
    });
    const seen = await colleague.agent.get(`/api/company-documents/${draft.id}/access`);
    expect(seen.body.canChange).toBe(false);

    const byAuthor = await setAccess(author, "document", draft.id, "restricted", [colleague.id]);
    expect(byAuthor.status).toBe(200);
    expect(byAuthor.body).toMatchObject({ level: "restricted", memberIds: [colleague.id] });
    expect((await colleague.agent.get(`/api/company-documents/${draft.id}`)).status).toBe(200);

    const byAdmin = await setAccess(admin, "document", draft.id, "administrators");
    expect(byAdmin.status).toBe(200);
    expect((await colleague.agent.get(`/api/company-documents/${draft.id}`)).status).toBe(404);
    // The member who added it keeps sight of it at its own level.
    expect((await author.agent.get(`/api/company-documents/${draft.id}`)).status).toBe(200);

    const folder = await createFolder(author.agent, { name: "Author's folder" });
    expect((await setAccess(colleague, "folder", folder.id, "administrators")).status).toBe(403);
    expect((await setAccess(admin, "folder", folder.id, "administrators")).status).toBe(200);
    expect((await colleague.agent.get(`/api/company-document-folders/${folder.id}`)).status).toBe(404);
  });

  it("names only active Members of the Workspace", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const document = await writeDocument(admin, "Roster");
    const res = await setAccess(admin, "document", document.id, "restricted", ["not-a-member"]);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Only active Members of this Workspace can be named");
  });

  it("closes an uploaded File's stream to a Member without access", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);

    const issued = await admin.agent.post("/api/company-documents/upload-url");
    const storagePath = completeUpload(issued.body.uploadURL, "contract bytes", "application/pdf");
    const created = await admin.agent.post("/api/company-documents").send({
      name: "Contract",
      fileName: "contract.pdf",
      fileSize: 14,
      mimeType: "application/pdf",
      storagePath,
    });
    expect(created.status).toBe(201);
    expect((await member.agent.get(`/api/company-documents/${created.body.id}/stream`)).status).toBe(200);

    expect((await setAccess(admin, "document", created.body.id, "administrators")).status).toBe(200);
    expect((await member.agent.get(`/api/company-documents/${created.body.id}/stream`)).status).toBe(404);
    expect((await member.agent.get(`/api/company-documents/${created.body.id}/download`)).status).toBe(404);
    expect((await admin.agent.get(`/api/company-documents/${created.body.id}/stream`)).status).toBe(200);
  });
});

describe("Project Files (#278)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("adds a File to a Project through the upload slot, and lists it with the Project's Documents", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);
    const { project, crmProject } = await createCrmProject(admin.agent, {
      name: "Harbor fit-out",
      documentationEnabled: true,
    });

    const issued = await admin.agent.post("/api/company-documents/upload-url");
    const storagePath = completeUpload(issued.body.uploadURL, "drawing bytes", "application/pdf");
    const added = await admin.agent.post(`/api/projects/${project.id}/files`).send({
      name: "Site drawing",
      fileName: "site.pdf",
      fileSize: 13,
      mimeType: "application/pdf",
      storagePath,
    });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ name: "Site drawing", projectId: project.id });

    const listed = await admin.agent.get(`/api/projects/${project.id}/files`);
    expect(listed.body).toEqual([expect.objectContaining({ id: added.body.id, name: "Site drawing" })]);
    const stream = await admin.agent.get(`/api/projects/${project.id}/files/${added.body.id}/stream`);
    expect(stream.status).toBe(200);

    // The Project Documentation page carries it beside the Project's Documents.
    const page = await admin.agent.get("/api/projects/documentable").query({ scope: "visible", documentation: "all", page: 1, pageSize: 50 });
    expect(page.status).toBe(200);
    const entry = page.body.data.find((row: { project: { id: string } }) => row.project.id === project.id);
    expect(entry.files.map((row: { id: string }) => row.id)).toEqual([added.body.id]);

    // A Project File is not a Workspace Document.
    const workspace = await admin.agent.get("/api/company-documents");
    expect(workspace.body.map((row: { id: string }) => row.id)).not.toContain(added.body.id);

    // A Member without a Project Assignment cannot list, read, or add.
    expect((await member.agent.get(`/api/projects/${project.id}/files`)).status).toBe(404);
    expect(
      (await member.agent.get(`/api/projects/${project.id}/files/${added.body.id}/stream`)).status,
    ).toBe(404);
    expect(
      (await member.agent.post(`/api/projects/${project.id}/files`).send({
        name: "Sneak",
        fileName: "sneak.pdf",
        storagePath,
      })).status,
    ).toBe(404);

    const assigned = await admin.agent.post(`/api/crm/projects/${crmProject.id}/members`).send({ userId: member.id });
    expect(assigned.status).toBeLessThan(300);
    const memberList = await member.agent.get(`/api/projects/${project.id}/files`);
    expect(memberList.status).toBe(200);
    expect(memberList.body.map((row: { id: string }) => row.id)).toEqual([added.body.id]);
  });
});
