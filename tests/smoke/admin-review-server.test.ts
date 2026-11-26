import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  auditEvents,
  orgSettings,
  platformStaff,
  PROJECTS_READ_CAPABILITY_ID,
  SEEDED_WORKSPACE_ID,
  serviceAccountCapabilities,
  VIEW_DAILY_UPDATES_CAPABILITY_ID,
  WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID,
  webhookEndpoints,
  workspaces,
} from "../../shared/schema";
import { makeApp } from "../helpers/app";
import { newAgent, registerPlatformStaff, registerUser, setWorkspaceRole, type TestUser } from "../helpers/auth";
import { ownerDb, resetDb } from "../helpers/db";
import { inSeededWorkspace } from "../helpers/workspace";

/**
 * The Administration review's server half (F106, F108, F109, F110, webhook
 * addresses), over HTTP. The findings are the cases.
 */

async function administrator(): Promise<TestUser> {
  const app = await makeApp();
  const admin = await registerUser(app);
  await setWorkspaceRole(admin.id, "administrator");
  return admin;
}

async function storedPolicy(): Promise<Record<string, unknown>> {
  const [row] = await ownerDb
    .select({ screenshotPolicy: orgSettings.screenshotPolicy })
    .from(orgSettings)
    .where(and(eq(orgSettings.workspaceId, SEEDED_WORKSPACE_ID), eq(orgSettings.id, "default")));
  return (row?.screenshotPolicy ?? {}) as Record<string, unknown>;
}

async function plantPolicy(policy: Record<string, unknown>): Promise<void> {
  await ownerDb
    .insert(orgSettings)
    .values({ id: "default", workspaceId: SEEDED_WORKSPACE_ID, screenshotPolicy: policy as never })
    .onConflictDoUpdate({
      target: [orgSettings.workspaceId, orgSettings.id],
      set: { screenshotPolicy: policy as never },
    });
}

