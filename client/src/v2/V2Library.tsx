import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { FileText, Folder } from "lucide-react";
import {
  groupLibraryRows,
  unfilteredFootLabel,
  type LibraryGroup,
  type LibraryModel,
  type LibraryRow,
} from "./library";
import { V2RecordEmpty } from "./V2EmptyState";

/** The indent stops at four Folders deep; the path still names every one. */
const MAX_INDENT = 4;

export function useFolderExpandMotion(filterQuery: string) {
  const filtering = filterQuery.trim().length > 0;
  const [holdInstant, setHoldInstant] = useState(false);
  useEffect(() => {
    if (filtering) setHoldInstant(true);
  }, [filtering]);
  return {
    instantExpand: filtering || holdInstant,
    onUserExpand() {
      setHoldInstant(false);
    },
  };
}


function LibraryRowBody({ row, plainAccess }: { row: LibraryRow; plainAccess: boolean }) {
  return (
    <>
      <span className="df-cluster-start">
        {row.kind === "folder" ? (
          <Folder width={15} height={15} strokeWidth={1.4} style={{ color: "var(--df-case-ink)" }} className="df-row-icon" />
        ) : (
          <FileText width={15} height={15} strokeWidth={1.4} style={{ color: "var(--df-archive-slate)" }} className="df-row-icon" />
        )}
        <span style={{ minWidth: 0 }}>
          <div
            className="df-row-title"
            style={{
              fontWeight: row.kind === "folder" ? 600 : 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.name}
          </div>
          <div className="df-mono df-meta">{row.path}</div>
        </span>
      </span>
      <span className="df-mono df-meta">{row.type}</span>
      {plainAccess ? (
        <span className="df-library-text">{row.access}</span>
      ) : (
        <span>
          <span className="df-status">{row.access}</span>
        </span>
      )}
      <span style={{ fontWeight: 500, fontSize: 13.5 }}>{row.editor}</span>
      <span className="df-mono" style={{ fontSize: 12, textAlign: "right" }}>
        {row.updated}
      </span>
    </>
  );
}

function DocumentRow({ row, plainAccess }: { row: LibraryRow; plainAccess: boolean }) {
  return (
    <Link
      href={row.href ?? "/documents"}
      className="df-library-row"
      data-child={row.child ? "true" : "false"}
      data-depth={Math.min(row.depth, MAX_INDENT)}
      data-testid={`v2-document-row-${row.id}`}
    >
      <LibraryRowBody row={row} plainAccess={plainAccess} />
    </Link>
  );
}

function LibraryGroupRows({
  group,
  instantExpand,
  onFolderClick,
  plainAccess,
  folderActions,
}: {
  group: LibraryGroup;
  instantExpand: boolean;
  onFolderClick: (folderId: string) => void;
  plainAccess: boolean;
  folderActions?: (folder: LibraryRow) => ReactNode;
}) {
  if (group.kind === "item") return <DocumentRow row={group.row} plainAccess={plainAccess} />;
  const open = group.folder.expanded === true;
  return (
    <div>
      <button
        type="button"
        className="df-library-row"
        data-expanded={open ? "true" : "false"}
        data-selected={group.folder.selected ? "true" : "false"}
        data-depth={Math.min(group.folder.depth, MAX_INDENT)}
        data-testid={`v2-folder-row-${group.folder.id}`}
        aria-expanded={open}
        onClick={() => onFolderClick(group.folder.id)}
      >
        <LibraryRowBody row={group.folder} plainAccess={plainAccess} />
      </button>
      <div
        className="df-accordion"
        data-open={open ? "true" : "false"}
        data-motion={instantExpand ? "instant" : "standard"}
      >
        <div className="df-accordion-inner">
          {open ? folderActions?.(group.folder) : null}
          {group.children.map((child) => (
            <LibraryGroupRows
              key={child.kind === "folder" ? child.folder.id : child.row.id}
              group={child}
              instantExpand={instantExpand}
              onFolderClick={onFolderClick}
              plainAccess={plainAccess}
              folderActions={folderActions}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function V2LibraryRegister({
  library,
  testId,
  instantExpand,
  onFolderClick,
  onClear,
  createActions,
  footer,
  accessHeading = "Access",
  plainAccess = false,
  folderActions,
}: {
  library: LibraryModel;
  testId: string;
  instantExpand: boolean;
  onFolderClick: (folderId: string) => void;
  /** Clears the search and the filters that emptied it. */
  onClear: () => void;
  /** Offered when the register has nothing in it yet: the actions that add the first item. */
  createActions?: ReactNode;
  /** Replaces the item count, such as a pager. */
  footer?: ReactNode;
  /** The third column's heading, where a register says something other than who may open a row. */
  accessHeading?: string;
  /** Draws the third column as plain text instead of a chip. */
  plainAccess?: boolean;
  /** Drawn at the top of an open Folder's rows, such as the actions on it. */
  folderActions?: (folder: LibraryRow) => ReactNode;
}) {
  const groups = groupLibraryRows(library.rows);

  return (
    <section className="df-card" data-testid={testId}>
      {library.empty && !library.refusal && library.emptyState ? null : (
        <div className="df-library-head">
          <span>Name / path</span>
          <span>Type</span>
          <span>{accessHeading}</span>
          <span>Added by</span>
          <span style={{ textAlign: "right" }}>Updated</span>
        </div>
      )}
      {library.refusal ? (
        <p className="df-refusal">{library.refusal}</p>
      ) : library.empty && library.emptyState ? (
        <V2RecordEmpty
          model={library.emptyState}
          icon="documents"
          action={createActions}
          onClear={onClear}
          testIds={{ none: `${testId}-empty`, filtered: `${testId}-empty` }}
        />
      ) : (
        groups.map((group) => (
          <LibraryGroupRows
            key={group.kind === "folder" ? group.folder.id : group.row.id}
            group={group}
            instantExpand={instantExpand}
            onFolderClick={onFolderClick}
            plainAccess={plainAccess}
            folderActions={folderActions}
          />
        ))
      )}
      {footer ?? (
        <div className="df-library-foot">
          <span>{library.footLabel ?? unfilteredFootLabel(library.itemCount, library.folderCount, library.parentNoun)}</span>
        </div>
      )}
    </section>
  );
}
