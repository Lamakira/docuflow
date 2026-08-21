import type { WorkspacePersistence } from "./persistence";
import {
  createWebhookEndpoint,
  disableWebhookEndpoint,
  enableWebhookEndpoint,
  getWebhookEndpoint,
  listWebhookEndpoints,
  rotateWebhookEndpointSecret,
  type WebhookEndpointPersistence,
} from "./webhookEndpoints";

export type { WorkspacePersistence };
export type {
  CreatedWebhookEndpoint,
  WebhookEndpointPersistence,
  WebhookEndpointView,
} from "./webhookEndpoints";
export { workspaceOwnerUserId } from "./owner";
export {
  canManageWebhookEndpoints,
  createWebhookEndpoint,
  disableWebhookEndpoint,
  enableWebhookEndpoint,
  getWebhookEndpoint,
  listWebhookEndpoints,
  rotateWebhookEndpointSecret,
  UnknownWebhookEventTypeError,
  WebhookEndpointNotFoundError,
} from "./webhookEndpoints";

/**
 * `org_settings` is a shared clump: Activity (`getScreenshotPolicy`) and Time
 * (`getAllowedTimezones`) persist into it. ADR-0008 keeps policy with those
 * engines, so the table stays unowned until a later split.
 */
export const WORKSPACE_TABLES = [
  "workspaces",
  "capabilities",
  "workspace_roles",
  "workspace_role_capabilities",
  "memberships",
  "membership_capabilities",
  "webhook_endpoints",
] as const;

export const webhookEndpointPersistence: WebhookEndpointPersistence = {
  createWebhookEndpoint,
  listWebhookEndpoints,
  getWebhookEndpoint,
  disableWebhookEndpoint,
  enableWebhookEndpoint,
  rotateWebhookEndpointSecret,
};

export const workspaceModule = {
  id: "workspace",
  name: "Workspace",
  tables: WORKSPACE_TABLES,
  persistence: webhookEndpointPersistence,
} as const;