describe("PATCH /api/admin/org-settings (F108)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("refuses a good time zone sent with a bad policy and changes neither", async () => {
    const admin = await administrator();
    const before = await admin.agent.get("/api/admin/org-settings");

    const res = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ timeZone: "Europe/Paris", screenshotPolicy: { captureIntervalMaxMin: 0 } });
    expect(res.status).toBe(400);

    const after = await admin.agent.get("/api/admin/org-settings");
    expect(after.body.timeZone).toBe(before.body.timeZone);
    expect(after.body.screenshotPolicy.captureIntervalMaxMin).toBe(before.body.screenshotPolicy.captureIntervalMaxMin);
  });

  it("refuses the measured nonsense: a string switch, a fractional interval, and Mars/Phobos", async () => {
    const admin = await administrator();
    for (const body of [
      { screenshotPolicy: { screenshotsEnabled: "yes" } },
      { screenshotPolicy: { captureIntervalMinMin: 3.5 } },
      { screenshotPolicy: { idleTimeoutMinutes: 0 } },
      { screenshotPolicy: { idleCountdownSeconds: 121 } },
      { allowedTimezones: ["Mars/Phobos"] },
      { timeZone: "Mars/Phobos" },
    ]) {
      const res = await admin.agent.patch("/api/admin/org-settings").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(typeof res.body.message).toBe("string");
    }
    const after = await admin.agent.get("/api/admin/org-settings");
    expect(after.body.screenshotPolicy.screenshotsEnabled).toBe(true);
    expect(after.body.allowedTimezones).toEqual([]);
  });

  it("rolls the whole save back when the merged interval pair is out of order", async () => {
    const admin = await administrator();
    await plantPolicy({ captureIntervalMinMin: 3, captureIntervalMaxMin: 5 });
    const before = await admin.agent.get("/api/admin/org-settings");

    const res = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ timeZone: "Europe/Paris", allowedTimezones: ["Europe/Paris"], screenshotPolicy: { captureIntervalMinMin: 8 } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Min capture interval cannot exceed max" });

    const after = await admin.agent.get("/api/admin/org-settings");
    expect(after.body.timeZone).toBe(before.body.timeZone);
    expect(after.body.allowedTimezones).toEqual(before.body.allowedTimezones);
    expect(after.body.screenshotPolicy.captureIntervalMinMin).toBe(3);
  });

  it("lets a stored out-of-bounds value through a save that does not touch it, and refuses one that does", async () => {
    const admin = await administrator();
    await plantPolicy({ captureIntervalMinMin: 3, captureIntervalMaxMin: 0 });

    const other = await admin.agent.patch("/api/admin/org-settings").send({ screenshotPolicy: { idleTimeoutMinutes: 12 } });
    expect(other.status).toBe(200);
    expect((await storedPolicy()).idleTimeoutMinutes).toBe(12);

    const pair = await admin.agent.patch("/api/admin/org-settings").send({ screenshotPolicy: { captureIntervalMinMin: 4 } });
    expect(pair.status).toBe(400);
    expect((await storedPolicy()).captureIntervalMinMin).toBe(3);
  });

  it("drops unknown keys and saves the rest", async () => {
    const admin = await administrator();
    const res = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ screenshotPolicy: { idleTimeoutMinutes: 7, madeUp: true } });
    expect(res.status).toBe(200);
    const stored = await storedPolicy();
    expect(stored.idleTimeoutMinutes).toBe(7);
    expect(stored).not.toHaveProperty("madeUp");
  });

  it("answers Nothing to update when nothing valid is left to save", async () => {
    const admin = await administrator();
    for (const body of [{}, { screenshotPolicy: {} }, { screenshotPolicy: { madeUp: 1 } }]) {
      const res = await admin.agent.patch("/api/admin/org-settings").send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: "Nothing to update" });
    }
  });

  it("keeps v1 working: the whole policy read back, an empty list, a list of zones", async () => {
    const admin = await administrator();
    const read = await admin.agent.get("/api/admin/org-settings");

    const whole = await admin.agent
      .patch("/api/admin/org-settings")
      .send({ screenshotPolicy: { ...read.body.screenshotPolicy, idleCountdownSeconds: 30 } });
    expect(whole.status).toBe(200);
    expect((await storedPolicy()).idleCountdownSeconds).toBe(30);

    expect((await admin.agent.patch("/api/admin/org-settings").send({ allowedTimezones: ["Europe/Paris", "America/New_York"] })).status).toBe(200);
    expect((await admin.agent.patch("/api/admin/org-settings").send({ allowedTimezones: [] })).status).toBe(200);
    const after = await admin.agent.get("/api/admin/org-settings");
    expect(after.body.allowedTimezones).toEqual([]);
  });
});

type Field = { id: string; slug: string; options: string[] | null; updatedAt: string };
type Module = { slug: string; fields: Field[] };

async function sourceList(admin: TestUser): Promise<Field> {
  const res = await admin.agent.post("/api/admin/system-lists/ensure");
  expect(res.status).toBe(200);
  const field = (res.body as Module[]).find((m) => m.slug === "contacts")?.fields.find((f) => f.slug === "source");
  if (!field) throw new Error("no contacts.source list");
  return field;
}

function withOption(field: Field, label: string): string[] {
  return [...(field.options ?? []), JSON.stringify({ label })];
}

