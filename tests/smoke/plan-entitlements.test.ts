import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import { SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { makeApp } from "../helpers/app";
import { registerUser, setWorkspaceRole, type Agent, type TestUser } from "../helpers/auth";
import { loginDevice, type AgentDevice } from "../helpers/agent";
import { resetDb } from "../helpers/db";
import { createCrmProject, createTask } from "../helpers/fixtures";
import { inSeededWorkspace } from "../helpers/workspace";

/**
 * #299 / ADR-0027: Plans that leave areas out. The server refuses every area a
 * Plan does not include, with the Plan that would; data kept from a richer
 * Plan stays readable; v1 Workspaces keep the whole product; Starter captures
 * screenshots on one Project.
 */

const UPGRADE = "plan_upgrade_required";

type PlanPin = { planKey: string; registryVersion: number };

async function setPlan(pin: PlanPin): Promise<void> {
  const { db } = await import("../../server/db");
  const { workspaceBilling } = await import("../../shared/schema");
  const { eq } = await import("drizzle-orm");
  await db
    .update(workspaceBilling)
    .set({ planKey: pin.planKey, registryVersion: pin.registryVersion, billingState: "Active" })
    .where(eq(workspaceBilling.workspaceId, SEEDED_WORKSPACE_ID));
}

type Harness = { app: Express; owner: TestUser; device: AgentDevice; crmProjectId: string };

async function harness(): Promise<Harness> {
  const app = await makeApp();
  const owner = await registerUser(app);
  await setWorkspaceRole(owner.id, "owner");
  const device = await loginDevice(app, owner);
  const { crmProject } = await createCrmProject(owner.agent, {
    projectType: "internal",
    status: "won_in_progress",
  });
  return { app, owner, device, crmProjectId: crmProject.id };
}

type Probe = {
  feature: string;
  label: string;
  send: (h: Harness) => Promise<{ status: number; body: any }>;
  /** Only probed for refusal: running it on a Plan that includes it reaches a real provider. */
  refusalOnly?: boolean;
};

const PROBES: Probe[] = [
  {
    feature: "crm",
    label: "create a Client",
    send: (h) => h.owner.agent.post("/api/crm/clients").send({ name: `Client ${randomUUID()}` }),
  },
  {
    feature: "crm",
    label: "create an Opportunity",
    send: (h) => h.owner.agent.post("/api/crm/projects").send({ name: `Lead ${randomUUID()}`, status: "lead", projectType: "one_time" }),
  },
  {
    feature: "projectManagement",
    label: "create a Task",
    send: (h) => h.owner.agent.post("/api/tasks").send({ crmProjectId: h.crmProjectId, name: "Task" }),
  },
  {
    feature: "projectManagement",
    label: "set a Project budget",
    send: (h) =>
      h.owner.agent.patch(`/api/crm/projects/${h.crmProjectId}`).send({ budgetedHours: 12 }),
  },
  {
    feature: "knowledge",
    label: "create a Folder",
    send: (h) => h.owner.agent.post("/api/company-document-folders").send({ name: `Folder ${randomUUID()}` }),
  },
  {
    feature: "knowledge",
    label: "Ask",
    send: (h) => h.owner.agent.post("/api/chat").send({ message: "hello" }),
    refusalOnly: true,
  },
  {
    feature: "payrollExports",
    label: "export payroll",
    send: (h) => h.owner.agent.get("/api/admin/analytics/export"),
  },
  {
    feature: "advancedAnalytics",
    label: "read analytics",
    send: (h) => h.owner.agent.get("/api/admin/analytics/overview"),
  },
  {
    feature: "activityCapture",
    label: "send activity events",
    send: (h) =>
      h.device.request.post("/api/agent/events/batch").send({
        deviceId: h.device.deviceId,
        batchId: randomUUID(),
        clientType: "desktop",
        clientVersion: "0.1.0",
        events: [{ type: "input_activity", timestamp: new Date().toISOString(), data: { keyCount: 1 } }],
      }),
  },
];

const PLANS: Array<PlanPin & { includes: string[] }> = [
  { planKey: "starter", registryVersion: 2, includes: [] },
  {
    planKey: "growth",
    registryVersion: 2,
    includes: ["crm", "projectManagement", "knowledge", "payrollExports", "activityCapture"],
  },
  {
    planKey: "business",
    registryVersion: 2,
    includes: ["crm", "projectManagement", "knowledge", "payrollExports", "activityCapture", "advancedAnalytics"],
  },
  {
    planKey: "enterprise",
    registryVersion: 2,
    includes: ["crm", "projectManagement", "knowledge", "payrollExports", "activityCapture", "advancedAnalytics"],
  },
  {
    planKey: "trial",
    registryVersion: 2,
    includes: ["crm", "projectManagement", "knowledge", "payrollExports", "activityCapture", "advancedAnalytics"],
  },
];

describe("each Plan refuses every area it leaves out", () => {
  beforeEach(async () => {
    await resetDb();
  });

  for (const plan of PLANS) {
    it(`${plan.planKey} (v${plan.registryVersion})`, async () => {
      const h = await harness();
      await setPlan(plan);

      for (const probe of PROBES) {
        const included = plan.includes.includes(probe.feature);
        if (included && probe.refusalOnly) continue;
        const res = await probe.send(h);
        if (included) {
          expect(res.body?.code, `${plan.planKey} should allow: ${probe.label}`).not.toBe(UPGRADE);
        } else {
          expect(res.status, `${plan.planKey} should refuse: ${probe.label}`).toBe(403);
          expect(res.body).toMatchObject({ code: UPGRADE, feature: probe.feature });
          expect(res.body.message).toMatch(/Upgrade to (Growth|Business)/);
        }
      }
    });
  }

  it("names the cheapest Plan that includes the area in the refusal", async () => {
    const h = await harness();
    await setPlan({ planKey: "growth", registryVersion: 2 });

    const res = await h.owner.agent.get("/api/admin/analytics/overview");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      code: UPGRADE,
      feature: "advancedAnalytics",
      requiredPlan: "business",
      message: "The Growth Plan does not include advanced analytics and profitability dashboards. Upgrade to Business to use it.",
    });
  });
});

