import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerUser } from "../helpers/auth";
import { createCrmProject, createDocument, tiptap } from "../helpers/fixtures";

/**
 * Characterization: projects and their TipTap document tree.
 *
 * Quirks frozen here:
 *  - Every project is visible to every authenticated user. `getProjects` takes a
 *    user id and ignores it, so "my projects" is really "all projects".
 *  - `POST /api/projects` and `DELETE /api/projects/:id` are retired in place:
 *    they answer 400 with a `redirectTo` pointing at the CRM routes.
 *  - `PATCH /api/projects/:id` accepts only `name`; other fields are silently
 *    dropped rather than rejected.
 *  - `GET /api/search` scopes project hits to the caller's own projects but
 *    document hits to every project, and matches case-sensitively.
 *  - Document delete answers 204 and cascades to descendants; document reorder
 *    answers `{ success: true }` whatever it did.
 */
describe("projects and documents (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists every project regardless of who owns it, newest update first", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    const other = await registerUser(app);

    const first = await createCrmProject(owner.agent, { name: "Alpha" });
    const second = await createCrmProject(other.agent, { name: "Beta" });

    const asOwner = await owner.agent.get("/api/projects");
    expect(asOwner.status).toBe(200);
    // Quirk: company-wide visibility — the other user's project is listed too.
    expect(asOwner.body.map((p: { id: string }) => p.id)).toEqual([
      second.project.id,
      first.project.id,
    ]);

    const asOther = await other.agent.get("/api/projects");
    expect(asOther.body).toHaveLength(2);

    const single = await other.agent.get(`/api/projects/${first.project.id}`);
    expect(single.status).toBe(200);
    expect(single.body).toMatchObject({ id: first.project.id, name: "Alpha", ownerId: owner.id });

    const missing = await owner.agent.get("/api/projects/00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Project not found" });
  });

  it("lists only documentation-enabled projects on the documentable route", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const enabled = await createCrmProject(user.agent, {
      name: "Documented",
      documentationEnabled: true,
    });
    await createCrmProject(user.agent, { name: "Not documented" });

    const res = await user.agent.get("/api/projects/documentable");
    expect(res.status).toBe(200);
    expect(res.body.map((p: { id: string }) => p.id)).toEqual([enabled.project.id]);
  });

  it("keeps the retired create and delete endpoints answering 400 with a redirect hint", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { project } = await createCrmProject(user.agent);

    const created = await user.agent.post("/api/projects").send({ name: "Direct" });
    expect(created.status).toBe(400);
    expect(created.body).toEqual({
      message: "Projects must be created through Project Management. Use POST /api/crm/projects instead.",
      redirectTo: "/api/crm/projects",
    });

    const deleted = await user.agent.delete(`/api/projects/${project.id}`);
    expect(deleted.status).toBe(400);
    expect(deleted.body).toEqual({
      message: "Projects must be deleted through Project Management. Use DELETE /api/crm/projects/:id instead.",
      redirectTo: "/api/crm/projects",
    });

    // Quirk: the retired delete never looks the project up, so an unknown id
    // gets the same 400 rather than a 404.
    const deletedUnknown = await user.agent.delete("/api/projects/does-not-exist");
    expect(deletedUnknown.status).toBe(400);
  });

  it("renames a project and drops any other field in the payload", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { project } = await createCrmProject(user.agent, { description: "original" });

    const res = await user.agent
      .patch(`/api/projects/${project.id}`)
      .send({ name: "Renamed", description: "ignored", ownerId: "someone-else" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: project.id,
      name: "Renamed",
      // Quirk: unknown keys are stripped by the schema, not rejected — the
      // description and owner are untouched and the caller is never told.
      description: "original",
      ownerId: user.id,
    });

    const empty = await user.agent.patch(`/api/projects/${project.id}`).send({ name: "" });
    expect(empty.status).toBe(400);
    expect(empty.body.message).toBe("Invalid data");
    expect(Array.isArray(empty.body.errors)).toBe(true);
  });

  it("creates nested documents, appending each to the end of its sibling list", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { project } = await createCrmProject(user.agent);

    const first = await createDocument(user.agent, project.id, { title: "First" });
    const second = await createDocument(user.agent, project.id, { title: "Second" });
    const child = await createDocument(user.agent, project.id, {
      title: "Child",
      parentId: first.id,
    });

    expect(first).toMatchObject({ position: 0, parentId: null, projectId: project.id });
    expect(second.position).toBe(1);
    // Position is per parent, so the first child starts at 0 again.
    expect(child).toMatchObject({ position: 0, parentId: first.id });

    const list = await user.agent.get(`/api/projects/${project.id}/documents`);
    expect(list.status).toBe(200);
    expect(list.body.map((d: { title: string }) => d.title)).toEqual(["First", "Child", "Second"]);

    const grandchild = await createDocument(user.agent, project.id, {
      title: "Grandchild",
      parentId: child.id,
    });

    // Quirk (bug, frozen deliberately): `getDocumentAncestors` only collects a
    // node when that node itself has a parent, so the top-level ancestor is
    // always dropped. A child of a root page therefore reports no ancestors at
    // all, and a grandchild reports only its immediate parent. Breadcrumbs fed
    // to the embedding pipeline inherit the same gap.
    const rootChildAncestors = await user.agent.get(`/api/documents/${child.id}/ancestors`);
    expect(rootChildAncestors.status).toBe(200);
    expect(rootChildAncestors.body).toEqual([]);

    const ancestors = await user.agent.get(`/api/documents/${grandchild.id}/ancestors`);
    expect(ancestors.status).toBe(200);
    expect(ancestors.body.map((d: { id: string }) => d.id)).toEqual([child.id]);

    const missingProject = await user.agent
      .post("/api/projects/00000000-0000-0000-0000-000000000000/documents")
      .send({ title: "Orphan" });
    expect(missingProject.status).toBe(404);
    expect(missingProject.body).toEqual({ message: "Project not found" });

    const invalid = await user.agent.post(`/api/projects/${project.id}/documents`).send({});
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toBe("Invalid data");
  });

  it("returns a document with its creator inlined", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { firstName: "Ada" });
    const { project } = await createCrmProject(user.agent);
    const doc = await createDocument(user.agent, project.id, { content: tiptap("hello") });

    const res = await user.agent.get(`/api/documents/${doc.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: doc.id, projectId: project.id });
    expect(res.body.createdBy).toMatchObject({ id: user.id, firstName: "Ada" });
    expect(res.body.createdBy).not.toHaveProperty("password");

    const missing = await user.agent.get("/api/documents/00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Document not found" });
  });

  it("updates a document and lists it as recently touched", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { project } = await createCrmProject(user.agent);
    const first = await createDocument(user.agent, project.id, { title: "First" });
    const second = await createDocument(user.agent, project.id, { title: "Second" });

    const updated = await user.agent
      .patch(`/api/documents/${first.id}`)
      .send({ title: "First edited", content: tiptap("body text"), icon: "book" });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ id: first.id, title: "First edited", icon: "book" });

    const recent = await user.agent.get("/api/documents/recent");
    expect(recent.status).toBe(200);
    expect(recent.body.map((d: { id: string }) => d.id)).toEqual([first.id, second.id]);
  });

  it("deletes a document together with its descendants", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { project } = await createCrmProject(user.agent);
    const parent = await createDocument(user.agent, project.id, { title: "Parent" });
    const child = await createDocument(user.agent, project.id, {
      title: "Child",
      parentId: parent.id,
    });
    const keep = await createDocument(user.agent, project.id, { title: "Keep" });

    const res = await user.agent.delete(`/api/documents/${parent.id}`);
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});

    const remaining = await user.agent.get(`/api/projects/${project.id}/documents`);
    expect(remaining.body.map((d: { id: string }) => d.id)).toEqual([keep.id]);

    const gone = await user.agent.get(`/api/documents/${child.id}`);
    expect(gone.status).toBe(404);
  });

  it("duplicates a document under a de-duplicated title, just after the original", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { project } = await createCrmProject(user.agent);
    const original = await createDocument(user.agent, project.id, { title: "Runbook" });
    const after = await createDocument(user.agent, project.id, { title: "After" });

    const copy = await user.agent.post(`/api/documents/${original.id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ title: "Runbook (Copy)", position: 1, parentId: null });

    const list = await user.agent.get(`/api/projects/${project.id}/documents`);
    expect(list.body.map((d: { title: string }) => d.title)).toEqual([
      "Runbook",
      "Runbook (Copy)",
      "After",
    ]);
    expect(list.body[2].id).toBe(after.id);
  });

  it("reorders documents and reports success even for a no-op", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { project } = await createCrmProject(user.agent);
    const first = await createDocument(user.agent, project.id, { title: "First" });
    const second = await createDocument(user.agent, project.id, { title: "Second" });

    const moved = await user.agent
      .post(`/api/projects/${project.id}/documents/reorder`)
      .send({ documentId: second.id, newParentId: null, newPosition: 0 });
    expect(moved.status).toBe(200);
    expect(moved.body).toEqual({ success: true });

    const list = await user.agent.get(`/api/projects/${project.id}/documents`);
    expect(list.body.map((d: { title: string }) => d.title)).toEqual(["Second", "First"]);

    const nested = await user.agent
      .post(`/api/projects/${project.id}/documents/reorder`)
      .send({ documentId: first.id, newParentId: second.id, newPosition: 0 });
    expect(nested.status).toBe(200);
    const afterNesting = await user.agent.get(`/api/documents/${first.id}`);
    expect(afterNesting.body.parentId).toBe(second.id);

    const missingFields = await user.agent
      .post(`/api/projects/${project.id}/documents/reorder`)
      .send({ documentId: first.id });
    expect(missingFields.status).toBe(400);
    expect(missingFields.body).toEqual({ message: "documentId and newPosition are required" });

    const otherProject = await createCrmProject(user.agent);
    const wrongProject = await user.agent
      .post(`/api/projects/${otherProject.project.id}/documents/reorder`)
      .send({ documentId: first.id, newPosition: 0 });
    expect(wrongProject.status).toBe(400);
    expect(wrongProject.body).toEqual({ message: "Document does not belong to this project" });
  });

  it("searches titles case-sensitively, scoping projects to the caller but documents to everyone", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    const other = await registerUser(app);

    const mine = await createCrmProject(owner.agent, { name: "Reporting Portal" });
    const theirs = await createCrmProject(other.agent, { name: "Reporting Engine" });
    await createDocument(other.agent, theirs.project.id, { title: "Reporting notes" });

    const res = await owner.agent.get("/api/search").query({ q: "Reporting" });
    expect(res.status).toBe(200);
    const projectHits = res.body.filter((r: { type: string }) => r.type === "project");
    const documentHits = res.body.filter((r: { type: string }) => r.type === "document");
    // Quirk: project hits are owner-scoped …
    expect(projectHits.map((r: { id: string }) => r.id)).toEqual([mine.project.id]);
    // … while document hits span every project in the workspace.
    expect(documentHits.map((r: { title: string }) => r.title)).toEqual(["Reporting notes"]);
    expect(documentHits[0].projectName).toBe("Reporting Engine");

    // Quirk: LIKE is case-sensitive in Postgres, so the lowercase query misses.
    const lowercase = await owner.agent.get("/api/search").query({ q: "reporting" });
    expect(lowercase.body).toEqual([]);

    const empty = await owner.agent.get("/api/search").query({ q: "" });
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);
  });
});
