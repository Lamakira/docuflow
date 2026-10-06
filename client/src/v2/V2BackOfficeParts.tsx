import type { CSSProperties, ReactNode } from "react";
import { Link } from "wouter";
import { SkeletonRows } from "./V2Skeleton";
import { queryRefusalCopy, statusTone, type BackOfficeStatus } from "./backOffice";

/** The pill every back-office state wears. */
export function StatusPill({ status, label }: { status: BackOfficeStatus | null; label: string }) {
  return (
    <span className="df-status" data-status={label} data-tone={statusTone(status)}>
      {label}
    </span>
  );
}

/** The line a failed query shows in place of its empty copy. */
export function QueryRefusal({ error, flush }: { error: unknown; flush?: boolean }) {
  return (
    <p className={flush ? "df-refusal df-flush" : "df-refusal"} role="alert" data-testid="v2-query-refusal">
      {queryRefusalCopy(error)}
    </p>
  );
}

export type RegisterRow = {
  key: string;
  /** A row that opens a page is a link; the rest are plain rows. */
  href?: string;
  testId?: string;
  cells: ReactNode[];
};

/**
 * The back office's one register: a head, rows on a grid, an empty line and a
 * footer. `widths` is the grid, e.g. "2fr 1fr 1fr".
 */
export function BackOfficeRegister({
  columns,
  widths,
  rows,
  loading,
  error,
  emptyCopy,
  foot,
  testId,
}: {
  columns: readonly string[];
  widths: string;
  rows: RegisterRow[];
  loading?: boolean;
  /** A failed query: the refusal replaces the empty copy and the count. */
  error?: unknown;
  emptyCopy: string;
  foot?: string;
  testId?: string;
}) {
  const style = { "--df-bo-cols": widths } as CSSProperties;
  return (
    <section className="df-card df-backoffice-register" style={style} data-testid={testId}>
      <div className="df-register-head">
        {columns.map((column) => (
          <span key={column}>{column}</span>
        ))}
      </div>
      {loading ? (
        <SkeletonRows columns={columns.length} rows={5} />
      ) : error ? (
        <QueryRefusal error={error} />
      ) : rows.length === 0 ? (
        <p className="df-empty">{emptyCopy}</p>
      ) : (
        rows.map((row) => {
          const cells = row.cells.map((cell, index) => <span key={index} style={{ minWidth: 0 }}>{cell}</span>);
          return row.href ? (
            <Link key={row.key} href={row.href} className="df-register-row" data-testid={row.testId}>
              {cells}
            </Link>
          ) : (
            <div key={row.key} className="df-register-row" data-testid={row.testId}>
              {cells}
            </div>
          );
        })
      )}
      {foot && !error ? (
        <div className="df-library-foot">
          <span>{foot}</span>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The console's facts and counts as one strip inside its card: hairlines
 * between them rather than grey boxes. `stat` sets the value at headline size.
 */
export function FigureGrid({
  figures,
  testId,
  size = "fact",
}: {
  figures: Array<{ label: string; value: string }>;
  testId?: string;
  size?: "fact" | "stat";
}) {
  return (
    <div className="df-figure-band df-stat-strip" data-size={size} data-testid={testId}>
      {figures.map((figure) => (
        <div key={figure.label} className="df-analytics-figure">
          <span className="df-analytics-figure-label">{figure.label}</span>
          <span className="df-analytics-figure-value df-backoffice-figure">{figure.value}</span>
        </div>
      ))}
    </div>
  );
}

export function StripeLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return <span className="df-mono df-meta">—</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="df-cta">
      {children}
    </a>
  );
}
