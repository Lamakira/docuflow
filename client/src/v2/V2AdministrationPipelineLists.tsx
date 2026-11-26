import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import type { CrmModuleWithFields } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { queryClient } from "@/lib/queryClient";
import { swatchStyle } from "./palette";
import { CheckIcon, SourceMark } from "./icons";
import { sourceIcon } from "./sourceIcons";
import {
  PIPELINE_COLOURS,
  PIPELINE_LISTS,
  PIPELINE_LISTS_INTRO,
  PIPELINE_LIST_QUERY_KEYS,
  addPipelineOption,
  adminModulesPath,
  composePipelineLists,
  isPipelineStale,
  movePipelineOption,
  recolourPipelineOption,
  removePipelineOption,
  renamePipelineOption,
  savePipelineList,
  PIPELINE_RENAME_HINT,
  PIPELINE_SAVED_MS,
  feedbackFor,
  pipelineFeedback,
  type PipelineFeedback,
  type PipelineEdit,
  type PipelineListModel,
  type PipelineSend,
} from "./pipelineLists";
import { SkeletonSection } from "./V2Skeleton";
import { V2LoadFailed } from "./V2EmptyState";
import { DestructiveConfirm } from "./V2DestructiveConfirm";
import {
  AdministrationRefused,
  WriteRefusal,
  useAdministrationRead,
  useAdministrationWrites,
  type AdministrationContext,
} from "./V2AdministrationParts";

/**
 * A write that keeps the response's status on the error, so a 409 (the list
 * changed since it was read) is told apart from any other refusal.
 */
const sendKeepingStatus: PipelineSend = async (method, path, body) => {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let message = text;
    try {
      message = JSON.parse(text).message || text;
    } catch {
      // Not JSON: the text is the message.
    }
    throw Object.assign(new Error(message), { status: res.status });
  }
  return res.headers.get("content-type")?.includes("application/json") ? res.json() : null;
};

/**
 * Pipeline and lists. Nothing is editable until the lists are read (F106): a
 * Workspace's lists are never drawn as the defaults because a read failed.
 */
export function V2AdministrationPipelineLists({ context }: { context: AdministrationContext }) {
  const read = useAdministrationRead<CrmModuleWithFields[]>(adminModulesPath(), "The lists", "lists");
  const writes = useAdministrationWrites(context);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineFeedback | null>(null);
  const pipelineSaves = useRef(0);

  const savePipeline = useMutation({
    mutationFn: ({ list, edit }: { list: PipelineListModel; edit: { options: string[] }; feedback: PipelineFeedback }) =>
      savePipelineList(list, edit, sendKeepingStatus),
    onSuccess: (_data, { feedback }) => {
      writes.clear();
      setPipelineStatus((current) =>
        current?.id === feedback.id ? pipelineFeedback(feedback.id, feedback.listId, feedback.rowId, { phase: "saved" }) : current,
      );
    },
    onError: (error: Error, { feedback }) => {
      // Someone changed the list since it was read: say so beside it; the refetch below reloads it.
      if (isPipelineStale(error)) {
        setPipelineStatus(pipelineFeedback(feedback.id, feedback.listId, null, { phase: "failed", reason: error.message }));
        return;
      }
      writes.refuse(error.message);
      setPipelineStatus((current) => (current?.id === feedback.id ? null : current));
    },
    // A failed step may still have written the module or field before it.
    onSettled: () => {
      for (const queryKey of PIPELINE_LIST_QUERY_KEYS) queryClient.invalidateQueries({ queryKey });
    },
  });

  useEffect(() => {
    if (pipelineStatus?.phase !== "saved") return;
    const shown = pipelineStatus.id;
    const timer = window.setTimeout(
      () => setPipelineStatus((current) => (current?.id === shown ? null : current)),
      PIPELINE_SAVED_MS,
    );
    return () => window.clearTimeout(timer);
  }, [pipelineStatus]);

  /**
   * Whether the edit went to the server; a refused one leaves the row as it
   * was. `rowId` is the row the feedback sits beside, or null for the list.
   */
  function onPipelineEdit(list: PipelineListModel, edit: PipelineEdit, rowId: string | null): boolean {
    if (!writes.guard()) return false;
    pipelineSaves.current += 1;
    const id = pipelineSaves.current;
    if (!edit.ok) {
      setPipelineStatus(pipelineFeedback(id, list.id, rowId, { phase: "failed", reason: edit.reason }));
      return false;
    }
    const feedback = pipelineFeedback(id, list.id, rowId, { phase: "saving" });
    setPipelineStatus(feedback);
    savePipeline.mutate({ list, edit: { options: edit.options }, feedback });
    return true;
  }

  return (
    <>
      <p className="df-policy-hint" data-testid="v2-administration-pipeline-lists">{PIPELINE_LISTS_INTRO}</p>
      <WriteRefusal refusal={writes.refusal} />
      {read.state === "loading" ? (
        PIPELINE_LISTS.map((spec) => <SkeletonSection key={spec.id} title={spec.title} className="df-policy-form" lines={4} />)
      ) : read.state === "ready" && read.data ? (
        composePipelineLists(read.data).map((list) => (
          <PipelineListCard
            key={list.id}
            list={list}
            pending={savePipeline.isPending}
            feedback={pipelineStatus?.listId === list.id ? pipelineStatus : null}
            onEdit={(edit, rowId) => onPipelineEdit(list, edit, rowId)}
          />
        ))
      ) : (
        <section className="df-card" data-testid="v2-administration-lists-unread">
          {read.state === "refused" ? (
            <AdministrationRefused context={context} />
          ) : (
            <V2LoadFailed title="The lists could not be loaded" onRetry={read.retry} testId="v2-administration-lists-failed" />
          )}
        </section>
      )}
    </>
  );
}