describe("PATCH /api/admin/fields/:id with the version read (F106)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("refuses the second of two saves made from the same read, and keeps the first", async () => {
    const admin = await administrator();
    const read = await sourceList(admin);

    const first = await admin.agent
      .patch(`/api/admin/fields/${read.id}`)
      .send({ options: withOption(read, "Trade show"), expectedUpdatedAt: read.updatedAt });
    expect(first.status).toBe(200);

    const second = await admin.agent
      .patch(`/api/admin/fields/${read.id}`)
      .send({ options: withOption(read, "Podcast"), expectedUpdatedAt: read.updatedAt });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({
      message: "Someone changed this list since you opened it. It has been reloaded; make your change again.",
    });

    const modules = await admin.agent.get("/api/admin/modules");
    const now = (modules.body as Module[]).find((m) => m.slug === "contacts")!.fields.find((f) => f.slug === "source")!;
    const labels = (now.options ?? []).map((raw) => JSON.parse(raw).label);
    expect(labels).toContain("Trade show");
    expect(labels).not.toContain("Podcast");
  });

  it("refuses a stale version inside the save's transaction too, past the route's early check", async () => {
    const admin = await administrator();
    const read = await sourceList(admin);
    const first = await admin.agent
      .patch(`/api/admin/fields/${read.id}`)
      .send({ options: withOption(read, "Trade show"), expectedUpdatedAt: read.updatedAt });
    expect(first.status).toBe(200);

    const { storage } = await import("../../server/storage");
    const { FieldListChangedError } = await import("../../server/modules/postgresStorage");
    await expect(
      inSeededWorkspace(() =>
        storage.updateCrmModuleFieldOptions(read.id, { options: withOption(read, "Podcast") }, [], [], new Date(read.updatedAt)),
      ),
    ).rejects.toBeInstanceOf(FieldListChangedError);
  });

  it("lets one of two saves sent at once from the same read through", async () => {
    const admin = await administrator();
    const read = await sourceList(admin);

    const results = await Promise.all(
      ["Trade show", "Podcast"].map((label) =>
        admin.agent
          .patch(`/api/admin/fields/${read.id}`)
          .send({ options: withOption(read, label), expectedUpdatedAt: read.updatedAt }),
      ),
    );
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);

    const modules = await admin.agent.get("/api/admin/modules");
    const now = (modules.body as Module[]).find((m) => m.slug === "contacts")!.fields.find((f) => f.slug === "source")!;
    const labels = (now.options ?? []).map((raw) => JSON.parse(raw).label);
    expect(labels.filter((label: string) => label === "Trade show" || label === "Podcast")).toHaveLength(1);
  });

  it("saves from the version just read, and as before without one (v1)", async () => {
    const admin = await administrator();
    const read = await sourceList(admin);
    const saved = await admin.agent
      .patch(`/api/admin/fields/${read.id}`)
      .send({ options: withOption(read, "Trade show"), expectedUpdatedAt: read.updatedAt });
    expect(saved.status).toBe(200);

    const v1 = await admin.agent
      .patch(`/api/admin/fields/${read.id}`)
      .send({ options: withOption(saved.body, "Podcast") });
    expect(v1.status).toBe(200);
  });

  it("refuses a version that is not a date", async () => {
    const admin = await administrator();
    const read = await sourceList(admin);
    const res = await admin.agent
      .patch(`/api/admin/fields/${read.id}`)
      .send({ options: read.options, expectedUpdatedAt: "yesterday" });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/workspace (F110)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lets the Owner rename the Workspace, trimmed, with an audit event", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");

    const res = await owner.agent.patch("/api/workspace").send({ name: "  Harbour Studio  " });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: SEEDED_WORKSPACE_ID, name: "Harbour Studio" });

    const [row] = await ownerDb.select().from(workspaces).where(eq(workspaces.id, SEEDED_WORKSPACE_ID));
    expect(row.name).toBe("Harbour Studio");
    const events = await ownerDb
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.workspaceId, SEEDED_WORKSPACE_ID), eq(auditEvents.action, "workspace.renamed")));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorKind: "user", actorId: owner.id, resourceId: SEEDED_WORKSPACE_ID });
  });

  it("refuses an Administrator, an empty name and a name over 100 characters", async () => {
    const app = await makeApp();
    const admin = await registerUser(app);
    await setWorkspaceRole(admin.id, "administrator");
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const [before] = await ownerDb.select().from(workspaces).where(eq(workspaces.id, SEEDED_WORKSPACE_ID));

    const asAdmin = await admin.agent.patch("/api/workspace").send({ name: "Mine now" });
    expect(asAdmin.status).toBe(403);
    expect(asAdmin.body).toEqual({ message: "Only the Owner can rename the Workspace" });

    expect((await owner.agent.patch("/api/workspace").send({ name: "   " })).status).toBe(400);
    expect((await owner.agent.patch("/api/workspace").send({ name: "x".repeat(101) })).status).toBe(400);
    expect((await owner.agent.patch("/api/workspace").send({})).status).toBe(400);

    const [after] = await ownerDb.select().from(workspaces).where(eq(workspaces.id, SEEDED_WORKSPACE_ID));
    expect(after.name).toBe(before.name);
  });
});

