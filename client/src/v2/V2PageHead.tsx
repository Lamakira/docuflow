import type { ReactNode } from "react";

/**
 * A page's head, and nothing else draws one: the title with its chip beside it,
 * the line about the page right under it, and the actions on the title's line.
 */
export function V2PageHead({
  title,
  chip,
  subhead,
  above,
  actions,
  testId,
}: {
  title: ReactNode;
  /** A count or a date about the whole page, e.g. `3 Members`. */
  chip?: ReactNode;
  /** What the title does not say, or the bar that holds its place while it loads. */
  subhead?: ReactNode;
  /** A way back or a kicker over the title. */
  above?: ReactNode;
  /** The page's actions, already Buttons. */
  actions?: ReactNode;
  testId?: string;
}) {
  return (
    <header className="df-page-head">
      <div className="df-page-head-text">
        {above}
        <div className="df-page-head-title">
          <h1 className="df-title" data-testid={testId}>
            {title}
          </h1>
          {chip ? <span className="df-head-chip">{chip}</span> : null}
        </div>
        {subhead ? <div className="df-subhead">{subhead}</div> : null}
      </div>
      {actions ? <div className="df-page-head-actions">{actions}</div> : null}
    </header>
  );
}