describe("v1 Workspaces keep their Entitlements", () => {
  beforeEach(async () => {
    await resetDb();
  });

  for (const planKey of ["legacy", "pro"]) {
    it(`v1 ${planKey} reaches every area`, async () => {
      const h = await harness();
      await setPlan({ planKey, registryVersion: 1 });

      for (const probe of PROBES.filter((candidate) => !candidate.refusalOnly)) {
        const res = await probe.send(h);
        expect(res.body?.code, probe.label).not.toBe(UPGRADE);
      }
      const entitlements = await h.owner.agent.get("/api/billing/entitlements");
      expect(entitlements.body).toMatchObject({
        planKey,
        registryVersion: 1,
        screenshotProjectCapacity: null,
        features: {
          activityCapture: true,
          payrollExports: true,
          crm: true,
          projectManagement: true,
          knowledge: true,
          advancedAnalytics: true,
        },
      });
    });
  }
});

describe("after a downgrade, kept data is read-only, never hidden", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reads Clients, Tasks and Folders kept from Growth, and refuses changes with the upgrade message", async () => {
    const h = await harness();
    await setPlan({ planKey: "growth", registryVersion: 2 });
    const client = await h.owner.agent.post("/api/crm/clients").send({ name: "Kept Client" });
    expect(client.status).toBe(201);
    const task = await createTask(h.owner.agent, h.crmProjectId, "Kept Task");
    const folder = await h.owner.agent.post("/api/company-document-folders").send({ name: "Kept Folder" });
    expect(folder.status).toBe(201);

    await setPlan({ planKey: "starter", registryVersion: 2 });

    const clients = await h.owner.agent.get("/api/crm/clients");
    expect(clients.status).toBe(200);
    expect(JSON.stringify(clients.body)).toContain("Kept Client");
    const tasks = await h.owner.agent.get(`/api/tasks?crmProjectId=${h.crmProjectId}`);
    expect(tasks.status).toBe(200);
    expect(JSON.stringify(tasks.body)).toContain("Kept Task");
    const folders = await h.owner.agent.get("/api/company-document-folders");
    expect(folders.status).toBe(200);
    expect(JSON.stringify(folders.body)).toContain("Kept Folder");

    const rename = await h.owner.agent.patch(`/api/crm/clients/${client.body.id}`).send({ name: "Renamed" });
    expect(rename.status).toBe(403);
    expect(rename.body.message).toBe(
      "Clients and Opportunities are read-only on the Starter Plan. Upgrade to Growth to make changes."
    );
    const taskEdit = await h.owner.agent.patch(`/api/tasks/${task.id}`).send({ name: "Renamed" });
    expect(taskEdit.status).toBe(403);
    expect(taskEdit.body.code).toBe(UPGRADE);
    const folderDelete = await h.owner.agent.delete(`/api/company-document-folders/${folder.body.id}`);
    expect(folderDelete.status).toBe(403);
    expect(folderDelete.body.code).toBe(UPGRADE);
  });
});

