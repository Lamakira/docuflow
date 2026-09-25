import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { FileText, Folder } from "lucide-react";
import { groupLibraryRows, type LibraryGroup, type LibraryModel, type LibraryRow } from "./library";

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


function LibraryRowBody({ row }: { row: LibraryRow }) {
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
      <span>
        <span className="df-status">{row.access}</span>
      </span>
      <span style={{ fontWeight: 500, fontSize: 13.5 }}>{row.editor}</span>
      <span className="df-mono" style={{ fontSize: 12, textAlign: "right" }}>
        {row.updated}
      </span>
    </>
  );
}

function DocumentRow({ row }: { row: LibraryRow }) {
  return (
    <Link
      href={row.href ?? "/documents"}
      className="df-library-row"
      data-child={row.child ? "true" : "false"}
      data-depth={Math.min(row.depth, MAX_INDENT)}
      data-testid={`v2-document-row-${row.id}`}
    >
      <LibraryRowBody row={row} />
    </Link>
  );
}

function LibraryGroupRows({
  group,
  instantExpand,
  onFolderClick,
}: {
  group: LibraryGroup;
  instantExpand: boolean;
  onFolderClick: (folderId: string) => void;
}) {
  if (group.kind === "item") return <DocumentRow row={group.row} />;
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
        <LibraryRowBody row={group.folder} />
      </button>
      <div
        className="df-accordion"
        data-open={open ? "true" : "false"}
        data-motion={instantExpand ? "instant" : "standard"}
      >
        <div className="df-accordion-inner">
          {group.children.map((child) => (
            <LibraryGroupRows
              key={child.kind === "folder" ? child.folder.id : child.row.id}
              group={child}
              instantExpand={instantExpand}
              onFolderClick={onFolderClick}
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
  emptyAction,
  footer,
}: {
  library: LibraryModel;
  testId: string;
  instantExpand: boolean;
  onFolderClick: (folderId: string) => void;
  /** Offered under the empty copy, such as clearing the filters that emptied it. */
  emptyAction?: ReactNode;
  /** Replaces the item count, such as a pager. */
  footer?: ReactNode;
}) {
  const groups = groupLibraryRows(library.rows);

  return (
    <section className="df-card" data-testid={testId}>
      <div className="df-library-head">
        <span>NAME / PATH</span>
        <span>TYPE</span>
        <span>ACCESS</span>
        <span>LAST EDITOR</span>
        <span style={{ textAlign: "right" }}>UPDATED</span>
      </div>
      {library.refusal ? (
        <p className="df-refusal">{library.refusal}</p>
      ) : library.empty ? (
        emptyAction ? (
          <div className="df-empty-state">
            <p className="df-empty">{library.emptyCopy}</p>
            {emptyAction}
          </div>
        ) : (
          <p className="df-empty">{library.emptyCopy}</p>
        )
      ) : (
        groups.map((group) => (
          <LibraryGroupRows
            key={group.kind === "folder" ? group.folder.id : group.row.id}
            group={group}
            instantExpand={instantExpand}
            onFolderClick={onFolderClick}
          />
        ))
      )}
      {footer ?? (
        <div className="df-library-foot">
          <span>
            {library.itemCount} {library.itemCount === 1 ? "ITEM" : "ITEMS"} · {library.folderCount}{" "}
            {library.folderCount === 1 ? library.parentNoun.singular : library.parentNoun.plural}
          </span>
        </div>
      )}
    </section>
  );
}
