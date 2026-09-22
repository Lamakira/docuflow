import { useEffect, useState } from "react";
import { Link } from "wouter";
import { FileText, Folder } from "lucide-react";
import type { LibraryModel, LibraryRow } from "./library";

type LibraryGroup =
  | { kind: "folder"; folder: LibraryRow; children: LibraryRow[] }
  | { kind: "item"; row: LibraryRow };

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

export function groupLibraryRows(rows: LibraryRow[]): LibraryGroup[] {
  const groups: LibraryGroup[] = [];
  for (const row of rows) {
    if (row.kind === "folder") {
      groups.push({ kind: "folder", folder: row, children: [] });
      continue;
    }
    const last = groups[groups.length - 1];
    if (row.child && last?.kind === "folder") {
      last.children.push(row);
    } else {
      groups.push({ kind: "item", row });
    }
  }
  return groups;
}

function LibraryRowBody({ row }: { row: LibraryRow }) {
  return (
    <>
      <span className="df-cluster-start">
        {row.kind === "folder" ? (
          <Folder width={15} height={15} strokeWidth={1.4} color="#0F1524" className="df-row-icon" />
        ) : (
          <FileText width={15} height={15} strokeWidth={1.4} color="#59657A" className="df-row-icon" />
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
      data-testid={`v2-document-row-${row.id}`}
    >
      <LibraryRowBody row={row} />
    </Link>
  );
}

export function V2LibraryRegister({
  library,
  testId,
  instantExpand,
  onFolderClick,
}: {
  library: LibraryModel;
  testId: string;
  instantExpand: boolean;
  onFolderClick: (folderId: string) => void;
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
        <p className="df-empty">{library.emptyCopy}</p>
      ) : (
        groups.map((group) => {
          if (group.kind === "item") {
            return <DocumentRow key={group.row.id} row={group.row} />;
          }
          const open = group.folder.expanded === true;
          return (
            <div key={group.folder.id}>
              <button
                type="button"
                className="df-library-row"
                data-expanded={open ? "true" : "false"}
                data-selected={group.folder.selected ? "true" : "false"}
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
                  {group.children.map((row) => (
                    <DocumentRow key={row.id} row={row} />
                  ))}
                </div>
              </div>
            </div>
          );
        })
      )}
      <div className="df-library-foot">
        <span>
          {library.itemCount} {library.itemCount === 1 ? "ITEM" : "ITEMS"} · {library.folderCount}{" "}
          {library.folderCount === 1 ? library.parentNoun.singular : library.parentNoun.plural}
        </span>
      </div>
    </section>
  );
}