describe("Starter tracks time against light Projects", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates an Internal Project from a name, and refuses a Client, budget or documentation on it", async () => {
    const h = await harness();
    await setPlan({ planKey: "starter", registryVersion: 2 });

    const created = await h.owner.agent.post("/api/crm/projects").send({ name: "Light Project" });
    expect(created.status).toBe(201);
    expect(created.body.crmProject).toMatchObject({ projectType: "internal", status: "won_in_progress" });

    const renamed = await h.owner.agent
      .patch(`/api/crm/projects/${created.body.crmProject.id}`)
      .send({ projectName: "Light Project renamed" });
    expect(renamed.status).toBe(200);

    for (const body of [
      { name: "With budget", budgetedHours: 10 },
      { name: "With docs", documentationEnabled: true },
      { name: "With client", clientId: "client-1" },
    ]) {
      const refused = await h.owner.agent.post("/api/crm/projects").send(body);
      expect(refused.status, JSON.stringify(body)).toBe(403);
      expect(refused.body.code).toBe(UPGRADE);
    }
  });

  it("starts the web and desktop timers on a Project with no Task", async () => {
    const h = await harness();
    await setPlan({ planKey: "starter", registryVersion: 2 });

    expect((await h.owner.agent.get("/api/time-tracking/capabilities")).body).toEqual({ requiresTask: false });
    expect((await h.device.request.get("/api/agent/capabilities")).body).toEqual({ requiresTask: false });

    const web = await h.owner.agent.post("/api/time-tracking/start").send({ crmProjectId: h.crmProjectId });
    expect(web.status).toBe(200);
    expect(web.body.taskId).toBeNull();
    await h.owner.agent.post(`/api/time-tracking/${web.body.id}/stop`);

    const desktop = await h.device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId: h.crmProjectId, deviceId: h.device.deviceId, clientType: "desktop" });
    expect(desktop.status).toBe(200);
    expect(desktop.body.taskId ?? null).toBeNull();
  });

  it("still requires a Task on a Plan with Project management", async () => {
    const h = await harness();
    await setPlan({ planKey: "growth", registryVersion: 2 });

    expect((await h.owner.agent.get("/api/time-tracking/capabilities")).body).toEqual({ requiresTask: true });
    const refused = await h.owner.agent.post("/api/time-tracking/start").send({ crmProjectId: h.crmProjectId });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe("taskId is required");
  });

  it("creates an Internal Project from the desktop agent", async () => {
    const h = await harness();
    await setPlan({ planKey: "starter", registryVersion: 2 });

    const created = await h.device.request.post("/api/agent/projects").send({ name: "Desk Project" });
    expect(created.status).toBe(201);
    const { storage } = await import("../../server/storage");
    const row = await inSeededWorkspace(() => storage.getCrmProject(created.body.id));
    expect(row).toMatchObject({ projectType: "internal", status: "won_in_progress" });
  });
});

async function heartbeat(device: AgentDevice) {
  return device.request.post("/api/agent/heartbeat").send({
    deviceId: device.deviceId,
    timestamp: new Date().toISOString(),
    clientType: "desktop",
    clientVersion: "0.1.0",
  });
}

async function saveScreenshotProjects(agent: Agent, ids: string[] | null) {
  return agent
    .patch("/api/admin/org-settings")
    .send({ screenshotPolicy: { screenshotsEnabled: true, screenshotProjectIds: ids } });
}

