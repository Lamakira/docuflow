import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PARALLEL_WORKSPACE_ID, workspaceBilling, SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { makeApp } from "../helpers/app";
import { getOwnerPool, ownerDb, resetDb } from "../helpers/db";
import { registerAdmin, registerUser, setWorkspaceRole, type Agent, type TestUser } from "../helpers/auth";
import { createClient, createCrmProject, createDocument, tiptap } from "../helpers/fixtures";
import { completeUpload } from "../helpers/objects";
import { addWorkspaceMembership, inSeededWorkspace, plantParallelWorkspace, removeAllMemberships } from "../helpers/workspace";
import { waitFor } from "../helpers/wait";
import { resetFakeBrowser, useFakeBrowser } from "../fakes/playwright";

/**
 * Project Documentation review, server half (F60-F65): what the register lists,
 * finds and orders by, whom it names, page titles and authors, and linking a
 * documentation-only Project to the Project its Documents belong to.
 */

const UNKNOWN = "00000000-0000-0000-0000-000000000000";
const PERSON_KEYS = ["email", "firstName", "id", "lastName", "profileImageUrl"];

async function rows(text: string, values: unknown[] = []) {
  return (await getOwnerPool().query(text, values)).rows;
}

async function register(agent: Agent, query: Record<string, string | number> = {}) {
  const res = await agent.get("/api/projects/documentable").query({ page: 1, ...query });
  expect(res.status).toBe(200);
  return res.body as { data: any[]; total: number; projects: any[] };
}

const names = (page: { data: any[] }) => page.data.map((entry) => entry.project.name);
const choices = (page: { projects: any[] }) => page.projects.map((choice) => choice.name);

const delivery = (agent: Agent, name: string, body: Record<string, unknown> = {}) =>
  createCrmProject(agent, { name, status: "won_in_progress", documentationEnabled: true, ...body });
const documentationOnly = (agent: Agent, name: string, body: Record<string, unknown> = {}) =>
  createCrmProject(agent, { name, isDocumentationOnly: true, documentationEnabled: true, ...body });

