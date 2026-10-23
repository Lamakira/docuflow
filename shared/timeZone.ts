/**
 * IANA time zone names (#341). The Workspace time zone is one; the runtime's
 * own time zone database decides which names exist.
 */

/** Whether `value` names a time zone this runtime can format in, such as "Europe/Paris". */
export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
