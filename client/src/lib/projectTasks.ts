import type { Task } from "@shared/schema";

/**
 * The Tasks of one Project, as the Timer, the Time page and the Dossier read
 * them: one query key and one request, so the three share the cache and a
 * change to the request is made once (#400).
 */
export function projectTasksQuery<T = Task>(crmProjectId: string) {
  return {
    queryKey: ["/api/tasks", crmProjectId] as const,
    queryFn: (): Promise<{ data: T[] }> =>
      fetch(`/api/tasks?crmProjectId=${encodeURIComponent(crmProjectId)}`, { credentials: "include" }).then((res) =>
        res.json(),
      ),
    enabled: Boolean(crmProjectId),
  };
}
