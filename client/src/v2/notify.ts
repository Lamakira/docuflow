/**
 * Action feedback for v2. The result of a write — saved, created,
 * deleted, or the server refusing it — lands in one top-center toast.
 * Field validation, page states, and Capability refusals stay inline.
 */

import { toast } from "sonner";
import { chromeRefusal } from "./chrome";

export const NETWORK_FAILURE = "DocuFlow could not be reached. Check your connection and try again.";
export const GENERIC_FAILURE = "Something went wrong. Try again.";

/** The copy a failed write shows, read from the error apiRequest throws. */
export function errorMessage(error: unknown, fallback: string = GENERIC_FAILURE): string {
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) return NETWORK_FAILURE;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message.trim()) return fallback;
  return chromeRefusal({ kind: "generic", message });
}

const STANDING_REFUSAL = /read-only|permission denied|not authorized|access denied|forbidden|capability/i;
const PLAN_REFUSAL = /\bUpgrade to [A-Z]\w* to\b/;

/** The server's refusal for an area the Workspace's Plan leaves out; it names the Plan to move to. */
export function isPlanRefusal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return PLAN_REFUSAL.test(message);
}

/**
 * A refusal that explains the reader's standing — a Capability, the Workspace
 * Role, a Read-only Workspace — stays beside the control that raised it. A
 * Plan refusal is a toast: its own words are the whole explanation.
 */
export function isStandingRefusal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return STANDING_REFUSAL.test(message) && !isPlanRefusal(message);
}

type NotifyOptions = {
  /** A toast with the same id replaces the one on screen rather than stacking. */
  id?: string;
};

export const notify = {
  success(message: string, options: NotifyOptions = {}) {
    toast.success(message, options);
  },
  info(message: string, options: NotifyOptions = {}) {
    toast.info(message, options);
  },
  error(error: unknown, { fallback, ...options }: NotifyOptions & { fallback?: string } = {}) {
    toast.error(errorMessage(error, fallback), options);
  },
};

export function copyToClipboard(text: string, copied: string): void {
  navigator.clipboard.writeText(text).then(
    () => notify.success(copied),
    () => notify.error(null, { fallback: "Could not copy. Select the text and copy it instead." }),
  );
}
