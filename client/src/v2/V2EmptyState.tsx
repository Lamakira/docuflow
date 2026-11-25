/**
 * Every empty or failed region of the app, and nothing else draws one:
 *
 * - `V2RecordEmpty`: the list of a record screen, from its `EmptyModel`;
 * - `V2EmptyState`: any other region that holds nothing, or not the thing asked for;
 * - `V2LoadFailed`: a region that could not be read, with Try again;
 * - `V2CompactEmpty`: a section inside a card that has its own title;
 * - `V2EmptyLine`: inside a field, a settings row, a dialog or a sheet.
 *
 * The classes below belong to this file. `web-app-v2-empty-states.test.ts` fails
 * on an empty or failed line written anywhere else.
 */

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { EmptyKind, EmptyModel } from "./emptyState";
import { EmptyStateIcon, type EmptyStateIconId } from "./icons";

export type V2EmptyStateProps = {
  /** One of the shared icons, or a mark of the screen's own (a File's family). */
  icon: EmptyStateIconId | { mark: ReactNode };
  title: string;
  copy?: string;
  /** The one primary action, already a shadcn Button. */
  action?: ReactNode;
  testId?: string;
  /** `status` when the reader's own filter emptied the region, `alert` when it failed. */
  role?: "status" | "alert";
};

export function V2EmptyState({ icon, title, copy, action, testId, role }: V2EmptyStateProps) {
  return (
    <div className="df-empty-panel" data-testid={testId} role={role}>
      <span className="df-empty-panel-icon">
        {typeof icon === "string" ? <EmptyStateIcon id={icon} /> : icon.mark}
      </span>
      <p className="df-empty-panel-title">{title}</p>
      {copy ? <p className="df-empty-panel-copy">{copy}</p> : null}
      {action ? <div className="df-empty-panel-action">{action}</div> : null}
    </div>
  );
}

/**
 * A region that could not be read: its own icon, so it never passes for an empty
 * one. `action` is a second way out, such as back to the list.
 */
export function V2LoadFailed({
  title,
  copy = "Something went wrong while loading it. Try again.",
  onRetry,
  action,
  testId,
}: Omit<V2EmptyStateProps, "icon" | "role"> & { onRetry: () => void }) {
  return (
    <V2EmptyState
      icon="failed"
      role="alert"
      title={title}
      copy={copy}
      testId={testId}
      action={
        <>
          <Button variant="default" type="button" className="df-btn" onClick={onRetry}>
            Try again
          </Button>
          {action}
        </>
      }
    />
  );
}

/** A section inside a card that names it already: the line alone, centred. */
export function V2CompactEmpty({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="df-empty-panel" data-size="card" data-testid={testId}>
      <p className="df-empty-panel-copy">{children}</p>
    </div>
  );
}

/** One line where a panel would not fit: a field, a settings row, a dialog, a sheet. */
export function V2EmptyLine({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="df-empty-line" data-testid={testId}>
      {children}
    </p>
  );
}

/**
 * The empty list of a record screen, whichever of the three cases it is in.
 * `action` is the screen's primary action, already gated to the readers who may
 * take it; the first-use state shows no button without one. `onWiden` is omitted
 * when no Range is wider.
 */
export function V2RecordEmpty({
  model,
  icon,
  action,
  onClear,
  onWiden,
  testIds,
}: {
  model: EmptyModel;
  icon: EmptyStateIconId;
  action?: ReactNode;
  onClear: () => void;
  onWiden?: () => void;
  /** A test id per case; the first-use state is the one most screens pin. */
  testIds?: Partial<Record<EmptyKind, string>>;
}) {
  const way =
    model.kind === "filtered"
      ? { label: model.clearLabel, onClick: onClear }
      : model.kind === "range"
        ? { label: model.widenLabel, onClick: onWiden }
        : null;
  return (
    <V2EmptyState
      icon={model.icon ?? icon}
      role={model.kind === "filtered" ? "status" : undefined}
      title={model.title}
      copy={model.copy}
      testId={testIds?.[model.kind]}
      action={
        way === null ? (
          action
        ) : way.label && way.onClick ? (
          <Button variant="outline" type="button" className="df-btn" onClick={way.onClick}>
            {way.label}
          </Button>
        ) : undefined
      }
    />
  );
}
