import { identityModule } from "./identity";
import { workspaceModule } from "./workspace";
import { clientsSalesModule } from "./clients-sales";
import { projectsModule } from "./projects";
import { timeModule } from "./time";
import { activityModule } from "./activity";
import { knowledgeModule } from "./knowledge";
import { billingModule } from "./billing";
import { notificationsModule } from "./notifications";
import { intelligenceModule } from "./intelligence";
import type { IdentityPersistence } from "./identity/persistence";
import type { WorkspacePersistence } from "./workspace/persistence";
import type { ClientsSalesPersistence } from "./clients-sales/persistence";
import type { ProjectsPersistence } from "./projects/persistence";
import type { TimePersistence } from "./time/persistence";
import type { ActivityPersistence } from "./activity/persistence";
import type { KnowledgePersistence } from "./knowledge/persistence";
import type { BillingPersistence } from "./billing/persistence";
import type { NotificationsPersistence } from "./notifications/persistence";
import type { IntelligencePersistence } from "./intelligence/persistence";

/**
 * ADR-0008 / ADR-0014 domain modules. Each owns a persistence interface and
 * the tables listed here. HTTP keeps working through `server/storage.ts`.
 *
 * Jobs, dead letters, and scheduler leases are the Worker port (ADR-0013),
 * not a domain module.
 */
export const INFRASTRUCTURE_TABLES = [
  "jobs",
  "dead_letters",
  "scheduler_leases",
  "schema_migrations",
  "public_api_idempotency_keys",
  "audit_events",
] as const;

export const DOMAIN_MODULES = [
  identityModule,
  workspaceModule,
  clientsSalesModule,
  projectsModule,
  timeModule,
  activityModule,
  knowledgeModule,
  billingModule,
  notificationsModule,
  intelligenceModule,
] as const;

export type IStorage = IdentityPersistence &
  WorkspacePersistence &
  ClientsSalesPersistence &
  ProjectsPersistence &
  TimePersistence &
  ActivityPersistence &
  KnowledgePersistence &
  BillingPersistence &
  NotificationsPersistence &
  IntelligencePersistence;
