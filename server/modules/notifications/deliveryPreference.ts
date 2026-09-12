import { and, eq, isNull } from "drizzle-orm";
import {
  emailChannelEnabled,
  resolvedDeliveryPreference,
  type DeliveryCategoryId,
} from "@shared/deliveryPreference";
import { memberships } from "@shared/schema";
import { db } from "../../db";
import { requireWorkspaceContext } from "../../workspaceContext";

export async function getDeliveryPreference(
  userId: string,
): Promise<Record<DeliveryCategoryId, boolean>> {
  const stored = await readDeliveryPreference(userId);
  return resolvedDeliveryPreference(stored);
}

export async function putDeliveryPreference(
  userId: string,
  emailByCategory: Partial<Record<string, boolean>>,
): Promise<Record<DeliveryCategoryId, boolean>> {
  const { workspaceId } = requireWorkspaceContext();
  const current = await readDeliveryPreference(userId);
  const next = resolvedDeliveryPreference({ ...current, ...emailByCategory });
  const [updated] = await db
    .update(memberships)
    .set({ deliveryPreferences: next, updatedAt: new Date() })
    .where(
      and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId), isNull(memberships.archivedAt)),
    )
    .returning({ deliveryPreferences: memberships.deliveryPreferences });
  if (!updated) {
    throw new DeliveryPreferenceNotFoundError();
  }
  return resolvedDeliveryPreference(updated.deliveryPreferences);
}

export async function emailEnabledForUser(userId: string, category: DeliveryCategoryId): Promise<boolean> {
  return emailChannelEnabled(await readDeliveryPreference(userId), category);
}

export class DeliveryPreferenceNotFoundError extends Error {
  constructor() {
    super("Delivery Preference not found");
    this.name = "DeliveryPreferenceNotFoundError";
  }
}

async function readDeliveryPreference(userId: string): Promise<Record<string, boolean> | null> {
  const { workspaceId } = requireWorkspaceContext();
  const [row] = await db
    .select({ deliveryPreferences: memberships.deliveryPreferences })
    .from(memberships)
    .where(
      and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId), isNull(memberships.archivedAt)),
    )
    .limit(1);
  return row?.deliveryPreferences ?? null;
}
