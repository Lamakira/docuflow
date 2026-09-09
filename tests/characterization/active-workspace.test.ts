import { beforeEach, describe, expect, it } from "vitest";
import { PARALLEL_WORKSPACE_ID, SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { makeApp } from "../helpers/app";
import { registerUser } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createClient, createCrmProject, createDocument, createTask, startTimer } from "../helpers/fixtures";
import { addWorkspaceMembership, plantParallelWorkspace } from "../helpers/workspace";

/**
 * Active Workspace preference (#183). Seam: HTTP `/api/*`.
 * Compose from existing operational reads; new BFF only for listing Memberships
 * and setting the preference. Existing `/api/*` stays green elsewhere.
 */

async function memberInTwoWorkspaces(app: Awaited<ReturnType<typeof makeApp>>) {
  const user = await registerUser(app, { firstName: "Ada" });
  await plantParallelWorkspace();
  await addWorkspaceMembership(user.id, PARALLEL_WORKSPACE_ID, "member");
  return user;
}

async function conditionOf(
  user: Awaited<ReturnType<typeof registerUser>>,
  workspaceId: string,
): Promise<string | null> {
  const listed = await user.agent.get("/api/memberships");
  const row = listed.body.memberships.find((item: { workspaceId: string }) => item.workspaceId === workspaceId);
  return row?.condition ?? null;
}

