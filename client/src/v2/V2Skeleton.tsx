/**
 * The wait, drawn with the real geometry (Administration first, then every
 * destination). A screen's titles and column heads are known before any fetch;
 * only the values are not. So the skeleton shows the real frame with the real
 * words, and leaves only the values as breathing bars — when the data lands,
 * nothing moves. That is the spatial-consistency rule the rest of the v2 motion
 * substrate follows. An empty card of a guessed height was the opposite.
 */

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export const LOADING_SUBHEAD = "Loading this Workspace…";

export function SkeletonBar({ width, role }: { width?: "short" | "medium" | "long"; role?: "value" | "title" }) {
  return <Skeleton className="df-skeleton" data-width={width} data-role={role} />;
}

export function SkeletonBand({ tiles }: { tiles: number }) {
  return (
    <div className="df-figure-band">
      {Array.from({ length: tiles }, (_, index) => (
        <div key={index} className="df-analytics-figure">
          <SkeletonBar width="short" />
          <SkeletonBar role="value" />
        </div>
      ))}
    </div>
  );
}

/**
 * Rows of a register. They carry `df-register-row`, so the register's own
 * grid (`.df-people-register .df-register-row`, …) lays the bars out in the
 * columns the real rows will fill.
 */
export function SkeletonRows({
  columns,
  rows,
  dataColumns = false,
}: {
  columns: number;
  rows: number;
  /** Registers whose grid is chosen by `data-columns` (Administration's analytics). */
  dataColumns?: boolean;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="df-register-row"
          data-columns={dataColumns ? columns : undefined}
          data-skeleton="true"
        >
          <SkeletonBar width="long" />
          {Array.from({ length: columns - 1 }, (_, cell) => (
            <SkeletonBar key={cell} width="short" />
          ))}
        </div>
      ))}
    </>
  );
}

/** A card whose title is known and whose body is not. */
export function SkeletonSection({
  title,
  className = "",
  tiles,
  columns,
  rows,
  lines,
  dataColumns = false,
}: {
  title: string;
  className?: string;
  tiles?: number;
  columns?: number;
  rows?: number;
  /** Plain lines, for a card that holds prose or a form rather than a register. */
  lines?: number;
  dataColumns?: boolean;
}) {
  return (
    <section className={`df-card ${className}`.trim()}>
      <div className="df-card-head">
        <div className="df-card-head-text">
          <h2 className="df-card-title">{title}</h2>
          <div className="df-card-sub" data-skeleton="true">
            <SkeletonBar width="long" />
          </div>
        </div>
      </div>
      {tiles ? <SkeletonBand tiles={tiles} /> : null}
      {columns && rows ? <SkeletonRows columns={columns} rows={rows} dataColumns={dataColumns} /> : null}
      {lines ? <SkeletonLines count={lines} /> : null}
    </section>
  );
}

export function SkeletonLines({ count }: { count: number }) {
  return (
    <div className="df-skeleton-lines">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonBar key={index} width={index % 3 === 2 ? "medium" : "long"} />
      ))}
    </div>
  );
}

/**
 * A register with its real column heads. `className` is the register's own
 * card class, which carries its grid.
 */
export function SkeletonRegister({
  className = "",
  heads,
  rows = 6,
  title,
}: {
  /** The register's own card class; empty for a register on the default grid. */
  className?: string;
  heads: string[];
  rows?: number;
  title?: string;
}) {
  return (
    <section className={`df-card ${className}`.trim()}>
      {title ? (
        <div className="df-card-head">
          <h2 className="df-card-title">{title}</h2>
        </div>
      ) : null}
      <div className="df-register-head df-desktop-only">
        {heads.map((head, index) => (
          <span key={head} style={index === heads.length - 1 && heads.length > 2 ? { textAlign: "right" } : undefined}>
            {head}
          </span>
        ))}
      </div>
      <SkeletonRows columns={heads.length} rows={rows} />
    </section>
  );
}

/** Workspace Documents and Project Documentation share one register. */
export function SkeletonLibrary({ rows = 6 }: { rows?: number }) {
  return (
    <section className="df-card">
      <div className="df-library-head">
        <span>NAME / PATH</span>
        <span>TYPE</span>
        <span>ACCESS</span>
        <span>LAST EDITOR</span>
        <span style={{ textAlign: "right" }}>UPDATED</span>
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="df-library-row" data-skeleton="true">
          <SkeletonBar width="long" />
          <SkeletonBar width="short" />
          <SkeletonBar width="short" />
          <SkeletonBar width="medium" />
          <SkeletonBar width="short" />
        </div>
      ))}
    </section>
  );
}

/**
 * A board's columns, each holding card-shaped blanks. A column whose name is
 * not known yet (an Opportunity stage comes from the CRM field options) shows a
 * bar where the name will be.
 */
export function SkeletonBoard({ columns, cards = 2 }: { columns: Array<string | null>; cards?: number }) {
  return (
    <div className="df-opportunity-pipeline" data-stacked="false">
      {columns.map((label, index) => (
        <section key={label ?? `column-${index}`} className="df-card df-opportunity-column">
          <div className="df-card-head">
            {label ? <h2 className="df-card-title">{label}</h2> : <SkeletonBar width="medium" />}
          </div>
          <div className="df-opportunity-drop">
            {Array.from({ length: cards }, (_, card) => (
              <div key={card} className="df-opportunity-card" data-skeleton="true">
                <SkeletonBar width="long" />
                <SkeletonBar width="short" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The identity header of a record (a Project Dossier, a Client, an Opportunity). */
export function SkeletonRecordHead() {
  return (
    <header className="df-dossier-head">
      <div className="df-dossier-identity">
        <div className="df-dossier-copy df-skeleton-record">
          <SkeletonBar width="medium" />
          <SkeletonBar role="title" />
          <SkeletonBar width="long" />
        </div>
      </div>
    </header>
  );
}

/**
 * The page frame while it waits: the destination's own title, the loading
 * subhead, and a status a screen reader announces once. `frame` matches the
 * wrapper the loaded page uses, so the header does not jump on arrival:
 * `page` for most destinations, `library` for the two Document registers, and
 * `fragment` for a pane drawn inside a page that already has its frame.
 */
export function V2PageSkeleton({
  title,
  testId,
  status,
  subhead = LOADING_SUBHEAD,
  frame = "page",
  children,
}: {
  title: string;
  testId?: string;
  /** What a screen reader hears, e.g. "Loading Projects for this Workspace." */
  status: string;
  subhead?: string;
  frame?: "page" | "library" | "fragment";
  children: ReactNode;
}) {
  const body = (
    <>
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">{title}</h1>
          <p className="df-subhead">{subhead}</p>
        </div>
      </header>
      <p className="df-sr-only" role="status">
        {status}
      </p>
      {children}
    </>
  );
  if (frame === "fragment") {
    return <div aria-busy="true" className="df-skeleton-pane">{body}</div>;
  }
  if (frame === "library") {
    return (
      <div className="df-library" data-testid={testId} aria-busy="true">
        <div className="df-library-main">{body}</div>
      </div>
    );
  }
  return (
    <div className="df-page" data-testid={testId} aria-busy="true">
      {body}
    </div>
  );
}
