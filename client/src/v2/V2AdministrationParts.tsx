/**
 * What the Administration tabs share (F107): one read per card that loads,
 * fails and refreshes alone, the refusal a write can meet, and the checkbox row.
 */

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { administrationRefusal, administrationWriteRefusal } from "./administration";
import { isStandingRefusal, notify } from "./notify";
import { useRefreshFailure } from "./useRefreshFailure";
import { readBehindAdministration } from "./V2Analytics";
import { V2EmptyState } from "./V2EmptyState";
import type { WorkspaceCondition } from "./workspace";

/** Who is reading, passed from the page to each tab. */
export type AdministrationContext = {
  workspaceName: string;
  workspaceRole: string;
  ownerName: string | null;
  condition: WorkspaceCondition;
  stacked: boolean;
};

export type AdministrationRead<T> = {
  data: T | undefined;
  /** `refused`: the Administration gate said no; never drawn as empty. */
  state: "loading" | "failed" | "refused" | "ready";
  retry: () => void;
};

/**
 * One card's read. A refresh that fails with data on screen keeps the data and
 * says so once. `refusable: false` for a key another screen reads with a fetch
 * that throws, so both agree on what the cache holds.
 */
export function useAdministrationRead<T>(
  path: string,
  noun: string,
  id: string,
  { enabled = true, refusable = true }: { enabled?: boolean; refusable?: boolean } = {},
): AdministrationRead<T> {
  const query = useQuery<T | null>({
    queryKey: [path],
    enabled,
    staleTime: 0,
    queryFn: async () => {
      if (refusable) return readBehindAdministration<T>(path);
      const res = await fetch(path, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to read ${path}`);
      return res.json();
    },
  });
  const data = query.data ?? undefined;
  useRefreshFailure(query.isError && data !== undefined, `${noun} could not be refreshed.`, `v2-administration-${id}-refresh-failed`);
  // Another screen may have cached `null` for the same key; while this read
  // runs it is a wait, not a refusal.
  const refused = query.data === null && !query.isFetching && !query.isError;
  return {
    data,
    state: refused ? "refused" : query.isError && data === undefined ? "failed" : data === undefined ? "loading" : "ready",
    retry: () => {
      void query.refetch();
    },
  };
}

/** A read the gate refused: the reason, drawn as Analytics draws it. */
export function AdministrationRefused({ context, testId }: { context: AdministrationContext; testId?: string }) {
  return (
    <V2EmptyState
      icon="access"
      title="This could not be opened"
      copy={administrationRefusal({ workspaceRole: context.workspaceRole, ownerName: context.ownerName })}
      testId={testId}
    />
  );
}

/**
 * A write's refusal. One that explains the reader's standing (the Workspace
 * Role, a Read-only Workspace) stays on the tab; any other is a toast.
 */
export function useAdministrationWrites(context: AdministrationContext) {
  const [refusal, setRefusal] = useState<string | null>(null);

  function refuse(message: string) {
    if (!isStandingRefusal(message)) return notify.error(message);
    setRefusal(
      administrationWriteRefusal({
        kind: "error",
        workspaceName: context.workspaceName,
        workspaceRole: context.workspaceRole,
        ownerName: context.ownerName,
        errorMessage: message,
      }),
    );
  }

  function guard(): boolean {
    if (context.condition !== "Read-only") return true;
    setRefusal(
      administrationWriteRefusal({
        kind: "workspace-condition",
        workspaceName: context.workspaceName,
        condition: "Read-only",
      }),
    );
    return false;
  }

  return { refusal, clear: () => setRefusal(null), refuse, guard };
}

/** The refusal line a tab shows over its cards. */
export function WriteRefusal({ refusal }: { refusal: string | null }): ReactNode {
  return refusal ? (
    <p className="df-refusal" role="alert">
      {refusal}
    </p>
  ) : null;
}

/**
 * The shadcn/Radix checkbox wearing v2 tokens (#212). Radix renders a button,
 * which a <label> cannot implicitly label, so every row pairs an explicit id.
 */
export function CheckRow({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="df-checkbox-row" data-disabled={disabled ? "true" : "false"}>
      <Checkbox
        id={id}
        className="df-checkbox"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}