describe("Active Workspace HTTP (#183)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists only active Memberships with Workspace name, Workspace Role, and condition, last Active first", async () => {
    const app = await makeApp();
    const user = await memberInTwoWorkspaces(app);
    const { db } = await import("../../server/db");
    const { memberships, workspaceBilling, workspaceRoles, workspaces } = await import(
      "../../shared/schema"
    );
    await db.insert(workspaces).values({ id: "gone", name: "Gone" });
    await db.insert(workspaceRoles).values({
      id: "gone-member",
      workspaceId: "gone",
      slug: "member",
      name: "Member",
    });
    await db.insert(workspaceBilling).values({
      workspaceId: "gone",
      planKey: "legacy",
      registryVersion: 1,
      billingState: "Active",
      purchasedSeatCapacity: 500,
      authorizationVersion: 1,
    });
    await db.insert(memberships).values({
      workspaceId: "gone",
      userId: user.id,
      workspaceRoleId: "gone-member",
      archivedAt: new Date(),
    });

    const listed = await user.agent.get("/api/memberships");
    expect(listed.status).toBe(200);
    expect(listed.body.activeWorkspaceId).toBe(SEEDED_WORKSPACE_ID);
    expect(listed.body.preferredWorkspaceId).toBeNull();
    const names = listed.body.memberships.map((row: { workspaceName: string }) => row.workspaceName);
    expect(names).toEqual(["DocuFlow", "Harbour View"]);
    expect(names).not.toContain("Gone");
    expect(listed.body.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceId: SEEDED_WORKSPACE_ID,
          workspaceName: "DocuFlow",
          workspaceRole: "MEMBER",
          condition: null,
        }),
        expect.objectContaining({
          workspaceId: PARALLEL_WORKSPACE_ID,
          workspaceName: "Harbour View",
          workspaceRole: "MEMBER",
          condition: null,
        }),
      ]),
    );

    const switched = await user.agent
      .put("/api/memberships/active")
      .send({ workspaceId: PARALLEL_WORKSPACE_ID });
    expect(switched.status).toBe(200);
    expect(switched.body.activeWorkspaceId).toBe(PARALLEL_WORKSPACE_ID);
    expect(switched.body.preferredWorkspaceId).toBe(PARALLEL_WORKSPACE_ID);
    expect(switched.body.memberships[0].workspaceId).toBe(PARALLEL_WORKSPACE_ID);

    const remembered = await user.agent.get("/api/memberships");
    expect(remembered.body.activeWorkspaceId).toBe(PARALLEL_WORKSPACE_ID);
    expect(remembered.body.memberships[0].workspaceId).toBe(PARALLEL_WORKSPACE_ID);
  });

  it("honors a persisted Active Workspace on operational reads and search, and does not hard-prefer the seeded Workspace after a choice", async () => {
    const app = await makeApp();
    const user = await memberInTwoWorkspaces(app);

    const seeded = await createCrmProject(user.agent, { name: "Atlas Ledger" });
    expect(seeded.project.workspaceId).toBe(SEEDED_WORKSPACE_ID);

    const switched = await user.agent
      .put("/api/memberships/active")
      .send({ workspaceId: PARALLEL_WORKSPACE_ID });
    expect(switched.status).toBe(200);

    const afterSwitch = await user.agent.get("/api/projects");
    expect(afterSwitch.status).toBe(200);
    expect(afterSwitch.body.map((row: { id: string }) => row.id)).not.toContain(seeded.project.id);

    const parallel = await createCrmProject(user.agent, { name: "Harbour Rebuild" });
    expect(parallel.project.workspaceId).toBe(PARALLEL_WORKSPACE_ID);

    const listed = await user.agent.get("/api/projects");
    expect(listed.body.map((row: { id: string }) => row.id)).toEqual([parallel.project.id]);

    const clientA = await createClient(user.agent, { name: "Harbour Client" });
    expect(clientA.workspaceId).toBe(PARALLEL_WORKSPACE_ID);
    const docA = await createDocument(user.agent, parallel.project.id, { title: "Harbour page" });

    const clientsHere = await user.agent.get("/api/crm/clients");
    expect(clientsHere.status).toBe(200);
    expect(clientsHere.body.map((row: { id: string }) => row.id)).toEqual([clientA.id]);

    const docsHere = await user.agent.get(`/api/projects/${parallel.project.id}/documents`);
    expect(docsHere.status).toBe(200);
    expect(docsHere.body.map((row: { id: string }) => row.id)).toContain(docA.id);

    await user.agent.put("/api/memberships/active").send({ workspaceId: SEEDED_WORKSPACE_ID });

    const clientsLeft = await user.agent.get("/api/crm/clients");
    expect(clientsLeft.body.map((row: { id: string }) => row.id)).not.toContain(clientA.id);

    const docsLeft = await user.agent.get(`/api/projects/${parallel.project.id}/documents`);
    expect(docsLeft.status).toBe(404);

    await user.agent.put("/api/memberships/active").send({ workspaceId: PARALLEL_WORKSPACE_ID });

    const searchOther = await user.agent.get("/api/search").query({ q: "Atlas" });
    expect(searchOther.status).toBe(200);
    expect(searchOther.body).toEqual([]);

    const searchHere = await user.agent.get("/api/search").query({ q: "Harbour" });
    expect(searchHere.body.map((row: { title: string }) => row.title)).toContain("Harbour Rebuild");

    const signInAgain = await user.agent.get("/api/projects");
    expect(signInAgain.body.map((row: { id: string }) => row.id)).toEqual([parallel.project.id]);
  });

  it("enters the only active Membership without a list of other Workspaces", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const listed = await user.agent.get("/api/memberships");
    expect(listed.status).toBe(200);
    expect(listed.body.memberships).toHaveLength(1);
    expect(listed.body.activeWorkspaceId).toBe(SEEDED_WORKSPACE_ID);
  });

  it("names Trial, Read-only, and Past due on the Membership they belong to", async () => {
    const app = await makeApp();
    const user = await memberInTwoWorkspaces(app);
    const { db } = await import("../../server/db");
    const { eq } = await import("drizzle-orm");
    const { workspaceBilling } = await import("../../shared/schema");

    await db
      .update(workspaceBilling)
      .set({ billingState: "Trialing" })
      .where(eq(workspaceBilling.workspaceId, PARALLEL_WORKSPACE_ID));
    expect(await conditionOf(user, PARALLEL_WORKSPACE_ID)).toBe("Trial");

    await db
      .update(workspaceBilling)
      .set({ billingState: "PastDue" })
      .where(eq(workspaceBilling.workspaceId, PARALLEL_WORKSPACE_ID));
    expect(await conditionOf(user, PARALLEL_WORKSPACE_ID)).toBe("Past due");

    await db
      .update(workspaceBilling)
      .set({ billingState: "ReadOnly" })
      .where(eq(workspaceBilling.workspaceId, PARALLEL_WORKSPACE_ID));
    expect(await conditionOf(user, PARALLEL_WORKSPACE_ID)).toBe("Read-only");
  });

  it("keeps a Timer started in Workspace A labelled as A after switching to B", async () => {
    const app = await makeApp();
    const user = await memberInTwoWorkspaces(app);
    const { crmProject } = await createCrmProject(user.agent, { name: "Northwind" });
    const task = await createTask(user.agent, crmProject.id);
    const timer = await startTimer(user.agent, crmProject.id, task.id);

    await user.agent.put("/api/memberships/active").send({ workspaceId: PARALLEL_WORKSPACE_ID });

    const active = await user.agent.get("/api/time-tracking/active");
    expect(active.status).toBe(200);
    expect(active.body.id).toBe(timer.id);
    expect(active.body.workspaceId).toBe(SEEDED_WORKSPACE_ID);

    const paused = await user.agent.post(`/api/time-tracking/${timer.id}/pause`);
    expect(paused.status).toBe(200);
    expect(paused.body.status).toBe("paused");
    expect(paused.body.workspaceId).toBe(SEEDED_WORKSPACE_ID);

    const resumed = await user.agent.post(`/api/time-tracking/${timer.id}/resume`).send({});
    expect(resumed.status).toBe(200);
    expect(resumed.body.status).toBe("running");

    const heartbeat = await user.agent.post(`/api/time-tracking/${timer.id}/activity`);
    expect(heartbeat.status).toBe(200);
    expect(heartbeat.body.workspaceId).toBe(SEEDED_WORKSPACE_ID);
  });

  it("keeps Notifications as a User-global inbox that names origin after a switch", async () => {
    const app = await makeApp();
    const owner = await registerUser(app, { firstName: "Olive" });
    const teammate = await memberInTwoWorkspaces(app);
    const { crmProject } = await createCrmProject(owner.agent, { name: "Notify" });
    await owner.agent
      .post(`/api/crm/projects/${crmProject.id}/notes`)
      .send({ content: "ping", mentionedUserIds: [teammate.id] });

    await teammate.agent.put("/api/memberships/active").send({ workspaceId: PARALLEL_WORKSPACE_ID });

    const list = await teammate.agent.get("/api/notifications");
    expect(list.status).toBe(200);
    expect(list.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "mention",
          workspace: expect.objectContaining({
            id: SEEDED_WORKSPACE_ID,
            name: "DocuFlow",
          }),
        }),
      ]),
    );
  });

  it("refuses setting Active Workspace to an archived or foreign Membership", async () => {
    const app = await makeApp();
    const user = await memberInTwoWorkspaces(app);
    const stranger = await registerUser(app);

    const archived = await user.agent.put("/api/memberships/active").send({ workspaceId: "gone" });
    expect(archived.status).toBe(400);
    expect(archived.body).toEqual({ message: expect.any(String) });

    const foreign = await stranger.agent
      .put("/api/memberships/active")
      .send({ workspaceId: PARALLEL_WORKSPACE_ID });
    expect(foreign.status).toBe(400);
    expect(foreign.body).toHaveProperty("message");
  });
});
