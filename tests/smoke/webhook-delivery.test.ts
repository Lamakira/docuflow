import { beforeEach, describe, expect, it } from "vitest";
import { SEEDED_WORKSPACE_ID } from "../../shared/schema";
import { resetDb } from "../helpers/db";
import { inSeededWorkspace } from "../helpers/workspace";

/**
 * Phase 7 ticket #130: allowlisted writes append Outbox Events; each enabled
 * Webhook Endpoint becomes a Job (ADR-0013). HMAC-signed thin POST, at-least-once,
 * unordered, auto-disable on exhausted attempts, audited replay.
 *
 * Seams: domain writes (same transaction as the Outbox Event), the jobs port,
 * and a faked HTTP sink. HTTP does not deliver on an interval.
 */

async function seedWriter() {
  const { storage } = await import("../../server/storage");
  const user = await storage.createUser({
    email: "hooks@test.invalid",
    password: "not-a-real-hash",
    firstName: "Hooks",
  });
  return { storage, user };
}

describe("webhook delivery from the outbox", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("appends a client.created Outbox Event in the same transaction as creating a Client", async () => {
    const { storage, user } = await seedWriter();
    const { db } = await import("../../server/db");
    const { outboxEvents } = await import("../../shared/schema");

    const client = await inSeededWorkspace(() =>
      storage.createCrmClient({
        name: "Northwind",
        ownerId: user.id,
      })
    );

    const rows = await inSeededWorkspace(() => db.select().from(outboxEvents));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "client.created",
      workspaceId: SEEDED_WORKSPACE_ID,
      aggregateType: "client",
      aggregateId: client.id,
    });
    expect(rows[0]!.payload).toEqual({ clientId: client.id });
    expect(rows[0]!.payload).not.toHaveProperty("name");
    expect(rows[0]!.dispatchedAt).toBeNull();
    expect(rows[0]!.principalKind).toBeNull();
    expect(rows[0]!.principalId).toBeNull();
  });

  it("stamps the acting principal on the Outbox Event", async () => {
    const { storage, user } = await seedWriter();
    const { db } = await import("../../server/db");
    const { outboxEvents } = await import("../../shared/schema");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");

    await runWithWorkspaceContext(
      {
        workspaceId: SEEDED_WORKSPACE_ID,
        userId: user.id,
      },
      () => storage.createCrmClient({ name: "Northwind", ownerId: user.id })
    );
    await runWithWorkspaceContext(
      {
        workspaceId: SEEDED_WORKSPACE_ID,
        principalKind: "service_account",
        principalId: "sa-hooks",
      },
      () => storage.createCrmClient({ name: "Contoso", ownerId: user.id })
    );

    const rows = await inSeededWorkspace(() => db.select().from(outboxEvents));
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ principalKind: "user", principalId: user.id }),
        expect.objectContaining({ principalKind: "service_account", principalId: "sa-hooks" }),
      ])
    );
  });

  it("appends client.updated when a Client is updated", async () => {
    const { storage, user } = await seedWriter();
    const { db } = await import("../../server/db");
    const { outboxEvents } = await import("../../shared/schema");

    const client = await inSeededWorkspace(() =>
      storage.createCrmClient({ name: "Northwind", ownerId: user.id })
    );
    await inSeededWorkspace(() => storage.updateCrmClient(client.id, { name: "Northwind Ltd" }));

    const rows = await inSeededWorkspace(() => db.select().from(outboxEvents));
    expect(rows.map((row) => row.type)).toEqual(["client.created", "client.updated"]);
    expect(rows[1]).toMatchObject({
      aggregateType: "client",
      aggregateId: client.id,
      payload: { clientId: client.id },
    });
    expect(rows[1]!.payload).not.toHaveProperty("name");
  });

  it("appends project.created and project.updated for a Project write", async () => {
    const { storage, user } = await seedWriter();
    const { db } = await import("../../server/db");
    const { outboxEvents } = await import("../../shared/schema");

    const { crmProject } = await inSeededWorkspace(() =>
      storage.createCrmProjectWithBase({ name: "Atlas", ownerId: user.id })
    );
    await inSeededWorkspace(() => storage.updateCrmProject(crmProject.id, { comments: "Kickoff" }));

    const rows = await inSeededWorkspace(() => db.select().from(outboxEvents));
    expect(rows.map((row) => row.type)).toEqual(["project.created", "project.updated"]);
    expect(rows[0]).toMatchObject({
      aggregateType: "project",
      aggregateId: crmProject.id,
      payload: { projectId: crmProject.id },
    });
    expect(rows[0]!.payload).not.toHaveProperty("name");
    expect(rows[1]!.payload).toEqual({ projectId: crmProject.id });
  });

  it("appends time_entry.stopped when a Timer Command stops a Time Entry", async () => {
    const { storage, user } = await seedWriter();
    const { db } = await import("../../server/db");
    const { outboxEvents } = await import("../../shared/schema");
    const { applyTimerCommand } = await import("../../server/modules/time/commands");

    const { crmProject } = await inSeededWorkspace(() =>
      storage.createCrmProjectWithBase({ name: "Atlas", ownerId: user.id })
    );
    await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "web-session-1",
        sequence: 1,
        kind: "start",
        claimedEffectiveAt: new Date("2026-08-22T10:00:00.000Z"),
        payload: { crmProjectId: crmProject.id },
      })
    );
    const stopped = await inSeededWorkspace(() =>
      applyTimerCommand({
        userId: user.id,
        origin: "web-session-1",
        sequence: 2,
        kind: "stop",
        claimedEffectiveAt: new Date("2026-08-22T11:00:00.000Z"),
        payload: {},
      })
    );

    const rows = await inSeededWorkspace(() => db.select().from(outboxEvents));
    const stoppedEvents = rows.filter((row) => row.type === "time_entry.stopped");
    expect(stoppedEvents).toHaveLength(1);
    expect(stoppedEvents[0]).toMatchObject({
      aggregateType: "time_entry",
      aggregateId: stopped.timeEntry!.id,
      payload: { timeEntryId: stopped.timeEntry!.id },
    });
    expect(stoppedEvents[0]!.payload).not.toHaveProperty("duration");
  });

  it("rolls back the Outbox Event when the Client write rolls back", async () => {
    const { storage, user } = await seedWriter();
    const { db } = await import("../../server/db");
    const { crmClients, outboxEvents } = await import("../../shared/schema");

    await expect(
      db.transaction(async (tx) => {
        await inSeededWorkspace(() =>
          storage.createCrmClient({ name: "Never committed", ownerId: user.id }, tx)
        );
        tx.rollback();
      })
    ).rejects.toThrow();

    const events = await inSeededWorkspace(() => db.select().from(outboxEvents));
    const clients = await inSeededWorkspace(() => db.select().from(crmClients));
    expect(events).toEqual([]);
    expect(clients).toEqual([]);
  });

  it("fans each enabled subscribed Endpoint out as a Job and skips the rest", async () => {
    const { storage, user } = await seedWriter();
    const { db } = await import("../../server/db");
    const { outboxEvents } = await import("../../shared/schema");
    const { createWebhookEndpoint, disableWebhookEndpoint } = await import(
      "../../server/modules/workspace"
    );
    const { createJobsPort } = await import("../../server/jobs");
    const { dispatchOutbox } = await import("../../server/outbox");
    const { WEBHOOK_DELIVER_JOB, WEBHOOK_DELIVER_JOB_TYPE } = await import(
      "../../server/webhookDelivery"
    );

    const matching = await inSeededWorkspace(() =>
      createWebhookEndpoint({
        url: "https://hooks.example.test/crm",
        eventTypes: ["client.created"],
      })
    );
    const otherType = await inSeededWorkspace(() =>
      createWebhookEndpoint({
        url: "https://hooks.example.test/projects",
        eventTypes: ["project.created"],
      })
    );
    const disabled = await inSeededWorkspace(() =>
      createWebhookEndpoint({
        url: "https://hooks.example.test/off",
        eventTypes: ["client.created"],
      })
    );
    await inSeededWorkspace(() => disableWebhookEndpoint(disabled.id));

    const client = await inSeededWorkspace(() =>
      storage.createCrmClient({ name: "Northwind", ownerId: user.id })
    );
    const jobs = createJobsPort({
      db,
      types: { [WEBHOOK_DELIVER_JOB]: WEBHOOK_DELIVER_JOB_TYPE },
    });

    expect(await dispatchOutbox(jobs)).toBe(1);
    expect(await dispatchOutbox(jobs)).toBe(0);

    const [event] = await inSeededWorkspace(() => db.select().from(outboxEvents));
    expect(event.dispatchedAt).toBeInstanceOf(Date);

    const claimed = await jobs.claim("worker-1");
    expect(claimed).toMatchObject({
      type: WEBHOOK_DELIVER_JOB,
      workspaceId: SEEDED_WORKSPACE_ID,
      payload: { outboxEventId: event.id, endpointId: matching.id },
    });
    expect(claimed!.payload).not.toMatchObject({ endpointId: otherType.id });
    expect(claimed!.payload).not.toMatchObject({ endpointId: disabled.id });
    expect(await jobs.claim("worker-2")).toBeNull();
    expect(client.id).toBeTruthy();
  });

  it("POSTs an HMAC-signed thin body and retries at-least-once until success", async () => {
    const { createHmac } = await import("node:crypto");
    const { storage, user } = await seedWriter();
    const { db } = await import("../../server/db");
    const { createWebhookEndpoint } = await import("../../server/modules/workspace");
    const { createJobsPort } = await import("../../server/jobs");
    const { createJobRunner } = await import("../../server/worker");
    const { dispatchOutbox } = await import("../../server/outbox");
    const {
      WEBHOOK_DELIVER_JOB,
      WEBHOOK_DELIVER_JOB_TYPE,
      handleWebhookDeliverJob,
    } = await import("../../server/webhookDelivery");

    const endpoint = await inSeededWorkspace(() =>
      createWebhookEndpoint({
        url: "https://hooks.example.test/crm",
        eventTypes: ["client.created"],
      })
    );
    const client = await inSeededWorkspace(() =>
      storage.createCrmClient({ name: "Northwind", ownerId: user.id })
    );

    const posts: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    let failuresLeft = 1;
    const sink = {
      async post(input: { url: string; body: string; headers: Record<string, string> }) {
        posts.push(input);
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw new Error("consumer down");
        }
      },
    };

    const jobs = createJobsPort({
      db,
      types: {
        [WEBHOOK_DELIVER_JOB]: { ...WEBHOOK_DELIVER_JOB_TYPE, attempts: 3, backoffMs: 0 },
      },
    });
    await dispatchOutbox(jobs);
    const runner = createJobRunner({
      role: "worker",
      jobs,
      handlers: {
        [WEBHOOK_DELIVER_JOB]: (job) => handleWebhookDeliverJob(job, sink),
      },
      claimerId: "worker-1",
    });

    expect((await runner.runOne())?.type).toBe(WEBHOOK_DELIVER_JOB);
    expect((await runner.runOne())?.type).toBe(WEBHOOK_DELIVER_JOB);
    expect(await runner.runOne()).toBeNull();

    expect(posts).toHaveLength(2);
    expect(posts[0]).toEqual(posts[1]);
    expect(posts[0]!.url).toBe("https://hooks.example.test/crm");
    const payload = JSON.parse(posts[0]!.body) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ["clientId", "id", "occurredAt", "type", "workspaceId"].sort()
    );
    expect(payload).toMatchObject({
      type: "client.created",
      workspaceId: SEEDED_WORKSPACE_ID,
      clientId: client.id,
    });
    expect(payload).not.toHaveProperty("name");
    expect(typeof payload.id).toBe("string");
    expect(typeof payload.occurredAt).toBe("string");

    const expected = createHmac("sha256", endpoint.plaintextSecret)
      .update(posts[0]!.body)
      .digest("hex");
    expect(posts[0]!.headers["x-docuflow-signature"]).toBe(`sha256=${expected}`);
    expect(posts[0]!.headers["content-type"]).toBe("application/json");
  });

  it("auto-disables the Endpoint after exhausted attempts", async () => {
    const { storage, user } = await seedWriter();
    const { db } = await import("../../server/db");
    const { createWebhookEndpoint, getWebhookEndpoint } = await import(
      "../../server/modules/workspace"
    );
    const { createJobsPort } = await import("../../server/jobs");
    const { createJobRunner } = await import("../../server/worker");
    const { dispatchOutbox } = await import("../../server/outbox");
    const {
      WEBHOOK_DELIVER_JOB,
      WEBHOOK_DELIVER_JOB_TYPE,
      handleWebhookDeliverJob,
    } = await import("../../server/webhookDelivery");

    const endpoint = await inSeededWorkspace(() =>
      createWebhookEndpoint({
        url: "https://hooks.example.test/crm",
        eventTypes: ["client.created"],
      })
    );
    await inSeededWorkspace(() =>
      storage.createCrmClient({ name: "Northwind", ownerId: user.id })
    );

    const sink = {
      async post() {
        throw new Error("consumer down");
      },
    };
    const jobs = createJobsPort({
      db,
      types: {
        [WEBHOOK_DELIVER_JOB]: { ...WEBHOOK_DELIVER_JOB_TYPE, attempts: 1, backoffMs: 0 },
      },
    });
    await dispatchOutbox(jobs);
    const runner = createJobRunner({
      role: "worker",
      jobs,
      handlers: {
        [WEBHOOK_DELIVER_JOB]: (job) => handleWebhookDeliverJob(job, sink),
      },
      claimerId: "worker-1",
    });
    const job = await runner.runOne();
    expect(job).not.toBeNull();
    expect(await jobs.claim("worker-2")).toBeNull();
    expect(await jobs.deadLetterFor(job!.id)).toMatchObject({ type: WEBHOOK_DELIVER_JOB });

    const disabled = await inSeededWorkspace(() => getWebhookEndpoint(endpoint.id));
    expect(disabled.disabledAt).toBeInstanceOf(Date);
  });

  it("does not POST remaining queued Jobs after the Endpoint is auto-disabled", async () => {
    const { storage, user } = await seedWriter();
    const { db } = await import("../../server/db");
    const { createWebhookEndpoint, getWebhookEndpoint } = await import(
      "../../server/modules/workspace"
    );
    const { createJobsPort } = await import("../../server/jobs");
    const { createJobRunner } = await import("../../server/worker");
    const { dispatchOutbox } = await import("../../server/outbox");
    const {
      WEBHOOK_DELIVER_JOB,
      WEBHOOK_DELIVER_JOB_TYPE,
      handleWebhookDeliverJob,
    } = await import("../../server/webhookDelivery");

    const endpoint = await inSeededWorkspace(() =>
      createWebhookEndpoint({
        url: "https://hooks.example.test/crm",
        eventTypes: ["client.created"],
      })
    );
    await inSeededWorkspace(() =>
      storage.createCrmClient({ name: "Northwind", ownerId: user.id })
    );
    await inSeededWorkspace(() =>
      storage.createCrmClient({ name: "Contoso", ownerId: user.id })
    );

    let posts = 0;
    const sink = {
      async post() {
        posts += 1;
        throw new Error("consumer down");
      },
    };
    const jobs = createJobsPort({
      db,
      types: {
        [WEBHOOK_DELIVER_JOB]: { ...WEBHOOK_DELIVER_JOB_TYPE, attempts: 1, backoffMs: 0 },
      },
    });
    expect(await dispatchOutbox(jobs)).toBe(2);
    const runner = createJobRunner({
      role: "worker",
      jobs,
      handlers: {
        [WEBHOOK_DELIVER_JOB]: (job) => handleWebhookDeliverJob(job, sink),
      },
      claimerId: "worker-1",
    });

    expect(await runner.runOne()).not.toBeNull();
    expect(await runner.runOne()).not.toBeNull();
    expect(await runner.runOne()).toBeNull();
    expect(posts).toBe(1);

    const disabled = await inSeededWorkspace(() => getWebhookEndpoint(endpoint.id));
    expect(disabled.disabledAt).toBeInstanceOf(Date);
  });

  it("replays delivery as an audited command that enqueues again", async () => {
    const { storage, user } = await seedWriter();
    const { db } = await import("../../server/db");
    const { auditEvents, outboxEvents } = await import("../../shared/schema");
    const { createWebhookEndpoint } = await import("../../server/modules/workspace");
    const { createJobsPort } = await import("../../server/jobs");
    const { createJobRunner } = await import("../../server/worker");
    const { dispatchOutbox } = await import("../../server/outbox");
    const {
      WEBHOOK_DELIVER_JOB,
      WEBHOOK_DELIVER_JOB_TYPE,
      handleWebhookDeliverJob,
      replayWebhookDelivery,
    } = await import("../../server/webhookDelivery");

    const endpoint = await inSeededWorkspace(() =>
      createWebhookEndpoint({
        url: "https://hooks.example.test/crm",
        eventTypes: ["client.created"],
      })
    );
    await inSeededWorkspace(() =>
      storage.createCrmClient({ name: "Northwind", ownerId: user.id })
    );

    const posts: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    const sink = {
      async post(input: { url: string; body: string; headers: Record<string, string> }) {
        posts.push(input);
      },
    };
    const jobs = createJobsPort({
      db,
      types: { [WEBHOOK_DELIVER_JOB]: WEBHOOK_DELIVER_JOB_TYPE },
    });
    await dispatchOutbox(jobs);
    const runner = createJobRunner({
      role: "worker",
      jobs,
      handlers: {
        [WEBHOOK_DELIVER_JOB]: (job) => handleWebhookDeliverJob(job, sink),
      },
      claimerId: "worker-1",
    });
    await runner.runOne();
    expect(posts).toHaveLength(1);

    const [event] = await inSeededWorkspace(() => db.select().from(outboxEvents));
    await inSeededWorkspace(() =>
      replayWebhookDelivery(jobs, { outboxEventId: event.id, endpointId: endpoint.id })
    );

    const audits = await inSeededWorkspace(() => db.select().from(auditEvents));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      type: "webhook.replay",
      workspaceId: SEEDED_WORKSPACE_ID,
      resourceType: "outbox_event",
      resourceId: event.id,
      payload: { endpointId: endpoint.id, outboxEventId: event.id },
    });

    expect((await runner.runOne())?.type).toBe(WEBHOOK_DELIVER_JOB);
    expect(posts).toHaveLength(2);
    expect(JSON.parse(posts[1]!.body)).toEqual(JSON.parse(posts[0]!.body));
  });
});
