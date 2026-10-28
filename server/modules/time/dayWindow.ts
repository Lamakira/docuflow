/**
 * The agent's Task-today window: server-local midnight to 23:59:59.999.
 * Kept identical for the web Timer chip and the agent so they agree.
 */
export function serverDayWindow(now: Date): { startOfDay: Date; endOfDay: Date } {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { startOfDay, endOfDay };
}
