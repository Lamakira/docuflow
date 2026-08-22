/**
 * Webhook delivery Jobs (#130, ADR-0011, ADR-0013). Each enabled Webhook
 * Endpoint subscribed to an Outbox Event becomes a Job: HMAC-signed POST of a
 * thin payload. HTTP never delivers. Tests inject a fake sink.
 */

import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  auditEvents,
  outboxEvents,
  webhookEndpoints,
} from "@shared/schema";
import { db } from "./db";
import type { Job, JobTypeDeclaration, JobsPort } from "./jobs";
import { disableWebhookEndpoint, WebhookEndpointNotFoundError } from "./modules/workspace";
import { inWorkspace, principalProvenance, requireWorkspaceContext } from "./workspaceContext";
import { uuidv7 } from "./uuidv7";

export const WEBHOOK_DELIVER_JOB = "webhook.deliver";

/** ~72h of linear backoff (13 attempts × 6h after the first try). */
export const WEBHOOK_DELIVER_JOB_TYPE: JobTypeDeclaration = {
  attempts: 13,
  backoffMs: 6 * 60 * 60 * 1000,
  timeoutMs: 30_000,
  concurrencyClass: "external-delivery",
};

export type WebhookSink = {
  post(input: { url: string; body: string; headers: Record<string, string> }): Promise<void>;
};

export function createFetchWebhookSink(): WebhookSink {
  return {
    async post({ url, body, headers }) {
      const response = await fetch(url, {
        method: "POST",
        body,
        headers,
        signal: AbortSignal.timeout(WEBHOOK_DELIVER_JOB_TYPE.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Webhook POST ${response.status}`);
      }
    },
  };
}

export function webhookDeliverOccurrenceKey(outboxEventId: string, endpointId: string): string {
  return `${WEBHOOK_DELIVER_JOB}:${outboxEventId}:${endpointId}`;
}

function thinBody(event: {
  id: string;
  type: string;
  workspaceId: string;
  occurredAt: Date;
  payload: Record<string, string>;
}): string {
  return JSON.stringify({
    type: event.type,
    id: event.id,
    workspaceId: event.workspaceId,
    occurredAt: new Date(event.occurredAt).toISOString(),
    ...event.payload,
  });
}

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function handleWebhookDeliverJob(
  job: Job,
  sink: WebhookSink = createFetchWebhookSink()
): Promise<void> {
  const payload = job.payload as { outboxEventId?: unknown; endpointId?: unknown };
  if (typeof payload.outboxEventId !== "string" || payload.outboxEventId.length === 0) {
    throw new Error(`Job "${job.id}" is missing an outboxEventId.`);
  }
  if (typeof payload.endpointId !== "string" || payload.endpointId.length === 0) {
    throw new Error(`Job "${job.id}" is missing an endpointId.`);
  }

  const [event] = await db
    .select()
    .from(outboxEvents)
    .where(and(eq(outboxEvents.id, payload.outboxEventId), inWorkspace(outboxEvents)));
  const [endpoint] = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, payload.endpointId), inWorkspace(webhookEndpoints)));
  if (!event || !endpoint) return;
  if (endpoint.disabledAt) return;

  const body = thinBody(event);
  try {
    await sink.post({
      url: endpoint.url,
      body,
      headers: {
        "content-type": "application/json",
        "x-docuflow-signature": sign(endpoint.hmacSecret, body),
      },
    });
  } catch (error) {
    if (job.attempt >= job.maxAttempts) {
      await disableWebhookEndpoint(endpoint.id);
    }
    throw error;
  }
}

export async function replayWebhookDelivery(
  jobs: JobsPort,
  input: { outboxEventId: string; endpointId: string }
): Promise<void> {
  const ctx = requireWorkspaceContext();
  const principal = principalProvenance(ctx);
  const [event] = await db
    .select()
    .from(outboxEvents)
    .where(and(eq(outboxEvents.id, input.outboxEventId), inWorkspace(outboxEvents)));
  if (!event) {
    throw new Error("Outbox Event not found");
  }
  const [endpoint] = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, input.endpointId), inWorkspace(webhookEndpoints)));
  if (!endpoint) throw new WebhookEndpointNotFoundError();

  const auditId = uuidv7();
  await db.transaction(async (tx) => {
    await tx.insert(auditEvents).values({
      id: auditId,
      type: "webhook.replay",
      occurredAt: new Date(),
      workspaceId: ctx.workspaceId,
      principalKind: principal.principalKind,
      principalId: principal.principalId,
      resourceType: "outbox_event",
      resourceId: event.id,
      payload: { endpointId: endpoint.id, outboxEventId: event.id },
    });
    await jobs.enqueue(
      {
        type: WEBHOOK_DELIVER_JOB,
        payload: { outboxEventId: event.id, endpointId: endpoint.id },
        workspaceId: ctx.workspaceId,
        occurrenceKey: `${webhookDeliverOccurrenceKey(event.id, endpoint.id)}:replay:${auditId}`,
      },
      tx
    );
  });
}