describe("Service Accounts (F109)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("refuses one without a Capability", async () => {
    const admin = await administrator();
    for (const body of [{ name: "Nothing" }, { name: "Nothing", capabilityIds: [] }]) {
      const res = await admin.agent.post("/api/service-accounts").send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: "Choose at least one Capability" });
    }
  });

  it("trims the name and refuses an empty one", async () => {
    const admin = await administrator();
    const created = await admin.agent
      .post("/api/service-accounts")
      .send({ name: "  Exports  ", capabilityIds: [PROJECTS_READ_CAPABILITY_ID] });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe("Exports");

    const empty = await admin.agent
      .post("/api/service-accounts")
      .send({ name: "   ", capabilityIds: [PROJECTS_READ_CAPABILITY_ID] });
    expect(empty.status).toBe(400);
  });

  it("renames one and replaces its Capabilities", async () => {
    const admin = await administrator();
    const created = await admin.agent
      .post("/api/service-accounts")
      .send({ name: "Exports", capabilityIds: [PROJECTS_READ_CAPABILITY_ID] });

    const renamed = await admin.agent.patch(`/api/service-accounts/${created.body.id}`).send({ name: "Invoices" });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ id: created.body.id, name: "Invoices", capabilityIds: [PROJECTS_READ_CAPABILITY_ID] });
    expect(renamed.body).not.toHaveProperty("plaintextKey");

    const regranted = await admin.agent
      .patch(`/api/service-accounts/${created.body.id}`)
      .send({ capabilityIds: [VIEW_DAILY_UPDATES_CAPABILITY_ID, WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID] });
    expect(regranted.status).toBe(200);
    expect([...regranted.body.capabilityIds].sort()).toEqual(
      [VIEW_DAILY_UPDATES_CAPABILITY_ID, WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID].sort(),
    );
    const grants = await ownerDb
      .select({ capabilityId: serviceAccountCapabilities.capabilityId })
      .from(serviceAccountCapabilities)
      .where(eq(serviceAccountCapabilities.serviceAccountId, created.body.id));
    expect(grants.map((g) => g.capabilityId).sort()).toEqual(
      [VIEW_DAILY_UPDATES_CAPABILITY_ID, WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID].sort(),
    );

    const listed = await admin.agent.get("/api/service-accounts");
    expect(listed.body[0]).toMatchObject({ name: "Invoices" });
  });

  it("refuses an empty Capability list, an empty change, an unknown one and a revoked one", async () => {
    const admin = await administrator();
    const created = await admin.agent
      .post("/api/service-accounts")
      .send({ name: "Exports", capabilityIds: [PROJECTS_READ_CAPABILITY_ID] });
    const id = created.body.id;

    expect((await admin.agent.patch(`/api/service-accounts/${id}`).send({ capabilityIds: [] })).status).toBe(400);
    expect((await admin.agent.patch(`/api/service-accounts/${id}`).send({})).status).toBe(400);
    expect((await admin.agent.patch(`/api/service-accounts/${id}`).send({ name: "x".repeat(101) })).status).toBe(400);
    expect((await admin.agent.patch(`/api/service-accounts/missing`).send({ name: "Gone" })).status).toBe(404);

    await admin.agent.post(`/api/service-accounts/${id}/revoke`);
    const revoked = await admin.agent.patch(`/api/service-accounts/${id}`).send({ name: "Back" });
    expect(revoked.status).toBe(409);
    expect(revoked.body).toEqual({ message: "This Service Account is revoked" });
  });

  it("refuses a Member", async () => {
    const app = await makeApp();
    const admin = await administrator();
    const created = await admin.agent
      .post("/api/service-accounts")
      .send({ name: "Exports", capabilityIds: [PROJECTS_READ_CAPABILITY_ID] });
    const member = await registerUser(app);
    const res = await member.agent.patch(`/api/service-accounts/${created.body.id}`).send({ name: "Mine" });
    expect(res.status).toBe(403);
  });
});

