/**
 * Webhook Endpoint (#129, ADR-0008, ADR-0011).
 *
 * A Workspace-owned target URL with HMAC key material and an event filter
 * from the public allowlist. The secret is shown once on create/rotate and
 * stored as HMAC key material the deliverer (#130) needs — never listed.
 * An Endpoint confers no read of domain records.
 */

import { randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  memberships,
  WEBHOOK_EVENT_TYPES,
  webhookEndpoints,
  workspaceRoles,
  type WebhookEventType,
} from "@shared/schema";
import { db } from "../../db";
import {
  currentWorkspaceContext,
  inWorkspace,
  stampWorkspace,
} from "../../workspaceContext";

const SECRET_PREFIX = "dfwh_";
const SECRET_BYTES = 32;

export class WebhookEndpointNotFoundError extends Error {
  constructor() {
    super("Webhook Endpoint not found");
    this.name = "WebhookEndpointNotFoundError";
  }
}

export class UnknownWebhookEventTypeError extends Error {
  constructor() {
    super("Unknown webhook event type");
    this.name = "UnknownWebhookEventTypeError";
  }
}

export type WebhookEndpointView = {
  id: string;
  url: string;
  eventTypes: WebhookEventType[];
  createdAt: Date | null;
  disabledAt: Date | null;
};

export type CreatedWebhookEndpoint = WebhookEndpointView & { plaintextSecret: string };

export interface WebhookEndpointPersistence {
  createWebhookEndpoint(input: {
    url: string;
    eventTypes: string[];
  }): Promise<CreatedWebhookEndpoint>;
  listWebhookEndpoints(): Promise<WebhookEndpointView[]>;
  getWebhookEndpoint(id: string): Promise<WebhookEndpointView>;
  disableWebhookEndpoint(id: string): Promise<void>;
  enableWebhookEndpoint(id: string): Promise<void>;
  rotateWebhookEndpointSecret(id: string): Promise<{ id: string; plaintextSecret: string }>;
}

const ALLOWED = new Set<string>(WEBHOOK_EVENT_TYPES);

function mintSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString("hex")}`;
}

function uniqueEventTypes(eventTypes: string[]): WebhookEventType[] {
  const unique = [...new Set(eventTypes)];
  if (unique.length === 0 || unique.some((type) => !ALLOWED.has(type))) {
    throw new UnknownWebhookEventTypeError();
  }
  return unique as WebhookEventType[];
}

function toView(row: typeof webhookEndpoints.$inferSelect): WebhookEndpointView {
  return {
    id: row.id,
    url: row.url,
    eventTypes: row.eventTypes,
    createdAt: row.createdAt,
    disabledAt: row.disabledAt,
  };
}

async function requireEndpoint(id: string) {
  const [row] = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, id), inWorkspace(webhookEndpoints)));
  if (!row) throw new WebhookEndpointNotFoundError();
  return row;
}

export async function createWebhookEndpoint(input: {
  url: string;
  eventTypes: string[];
}): Promise<CreatedWebhookEndpoint> {
  const eventTypes = uniqueEventTypes(input.eventTypes);
  const plaintextSecret = mintSecret();
  const [row] = await db
    .insert(webhookEndpoints)
    .values(
      stampWorkspace({
        url: input.url,
        hmacSecret: plaintextSecret,
        eventTypes,
      })
    )
    .returning();
  return { ...toView(row), plaintextSecret };
}

export async function listWebhookEndpoints(): Promise<WebhookEndpointView[]> {
  const rows = await db
    .select()
    .from(webhookEndpoints)
    .where(inWorkspace(webhookEndpoints))
    .orderBy(asc(webhookEndpoints.createdAt));
  return rows.map(toView);
}

export async function getWebhookEndpoint(id: string): Promise<WebhookEndpointView> {
  return toView(await requireEndpoint(id));
}

export async function disableWebhookEndpoint(id: string): Promise<void> {
  const [row] = await db
    .update(webhookEndpoints)
    .set({ disabledAt: new Date() })
    .where(and(eq(webhookEndpoints.id, id), inWorkspace(webhookEndpoints)))
    .returning({ id: webhookEndpoints.id });
  if (!row) throw new WebhookEndpointNotFoundError();
}

export async function enableWebhookEndpoint(id: string): Promise<void> {
  const [row] = await db
    .update(webhookEndpoints)
    .set({ disabledAt: null })
    .where(and(eq(webhookEndpoints.id, id), inWorkspace(webhookEndpoints)))
    .returning({ id: webhookEndpoints.id });
  if (!row) throw new WebhookEndpointNotFoundError();
}

export async function rotateWebhookEndpointSecret(
  id: string
): Promise<{ id: string; plaintextSecret: string }> {
  await requireEndpoint(id);
  const plaintextSecret = mintSecret();
  await db
    .update(webhookEndpoints)
    .set({ hmacSecret: plaintextSecret })
    .where(and(eq(webhookEndpoints.id, id), inWorkspace(webhookEndpoints)));
  return { id, plaintextSecret };
}

/** Owner and Administrator may manage Webhook Endpoints. Member may not. */
export async function canManageWebhookEndpoints(): Promise<boolean> {
  const ctx = currentWorkspaceContext();
  if (!ctx?.membershipId) return false;
  const [row] = await db
    .select({ slug: workspaceRoles.slug })
    .from(memberships)
    .innerJoin(workspaceRoles, eq(memberships.workspaceRoleId, workspaceRoles.id))
    .where(eq(memberships.id, ctx.membershipId));
  return row?.slug === "owner" || row?.slug === "administrator";
}
