/**
 * The designed empty state (#277): a record list with nothing in it yet says
 * what it holds and offers the action that adds the first one, instead of a
 * single bare line. One component, so every tab empties the same way.
 */

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { EmptyKind, EmptyModel } from "./emptyState";
import { EmptyStateIcon, type EmptyStateIconId } from "./icons";

export type V2EmptyStateProps = {
  icon: EmptyStateIconId;
  title: string;
  copy: string;
  /** The one primary action, already a shadcn Button. */
  action?: ReactNode;
  testId?: string;
};

export function V2EmptyState({ icon, title, copy, action, testId }: V2EmptyStateProps) {
  return (
    <div className="df-empty-panel" data-testid={testId}>
      <span className="df-empty-panel-icon">
        <EmptyStateIcon id={icon} />
      </span>
      <p className="df-empty-panel-title">{title}</p>
      <p className="df-empty-panel-copy">{copy}</p>
      {action ? <div className="df-empty-panel-action">{action}</div> : null}
    </div>
  );
}

/**
 * Filters hide every row (#325): one short line and the way out, compact
 * enough to sit where the rows would.
 */
export function V2FilteredEmpty({ copy, onClear, testId }: { copy: string; onClear: () => void; testId?: string }) {
  return (
    <div className="df-empty-state" data-testid={testId}>
      <p className="df-empty">{copy}</p>
      <Button variant="outline" type="button" className="df-btn" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}

/**
 * A dashboard section with no data (#325): one compact line inside the card,
 * the same everywhere. Record lists never use it; they show V2EmptyState.
 */
export function V2CompactEmpty({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="df-empty" data-testid={testId}>
      {children}
    </p>
  );
}

/**
 * The empty list of a record screen, whichever of the three cases it is in:
 * the designed state, the filtered line with Clear filters, or the designed
 * Range state whose action widens the Range. `action` is the screen's primary
 * action, already gated to the readers who may take it; the designed state
 * shows no button without one. `onWiden` is omitted when no Range is wider.
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
  /** A test id per case; the designed state is the one most screens pin. */
  testIds?: Partial<Record<EmptyKind, string>>;
}) {
  if (model.kind === "filtered") return <V2FilteredEmpty copy={model.copy} onClear={onClear} testId={testIds?.filtered} />;
  if (model.kind === "range") {
    const widen =
      model.widenLabel && onWiden ? (
        <Button variant="outline" type="button" className="df-btn" onClick={onWiden}>
          {model.widenLabel}
        </Button>
      ) : undefined;
    return <V2EmptyState icon={icon} title={model.title} copy={model.copy} action={widen} testId={testIds?.range} />;
  }
  return <V2EmptyState icon={icon} title={model.title} copy={model.copy} action={action} testId={testIds?.none} />;
}