const REFUSED_ADDRESSES = [
  "http://hooks.example.com/x",
  "javascript:alert(1)",
  "ftp://hooks.example.com/x",
  "https://localhost/x",
  "https://localhost./x",
  "https://api.localhost/x",
  "https://printer.local/x",
  "https://metadata.google.internal/computeMetadata/v1",
  "https://169.254.169.254/latest/meta-data",
  "https://127.0.0.1/x",
  "https://2130706433/x",
  "https://0x7f.0.0.1/x",
  "https://127.1/x",
  "https://[::1]/x",
  "https://[::ffff:169.254.169.254]/x",
  "https://user:pass@hooks.example.com/x",
  "https://intranet/x",
  "not a url",
];

describe("Webhook Endpoint addresses", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("refuses every address that is not public https on the BFF, and accepts a public one", async () => {
    const admin = await administrator();
    for (const url of REFUSED_ADDRESSES) {
      const res = await admin.agent.post("/api/webhook-endpoints").send({ url, eventTypes: ["client.created"] });
      expect(res.status, url).toBe(400);
      expect(res.body, url).toEqual({ message: "Use a public https address" });
    }
    expect(await ownerDb.select().from(webhookEndpoints)).toEqual([]);

    const ok = await admin.agent
      .post("/api/webhook-endpoints")
      .send({ url: "https://hooks.example.com:8443/crm", eventTypes: ["client.created"] });
    expect(ok.status).toBe(201);
  });

  it("refuses them on the public API too, as problem+json", async () => {
    const app = await makeApp();
    const admin = await administrator();
    const created = await admin.agent
      .post("/api/service-accounts")
      .send({ name: "Hooks", capabilityIds: [WEBHOOK_ENDPOINTS_MANAGE_CAPABILITY_ID] });
    const sa = newAgent(app).set("Authorization", `Bearer ${created.body.plaintextKey}`);

    for (const url of ["http://hooks.example.com/x", "https://169.254.169.254/x", "https://localhost/x"]) {
      const res = await sa.post("/api/v1/webhook-endpoints").send({ url, eventTypes: ["client.created"] });
      expect(res.status, url).toBe(400);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      const body = JSON.parse(res.text);
      expect(body).toMatchObject({ type: "urn:docuflow:problem:bad-request", status: 400, detail: "Use a public https address" });
    }
    expect(await ownerDb.select().from(webhookEndpoints)).toEqual([]);
  });
});

describe("GET /api/admin/platform-staff (F109)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("names staff by their User's full name, else a masked address, never the address", async () => {
    const app = await makeApp();
    const admin = await administrator();
    const named = await registerPlatformStaff(app, { firstName: "Ada", lastName: "Lovelace" });
    await ownerDb.insert(platformStaff).values({ subjectId: "staff_unlinked", email: "sam.support@docuflow.example" });

    const res = await admin.agent.get("/api/admin/platform-staff");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        { id: named.staffId, label: "Ada Lovelace" },
        { id: expect.any(String), label: "DocuFlow support (s***@docuflow.example)" },
      ]),
    );
    expect(res.body).toHaveLength(2);
    expect(JSON.stringify(res.body)).not.toContain("sam.support");
    expect(JSON.stringify(res.body)).not.toContain(named.email);
  });
});