async function addFile(agent: Agent, projectId: string, name: string) {
  const issued = await agent.post("/api/company-documents/upload-url");
  const storagePath = completeUpload(issued.body.uploadURL, `${name} bytes`, "application/pdf");
  const res = await agent
    .post(`/api/projects/${projectId}/files`)
    .send({ name, fileName: "file.pdf", mimeType: "application/pdf", storagePath });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

describe("the Project Documentation register (F61, F62, F65)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("leaves sales out of the rows, the count and the choices", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    for (const [name, body] of [
      ["Lead", {}],
      ["Follow up", { status: "follow_up" }],
      ["Lost", { status: "lost" }],
      ["Won", { status: "won" }],
      ["Internal", { projectType: "internal" }],
      ["Documented", { status: "documented" }],
      ["Docs only", { isDocumentationOnly: true }],
    ] as const) {
      await createCrmProject(admin.agent, { name, documentationEnabled: true, ...body });
    }
    await createCrmProject(admin.agent, { name: "Open sale", status: "in_negotiation" });
    await createCrmProject(admin.agent, { name: "Undocumented", status: "won_in_progress" });

    const page = await register(admin.agent);
    expect(names(page).sort()).toEqual(["Docs only", "Documented", "Internal", "Won"]);
    expect(page.total).toBe(4);
    expect(choices(page)).toEqual(["Docs only", "Documented", "Internal", "Undocumented", "Won"]);
    expect(names(await register(admin.agent, { documentation: "disabled" }))).toEqual(["Undocumented"]);
    expect((await register(admin.agent, { documentation: "all" })).total).toBe(5);
    // v1's own list keeps every documentation-enabled Project.
    const plain = await admin.agent.get("/api/projects/documentable");
    expect(plain.body.map((project: { name: string }) => project.name)).toContain("Follow up");
  });

  it("finds a Project by the name of one of its listed Files", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const atlas = await delivery(admin.agent, "Atlas");
    const borea = await delivery(admin.agent, "Borea");
    await addFile(admin.agent, atlas.project.id, "Site 100% drawing");
    const hidden = await addFile(admin.agent, borea.project.id, "Quarantined drawing");
    await rows("UPDATE files SET scan_status = 'quarantined' WHERE id = $1", [hidden.id]);

    expect(names(await register(admin.agent, { search: "DRAWING" }))).toEqual(["Atlas"]);
    expect(names(await register(admin.agent, { search: "100%" }))).toEqual(["Atlas"]);
    expect((await register(admin.agent, { search: "1%g" })).total).toBe(0);
    expect((await register(admin.agent, { search: "_" })).total).toBe(0);
  });

  it("orders by the date it shows, the same across pages", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const made: Record<string, string> = {};
    for (const name of ["Page newest", "File newest", "Own date", "Stale pages", "Hidden file"]) {
      made[name] = (await delivery(admin.agent, name)).project.id;
    }
    const pageNewest = await createDocument(admin.agent, made["Page newest"]);
    const stale = await createDocument(admin.agent, made["Stale pages"]);
    const file = await addFile(admin.agent, made["File newest"], "Plan");
    const hidden = await addFile(admin.agent, made["Hidden file"], "Virus");
    const stamp = (table: string, id: string, at: string) =>
      rows(`UPDATE ${table} SET updated_at = $2 WHERE id = $1`, [id, at]);
    // The Project's own date is the reverse of what its content shows.
    await stamp("projects", made["Page newest"], "2026-01-01");
    await stamp("documents", pageNewest.id, "2026-06-05");
    await stamp("projects", made["File newest"], "2026-01-02");
    await stamp("files", file.id, "2026-06-04");
    await stamp("projects", made["Own date"], "2026-06-03");
    await stamp("projects", made["Hidden file"], "2026-06-02");
    await stamp("files", hidden.id, "2026-09-01");
    await rows("UPDATE files SET scan_status = 'rejected' WHERE id = $1", [hidden.id]);
    await stamp("projects", made["Stale pages"], "2026-08-01");
    await stamp("documents", stale.id, "2026-06-01");

    const order = ["Page newest", "File newest", "Own date", "Hidden file", "Stale pages"];
    expect(names(await register(admin.agent))).toEqual(order);
    const paged: string[] = [];
    for (let page = 1; page <= 5; page += 1) {
      paged.push(...names(await register(admin.agent, { page, pageSize: 1 })));
    }
    expect(paged).toEqual(order);
  });

  it("names the Client, the owner and the creators, and says what is documentation-only", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app, { firstName: "Ada", lastName: "Mensah" });
    const acme = await createClient(admin.agent, { name: "Acme" });
    const site = await delivery(admin.agent, "Site", { clientId: acme.id, memberIds: [member.id] });
    await documentationOnly(admin.agent, "Handbook");
    const page = await createDocument(member.agent, site.project.id, { title: "Runbook" });
    const orphan = await createDocument(admin.agent, site.project.id, { title: "Unsigned" });
    await rows("UPDATE documents SET created_by_id = NULL WHERE id = $1", [orphan.id]);
    await addFile(member.agent, site.project.id, "Drawing");

    const list = await register(admin.agent);
    const entry = list.data.find((row) => row.project.name === "Site");
    const handbook = list.data.find((row) => row.project.name === "Handbook");
    expect(entry).toMatchObject({ clientId: acme.id, clientName: "Acme", isDocumentationOnly: false });
    expect(handbook).toMatchObject({ clientId: null, clientName: null, isDocumentationOnly: true });
    expect(entry.owner.id).toBe(admin.id);
    expect(Object.keys(entry.owner).sort()).toEqual(PERSON_KEYS);
    expect(entry.documents.map((row: any) => [row.id, row.createdBy?.firstName ?? null])).toEqual([
      [page.id, "Ada"],
      [orphan.id, null],
    ]);
    expect(entry.documents[1].createdBy).toBeNull();
    expect(Object.keys(entry.documents[0].createdBy).sort()).toEqual(PERSON_KEYS);
    expect(entry.files[0].createdBy).toMatchObject({ id: member.id, firstName: "Ada" });
    expect(Object.keys(entry.files[0].createdBy).sort()).toEqual(PERSON_KEYS);
    expect(list.projects.map((row) => [row.name, row.isDocumentationOnly])).toEqual([
      ["Handbook", true],
      ["Site", false],
    ]);
  });

  it("holds a Member to the Projects they may see, search included", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);
    const shared = await delivery(admin.agent, "Shared", { memberIds: [member.id] });
    const closed = await delivery(admin.agent, "Closed");
    await documentationOnly(admin.agent, "Closed docs");
    await addFile(admin.agent, shared.project.id, "Drawing A");
    await addFile(admin.agent, closed.project.id, "Drawing B");

    const page = await register(member.agent);
    expect(names(page)).toEqual(["Shared"]);
    expect(choices(page)).toEqual(["Shared"]);
    expect(names(await register(member.agent, { search: "drawing" }))).toEqual(["Shared"]);
  });

  it("orders pages at one position the same way as the Dossier's tree", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const { project } = await delivery(admin.agent, "Site");
    const made = [];
    for (const title of ["A", "B", "C"]) made.push(await createDocument(admin.agent, project.id, { title }));
    await rows("UPDATE documents SET position = 0, created_at = '2026-01-02'");
    await rows("UPDATE documents SET created_at = '2026-01-01' WHERE id = $1", [made[2].id]);
    const tied = [made[0].id, made[1].id].sort();
    const order = [made[2].id, ...tied];

    const tree = await admin.agent.get(`/api/projects/${project.id}/documents`);
    expect(tree.body.map((row: { id: string }) => row.id)).toEqual(order);
    expect((await register(admin.agent)).data[0].documents.map((row: any) => row.id)).toEqual(order);
  });
});

