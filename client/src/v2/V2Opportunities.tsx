import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvided,
  type DropResult,
} from "@hello-pangea/dnd";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  CrmClient,
  CrmProjectNoteWithCreator,
  CrmProjectStageHistoryWithUser,
  CrmProjectWithDetails,
  SafeUser,
} from "@shared/schema";
import { opportunityStageFromCombined } from "@shared/projectLifecycle";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { motionForSurface } from "./motion";
import { isStandingRefusal, notify } from "./notify";
import { swatchStyle } from "./palette";
import { matchV2Route } from "./presentation";
import { memberName } from "./today";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { useV2Chrome } from "./V2Shell";
import { V2EmptyState } from "./V2EmptyState";
import { V2FormDialog } from "./V2FormDialog";
import { V2FilterSelect, V2_SELECT_NONE, type V2SelectOption } from "./V2Select";
import {
  CURRENCY_OPTIONS,
  canChangeOpportunityStage,
  combinedStatusForStage,
  composeOpportunityForm,
  composeOpportunityHistory,
  composeOpportunityNotes,
  composeOpportunityPipeline,
  composeOpportunityRecord,
  composeOpportunityStages,
  lostDraft,
  lostReasonOptions,
  newOpportunityDraft,
  newOpportunityPayload,
  opportunityDraft,
  opportunityLostPath,
  opportunityNotePath,
  opportunityNotesPath,
  opportunityStageHistoryPath,
  opportunitySourceOptions,
  opportunityWriteRefusal,
  readLostDraft,
  readWinDraft,
  stageOptionsFromFieldOptions,
  winDraft,
  winProjectTypeOptions,
  withSavedChoice,
  type ListOption,
  type LostDraft,
  type OpportunityCard,
  type OpportunityDraft,
  type OpportunityOutcome,
  type OpportunityRecordModel,
  type OpportunityPipelineRowInput,
  type OpportunityStageOption,
  type SavedOpportunity,
  type WinDraft,
} from "./opportunities";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SkeletonBoard, SkeletonRecordHead, SkeletonSection, V2PageSkeleton } from "./V2Skeleton";

type OpportunityRowsResponse = { data: CrmProjectWithDetails[]; total?: number };
type ModuleField = { slug: string; options: string[] | null };

const STAGE_CHANGE_MOTION = motionForSurface("opportunity-stage-change").enterExit;

async function loadOpportunityRows(): Promise<OpportunityRowsResponse> {
  const pageSize = 200;
  const rows: CrmProjectWithDetails[] = [];
  let page = 1;
  let total = 0;

  for (;;) {
    const res = await fetch(`/api/crm/projects?page=${page}&pageSize=${pageSize}`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to fetch Opportunities");
    const body = (await res.json()) as OpportunityRowsResponse;
    const batch = body.data ?? [];
    total = body.total ?? rows.length + batch.length;
    rows.push(...batch);
    if (rows.length >= total || batch.length === 0) break;
    page += 1;
  }

  return { data: rows, total };
}

function toPipelineRow(row: CrmProjectWithDetails): OpportunityPipelineRowInput {
  return {
    id: row.id,
    name: row.project?.name || "Untitled Opportunity",
    clientName: row.client?.name ?? null,
    combinedStatus: row.status,
    projectType: row.projectType,
    isDocumentationOnly: row.isDocumentationOnly ?? 0,
    estimatedValueMinor: row.estimatedValueMinor,
    estimatedValueCurrency: row.estimatedValueCurrency,
  };
}

function toSavedOpportunity(row: CrmProjectWithDetails): SavedOpportunity {
  return {
    name: row.project?.name ?? "",
    status: row.status,
    clientId: row.clientId,
    opportunityOwnerId: row.opportunityOwnerId,
    dueDate: row.dueDate,
    source: row.source,
    estimatedValueMinor: row.estimatedValueMinor,
    estimatedValueCurrency: row.estimatedValueCurrency,
  };
}

/** The Workspace's stages and the Pipeline & lists lists an Opportunity reads. */
function useOpportunityLists() {
  const { data: fields = [] } = useQuery<ModuleField[]>({
    queryKey: ["/api/modules/projects/fields"],
  });
  const { data: contactFields = [] } = useQuery<ModuleField[]>({
    queryKey: ["/api/modules/contacts/fields"],
    retry: false,
  });
  const statusField = fields.find((field) => field.slug === "status");
  const stages = useMemo(
    () => composeOpportunityStages(stageOptionsFromFieldOptions(statusField?.options)),
    [statusField],
  );
  return {
    stages,
    sources: opportunitySourceOptions(contactFields),
    lostReasons: lostReasonOptions(fields),
    projectTypes: winProjectTypeOptions(fields),
  };
}

type OpportunityLists = ReturnType<typeof useOpportunityLists>;

function useWorkspaceWrites() {
  const { memberships } = useV2Chrome();
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";
  const ownerName = useWorkspaceOwnerName();
  return {
    workspaceName,
    readOnly,
    refusal: (errorMessage?: string, capability?: string) =>
      opportunityWriteRefusal({ readOnly, workspaceName, errorMessage, ownerName, capability }),
    /** The inline refusal a failed write leaves, or null once any other failure is a toast. */
    failed: (error: Error, capability?: string): string | null => {
      if (!readOnly && !isStandingRefusal(error)) {
        notify.error(error);
        return null;
      }
      return opportunityWriteRefusal({ readOnly, workspaceName, errorMessage: error.message, ownerName, capability });
    },
  };
}

function peopleOptions(users: SafeUser[], none: string): V2SelectOption[] {
  return [
    { value: V2_SELECT_NONE, label: none },
    ...users.map((user) => ({ value: user.id, label: memberName(user) })),
  ];
}

function fromSelect(value: string): string {
  return value === V2_SELECT_NONE ? "" : value;
}

function opportunityCloneRoot(): HTMLElement {
  return document.querySelector<HTMLElement>(".df-v2") ?? document.body;
}

function isOpportunityCardClick(
  event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "clientX" | "clientY">,
  origin: { x: number; y: number } | null,
): boolean {
  if (!origin) return false;
  if (event.button !== 0 || event.shiftKey || event.altKey) return false;
  return Math.abs(event.clientX - origin.x) <= 5 && Math.abs(event.clientY - origin.y) <= 5;
}

function OpportunityCardView({
  card,
  provided,
  dragging,
  locked,
  onOpen,
}: {
  card: OpportunityCard;
  provided: DraggableProvided;
  dragging: boolean;
  locked: boolean;
  onOpen: (href: string) => void;
}) {
  const origin = useRef<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const recordHref = card.recordHref;

  useEffect(() => {
    const clearPress = () => cardRef.current?.setAttribute("data-pressing", "false");
    window.addEventListener("pointerup", clearPress);
    window.addEventListener("pointercancel", clearPress);
    return () => {
      window.removeEventListener("pointerup", clearPress);
      window.removeEventListener("pointercancel", clearPress);
    };
  }, []);

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    origin.current = { x: event.clientX, y: event.clientY };
    if (!locked && !dragging) event.currentTarget.setAttribute("data-pressing", "true");
  }

  function onClick(event: MouseEvent<HTMLElement>) {
    if (dragging) return;
    if (!isOpportunityCardClick(event, origin.current)) return;
    origin.current = null;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      window.open(recordHref, "_blank", "noopener,noreferrer");
      return;
    }
    onOpen(recordHref);
  }

  return (
    <article
      ref={(element) => {
        provided.innerRef(element);
        cardRef.current = element;
      }}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      className="df-opportunity-card"
      data-dragging={dragging ? "true" : "false"}
      data-pressing="false"
      data-locked={locked ? "true" : "false"}
      data-href={recordHref}
      data-testid={`v2-opportunity-card-${card.id}`}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <div className="df-row-title">{card.name}</div>
      {card.clientLabel ? <div className="df-opportunity-card-client">{card.clientLabel}</div> : null}
      {card.valueLabel ? <div className="df-opportunity-card-value">{card.valueLabel}</div> : null}
    </article>
  );
}