describe("Starter screenshot capacity", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("refuses a Tracking Policy naming more than one screenshot Project", async () => {
    const h = await harness();
    const { crmProject: second } = await createCrmProject(h.owner.agent);
    await setPlan({ planKey: "starter", registryVersion: 2 });

    const refused = await saveScreenshotProjects(h.owner.agent, [h.crmProjectId, second.id]);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: UPGRADE, feature: "screenshotProjects", requiredPlan: "growth" });
    expect(refused.body.message).toBe(
      "The Starter Plan captures screenshots on 1 Project. Upgrade to Growth to capture them on every Project."
    );

    expect((await saveScreenshotProjects(h.owner.agent, [h.crmProjectId])).status).toBe(200);
  });

  it("delivers screenshots only while the timer runs on the chosen Project, and refuses the rest", async () => {
    const h = await harness();
    const { crmProject: other } = await createCrmProject(h.owner.agent);
    await setPlan({ planKey: "starter", registryVersion: 2 });
    expect((await saveScreenshotProjects(h.owner.agent, [h.crmProjectId])).status).toBe(200);

    const idle = await heartbeat(h.device);
    expect(idle.body.screenshotPolicy).toMatchObject({
      screenshotsEnabled: false,
      screenshotProjectIds: [h.crmProjectId],
      screenshotProjectCapacity: 1,
      activityCaptureEnabled: false,
    });

    const onChosen = await h.device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId: h.crmProjectId, deviceId: h.device.deviceId, clientType: "desktop" });
    expect(onChosen.status).toBe(200);
    expect((await heartbeat(h.device)).body.screenshotPolicy.screenshotsEnabled).toBe(true);
    const allowed = await h.device.request.post("/api/agent/screenshots/presign").send({
      timeEntryId: onChosen.body.id,
      deviceId: h.device.deviceId,
      capturedAt: new Date().toISOString(),
      keyboardActivityPercent: 40,
      clientType: "desktop",
      clientVersion: "0.1.0",
    });
    expect(allowed.status).toBe(200);
    const { db } = await import("../../server/db");
    const { timeEntryScreenshots } = await import("../../shared/schema");
    const [stored] = await db.select().from(timeEntryScreenshots);
    expect(stored.keyboardActivityPercent).toBeNull();
    await h.device.request.post(`/api/agent/timer/${onChosen.body.id}/stop`);

    const onOther = await h.device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId: other.id, deviceId: h.device.deviceId, clientType: "desktop" });
    expect(onOther.status).toBe(200);
    expect((await heartbeat(h.device)).body.screenshotPolicy.screenshotsEnabled).toBe(false);
    const refused = await h.device.request.post("/api/agent/screenshots/presign").send({
      timeEntryId: onOther.body.id,
      deviceId: h.device.deviceId,
      capturedAt: new Date().toISOString(),
      clientType: "desktop",
      clientVersion: "0.1.0",
    });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe(UPGRADE);

    const web = await h.owner.agent
      .post("/api/time-tracking/screenshots/upload-url")
      .send({ timeEntryId: onOther.body.id });
    expect(web.status).toBe(403);
    expect(web.body.feature).toBe("screenshotProjects");
  });

  it("captures on every Project on Growth, whatever the stored list says", async () => {
    const h = await harness();
    await setPlan({ planKey: "growth", registryVersion: 2 });
    await saveScreenshotProjects(h.owner.agent, null);

    const started = await h.device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId: h.crmProjectId, deviceId: h.device.deviceId, clientType: "desktop" });
    expect(started.status).toBe(400);

    const task = await createTask(h.owner.agent, h.crmProjectId);
    const withTask = await h.device.request
      .post("/api/agent/timer/start")
      .send({ crmProjectId: h.crmProjectId, taskId: task.id, deviceId: h.device.deviceId, clientType: "desktop" });
    expect(withTask.status).toBe(200);
    expect((await heartbeat(h.device)).body.screenshotPolicy).toMatchObject({
      screenshotsEnabled: true,
      screenshotProjectIds: null,
      screenshotProjectCapacity: null,
      activityCaptureEnabled: true,
    });
  });
});

describe("Worker jobs outside the Plan", () => {
  it("completes a Knowledge Job without running it when the Plan leaves Knowledge out", async () => {
    const { whenPlanIncludes } = await import("../../server/worker");
    let ran = 0;
    const handler = whenPlanIncludes(async () => false, async () => {
      ran += 1;
    });

    await handler({ id: "job-1", type: "document.embed", workspaceId: SEEDED_WORKSPACE_ID } as never);
    expect(ran).toBe(0);

    await whenPlanIncludes(async () => true, async () => {
      ran += 1;
    })({ id: "job-2", type: "document.embed", workspaceId: SEEDED_WORKSPACE_ID } as never);
    expect(ran).toBe(1);
  });
});
