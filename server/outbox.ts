/**
 * Transactional outbox (#130, ADR-0013). Domain writes append one Outbox Event
 * in the same transaction. A Worker dispatcher claims undispatched rows with
 * FOR UPDATE SKIP LOCKED and fans out one Job per registered consumer. HTTP
 * never dispatches.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { outboxEvents, webhookEndpoints, type WebhookEventType } from "@shared/schema";
import { db, type Db } from "./db";
import { workspaceOfCause, type JobsPort } from "./jobs";
import { WEBHOOK_DELIVER_JOB, webhookDeliverOccurrenceKey } from "./webhookDelivery";
import {
  currentWorkspaceContext,
  forEachWorkspace,
  principalProvenance,
  requireWorkspaceContext,
} from "./workspaceContext";
import { uuidv7 } from "./uuidv7";

export type OutboxWriter = Pick<Db, "insert" | "update">;

export type AllowlistedOutboxInput = {
  type: WebhookEventType;
  aggregateType: "client" | "project" | "time_entry";
  aggregateId: string;
  payload: Record<string, string>;
  occurredAt?: Date;
};

export async function appendAllowlistedOutboxEvent(
  writer: OutboxWriter,
  input: AllowlistedOutboxInput
): Promise<void> {
  const ctx = requireWorkspaceContext();
  const principal = principalProvenance(ctx);
  await writer.insert(outboxEvents).values({
    id: uuidv7(),
    type: input.type,
    occurredAt: input.occurredAt ?? new Date(),
    workspaceId: ctx.workspaceId,
    principalKind: principal.principalKind,
    principalId: principal.principalId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    payload: input.payload,
  });
}

/**
 * Claim undispatched Outbox Events and enqueue one webhook.deliver Job per
 * enabled subscribed Endpoint. Returns how many Jobs were created. HTTP never
 * calls this — only the Worker does. Unbound callers walk each Workspace so
 * the application role can see RLS-scoped rows (same pattern as schedulers).
 */
export async function dispatchOutbox(jobs: JobsPort): Promise<number> {
  if (currentWorkspaceContext()) return dispatchOutboxInCurrentWorkspace(jobs);
  const counts = await forEachWorkspace(() => dispatchOutboxInCurrentWorkspace(jobs));
  return counts.reduce((sum, n) => sum + n, 0);
}

async function dispatchOutboxInCurrentWorkspace(jobs: JobsPort): Promise<number> {
  let created = 0;
  for (;;) {
    const jobsCreated = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
      const picked = await tx.execute(sql`
        SELECT id
        FROM outbox_events
        WHERE dispatched_at IS NULL
        ORDER BY occurred_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const id = (picked.rows as { id: string }[])[0]?.id;
      if (!id) return null;

      const [event] = await tx.select().from(outboxEvents).where(eq(outboxEvents.id, id));
      const endpoints = await tx
        .select()
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.workspaceId, event.workspaceId),
            isNull(webhookEndpoints.disabledAt)
          )
        );

      let n = 0;
      for (const endpoint of endpoints) {
        if (!endpoint.eventTypes.includes(event.type as WebhookEventType)) continue;
        const enqueued = await jobs.enqueue(
          {
            type: WEBHOOK_DELIVER_JOB,
            payload: { outboxEventId: event.id, endpointId: endpoint.id },
            workspaceId: workspaceOfCause(event.workspaceId),
            occurrenceKey: webhookDeliverOccurrenceKey(event.id, endpoint.id),
          },
          tx
        );
        if (enqueued.created) n += 1;
      }

      await tx
        .update(outboxEvents)
        .set({ dispatchedAt: new Date() })
        .where(eq(outboxEvents.id, event.id));
      return n;
    });
    if (jobsCreated === null) return created;
    created += jobsCreated;
  }
}