/** The fields New Opportunity asks for and the record edits (#276). */
function OpportunityFieldInputs({
  draft,
  onChange,
  clients,
  users,
  sources,
  savedSource,
  autoFocus,
}: {
  draft: OpportunityDraft;
  onChange: (draft: OpportunityDraft) => void;
  clients: CrmClient[];
  users: SafeUser[];
  sources: ListOption[];
  savedSource?: string | null;
  autoFocus?: boolean;
}) {
  const set = (patch: Partial<OpportunityDraft>) => onChange({ ...draft, ...patch });
  return (
    <>
      <label className="df-daily-field" data-wide="true">
        NAME
        <input
          type="text"
          value={draft.name}
          autoFocus={autoFocus}
          onChange={(event) => set({ name: event.target.value })}
          placeholder="Opportunity name"
          aria-label="Opportunity name"
        />
      </label>
      <label className="df-daily-field">
        CLIENT
        <V2FilterSelect
          label=""
          ariaLabel="Client"
          value={draft.clientId || V2_SELECT_NONE}
          options={[
            { value: V2_SELECT_NONE, label: "No Client yet" },
            ...clients.map((client) => ({ value: client.id, label: client.name })),
          ]}
          onChange={(value) => set({ clientId: fromSelect(value) })}
        />
      </label>
      <label className="df-daily-field">
        OWNER
        <V2FilterSelect
          label=""
          ariaLabel="Owner"
          value={draft.ownerId || V2_SELECT_NONE}
          options={peopleOptions(users, "No Owner")}
          onChange={(value) => set({ ownerId: fromSelect(value) })}
        />
      </label>
      <label className="df-daily-field">
        EXPECTED CLOSE
        <input
          type="date"
          value={draft.closeDate}
          onChange={(event) => set({ closeDate: event.target.value })}
          aria-label="Expected close date"
        />
      </label>
      <label className="df-daily-field">
        SOURCE
        <V2FilterSelect
          label=""
          ariaLabel="Source"
          value={draft.source || V2_SELECT_NONE}
          options={[{ value: V2_SELECT_NONE, label: "Not set" }, ...withSavedChoice(sources, savedSource)]}
          onChange={(value) => set({ source: fromSelect(value) })}
        />
      </label>
      <label className="df-daily-field">
        ESTIMATED VALUE
        <input
          type="text"
          inputMode="decimal"
          value={draft.amount}
          onChange={(event) => set({ amount: event.target.value })}
          placeholder="Not set"
          aria-label="Estimated value"
        />
      </label>
      <label className="df-daily-field">
        CURRENCY
        <V2FilterSelect
          label=""
          ariaLabel="Currency"
          value={draft.currency}
          options={CURRENCY_OPTIONS}
          onChange={(value) => set({ currency: value })}
        />
      </label>
    </>
  );
}

