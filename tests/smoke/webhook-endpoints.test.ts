import { beforeEach, describe, expect, it } from "vitest";
import { webhookEndpoints } from "../../shared/schema";
import { inSeededWorkspace } from "../helpers/workspace";
import { resetDb } from "../helpers/db";

/**
 * Phase 7 ticket #129: Workspace owns Webhook Endpoint. Delivery (#130) is
 * not this suite. Seam: the Workspace module (create / list / get / disable /
 * rotate, allowlist, isolation). Web BFF characterization is in
 * tests/characterization/webhook-endpoints.test.ts; `/api/v1` characterization
 * is in public-api-v1.test.ts.
 */

describe("Webhook Endpoints (Workspace)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a Webhook Endpoint, shows the secret once, and never lists it later", async () => {
    const { createWebhookEndpoint, listWebhookEndpoints } = await import(
      "../../server/modules/workspace"
    );
    const { db } = await import("../../server/db");

    const created = await inSeededWorkspace(() =>
      createWebhookEndpoint({
        url: "https://hooks.example.test/crm",
        eventTypes: ["client.created", "project.updated"],
      })
    );

    expect(created).toMatchObject({
      url: "https://hooks.example.test/crm",
      eventTypes: ["client.created", "project.updated"],
      disabledAt: null,
    });
    expect(created.plaintextSecret.startsWith("dfwh_")).toBe(true);
    expect(created).not.toHaveProperty("hmacSecret");

    const listed = await inSeededWorkspace(() => listWebhookEndpoints());
    expect(listed).toEqual([
      {
        id: created.id,
        url: "https://hooks.example.test/crm",
        eventTypes: ["client.created", "project.updated"],
        createdAt: created.createdAt,
        disabledAt: null,
      },
    ]);
    expect(listed[0]).not.toHaveProperty("plaintextSecret");
    expect(listed[0]).not.toHaveProperty("hmacSecret");

    const [stored] = await db.select().from(webhookEndpoints);
    expect(stored.id).toBe(created.id);
    expect(stored.hmacSecret).toBe(created.plaintextSecret);
  });

  it("gets, disables, re-enables, and rotates without listing the new secret", async () => {
    const {
      createWebhookEndpoint,
      getWebhookEndpoint,
      disableWebhookEndpoint,
      enableWebhookEndpoint,
      rotateWebhookEndpointSecret,
      listWebhookEndpoints,
    } = await import("../../server/modules/workspace");

    const created = await inSeededWorkspace(() =>
      createWebhookEndpoint({
        url: "https://hooks.example.test/crm",
        eventTypes: ["time_entry.stopped"],
      })
    );

    const got = await inSeededWorkspace(() => getWebhookEndpoint(created.id));
    expect(got).toEqual({
      id: created.id,
      url: created.url,
      eventTypes: ["time_entry.stopped"],
      createdAt: created.createdAt,
      disabledAt: null,
    });
    expect(got).not.toHaveProperty("plaintextSecret");

    await inSeededWorkspace(() => disableWebhookEndpoint(created.id));
    const disabled = await inSeededWorkspace(() => getWebhookEndpoint(created.id));
    expect(disabled.disabledAt).toBeInstanceOf(Date);

    await inSeededWorkspace(() => enableWebhookEndpoint(created.id));
    const enabled = await inSeededWorkspace(() => getWebhookEndpoint(created.id));
    expect(enabled.disabledAt).toBeNull();

    const rotated = await inSeededWorkspace(() => rotateWebhookEndpointSecret(created.id));
    expect(rotated.plaintextSecret).not.toBe(created.plaintextSecret);
    expect(rotated.plaintextSecret.startsWith("dfwh_")).toBe(true);

    const listed = await inSeededWorkspace(() => listWebhookEndpoints());
    expect(listed[0]).not.toHaveProperty("plaintextSecret");
    expect(listed[0]?.id).toBe(created.id);
  });

  it("rejects an event type outside the public allowlist", async () => {
    const { createWebhookEndpoint, UnknownWebhookEventTypeError } = await import(
      "../../server/modules/workspace"
    );

    await expect(
      inSeededWorkspace(() =>
        createWebhookEndpoint({
          url: "https://hooks.example.test/crm",
          eventTypes: ["client.created", "invoice.paid"],
        })
      )
    ).rejects.toBeInstanceOf(UnknownWebhookEventTypeError);
  });

  it("does not let one Workspace read another Workspace's Endpoints", async () => {
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");
    const { createWebhookEndpoint, listWebhookEndpoints, getWebhookEndpoint } = await import(
      "../../server/modules/workspace"
    );
    const { workspaces } = await import("../../shared/schema");
    const { db } = await import("../../server/db");
    const { WebhookEndpointNotFoundError } = await import("../../server/modules/workspace");

    await db.insert(workspaces).values({ id: "other", name: "Other" });

    const theirs = await runWithWorkspaceContext({ workspaceId: "other" }, () =>
      createWebhookEndpoint({
        url: "https://other.example.test/hooks",
        eventTypes: ["client.created"],
      })
    );
    const ours = await inSeededWorkspace(() =>
      createWebhookEndpoint({
        url: "https://ours.example.test/hooks",
        eventTypes: ["project.created"],
      })
    );

    const visible = await inSeededWorkspace(() => listWebhookEndpoints());
    expect(visible.map((row) => row.id)).toEqual([ours.id]);

    await expect(inSeededWorkspace(() => getWebhookEndpoint(theirs.id))).rejects.toBeInstanceOf(
      WebhookEndpointNotFoundError
    );

    const fromTheirs = await runWithWorkspaceContext({ workspaceId: "other" }, () =>
      listWebhookEndpoints()
    );
    expect(fromTheirs.map((row) => row.id)).toEqual([theirs.id]);
  });
});

