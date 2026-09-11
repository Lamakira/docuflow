import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { motionForSurface } from "./motion";
import {
  composePeople,
  peopleWriteRefusal,
  workspaceMembershipsPath,
  type PeopleMembershipInput,
} from "./people";
import { memberName } from "./today";
import { useV2Chrome } from "./V2Shell";

type WorkspaceMembershipsResponse = { memberships: PeopleMembershipInput[] };
type BillingSubscription = { purchasedSeatCapacity?: number };

const REFUSAL_MOTION = motionForSurface("capability-refusal").enterExit;

export function V2PeoplePage() {
  const { user } = useAuth();
  const { layout, memberships } = useV2Chrome();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [refusal, setRefusal] = useState<{ userId: string; message: string } | null>(null);
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";
  const canReviewArchived =
    current?.workspaceRole === "OWNER" || current?.workspaceRole === "ADMINISTRATOR";

  const listUrl = workspaceMembershipsPath({ includeArchived: canReviewArchived && includeArchived });
  const { data, isLoading, isError } = useQuery<WorkspaceMembershipsResponse>({
    queryKey: ["/api/workspace/memberships", listUrl],
    queryFn: async () => {
      const res = await fetch(listUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch Memberships");
      return res.json();
    },
  });
  const { data: subscription } = useQuery<BillingSubscription | null>({
    queryKey: ["/api/billing/subscription"],
    queryFn: async () => {
      const res = await fetch("/api/billing/subscription", { credentials: "include" });
      if (res.status === 403) return null;
      if (!res.ok) return null;
      return res.json();
    },
  });

  const owner = (data?.memberships ?? []).find((row) => row.workspaceRole === "OWNER");
  const ownerName = owner ? memberName(owner) : null;

  const page = composePeople({
    workspaceName,
    currentUserId: user?.id ?? "",
    ownerName,
    condition: current?.condition ?? null,
    includeArchived: canReviewArchived && includeArchived,
    purchasedSeats: subscription?.purchasedSeatCapacity ?? null,
    memberships: data?.memberships ?? [],
  });

  const archive = useMutation({
    mutationFn: async (row: { userId: string; archiveAction: "archive" | "restore" }) => {
      await apiRequest("PATCH", `/api/admin/users/${row.userId}/archive`, {
        isArchived: row.archiveAction === "archive",
      });
    },
    onSuccess: () => {
      setRefusal(null);
      queryClient.invalidateQueries({ queryKey: ["/api/workspace/memberships"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (error: Error, row) => {
      setRefusal({
        userId: row.userId,
        message: peopleWriteRefusal({
          kind: "error",
          workspaceName,
          ownerName,
          errorMessage: error.message,
          purchasedSeats: subscription?.purchasedSeatCapacity ?? null,
        }),
      });
    },
  });

  function onArchive(row: { userId: string; archiveAction: "archive" | "restore" }) {
    if (readOnly) {
      setRefusal({
        userId: row.userId,
        message: peopleWriteRefusal({
          kind: "workspace-condition",
          workspaceName,
          condition: "Read-only",
        }),
      });
      return;
    }
    archive.mutate(row);
  }

  if (isLoading) {
    return (
      <div className="df-page" data-testid="v2-people">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">People</h1>
            <p className="df-subhead">Loading this Workspace…</p>
          </div>
        </header>
        <div className="df-card" style={{ minHeight: 280 }} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="df-page" data-testid="v2-people">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">People</h1>
            <p className="df-subhead">{page.subhead}</p>
          </div>
        </header>
        <p className="df-empty">Memberships in this Workspace could not be loaded.</p>
      </div>
    );
  }

  return (
    <div className="df-page" data-testid="v2-people">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">People</h1>
          <p className="df-subhead">{page.subhead}</p>
        </div>
        <span className="df-count-chip">{page.rows.length}</span>
      </header>

      <p className="df-empty" style={{ paddingTop: 0 }}>
        {page.seatCopy}
      </p>

      {canReviewArchived ? (
        <div className="df-filter-bar">
          <label className="df-filter-chip" data-active={includeArchived ? "true" : "false"}>
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => {
                setIncludeArchived(event.target.checked);
                setRefusal(null);
              }}
            />
            Show archived
          </label>
        </div>
      ) : null}

      <section className="df-card df-people-register" data-testid="v2-people-register">
        {layout.stackedRegister ? null : (
          <div className="df-register-head df-desktop-only">
            <span>MEMBER</span>
            <span>WORKSPACE ROLE</span>
            <span>CAPABILITIES</span>
            <span>STATUS</span>
            <span />
          </div>
        )}
        {page.empty ? (
          <p className="df-empty">{page.emptyCopy}</p>
        ) : (
          page.rows.map((row) => (
            <div key={row.membershipId} className="df-people-row-wrap">
              <div className="df-register-row" data-testid={`v2-people-row-${row.userId}`}>
                {layout.stackedRegister ? (
                  <span className="df-project-mobile">
                    <span className="df-avatar" data-self={row.self ? "true" : "false"}>
                      {row.initials}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <div className="df-row-title">{row.name}</div>
                      <div className="df-mono df-meta">
                        {row.workspaceRole} · {row.status}
                        {row.capabilities !== "—" ? ` · ${row.capabilities}` : ""}
                      </div>
                    </span>
                    {row.archiveAction ? (
                      <ArchiveControl
                        row={{ userId: row.userId, archiveAction: row.archiveAction }}
                        pending={archive.isPending}
                        refusal={refusal}
                        onArchive={onArchive}
                        onDismiss={() => setRefusal(null)}
                      />
                    ) : null}
                  </span>
                ) : (
                  <>
                    <span className="df-people-member">
                      <span className="df-avatar" data-self={row.self ? "true" : "false"}>
                        {row.initials}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <div className="df-row-title">{row.name}</div>
                        <div className="df-mono df-meta">{row.email}</div>
                      </span>
                    </span>
                    <span className="df-status">{row.workspaceRole}</span>
                    <span className="df-mono df-meta">{row.capabilities}</span>
                    <span className="df-status" data-status={row.status}>
                      {row.status}
                    </span>
                    <span className="df-people-action">
                      {row.archiveAction ? (
                        <ArchiveControl
                          row={{ userId: row.userId, archiveAction: row.archiveAction }}
                          pending={archive.isPending}
                          refusal={refusal}
                          onArchive={onArchive}
                          onDismiss={() => setRefusal(null)}
                        />
                      ) : null}
                    </span>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function ArchiveControl({
  row,
  pending,
  refusal,
  onArchive,
  onDismiss,
}: {
  row: { userId: string; archiveAction: "archive" | "restore" };
  pending: boolean;
  refusal: { userId: string; message: string } | null;
  onArchive: (row: { userId: string; archiveAction: "archive" | "restore" }) => void;
  onDismiss: () => void;
}) {
  const open = refusal?.userId === row.userId;
  return (
    <span className="df-refusal-anchor">
      <button
        type="button"
        className="df-ghost-link"
        disabled={pending}
        data-testid={`v2-people-archive-${row.userId}`}
        onClick={() => onArchive(row)}
      >
        {row.archiveAction === "restore" ? "Restore" : "Archive"}
      </button>
      {open ? (
        <div
          className="df-refusal-pop"
          data-motion={REFUSAL_MOTION}
          role="status"
          data-testid={`v2-people-refusal-${row.userId}`}
        >
          <p className="df-refusal">{refusal.message}</p>
          <button type="button" className="df-ghost-link" onClick={onDismiss}>
            Close
          </button>
        </div>
      ) : null}
    </span>
  );
}
