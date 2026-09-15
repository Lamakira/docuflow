/**
 * The Tasks table on Projects & Tasks (#214).
 *
 * TanStack Table v9 holds the model — columns, sorting — and the shadcn Table
 * primitives hold the markup, wearing v2 register tokens. The v9 API is not
 * v8's: features are opted into with `tableFeatures`, `useTable` replaces
 * `useReactTable`, the core row model is automatic, and cells render through
 * `table.FlexRender`.
 *
 * Archived Tasks sit in the same table rather than a section of their own: the
 * Task Status column already says ARCHIVED, and one table is what a User can
 * sort across.
 */

import { useMemo } from "react";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TaskManagerRow } from "./tasks";
import { V2RowMenu } from "./V2RowMenu";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

const helper = createColumnHelper<typeof features, TaskManagerRow>();

export type V2TaskTableProps = {
  rows: TaskManagerRow[];
  canWrite: boolean;
  emptyCopy: string;
  editingId: string | null;
  editingName: string;
  confirmDeleteId: string | null;
  setEditingName: (name: string) => void;
  onStartRename: (row: TaskManagerRow) => void;
  onRename: (id: string) => void;
  onCancelRename: () => void;
  onSetStatus: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onCancelDelete: () => void;
};

export function V2TaskTable(props: V2TaskTableProps) {
  const {
    rows,
    canWrite,
    emptyCopy,
    editingId,
    editingName,
    confirmDeleteId,
    setEditingName,
    onStartRename,
    onRename,
    onCancelRename,
    onSetStatus,
    onDelete,
    onCancelDelete,
  } = props;

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("name", {
          header: "TASK",
          sortFn: "text",
          cell: ({ row }) =>
            editingId === row.original.id ? (
              <input
                className="df-task-rename"
                value={editingName}
                aria-label="Task name"
                autoFocus
                onChange={(event) => setEditingName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onRename(row.original.id);
                  if (event.key === "Escape") onCancelRename();
                }}
              />
            ) : (
              <span className="df-row-title">{row.original.name}</span>
            ),
        }),
        helper.accessor("statusValue", {
          header: "STATUS",
          sortFn: "text",
          cell: ({ row }) => <span className="df-status-word">{row.original.status}</span>,
        }),
        helper.display({
          id: "actions",
          header: "",
          cell: ({ row }) => (
            <TaskActions
              row={row.original}
              canWrite={canWrite}
              editing={editingId === row.original.id}
              confirming={confirmDeleteId === row.original.id}
              onStartRename={onStartRename}
              onRename={onRename}
              onCancelRename={onCancelRename}
              onSetStatus={onSetStatus}
              onDelete={onDelete}
              onCancelDelete={onCancelDelete}
            />
          ),
        }),
      ]),
    [
      canWrite,
      confirmDeleteId,
      editingId,
      editingName,
      onCancelDelete,
      onCancelRename,
      onDelete,
      onRename,
      onSetStatus,
      onStartRename,
      setEditingName,
    ],
  );

  const table = useTable({ features, columns, data: rows });

  if (rows.length === 0) {
    return <p className="df-empty">{emptyCopy}</p>;
  }

  return (
    <Table className="df-table" data-testid="v2-time-task-table">
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="df-table-head-row">
            {group.headers.map((header) => {
              const sortable = header.column.getCanSort();
              const direction = header.column.getIsSorted();
              return (
                <TableHead key={header.id} className="df-table-head" data-column={header.column.id}>
                  {header.isPlaceholder ? null : sortable ? (
                    <button
                      type="button"
                      className="df-table-sort"
                      aria-label={`Sort by ${header.column.id}`}
                      data-sorted={direction || "none"}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <table.FlexRender header={header} />
                      <span aria-hidden="true">
                        {direction === "asc" ? "↑" : direction === "desc" ? "↓" : ""}
                      </span>
                    </button>
                  ) : (
                    <table.FlexRender header={header} />
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            className="df-table-row"
            data-archived={row.original.archived ? "true" : "false"}
            data-testid={`v2-time-task-${row.original.id}`}
          >
            {row.getAllCells().map((cell) => (
              <TableCell key={cell.id} className="df-table-cell" data-column={cell.column.id}>
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type TaskActionsProps = {
  row: TaskManagerRow;
  canWrite: boolean;
  editing: boolean;
  confirming: boolean;
  onStartRename: (row: TaskManagerRow) => void;
  onRename: (id: string) => void;
  onCancelRename: () => void;
  onSetStatus: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onCancelDelete: () => void;
};

function TaskActions({
  row,
  canWrite,
  editing,
  confirming,
  onStartRename,
  onRename,
  onCancelRename,
  onSetStatus,
  onDelete,
  onCancelDelete,
}: TaskActionsProps) {
  if (!canWrite) return null;

  if (editing) {
    return (
      <span className="df-row-actions">
        <button type="button" className="df-ink-btn" onClick={() => onRename(row.id)}>
          Save
        </button>
        <button type="button" className="df-ghost-btn" onClick={onCancelRename}>
          Cancel
        </button>
      </span>
    );
  }

  // Deleting asks once on the row, so the menu cannot destroy in one click.
  if (confirming) {
    return (
      <span className="df-row-actions">
        <button type="button" className="df-ghost-btn" data-danger="true" onClick={() => onDelete(row.id)}>
          Confirm delete
        </button>
        <button type="button" className="df-ghost-btn" onClick={onCancelDelete}>
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="df-row-actions">
      <V2RowMenu
        ariaLabel={`Actions on ${row.name}`}
        testId={`v2-time-task-menu-${row.id}`}
        items={
          row.archived
            ? [
                { label: "Restore", onSelect: () => onSetStatus(row.id, "open") },
                { label: "Delete", danger: true, onSelect: () => onDelete(row.id) },
              ]
            : [
                { label: "Rename", onSelect: () => onStartRename(row) },
                { label: "Archive", onSelect: () => onSetStatus(row.id, "archived") },
                { label: "Delete", danger: true, onSelect: () => onDelete(row.id) },
              ]
        }
      />
    </span>
  );
}
