/**
 * The designed empty state (#277): a record list with nothing in it yet says
 * what it holds and offers the action that adds the first one, instead of a
 * single bare line. One component, so every tab empties the same way.
 */

import type { ReactNode } from "react";
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