type Outcome = { kind: OpportunityOutcome; row: CrmProjectWithDetails };

/**
 * Mark as won asks for the Client Project the win makes (ADR-0001): its
 * Project type, its budget in hours, and its Project Manager, the Owner until
 * changed. Mark as lost asks why. The Estimated value is never the budget.
 */
function OpportunityOutcomeDialog({
  outcome,
  onClose,
  lists,
  users,
  clients,
}: {
  outcome: Outcome;
  onClose: () => void;
  lists: OpportunityLists;
  users: SafeUser[];
  clients: CrmClient[];
}) {
  const writes = useWorkspaceWrites();
  const { row, kind } = outcome;
  const [win, setWin] = useState<WinDraft>(() => winDraft(row, lists.projectTypes));
  const [lost, setLost] = useState<LostDraft>(() => lostDraft(row));
  const [refusal, setRefusal] = useState<string | null>(null);
  const alreadyLost = row.status === "lost";

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      kind === "won"
        ? apiRequest("PATCH", `/api/crm/projects/${row.id}`, payload)
        : apiRequest("POST", opportunityLostPath(row.id), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      onClose();
      notify.success(kind === "won" ? "Opportunity marked won" : "Opportunity marked lost");
    },
    onError: (error: Error) => setRefusal(writes.failed(error, "Change Opportunity Stage")),
  });

  const readWin = readWinDraft(win, { status: row.status, clientId: row.clientId });
  const readLost = readLostDraft(lost);
  const read = kind === "won" ? readWin : readLost;

  function submit() {
    if (writes.readOnly) {
      setRefusal(writes.refusal());
      return;
    }
    if (read.payload) save.mutate(read.payload);
  }

  const name = row.project?.name || "this Opportunity";
  if (kind === "won") {
    return (
      <V2FormDialog
        open
        onOpenChange={(open) => !open && onClose()}
        title="Mark as won"
        description={`Winning ${name} makes it a Client Project. Its Estimated value stays on the Opportunity; the Project's budget is time.`}
        submitLabel="Mark as won"
        pending={save.isPending}
        canSubmit={Boolean(readWin.payload)}
        onSubmit={submit}
        refusal={refusal ?? readWin.issue}
        testId="v2-opportunity-win"
      >
        {!row.clientId ? (
          <label className="df-daily-field">
            CLIENT
            <V2FilterSelect
              label=""
              ariaLabel="Client"
              value={win.clientId || V2_SELECT_NONE}
              options={[
                { value: V2_SELECT_NONE, label: "Choose a Client" },
                ...clients.map((client) => ({ value: client.id, label: client.name })),
              ]}
              onChange={(value) => setWin({ ...win, clientId: fromSelect(value) })}
            />
          </label>
        ) : null}
        <label className="df-daily-field">
          PROJECT TYPE
          <V2FilterSelect
            label=""
            ariaLabel="Project type"
            value={win.projectType}
            options={lists.projectTypes}
            onChange={(value) => setWin({ ...win, projectType: value })}
          />
        </label>
        <div className="df-field-pair">
          <label className="df-daily-field">
            BUDGET HOURS
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={win.hours}
              autoFocus
              onChange={(event) => setWin({ ...win, hours: event.target.value })}
              placeholder="No budget"
              aria-label="Budget hours"
            />
          </label>
          <label className="df-daily-field">
            MINUTES
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              step={1}
              value={win.minutes}
              onChange={(event) => setWin({ ...win, minutes: event.target.value })}
              placeholder="0"
              aria-label="Budget minutes"
            />
          </label>
        </div>
        <label className="df-daily-field">
          PROJECT MANAGER
          <V2FilterSelect
            label=""
            ariaLabel="Project Manager"
            value={win.managerId || V2_SELECT_NONE}
            options={peopleOptions(users, "No Project Manager")}
            onChange={(value) => setWin({ ...win, managerId: fromSelect(value) })}
          />
        </label>
      </V2FormDialog>
    );
  }

  return (
    <V2FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={alreadyLost ? (row.lostReason ? "Change Lost reason" : "Add Lost reason") : "Mark as lost"}
      description={
        alreadyLost
          ? `Why ${name} was lost.`
          : `Losing ${name} closes it. Say why, so the pipeline can learn from it.`
      }
      submitLabel={alreadyLost ? "Save reason" : "Mark as lost"}
      pending={save.isPending}
      canSubmit={Boolean(readLost.payload)}
      onSubmit={submit}
      refusal={refusal ?? (lost.reason ? readLost.issue : null)}
      testId="v2-opportunity-lost"
    >
      <label className="df-daily-field">
        LOST REASON
        <V2FilterSelect
          label=""
          ariaLabel="Lost reason"
          value={lost.reason || V2_SELECT_NONE}
          options={[
            { value: V2_SELECT_NONE, label: "Choose a reason", disabled: true },
            ...withSavedChoice(lists.lostReasons, row.lostReason),
          ]}
          onChange={(value) => setLost({ ...lost, reason: fromSelect(value) })}
        />
      </label>
      <label className="df-daily-field">
        DETAIL
        <textarea
          value={lost.detail}
          onChange={(event) => setLost({ ...lost, detail: event.target.value })}
          placeholder="Optional"
          aria-label="Lost reason detail"
        />
      </label>
    </V2FormDialog>
  );
}