/**
 * One of the four lists on Pipeline and lists. Every control writes at once,
 * against the version read; there is no draft to lose.
 */
function PipelineListCard({
  list,
  pending,
  feedback,
  onEdit,
}: {
  list: PipelineListModel;
  pending: boolean;
  feedback: PipelineFeedback | null;
  onEdit: (edit: PipelineEdit, rowId: string | null) => boolean;
}) {
  const [draft, setDraft] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const listStatus = feedbackFor(feedback, list.id, null);
  return (
    <section className="df-card df-policy-form" data-testid={`v2-administration-list-${list.id}`}>
      <div className="df-card-head">
        <div className="df-card-head-text">
          <h2 className="df-card-title">{list.title}</h2>
          <p className="df-card-sub">{list.sub}</p>
        </div>
        {list.saved ? null : <span className="df-status-word">Defaults</span>}
      </div>
      <div className="df-daily-form">
        {list.unsavedNote ? <p className="df-policy-hint">{list.unsavedNote}</p> : null}
        <ol className="df-pipeline-options" data-list={list.id} aria-label={list.title}>
          {list.rows.map((row) => {
            const rowStatus = feedbackFor(feedback, list.id, row.id);
            const hintId = `v2-pipeline-hint-${list.id}-${row.id}`;
            return (
              <li key={row.id} className="df-pipeline-item" data-testid={`v2-pipeline-option-${list.id}-${row.value}`}>
                <div className="df-pipeline-option">
                  {/* A brand's colour is not the Workspace's to choose, so a Source
                      with its own mark has no picker. */}
                  {list.id === "source" && sourceIcon(row.value) ? (
                    <span className="df-pipeline-mark" data-testid={`v2-pipeline-mark-${row.value}`}>
                      <SourceMark value={row.value} size="box" />
                    </span>
                  ) : (
                    <ColourPicker
                      label={row.label}
                      color={row.color}
                      disabled={pending}
                      onChoose={(color) => onEdit(recolourPipelineOption(list, row.index, color), row.id)}
                    />
                  )}
                  {row.outcome ? (
                    <span className="df-pipeline-outcome">
                      <span className="df-status" data-swatch="" style={swatchStyle(row.color)}>{row.label}</span>
                      <span className="df-status-word">Fixed outcome</span>
                    </span>
                  ) : row.builtIn ? (
                    <span className="df-pipeline-outcome">
                      <span className="df-pipeline-builtin">{row.label}</span>
                      <span className="df-status-word">Built in</span>
                    </span>
                  ) : (
                    <Input
                      // A refused save remounts the field, so it reads the saved name again;
                      // so does a list read again after a 409.
                      key={`${row.label}:${rowStatus?.phase === "failed" ? rowStatus.id : listStatus?.phase === "failed" ? `list-${listStatus.id}` : 0}`}
                      className="df-pipeline-label"
                      aria-label={`Name of ${row.label}`}
                      aria-describedby={hintId}
                      defaultValue={row.label}
                      disabled={pending}
                      onFocus={() => setNaming(row.id)}
                      onBlur={(event) => {
                        setNaming(null);
                        const next = event.target.value.trim();
                        if (next === row.label) return;
                        if (!onEdit(renamePipelineOption(list, row.index, next), row.id)) event.target.value = row.label;
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") event.currentTarget.value = row.label;
                        if (event.key === "Enter" || event.key === "Escape") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  )}
                  {row.outcome ? null : (
                    <span className="df-row-actions">
                      <Button
                        variant="outline"
                        size="icon"
                        type="button"
                        className="df-btn df-pipeline-move"
                        disabled={pending || !row.canMoveUp}
                        aria-label={`Move ${row.label} up`}
                        title="Move up"
                        onClick={() => onEdit(movePipelineOption(list, row.index, -1), row.id)}
                      >
                        <ChevronUp strokeWidth={1.6} aria-hidden />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        type="button"
                        className="df-btn df-pipeline-move"
                        disabled={pending || !row.canMoveDown}
                        aria-label={`Move ${row.label} down`}
                        title="Move down"
                        onClick={() => onEdit(movePipelineOption(list, row.index, 1), row.id)}
                      >
                        <ChevronDown strokeWidth={1.6} aria-hidden />
                      </Button>
                      {row.canRemove ? (
                        <DestructiveConfirm
                          icon={Trash2}
                          label="Remove"
                          title={`Remove ${row.label}`}
                          consequence={row.removeConsequence}
                          confirmLabel={`Remove ${list.noun}`}
                          keepLabel={`Keep ${list.noun}`}
                          pending={pending}
                          testId={`v2-pipeline-remove-${list.id}-${row.value}`}
                          onConfirm={() => onEdit(removePipelineOption(list, row.index), null)}
                        />
                      ) : null}
                    </span>
                  )}
                </div>
                <PipelineStatus
                  status={rowStatus}
                  hintId={hintId}
                  hint={naming === row.id ? PIPELINE_RENAME_HINT : null}
                />
              </li>
            );
          })}
        </ol>
        <form
          className="df-admin-form df-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (onEdit(addPipelineOption(list, draft), null)) setDraft("");
          }}
        >
          <label className="df-daily-field">
            New {list.noun}
            <Input value={draft} disabled={pending} onChange={(event) => setDraft(event.target.value)} />
          </label>
          <Button variant="default" type="submit" disabled={pending || !draft.trim()} className="df-btn">
            Add {list.noun}
          </Button>
        </form>
        <PipelineStatus status={listStatus} />
        <p className="df-policy-hint">{list.renameNote}</p>
        {/* One polite voice per list, so a save is heard once wherever it shows. */}
        <p className="df-sr-only" aria-live="polite" data-testid={`v2-pipeline-live-${list.id}`}>
          {feedback && feedback.phase !== "failed" ? feedback.message : ""}
        </p>
      </div>
    </section>
  );
}

