export const DELIVERY_CATEGORIES = [
  { id: "work-assignments", label: "Work assignments", mandatory: false },
  { id: "reminders", label: "Reminders", mandatory: false },
  { id: "approvals", label: "Approvals", mandatory: false },
  { id: "membership", label: "Membership", mandatory: true },
  { id: "billing", label: "Billing", mandatory: true },
  { id: "security", label: "Security", mandatory: true },
] as const;

export type DeliveryCategoryId = (typeof DELIVERY_CATEGORIES)[number]["id"];

export function normalizeDeliveryPreference(
  emailByCategory: Partial<Record<string, boolean>> | null | undefined,
): Partial<Record<DeliveryCategoryId, boolean>> {
  const next: Partial<Record<DeliveryCategoryId, boolean>> = {};
  for (const category of DELIVERY_CATEGORIES) {
    if (category.mandatory) {
      next[category.id] = true;
      continue;
    }
    const value = emailByCategory?.[category.id];
    if (typeof value === "boolean") next[category.id] = value;
  }
  return next;
}

export function resolvedDeliveryPreference(
  emailByCategory: Partial<Record<string, boolean>> | null | undefined,
): Record<DeliveryCategoryId, boolean> {
  const next = {} as Record<DeliveryCategoryId, boolean>;
  for (const category of DELIVERY_CATEGORIES) {
    next[category.id] = emailChannelEnabled(emailByCategory, category.id);
  }
  return next;
}

export function emailChannelEnabled(
  emailByCategory: Partial<Record<string, boolean>> | null | undefined,
  category: DeliveryCategoryId,
): boolean {
  const def = DELIVERY_CATEGORIES.find((row) => row.id === category);
  if (!def || def.mandatory) return true;
  return emailByCategory?.[category] ?? true;
}

export function toggleDeliveryPreference(
  emailByCategory: Partial<Record<DeliveryCategoryId, boolean>>,
  change: { category: DeliveryCategoryId; email: boolean },
): Partial<Record<DeliveryCategoryId, boolean>> {
  return normalizeDeliveryPreference({
    ...emailByCategory,
    [change.category]: change.email,
  });
}