describe("page titles and authors (F65)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("trims a title and says what is wrong with one it refuses", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { project } = await createCrmProject(user.agent);
    const post = (body: object) => user.agent.post(`/api/projects/${project.id}/documents`).send(body);
    const made = await post({ title: "  Runbook  " });
    expect(made.status).toBe(201);
    expect(made.body.title).toBe("Runbook");
    expect((await post({ title: "x".repeat(500) })).status).toBe(201);
    for (const body of [{}, { title: "" }, { title: "   " }, { title: "x".repeat(501) }, { title: 4 }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Document title must be 1 to 500 characters");
      expect(res.body.errors).toBeInstanceOf(Array);
    }

    const patch = (title: string) => user.agent.patch(`/api/documents/${made.body.id}`).send({ title });
    expect((await patch("  Notes ")).body.title).toBe("Notes");
    const long = await patch("x".repeat(501));
    expect(long.status).toBe(400);
    expect(long.body.message).toBe("Document title must be 500 characters or fewer");
    expect(long.body.errors).toBeInstanceOf(Array);
    expect((await patch("")).body.title).toBe("");
  });

  it("signs the pages made when documentation is turned on", async () => {
    const app = await makeApp();
    const lead = await registerUser(app);
    const admin = await registerAdmin(app);
    const { project, crmProject } = await createCrmProject(lead.agent, { status: "won_in_progress" });
    const on = await admin.agent.patch(`/api/crm/projects/${crmProject.id}/documentation`).send({ enabled: true });
    expect(on.status).toBe(200);
    expect(
      await rows("SELECT title, created_by_id FROM documents WHERE project_id = $1 ORDER BY position", [project.id]),
    ).toEqual(["Resources", "Requirements", "Deliverables"].map((title) => ({ title, created_by_id: admin.id })));
  });
});

describe("a documentation-only Project's own record (F60)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("answers its Members and nobody else, and says it is documentation-only", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const assigned = await registerUser(app);
    const outsider = await registerUser(app);
    await setWorkspaceRole(assigned.id, "member");
    await setWorkspaceRole(outsider.id, "member");
    const { project, crmProject } = await documentationOnly(admin.agent, "Handbook", { memberIds: [assigned.id] });

    for (const path of [`/api/crm/projects/by-project/${project.id}`, `/api/crm/projects/${crmProject.id}`]) {
      for (const reader of [admin, assigned]) {
        const res = await reader.agent.get(path);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id: crmProject.id, projectId: project.id, isDocumentationOnly: 1 });
      }
      expect((await outsider.agent.get(path)).status).toBe(404);
    }
  });
});

