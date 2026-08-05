/**
 * Context-panel primitives — the middle column.
 *
 * Every screen's panel is the same three parts: a header, a body that never
 * scrolls, and an optional pager footer. Rows are one shape (name + meta on the
 * left, a value on the right) so the four screens stay recognisably one panel.
 */

import { ChevronLeftIcon, ChevronRightIcon } from '../icons';

export function Panel({ children }: { children: React.ReactNode }) {
  return <aside className="v2-panel">{children}</aside>;
}

export function PanelHead({ title, subtitle, children }: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="v2-panel__head">
      <h2 className="v2-panel__title">{title}</h2>
      {subtitle && <p className="v2-panel__subtitle">{subtitle}</p>}
      {children}
    </header>
  );
}

export function PanelBody({ children }: { children: React.ReactNode }) {
  return <div className="v2-panel__body">{children}</div>;
}

export function PanelRow({ name, meta, icon, end, endAccent, selected, onClick, title }: {
  name: string;
  meta?: string;
  /** Leading glyph. Settings uses one per section; the lists do not — a row of
   *  identical project icons is decoration that costs a column of width. */
  icon?: React.ReactNode;
  end?: React.ReactNode;
  endAccent?: boolean;
  selected?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      className={`v2-row${selected ? ' v2-row--selected' : ''}`}
      onClick={onClick}
      title={title ?? name}
      type="button"
    >
      {icon && <span className="v2-row__icon" aria-hidden="true">{icon}</span>}
      <span className="v2-row__text">
        <span className="v2-row__name">{name}</span>
        {meta && <span className="v2-row__meta">{meta}</span>}
      </span>
      {end != null && <span className={`v2-row__end${endAccent ? ' v2-row__end--accent' : ''}`}>{end}</span>}
    </button>
  );
}

/** Footer pager. Rendered only when there is more than one page. */
export function Pager({ page, pages, onChange }: {
  page: number;
  pages: number;
  onChange: (next: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <footer className="v2-panel__foot">
      <span className="v2-pager__label">Page {page + 1} / {pages}</span>
      <span className="v2-pager__arrows">
        <button
          className="v2-pager__btn"
          onClick={() => onChange(page - 1)}
          disabled={page === 0}
          aria-label="Previous page"
        >
          <ChevronLeftIcon size={12} />
        </button>
        <button
          className="v2-pager__btn"
          onClick={() => onChange(page + 1)}
          disabled={page >= pages - 1}
          aria-label="Next page"
        >
          <ChevronRightIcon size={12} />
        </button>
      </span>
    </footer>
  );
}