function StageHistoryCard({ opportunityId, stages }: { opportunityId: string; stages: OpportunityStageOption[] }) {
  const { data: changes = [] } = useQuery<CrmProjectStageHistoryWithUser[]>({
    queryKey: ["/api/crm/projects", opportunityId, "stage-history"],
    queryFn: () => apiRequest("GET", opportunityStageHistoryPath(opportunityId)),
  });
  const history = composeOpportunityHistory(changes, stages, new Date());
  return (
    <section className="df-card" data-testid="v2-opportunity-stage-history">
      <div className="df-card-head">
        <h2 className="df-card-title">Stage history</h2>
      </div>
      {history.empty ? (
        <V2EmptyState
          icon="activity"
          title={history.emptyState.title}
          copy={history.emptyState.copy}
          testId="v2-opportunity-stage-history-empty"
        />
      ) : (
        history.rows.map((row) => (
          <div key={row.id} className="df-history-row">
            <div className="df-history-move">
              {row.from && row.fromColor ? (
                <>
                  <span className="df-status" data-swatch="" style={swatchStyle(row.fromColor)}>{row.from}</span>
                  <span className="df-mono df-meta">→</span>
                </>
              ) : null}
              <span className="df-status" data-swatch="" style={swatchStyle(row.toColor)}>{row.to}</span>
            </div>
            <div className="df-mono df-meta">
              {row.when} · {row.who.toUpperCase()} · HELD {row.held.toUpperCase()}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

type NoteComposer = { mode: "new" } | { mode: "edit"; id: string };

/** A thread of dated notes, written and edited in a dialog, as the Dossier's Notes tab. */
function OpportunityNotesCard({ opportunityId }: { opportunityId: string }) {
  const writes = useWorkspaceWrites();
  const [composer, setComposer] = useState<NoteComposer | null>(null);
  const [content, setContent] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const notesKey = ["/api/crm/projects", opportunityId, "notes"];
  const { data: notes = [] } = useQuery<CrmProjectNoteWithCreator[]>({
    queryKey: notesKey,
    queryFn: () => apiRequest("GET", opportunityNotesPath(opportunityId)),
  });
  const thread = composeOpportunityNotes(notes, new Date());

  const onNoteError = (error: Error) => setRefusal(writes.failed(error, "Manage Opportunity Notes"));
  const saveNote = useMutation({
    mutationFn: ({ target, text }: { target: NoteComposer; text: string }) =>
      target.mode === "new"
        ? apiRequest("POST", opportunityNotesPath(opportunityId), { content: text })
        : apiRequest("PATCH", opportunityNotePath(opportunityId, target.id), { content: text }),
    onSuccess: (_result, { target }) => {
      queryClient.invalidateQueries({ queryKey: notesKey });
      setComposer(null);
      setContent("");
      setRefusal(null);
      notify.success(target.mode === "new" ? "Note added" : "Note saved");
    },
    onError: onNoteError,
  });
  const deleteNote = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", opportunityNotePath(opportunityId, id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notesKey });
      notify.success("Note deleted");
    },
    onError: onNoteError,
  });

  function open(target: NoteComposer, text: string) {
    if (writes.readOnly) {
      setRefusal(writes.refusal());
      return;
    }
    setRefusal(null);
    setContent(text);
    setComposer(target);
  }

  const editing = composer?.mode === "edit";
  return (
    <section className="df-card" data-testid="v2-opportunity-notes">
      <div className="df-card-head">
        <h2 className="df-card-title">Notes</h2>
        <span className="df-cluster">
          <span className="df-count-chip">{thread.rows.length}</span>
          {!thread.empty ? (
            <Button variant="outline" type="button" onClick={() => open({ mode: "new" }, "")} className="df-btn">
              New Note
            </Button>
          ) : null}
        </span>
      </div>
      {refusal && !composer ? <p className="df-refusal">{refusal}</p> : null}
      {thread.empty ? (
        <V2EmptyState
          icon="notes"
          title={thread.emptyState.title}
          copy={thread.emptyState.copy}
          testId="v2-opportunity-notes-empty"
          action={
            <Button variant="default" type="button" className="df-btn" onClick={() => open({ mode: "new" }, "")}>
              {thread.emptyState.action}
            </Button>
          }
        />
      ) : null}
      {thread.rows.map((note) => (
        <article key={note.id} className="df-update-body" data-testid={`v2-opportunity-note-${note.id}`}>
          <div className="df-mono df-meta">{note.meta}</div>
          <p className="df-prose">{note.content}</p>
          <div className="df-cluster">
            <Button
              variant="outline"
              type="button"
              className="df-btn"
              onClick={() => open({ mode: "edit", id: note.id }, note.content)}
              data-testid={`v2-opportunity-edit-note-${note.id}`}
            >
              Edit
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructiveOutline"
                  type="button"
                  className="df-btn"
                  data-testid={`v2-opportunity-delete-note-${note.id}`}
                >
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="df-v2 df-alert">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete note</AlertDialogTitle>
                  <AlertDialogDescription>{note.deleteConsequence}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="df-btn" autoFocus>
                    Keep note
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="df-btn bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => {
                      if (writes.readOnly) setRefusal(writes.refusal());
                      else deleteNote.mutate(note.id);
                    }}
                  >
                    Delete note
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </article>
      ))}
      <V2FormDialog
        open={composer !== null}
        onOpenChange={(next) => {
          if (!next) {
            setComposer(null);
            setRefusal(null);
          }
        }}
        title={editing ? "Edit note" : "New Note"}
        description="A note keeps what was said or decided on this Opportunity. It is dated and signed with your name."
        submitLabel={editing ? "Save note" : "Add note"}
        pending={saveNote.isPending}
        canSubmit={Boolean(content.trim())}
        onSubmit={() => composer && saveNote.mutate({ target: composer, text: content.trim() })}
        refusal={refusal}
        testId="v2-opportunity-note-dialog"
      >
        <label className="df-daily-field">
          NOTE
          <textarea
            value={content}
            autoFocus
            onChange={(event) => setContent(event.target.value)}
            aria-label="Opportunity note"
          />
        </label>
      </V2FormDialog>
    </section>
  );
}

/**
 * The Opportunity record (#307): it reads first. Edit turns it into the form,
 * the stage included, and Save changes or Cancel turn it back. Won and Lost
 * still ask their questions in the outcome dialog.
 */
function OpportunityDetailsCard({
  row,
  record,
  stages,
  editing,
  onCancel,
  onSaved,
  onOutcome,
  clients,
  users,
  sources,
}: {
  row: CrmProjectWithDetails;
  record: OpportunityRecordModel;
  stages: OpportunityStageOption[];
  editing: boolean;
  onCancel: () => void;
  onSaved: () => void;
  onOutcome: (kind: OpportunityOutcome) => void;
  clients: CrmClient[];
  users: SafeUser[];
  sources: ListOption[];
}) {
  return (
    <section className="df-card" data-testid="v2-opportunity-details">
      <div className="df-card-head">
        <div className="df-card-head-text">
          <h2 className="df-card-title">Opportunity record</h2>
          <p className="df-card-sub">What this sale is, who owns it, and what it is expected to bring in.</p>
        </div>
      </div>
      {editing ? (
        <OpportunityEditForm
          row={row}
          terminal={record.terminal}
          stages={stages}
          onCancel={onCancel}
          onSaved={onSaved}
          onOutcome={onOutcome}
          clients={clients}
          users={users}
          sources={sources}
        />
      ) : (
        <div className="df-settings-grid" data-testid="v2-opportunity-fields-read">
          {record.fields.map((field) => (
            <div key={field.label} className="df-settings-row">
              <span className="df-settings-label">{field.label}</span>
              <span className="df-settings-value">{field.value}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function OpportunityEditForm({
  row,
  terminal,
  stages,
  onCancel,
  onSaved,
  onOutcome,
  clients,
  users,
  sources,
}: {
  row: CrmProjectWithDetails;
  terminal: boolean;
  stages: OpportunityStageOption[];
  onCancel: () => void;
  onSaved: () => void;
  onOutcome: (kind: OpportunityOutcome) => void;
  clients: CrmClient[];
  users: SafeUser[];
  sources: ListOption[];
}) {
  const writes = useWorkspaceWrites();
  const saved = toSavedOpportunity(row);
  const [draft, setDraft] = useState<OpportunityDraft>(() => opportunityDraft(saved));
  const [refusal, setRefusal] = useState<string | null>(null);
  const form = composeOpportunityForm(draft, saved);

  function finish(outcome: OpportunityOutcome | null) {
    onSaved();
    if (outcome) onOutcome(outcome);
  }

  const save = useMutation({
    mutationFn: ({ patch }: { patch: Record<string, unknown>; outcome: OpportunityOutcome | null }) =>
      apiRequest("PATCH", `/api/crm/projects/${row.id}`, patch),
    onSuccess: (_result, { outcome }) => {
      setRefusal(null);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      notify.success("Opportunity saved");
      finish(outcome);
    },
    onError: (error: Error) => setRefusal(writes.failed(error, "Edit Opportunities")),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.canSave) return;
    if (writes.readOnly) {
      setRefusal(writes.refusal());
      return;
    }
    if (form.patch) save.mutate({ patch: form.patch, outcome: form.outcome });
    else finish(form.outcome);
  }

  const note = refusal ?? form.note;
  return (
    <form onSubmit={onSubmit}>
      <div className="df-opportunity-fields">
        <label className="df-daily-field">
          STAGE
          <V2FilterSelect
            label=""
            ariaLabel="Stage"
            value={draft.stage}
            options={stages.map((stage) => ({ value: stage.id, label: stage.label }))}
            onChange={(stage) => setDraft({ ...draft, stage })}
            disabled={terminal}
          />
        </label>
        <OpportunityFieldInputs
          draft={draft}
          onChange={setDraft}
          clients={clients}
          users={users}
          sources={sources}
          savedSource={row.source}
          autoFocus
        />
      </div>
      <div className="df-form-actions">
        <p className={refusal || form.issue ? "df-form-note df-refusal-inline" : "df-form-note"} role="status">
          {note}
        </p>
        <Button variant="outline" type="button" onClick={onCancel} className="df-btn" data-testid="v2-opportunity-cancel">
          Cancel
        </Button>
        <Button variant="default" type="submit" disabled={!form.canSave || save.isPending} className="df-btn">
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function OpportunityRecord({ row }: { row: CrmProjectWithDetails }) {
  const lists = useOpportunityLists();
  const writes = useWorkspaceWrites();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const { data: clients = [] } = useQuery<CrmClient[]>({ queryKey: ["/api/crm/clients"] });

  const record = composeOpportunityRecord({
    ...toPipelineRow(row),
    stages: lists.stages,
    clientId: row.clientId,
    owner: users.find((member) => member.id === row.opportunityOwnerId) ?? null,
    dueDate: row.dueDate,
    source: row.source,
    sourceOptions: lists.sources,
    lostReason: row.lostReason,
    lostReasonDetail: row.lostReasonDetail,
    lostReasonOptions: lists.lostReasons,
  });

  function onEdit() {
    if (writes.readOnly) {
      setRefusal(writes.refusal());
      return;
    }
    setRefusal(null);
    setEditing(true);
  }

  function onLostReason() {
    if (writes.readOnly) setRefusal(writes.refusal());
    else setOutcome({ kind: "lost", row });
  }

  return (
    <div className="df-page" data-testid="v2-opportunity-record">
      <header className="df-dossier-head">
        <div className="df-dossier-identity df-opportunity-identity">
          <div className="df-dossier-copy">
            <h1 className="df-record-title">{record.title}</h1>
            <div className="df-dossier-provenance">
              {record.clientHref ? (
                <Link href={record.clientHref} className="df-mono df-meta">{record.clientLabel}</Link>
              ) : (
                <span className="df-mono df-meta">{record.clientLabel}</span>
              )}
              <span className="df-mono df-meta">{record.terminal ? "TERMINAL" : "OPEN"}</span>
            </div>
          </div>
          <div className="df-opportunity-head-side">
            <div className="df-dossier-meta">
              <span className="df-status">OPPORTUNITY</span>
              <span className="df-status" data-status={record.stage} data-swatch="" style={swatchStyle(record.stageColor)}>
                {record.stage}
              </span>
            </div>
            {editing ? null : (
              <Button variant="outline" type="button" onClick={onEdit} className="df-btn" data-testid="v2-opportunity-edit">
                Edit
              </Button>
            )}
          </div>
        </div>
      </header>
      {refusal ? <p className="df-refusal">{refusal}</p> : null}

      <div className="df-opportunity-layout">
        <div className="df-opportunity-column">
          <OpportunityDetailsCard
            key={`${row.id}-${String(row.updatedAt)}`}
            row={row}
            record={record}
            stages={lists.stages}
            editing={editing}
            onCancel={() => setEditing(false)}
            onSaved={() => setEditing(false)}
            onOutcome={(kind) => setOutcome({ kind, row })}
            clients={clients}
            users={users}
            sources={lists.sources}
          />
          <OpportunityNotesCard opportunityId={row.id} />
        </div>

        <div className="df-opportunity-column">
          <section className="df-card" data-testid="v2-opportunity-stage">
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Stage</h2>
                <p className="df-card-sub">Won and Lost close the pipeline. Marking it won makes it a Client Project; marking it lost asks why. Edit changes the stage.</p>
              </div>
            </div>
            <div className="df-settings-grid">
              <div className="df-settings-row">
                <span className="df-settings-label">STAGE</span>
                <span className="df-settings-value">
                  <span className="df-status" data-swatch="" style={swatchStyle(record.stageColor)}>
                    {record.stage}
                  </span>
                </span>
              </div>
              {record.lostReason ? (
                <div className="df-settings-row" data-testid="v2-opportunity-lost-reason">
                  <span className="df-settings-label">LOST REASON</span>
                  <span className="df-settings-value df-settings-inline">
                    <span>
                      {record.lostReason.label}
                      {record.lostReason.detail ? <span className="df-settings-copy"> · {record.lostReason.detail}</span> : null}
                    </span>
                    <Button variant="outline" type="button" className="df-btn" onClick={onLostReason}>
                      Change reason
                    </Button>
                  </span>
                </div>
              ) : null}
              {record.lostReasonMissing ? (
                <div className="df-settings-row" data-testid="v2-opportunity-lost-reason">
                  <span className="df-settings-label">LOST REASON</span>
                  <span className="df-settings-value df-settings-inline">
                    <span className="df-settings-copy">Not recorded</span>
                    <Button variant="outline" type="button" className="df-btn" onClick={onLostReason}>
                      Add reason
                    </Button>
                  </span>
                </div>
              ) : null}
            </div>
          </section>

          <StageHistoryCard opportunityId={row.id} stages={lists.stages} />
        </div>
      </div>

      {outcome ? (
        <OpportunityOutcomeDialog
          key={`${outcome.kind}-${outcome.row.id}`}
          outcome={outcome}
          onClose={() => setOutcome(null)}
          lists={lists}
          users={users}
          clients={clients}
        />
      ) : null}
    </div>
  );
}

export function V2OpportunityRecordPage() {
  const [location] = useLocation();
  const match = matchV2Route(location);
  const opportunityId = match.kind === "opportunity-record" ? match.opportunityId : "";
  const { data: row, isLoading, isError } = useQuery<CrmProjectWithDetails | null>({
    queryKey: ["/api/crm/projects", opportunityId],
    enabled: Boolean(opportunityId),
    queryFn: async () => {
      const response = await fetch(`/api/crm/projects/${opportunityId}`, { credentials: "include" });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Failed to fetch Opportunity");
      return response.json();
    },
  });

  if (match.kind !== "opportunity-record") return null;
  if (isLoading) {
    return (
      <div className="df-page" data-testid="v2-opportunity-record" aria-busy="true">
        <SkeletonRecordHead />
        <SkeletonSection title="Opportunity record" lines={4} />
      </div>
    );
  }
  if (isError || !row) {
    return <div className="df-page"><p className="df-empty">This Opportunity could not be loaded.</p></div>;
  }

  return <OpportunityRecord row={row} />;
}

function renderOpportunityClone(
  cardsById: Map<string, OpportunityCard>,
  provided: DraggableProvided,
  rubric: { draggableId: string },
) {
  const card = cardsById.get(rubric.draggableId);
  if (!card) return null;
  return <OpportunityCardView card={card} provided={provided} dragging locked={false} onOpen={() => {}} />;
}

export function V2OpportunitiesPage() {
  const { layout } = useV2Chrome();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [filterQuery, setFilterQuery] = useState("");
  const [changingId, setChangingId] = useState<string | null>(null);
  const pipelineRef = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(() => newOpportunityDraft(""));
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const { workspaceName, readOnly, refusal, failed } = useWorkspaceWrites();
  const lists = useOpportunityLists();
  const { stages } = lists;

  const { data: clients = [] } = useQuery<CrmClient[]>({
    queryKey: ["/api/crm/clients"],
  });
  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const { data: projectsResponse, isLoading, isError } = useQuery<OpportunityRowsResponse>({
    queryKey: ["/api/crm/projects", "register"],
    queryFn: loadOpportunityRows,
  });

  const pipeline = composeOpportunityPipeline({
    workspaceName,
    stages,
    rows: (projectsResponse?.data ?? []).map(toPipelineRow),
    filterQuery,
    changingId,
  });

  const created = newOpportunityPayload(draft);
  const openStages = stages.filter((stage) => !stage.terminal);

  const createOpportunity = useMutation({
    mutationFn: async (input: { body: Record<string, unknown>; note: string | null }) => {
      const result = await apiRequest("POST", "/api/crm/projects", input.body);
      if (input.note) {
        await apiRequest("POST", opportunityNotesPath(result.crmProject.id), { content: input.note });
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      setDraft(newOpportunityDraft(user?.id ?? ""));
      setCreating(false);
      setWriteRefusal(null);
      notify.success("Opportunity created");
    },
    onError: (error: Error) => {
      setWriteRefusal(failed(error));
    },
  });

  const changeStage = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/crm/projects/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/crm/projects"] });
      const previous = queryClient.getQueryData<OpportunityRowsResponse>(["/api/crm/projects", "register"]);
      if (previous) {
        queryClient.setQueryData<OpportunityRowsResponse>(["/api/crm/projects", "register"], {
          ...previous,
          data: previous.data.map((row) =>
            row.id === id ? { ...row, status: status as CrmProjectWithDetails["status"] } : row,
          ),
        });
      }
      setChangingId(id);
      setWriteRefusal(null);
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/crm/projects", "register"], context.previous);
      }
      setChangingId(null);
      setWriteRefusal(failed(error, "Change Opportunity Stage"));
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      window.setTimeout(() => setChangingId(null), 180);
    },
  });

  function onCreate() {
    if (!created.body) return;
    if (readOnly) {
      setWriteRefusal(refusal());
      return;
    }
    createOpportunity.mutate({ body: created.body, note: created.note });
  }

  function onStageChange(row: CrmProjectWithDetails, fromStage: string, nextStage: string) {
    if (!canChangeOpportunityStage(fromStage, nextStage)) return;
    if (readOnly) {
      setWriteRefusal(refusal());
      return;
    }
    if (nextStage === "won" || nextStage === "lost") {
      setOutcome({ kind: nextStage, row });
      return;
    }
    changeStage.mutate({
      id: row.id,
      status: combinedStatusForStage(nextStage, row.status),
    });
  }

  const rowsById = new Map((projectsResponse?.data ?? []).map((row) => [row.id, row]));
  const cardsById = new Map(
    pipeline.columns.flatMap((column) => column.cards.map((card) => [card.id, card] as const)),
  );

  function handleDragEnd(result: DropResult) {
    pipelineRef.current?.setAttribute("data-dragging", "false");
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;
    const row = rowsById.get(draggableId);
    if (!row) return;
    onStageChange(row, source.droppableId, destination.droppableId);
  }

  if (isLoading) {
    return (
      <V2PageSkeleton title="Opportunities" testId="v2-opportunities" status="Loading Opportunities for this Workspace.">
        {/* Stage names come from the CRM field options, so the columns wait unnamed. */}
        <SkeletonBoard columns={[null, null, null, null, null]} />
      </V2PageSkeleton>
    );
  }

  if (isError) {
    return (
      <div className="df-page" data-testid="v2-opportunities">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Opportunities</h1>
            <p className="df-subhead">{pipeline.subhead}</p>
          </div>
        </header>
        <p className="df-empty">Opportunities in this Workspace could not be loaded.</p>
      </div>
    );
  }

  return (
    <div className="df-page" data-testid="v2-opportunities">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">Opportunities</h1>
          <p className="df-subhead">{pipeline.subhead}</p>
        </div>
        <div className="df-library-actions">
          <Button
            variant="default"
            type="button"
            onClick={() => {
              setDraft(newOpportunityDraft(user?.id ?? ""));
              setWriteRefusal(null);
              setCreating(true);
            }}
            className="df-btn"
          >
            New Opportunity
          </Button>
        </div>
      </header>

      <V2FormDialog
        open={creating}
        onOpenChange={setCreating}
        title="New Opportunity"
        description="An Opportunity is a sale in the pipeline. It starts at the stage you choose and moves along the stages on the pipeline."
        submitLabel="Create Opportunity"
        pending={createOpportunity.isPending}
        canSubmit={Boolean(created.body)}
        onSubmit={onCreate}
        refusal={writeRefusal ?? (draft.name.trim() ? created.issue : null)}
        testId="v2-opportunities-new"
      >
        <div className="df-opportunity-fields">
          <OpportunityFieldInputs
            draft={draft}
            onChange={(next) => setDraft({ ...draft, ...next })}
            clients={clients}
            users={users}
            sources={lists.sources}
            autoFocus
          />
          <label className="df-daily-field" data-wide="true">
            STAGE
            <V2FilterSelect
              label=""
              ariaLabel="Stage"
              value={draft.stage}
              options={openStages.map((stage) => ({ value: stage.id, label: stage.label }))}
              onChange={(stage) => setDraft({ ...draft, stage })}
            />
          </label>
          <label className="df-daily-field" data-wide="true">
            FIRST NOTE
            <textarea
              value={draft.note}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
              placeholder="Optional"
              aria-label="First note"
            />
          </label>
        </div>
      </V2FormDialog>
      {writeRefusal && !creating ? <p className="df-refusal">{writeRefusal}</p> : null}

      <div className="df-filter-bar df-opportunities-filter">
        <label className="df-filter-input">
          <input
            type="search"
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder="Filter Opportunities"
            aria-label="Filter Opportunities"
          />
        </label>
      </div>

      {pipeline.empty ? <p className="df-empty">{pipeline.emptyCopy}</p> : null}

      <DragDropContext
        onDragStart={() => pipelineRef.current?.setAttribute("data-dragging", "true")}
        onDragEnd={handleDragEnd}
      >
        <div
          ref={pipelineRef}
          className="df-opportunity-pipeline"
          data-stacked={layout.stackedRegister ? "true" : "false"}
          data-dragging="false"
          data-motion={STAGE_CHANGE_MOTION}
          data-testid="v2-opportunities-pipeline"
        >
          {pipeline.columns.map((column) => (
            <section
              key={column.id}
              className="df-card df-opportunity-column"
              data-terminal={column.terminal ? "true" : "false"}
              data-staged="true"
              // Per-instance: the column's stage colour, read by the pill and the tint.
              style={{ "--df-stage": column.color } as CSSProperties}
            >
              <div className="df-card-head">
                <h2 className="df-card-title">
                  <span className="df-stage-pill" data-ink={column.ink}>
                    {column.label}
                  </span>
                </h2>
                <span className="df-cluster">
                  <span className="df-count-chip">{column.cards.length}</span>
                  {column.totals.length ? (
                    <span className="df-opportunity-totals" data-testid={`v2-opportunity-totals-${column.id}`}>
                      {column.totals.join(" · ")}
                    </span>
                  ) : null}
                </span>
              </div>
              <Droppable
                droppableId={column.id}
                renderClone={(provided, _snapshot, rubric) =>
                  renderOpportunityClone(cardsById, provided, rubric)
                }
                getContainerForClone={opportunityCloneRoot}
              >
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="df-opportunity-drop"
                    data-over={snapshot.isDraggingOver ? "true" : "false"}
                  >
                    {column.cards.map((card, index) => (
                      <Draggable
                        key={card.id}
                        draggableId={card.id}
                        index={index}
                        isDragDisabled={!card.canChangeStage || readOnly}
                      >
                        {(drag) => (
                          <OpportunityCardView
                            card={card}
                            provided={drag}
                            dragging={false}
                            locked={!card.canChangeStage || readOnly}
                            onOpen={setLocation}
                          />
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </section>
          ))}
        </div>
      </DragDropContext>

      <div className="df-library-foot">
        {pipeline.count} {pipeline.count === 1 ? "Opportunity" : "Opportunities"}
      </div>

      {outcome ? (
        <OpportunityOutcomeDialog
          key={`${outcome.kind}-${outcome.row.id}`}
          outcome={outcome}
          onClose={() => setOutcome(null)}
          lists={lists}
          users={users}
          clients={clients}
        />
      ) : null}
    </div>
  );
}