describe("linking a documentation-only Project", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    resetFakeBrowser();
  });

  const link = (user: TestUser, sourceId: string, targetId: unknown) =>
    user.agent.post(`/api/crm/projects/${sourceId}/link-documentation`).send({ targetId });

  async function seed() {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const source = await documentationOnly(admin.agent, "Harbor docs");
    const target = await createCrmProject(admin.agent, { name: "Harbor", status: "won_in_progress" });
    return { app, admin, source, target };
  }

  it("is an Owner's and an Administrator's to do", async () => {
    const { app, admin, source, target } = await seed();
    const member = await registerUser(app);
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    await admin.agent.post(`/api/crm/projects/${source.crmProject.id}/members`).send({ userId: member.id });

    const refused = await link(member, source.crmProject.id, target.crmProject.id);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/Owner or an Administrator/);
    expect((await link(owner, source.crmProject.id, target.crmProject.id)).status).toBe(200);
  });

  it("refuses what is not a documentation-only source or a delivery target", async () => {
    const { admin, source, target } = await seed();
    const otherDocs = await documentationOnly(admin.agent, "Other docs");
    const sale = await createCrmProject(admin.agent, { name: "Sale", status: "follow_up" });
    const lost = await createCrmProject(admin.agent, { name: "Lost", status: "lost" });
    const page = await createDocument(admin.agent, source.project.id);

    for (const targetId of [undefined, "", 3]) {
      expect((await link(admin, source.crmProject.id, targetId)).status).toBe(400);
    }
    expect((await link(admin, UNKNOWN, target.crmProject.id)).status).toBe(404);
    expect((await link(admin, source.crmProject.id, UNKNOWN)).status).toBe(404);
    const wrongSource = await link(admin, target.crmProject.id, target.crmProject.id);
    expect([wrongSource.status, wrongSource.body.message]).toEqual([
      400,
      "Only a documentation-only Project can be linked",
    ]);
    for (const id of [source, otherDocs, sale, lost].map((project) => project.crmProject.id)) {
      const res = await link(admin, source.crmProject.id, id);
      expect([res.status, res.body.message]).toEqual([
        400,
        "Documents can only move to a Client Project or an Internal Project",
      ]);
    }
    expect(await rows("SELECT project_id FROM documents WHERE id = $1", [page.id])).toEqual([
      { project_id: source.project.id },
    ]);
    expect(await rows("SELECT id FROM audit_events WHERE action = 'documentation.linked'")).toEqual([]);
  });

  it("refuses another Workspace's Projects, on either side", async () => {
    const { app, admin, source, target } = await seed();
    await plantParallelWorkspace();
    const elsewhere = await registerUser(app);
    await removeAllMemberships(elsewhere.id);
    await addWorkspaceMembership(elsewhere.id, PARALLEL_WORKSPACE_ID, "owner");
    const theirs = await delivery(elsewhere.agent, "Zebra");
    const theirDocs = await documentationOnly(elsewhere.agent, "Zebra docs");

    expect((await link(admin, source.crmProject.id, theirs.crmProject.id)).status).toBe(404);
    expect((await link(admin, theirDocs.crmProject.id, target.crmProject.id)).status).toBe(404);
    expect((await link(elsewhere, source.crmProject.id, theirs.crmProject.id)).status).toBe(404);
  });

  it("follows the Plan and Read-only gates of documentation", async () => {
    const { admin, source, target } = await seed();
    const { featureForRequest } = await import("../../server/modules/billing/featureGate");
    expect(featureForRequest("POST", "/api/crm/projects/x/link-documentation")).toEqual({
      feature: "knowledge",
      mode: "write",
    });
    const billing = (values: Partial<typeof workspaceBilling.$inferInsert>) =>
      ownerDb.update(workspaceBilling).set(values).where(eq(workspaceBilling.workspaceId, SEEDED_WORKSPACE_ID));
    await billing({ planKey: "starter", registryVersion: 2 });
    const plan = await link(admin, source.crmProject.id, target.crmProject.id);
    expect([plan.status, plan.body.code]).toEqual([403, "plan_upgrade_required"]);
    await billing({ planKey: "legacy", registryVersion: 1, billingState: "ReadOnly" });
    const readOnly = await link(admin, source.crmProject.id, target.crmProject.id);
    expect([readOnly.status, readOnly.body.message]).toEqual([403, "Workspace is read-only"]);
  });

  it("moves every page and File, keeping order and nesting", async () => {
    const { admin, source, target } = await seed();
    const kept = await createDocument(admin.agent, target.project.id, { title: "Kept" });
    await rows("UPDATE documents SET position = 4 WHERE id = $1", [kept.id]);
    const first = await createDocument(admin.agent, source.project.id, { title: "First" });
    const second = await createDocument(admin.agent, source.project.id, { title: "Second" });
    const childA = await createDocument(admin.agent, source.project.id, { title: "Child A", parentId: first.id });
    const childB = await createDocument(admin.agent, source.project.id, { title: "Child B", parentId: first.id });
    const deep = await createDocument(admin.agent, source.project.id, { title: "Deep", parentId: childB.id });
    const file = await addFile(admin.agent, source.project.id, "Drawing");
    const quarantined = await addFile(admin.agent, source.project.id, "Quarantined");
    await rows("UPDATE files SET scan_status = 'quarantined' WHERE id = $1", [quarantined.id]);
    await rows("UPDATE projects SET updated_at = '2026-01-01'");
    const dates = () => rows("SELECT id, updated_at FROM documents ORDER BY id");
    const datesBefore = await dates();

    const res = await link(admin, source.crmProject.id, target.crmProject.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ targetId: target.crmProject.id, documents: 5, files: 2 });

    expect(
      await rows("SELECT id, parent_id, position FROM documents WHERE project_id = $1 ORDER BY parent_id NULLS FIRST, position", [
        target.project.id,
      ]),
    ).toEqual(
      expect.arrayContaining([
        { id: kept.id, parent_id: null, position: 4 },
        { id: first.id, parent_id: null, position: 5 },
        { id: second.id, parent_id: null, position: 6 },
        { id: childA.id, parent_id: first.id, position: 0 },
        { id: childB.id, parent_id: first.id, position: 1 },
        { id: deep.id, parent_id: childB.id, position: 0 },
      ]),
    );
    // No template pages, and a page keeps its own date.
    expect(await rows("SELECT id FROM documents")).toHaveLength(6);
    expect(await dates()).toEqual(datesBefore);
    expect(await rows("SELECT project_id FROM files")).toEqual([
      { project_id: target.project.id },
      { project_id: target.project.id },
    ]);
    expect((await admin.agent.get(`/api/projects/${target.project.id}/files/${file.id}/stream`)).status).toBe(200);
    expect((await admin.agent.get(`/api/projects/${source.project.id}/files/${file.id}/stream`)).status).toBe(404);
    expect(
      await rows("SELECT id, documentation_enabled AS enabled FROM crm_projects WHERE id = ANY($1) ORDER BY enabled", [
        [source.crmProject.id, target.crmProject.id],
      ]),
    ).toEqual([
      { id: source.crmProject.id, enabled: 0 },
      { id: target.crmProject.id, enabled: 1 },
    ]);
    for (const row of await rows("SELECT updated_at FROM projects")) {
      expect(row.updated_at.getTime()).toBeGreaterThan(Date.parse("2026-02-01"));
    }
    expect(
      await rows(
        "SELECT actor_kind, actor_id, resource_type, resource_id, payload, workspace_id FROM audit_events WHERE action = 'documentation.linked'",
      ),
    ).toEqual([
      {
        actor_kind: "user",
        actor_id: admin.id,
        resource_type: "crm_projects",
        resource_id: source.crmProject.id,
        payload: { from: source.crmProject.id, to: target.crmProject.id, documents: 5, files: 2 },
        workspace_id: SEEDED_WORKSPACE_ID,
      },
    ]);
  });

  it("links an empty Project to one that has no pages", async () => {
    const { admin, source, target } = await seed();
    const res = await link(admin, source.crmProject.id, target.crmProject.id);
    expect(res.body).toEqual({ targetId: target.crmProject.id, documents: 0, files: 0 });
    expect(names(await register(admin.agent))).toEqual(["Harbor"]);
  });

  const chunksOf = (documentId: string) =>
    rows("SELECT project_id, metadata, chunk_text FROM document_embeddings WHERE document_id = $1", [documentId]);

  it("takes the index and the transcripts along", async () => {
    const { admin, source, target } = await seed();
    const { updateDocumentEmbeddings } = await import("../../server/embeddings");
    const page = await createDocument(admin.agent, source.project.id, { title: "Spec", content: tiptap("quantum") });
    await inSeededWorkspace(() =>
      updateDocumentEmbeddings(page.id, source.project.id, admin.id, "Spec", tiptap("quantum"), "Harbor docs", ["Up"]),
    );
    const [transcript] = await rows(
      `INSERT INTO video_transcripts (video_url, video_id, provider, document_id, project_id, owner_id, workspace_id)
       VALUES ('u', 'v', 'loom', $1, $2, $3, 'seeded') RETURNING id`,
      [page.id, source.project.id, admin.id],
    );
    expect((await link(admin, source.crmProject.id, target.crmProject.id)).status).toBe(200);
    const chunks = await chunksOf(page.id);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      project_id: target.project.id,
      metadata: { title: "Spec", projectName: "Harbor", breadcrumbs: ["Up"] },
    });
    expect(await rows("SELECT project_id FROM video_transcripts WHERE id = $1", [transcript.id])).toEqual([
      { project_id: target.project.id },
    ]);
    // The index no longer hangs on the emptied Project.
    expect((await admin.agent.delete(`/api/crm/projects/${source.crmProject.id}`)).status).toBe(204);
    expect(await chunksOf(page.id)).toHaveLength(1);
  });

  it("re-reads the Project when an index write that started before the move lands after it", async () => {
    const { admin, source, target } = await seed();
    const { updateDocumentEmbeddings } = await import("../../server/embeddings");
    const page = await createDocument(admin.agent, source.project.id, { title: "Spec" });
    expect((await link(admin, source.crmProject.id, target.crmProject.id)).status).toBe(200);
    await inSeededWorkspace(() =>
      updateDocumentEmbeddings(page.id, source.project.id, admin.id, "Spec", tiptap("late"), "Harbor docs"),
    );
    expect((await chunksOf(page.id))[0]).toMatchObject({
      project_id: target.project.id,
      metadata: { projectName: "Harbor", title: "Spec" },
    });
  });

  it("waits for a move that has not committed when an index write lands during it", async () => {
    const { admin, source, target } = await seed();
    const { updateDocumentEmbeddings } = await import("../../server/embeddings");
    const page = await createDocument(admin.agent, source.project.id, { title: "Spec" });
    const move = await getOwnerPool().connect();
    let landed = false;
    try {
      await move.query("BEGIN");
      await move.query("UPDATE documents SET project_id = $1 WHERE id = $2", [target.project.id, page.id]);
      const write = inSeededWorkspace(() =>
        updateDocumentEmbeddings(page.id, source.project.id, admin.id, "Spec", tiptap("during"), "Harbor docs"),
      ).then(() => {
        landed = true;
      });
      await waitFor(
        async () =>
          (await rows("SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%for share%' AND datname = current_database()"))
            .length > 0,
        { label: "the index write to wait for the move" },
      );
      expect(landed).toBe(false);
      await move.query("COMMIT");
      await write;
    } finally {
      await move.query("ROLLBACK").catch(() => {});
      move.release();
    }
    expect((await chunksOf(page.id))[0]).toMatchObject({
      project_id: target.project.id,
      metadata: { projectName: "Harbor" },
    });
  });

  it("re-reads the Project when a transcript read during the move lands after it", async () => {
    const { admin, source, target } = await seed();
    const { syncDocumentVideoTranscripts } = await import("../../server/transcripts");
    const page = await createDocument(admin.agent, source.project.id, { title: "Demo" });
    const videoId = "sanitized-recording-id";
    const videoUrl = `https://www.loom.com/share/${videoId}`;
    const fixture = readFileSync(join(import.meta.dirname, "../fixtures/loom-transcription-1.1.3.json"), "utf8");
    let linked = 0;
    useFakeBrowser({
      responses: [
        {
          url: `https://cdn.loom.com/mediametadata/transcription/${videoId}-1.json`,
          contentType: "application/json",
          body: async () => {
            linked = (await link(admin, source.crmProject.id, target.crmProject.id)).status;
            return fixture;
          },
        },
      ],
    });
    await inSeededWorkspace(() =>
      syncDocumentVideoTranscripts(
        page.id,
        source.project.id,
        admin.id,
        { type: "doc", content: [{ type: "videoEmbed", attrs: { src: videoUrl } }] },
        "Harbor docs",
        "Demo",
        [],
        { awaitProcessing: true },
      ),
    );
    expect(linked).toBe(200);
    const transcripts = await rows("SELECT project_id, status FROM video_transcripts");
    expect(transcripts).toEqual([{ project_id: target.project.id, status: "completed" }]);
    const chunks = await chunksOf(page.id);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk).toMatchObject({
        project_id: target.project.id,
        metadata: { projectName: "Harbor", isVideoTranscript: true },
      });
    }
  });

  it("re-reads the Project when a transcript row is made after the move", async () => {
    const { admin, source, target } = await seed();
    const { syncDocumentVideoTranscripts } = await import("../../server/transcripts");
    const page = await createDocument(admin.agent, source.project.id, { title: "Demo" });
    expect((await link(admin, source.crmProject.id, target.crmProject.id)).status).toBe(200);
    // The fake browser refuses to launch, so the read fails; the row is what matters.
    await inSeededWorkspace(() =>
      syncDocumentVideoTranscripts(
        page.id,
        source.project.id,
        admin.id,
        { type: "doc", content: [{ type: "videoEmbed", attrs: { src: "https://www.loom.com/share/late" } }] },
        "Harbor docs",
        "Demo",
        [],
        { awaitProcessing: true },
      ),
    );
    expect(await rows("SELECT project_id FROM video_transcripts")).toEqual([{ project_id: target.project.id }]);
  });
});