/**
 * The slot beside a row (or under the list): the keys while its name has
 * focus, then Saving, a brief Saved, or why the save was refused.
 */
function PipelineStatus({
  status,
  hint = null,
  hintId,
}: {
  status: PipelineFeedback | null;
  hint?: string | null;
  hintId?: string;
}) {
  if (status?.phase === "failed") {
    return (
      <p id={hintId} className="df-pipeline-status df-refusal" data-phase="failed" role="alert">
        {status.message}
      </p>
    );
  }
  return (
    <p id={hintId} className="df-pipeline-status" data-phase={status?.phase ?? (hint ? "hint" : "idle")}>
      {status?.phase === "saved" ? <CheckIcon /> : null}
      {status ? status.message : hint}
    </p>
  );
}

/** The colours an option may wear, each drawn as the pill it would make. */
function ColourPicker({
  label,
  color,
  disabled,
  onChoose,
}: {
  label: string;
  color: string;
  disabled: boolean;
  onChoose: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const known = PIPELINE_COLOURS.some((colour) => colour.hex === color.toLowerCase());
  const colours = known ? PIPELINE_COLOURS : [{ name: "Current", hex: color }, ...PIPELINE_COLOURS];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" type="button" disabled={disabled} className="df-btn df-pipeline-colour" aria-label={`Colour of ${label}`}>
          <span className="df-pipeline-swatch" style={swatchStyle(color)} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="df-v2 df-select-content df-colour-picker">
        <Command>
          <CommandList>
            {colours.map((colour) => (
              <CommandItem
                key={colour.hex}
                value={colour.name}
                className="df-select-item"
                onSelect={() => {
                  setOpen(false);
                  if (colour.hex !== color) onChoose(colour.hex);
                }}
              >
                <span className="df-colour-option" style={swatchStyle(colour.hex)}>
                  <span className="df-colour-chip" aria-hidden="true" />
                  <span className="df-status" data-swatch="">{colour.name}</span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
