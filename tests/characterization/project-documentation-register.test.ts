import { beforeEach, describe, expect, it } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerUser, setWorkspaceRole } from "../helpers/auth";
import { createClient, createCrmProject, createDocument } from "../helpers/fixtures";

/**
 * The Project Documentation register's page (#275). `GET /api/projects/documentable`
 * answers every documentation-enabled Project when there is no `page`; with `page`
 * it narrows and pages by Project, and carries each Project's Documents.
 */
describe("the Project Documentation register page (#275)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function seed() {
    const app = await makeApp();
    const user = await registerUser(app);
    const acme = await createClient(user.agent, { name: "Acme" });
    const site = await createCrmProject(user.agent, { name: "Acme site", clientId: acme.id, documentationEnabled: true });
    const handbook = await createCrmProject(user.agent, { name: "Handbook", documentationEnabled: true });
    const plain = await createCrmProject(user.agent, { name: "No docs" });
    await createDocument(user.agent, site.project.id, { title: "Runbook" });
    await createDocument(user.agent, site.project.id, { title: "Hand-off notes" });
    const names = async (query: Record<string, string>) =>
      ((await user.agent.get("/api/projects/documentable").query({ page: 1, ...query })).body.data as Array<{
        project: { name: string };
      }>)
        .map((entry) => entry.project.name)
        .sort();
    return { app, user, acme, site, handbook, plain, names };
  }

  it("keeps the plain list without page, and pages Projects with their Documents", async () => {
    const { user, site } = await seed();
    const plain = await user.agent.get("/api/projects/documentable");
    expect(plain.body.map((p: { name: string }) => p.name).sort()).toEqual(["Acme site", "Handbook"]);

    const paged = await user.agent.get("/api/projects/documentable").query({ page: 1, pageSize: 1 });
    expect(paged.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(paged.body.data).toHaveLength(1);
    const second = await user.agent.get("/api/projects/documentable").query({ page: 2, pageSize: 1 });
    expect(second.body.data).toHaveLength(1);

    const all = await user.agent.get("/api/projects/documentable").query({ page: 1 });
    const acmeEntry = all.body.data.find((entry: { project: { id: string } }) => entry.project.id === site.project.id);
    expect(acmeEntry.documentationEnabled).toBe(true);
    expect(acmeEntry.documents.map((doc: { title: string }) => doc.title).sort()).toEqual(["Hand-off notes", "Runbook"]);
    // The register lists titles; content stays on the Document route.
    expect(acmeEntry.documents[0]).not.toHaveProperty("content");
    // The chip and the picker read every Project the reader may see.
    expect(all.body.projects.map((p: { name: string }) => p.name)).toEqual(["Acme site", "Handbook", "No docs"]);
  });

  it("narrows by documentation, Project, Client and the search before paging", async () => {
    const { acme, handbook, names } = await seed();
    expect(await names({ documentation: "disabled" })).toEqual(["No docs"]);
    expect(await names({ documentation: "all" })).toEqual(["Acme site", "Handbook", "No docs"]);
    expect(await names({ documentation: "nonsense" })).toEqual(["Acme site", "Handbook"]);
    expect(await names({ projectId: handbook.project.id })).toEqual(["Handbook"]);
    expect(await names({ clientId: acme.id })).toEqual(["Acme site"]);
    // A Project name, or a Document title inside it.
    expect(await names({ search: "hand" })).toEqual(["Acme site", "Handbook"]);
    expect(await names({ search: "runbook" })).toEqual(["Acme site"]);
    expect(await names({ search: "_" })).toEqual([]);
  });

  it("pages only what a Member may see with scope=visible", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "administrator");
    const member = await registerUser(app);
    await setWorkspaceRole(member.id, "member");
    await createCrmProject(admin.agent, { name: "Admin only", documentationEnabled: true });
    await createCrmProject(admin.agent, { name: "Shared", documentationEnabled: true, memberIds: [member.id] });

    const visible = await member.agent.get("/api/projects/documentable").query({ page: 1, scope: "visible" });
    expect(visible.body.total).toBe(1);
    expect(visible.body.data[0].project.name).toBe("Shared");
    expect(visible.body.projects.map((p: { name: string }) => p.name)).toEqual(["Shared"]);

    const adminView = await admin.agent.get("/api/projects/documentable").query({ page: 1, scope: "visible" });
    expect(adminView.body.total).toBe(2);
  });
});
