/**
 * Central write-classification for Read-only Workspace (#140).
 * Capability denial, Read-only Workspace, and seat exhaustion are distinct errors.
 */

import { effectiveEntitlements } from "./entitlements";

export type WriteClass = "operational" | "view" | "export" | "billing_recovery";

export class ReadOnlyWorkspaceError extends Error {
  readonly statusCode = 403;
  constructor() {
    super("Workspace is read-only");
    this.name = "ReadOnlyWorkspaceError";
  }
}

export class SeatExhaustedError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("Billable Seat capacity is exhausted");
    this.name = "SeatExhaustedError";
  }
}

export async function assertWriteClass(kind: WriteClass): Promise<void> {
  if (kind !== "operational") return;
  await assertOperationalWrite();
}

export async function assertOperationalWrite(): Promise<void> {
  const entitlements = await effectiveEntitlements();
  if (!entitlements.writesAllowed) throw new ReadOnlyWorkspaceError();
}
