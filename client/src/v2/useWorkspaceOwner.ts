/**
 * The Owner a refusal names (#250). Every v2 screen that ends a refusal with
 * "…(Owner) can grant it" reads the Owner here, from the Memberships of the
 * Workspace being read. React Query holds one request behind the shared key, so
 * the screens that ask cost a single fetch.
 */

import { useQuery } from "@tanstack/react-query";
import { workspaceOwnerName, type WorkspaceMemberRow } from "./workspace";

const WORKSPACE_MEMBERSHIPS_PATH = "/api/workspace/memberships";

type WorkspaceMembershipsResponse = { memberships: WorkspaceMemberRow[] };

export function useWorkspaceOwnerName(): string | null {
  const { data } = useQuery<WorkspaceMembershipsResponse>({
    queryKey: [WORKSPACE_MEMBERSHIPS_PATH],
    queryFn: async () => {
      const res = await fetch(WORKSPACE_MEMBERSHIPS_PATH, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Memberships");
      return res.json();
    },
  });
  return workspaceOwnerName(data?.memberships ?? []);
}
