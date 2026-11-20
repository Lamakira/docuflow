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
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
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
import { matchV2Route } from "./presentation";
import { memberName } from "./today";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { useV2Chrome } from "./V2Shell";
import { V2EmptyState, V2RecordEmpty } from "./V2EmptyState";
import { V2FormDialog } from "./V2FormDialog";
import { V2FilterSelect, V2_SELECT_NONE, type V2SelectOption } from "./V2Select";
import {
  CURRENCY_OPTIONS,
  canChangeOpportunityStage,
  combinedStatusForStage,
  TERMINAL_PREVIEW,
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
  reopenStageOf,
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
    updatedAt: row.updatedAt,
    closeDate: row.dueDate,
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
  const cardRef = useRef<HTMLAnchorElement | null>(null);
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
    // Ctrl, Cmd, Shift, Alt: the browser's own link behaviour (new tab, new window).
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // The library cancels the click that ends a drag; that one opens nothing.
    const endsDrag = event.defaultPrevented;
    event.preventDefault();
    if (dragging || endsDrag) return;
    // Enter on the focused link fires a click with no pointer: it opens.
    if (event.detail !== 0 && !isOpportunityCardClick(event, origin.current)) return;
    origin.current = null;
    onOpen(recordHref);
  }

  return (
    <a
      ref={(element) => {
        provided.innerRef(element);
        cardRef.current = element;
      }}
      href={recordHref}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      // The library gives the handle role="button"; the card stays a link. Its
      // lift instructions arrive as aria-describedby, so the link keeps its own name.
      role={undefined}
      className="df-opportunity-card"
      data-dragging={dragging ? "true" : "false"}
      data-pressing="false"
      data-locked={locked ? "true" : "false"}
      data-changing={card.changing ? "true" : "false"}
      aria-busy={card.changing ? true : undefined}
      data-testid={`v2-opportunity-card-${card.id}`}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <div className="df-row-title">{card.name}</div>
      {card.clientLabel ? <div className="df-opportunity-card-client">{card.clientLabel}</div> : null}
      {card.valueLabel ? <div className="df-opportunity-card-value">{card.valueLabel}</div> : null}
      {card.ownerName || card.closeLabel ? (
        <div className="df-opportunity-card-meta">
          {card.ownerName && card.ownerInitials ? (
            <span
              className="df-opportunity-card-owner"
              role="img"
              title={`Owner: ${card.ownerName}`}
              aria-label={`Owner: ${card.ownerName}`}
            >
              {card.ownerInitials}
            </span>
          ) : null}
          {card.closeLabel ? (
            <span className="df-opportunity-card-close" data-overdue={card.closeOverdue ? "true" : undefined}>
              Close {card.closeLabel}
              {card.closeOverdue ? <span className="df-sr-only"> (passed)</span> : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </a>
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
  stageOptions,
  stageDisabled,
}: {
  draft: OpportunityDraft;
  onChange: (draft: OpportunityDraft) => void;
  clients: CrmClient[];
  users: SafeUser[];
  sources: ListOption[];
  savedSource?: string | null;
  autoFocus?: boolean;
  /** The Stages the Stage select offers; omitted, the form has no Stage field. */
  stageOptions?: ListOption[];
  stageDisabled?: boolean;
}) {
  const set = (patch: Partial<OpportunityDraft>) => onChange({ ...draft, ...patch });
  return (
    <>
      <label className="df-daily-field" data-wide="true">
        Name
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
        Client
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
      {stageOptions ? (
        <label className="df-daily-field">
          Stage
          <V2FilterSelect
            label=""
            ariaLabel="Stage"
            value={draft.stage}
            options={stageOptions}
            onChange={(stage) => set({ stage })}
            disabled={stageDisabled}
          />
        </label>
      ) : null}
      <label className="df-daily-field">
        Owner
        <V2FilterSelect
          label=""
          ariaLabel="Owner"
          value={draft.ownerId || V2_SELECT_NONE}
          options={peopleOptions(users, "No Owner")}
          onChange={(value) => set({ ownerId: fromSelect(value) })}
        />
      </label>
      <label className="df-daily-field">
        Expected close
        <input
          type="date"
          value={draft.closeDate}
          onChange={(event) => set({ closeDate: event.target.value })}
          aria-label="Expected close date"
        />
      </label>
      <label className="df-daily-field">
        Source
        <V2FilterSelect
          label=""
          ariaLabel="Source"
          value={draft.source || V2_SELECT_NONE}
          options={[{ value: V2_SELECT_NONE, label: "Not set" }, ...withSavedChoice(sources, savedSource)]}
          onChange={(value) => set({ source: fromSelect(value) })}
        />
      </label>
      <label className="df-daily-field">
        Estimated value
        <input
          type="text"
          inputMode="decimal"
          value={draft.amount}
          onChange={(event) => set({ amount: event.target.value })}
          placeholder="e.g. 4 500"
          aria-label="Estimated value"
        />
      </label>
      <label className="df-daily-field">
        Currency
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
        description={`Winning ${name} makes it a Client Project. Its Estimated value stays on the Opportunity; the Project's budget is time. It cannot be moved back to an open stage afterwards.`}
        submitLabel="Mark as won"
        pending={save.isPending}
        canSubmit={Boolean(readWin.payload)}
        onSubmit={submit}
        refusal={refusal ?? readWin.issue}
        testId="v2-opportunity-win"
      >
        {!row.clientId ? (
          <label className="df-daily-field">
            Client
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
          Project type
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
            Budget hours
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
            Minutes
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
          Project manager
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
          : `Losing ${name} closes it. Say why, so the pipeline can learn from it. You can reopen it later from its record.`
      }
      submitLabel={alreadyLost ? "Save reason" : "Mark as lost"}
      pending={save.isPending}
      canSubmit={Boolean(readLost.payload)}
      onSubmit={submit}
      refusal={refusal ?? (lost.reason ? readLost.issue : null)}
      testId="v2-opportunity-lost"
    >
      <label className="df-daily-field">
        Lost reason
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
        Detail
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

function useStageHistory(opportunityId: string) {
  return useQuery<CrmProjectStageHistoryWithUser[]>({
    queryKey: ["/api/crm/projects", opportunityId, "stage-history"],
    queryFn: () => apiRequest("GET", opportunityStageHistoryPath(opportunityId)),
  });
}

/** Reopen sends a Lost Opportunity back to an open stage, which clears its Lost reason. */
function OpportunityReopenDialog({
  row,
  stages,
  defaultStage,
  onClose,
}: {
  row: CrmProjectWithDetails;
  stages: OpportunityStageOption[];
  defaultStage: string;
  onClose: () => void;
}) {
  const writes = useWorkspaceWrites();
  const [stage, setStage] = useState(defaultStage);
  const [refusal, setRefusal] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/crm/projects/${row.id}`, { status: combinedStatusForStage(stage) }),
    onSuccess: () => {
      // The record, the register and the Stage history all key from this prefix.
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      onClose();
      notify.success("Opportunity reopened");
    },
    onError: (error: Error) => setRefusal(writes.failed(error, "Reopen Opportunity")),
  });
  function submit() {
    if (writes.readOnly) {
      setRefusal(writes.refusal());
      return;
    }
    save.mutate();
  }
  return (
    <V2FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Reopen ${row.project?.name || "this Opportunity"}`}
      description="It goes back to the open stage you pick. Its Lost reason is cleared."
      submitLabel="Reopen"
      pending={save.isPending}
      canSubmit
      onSubmit={submit}
      refusal={refusal}
      testId="v2-opportunity-reopen"
    >
      <label className="df-daily-field">
        Stage
        <V2FilterSelect
          label=""
          ariaLabel="Stage"
          value={stage}
          options={stages.filter((option) => !option.terminal).map((option) => ({ value: option.id, label: option.label }))}
          onChange={setStage}
        />
      </label>
    </V2FormDialog>
  );
}

function StageHistoryCard({ opportunityId, stages }: { opportunityId: string; stages: OpportunityStageOption[] }) {
  const { data: changes = [] } = useStageHistory(opportunityId);
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
                  <span className="df-stage-pill" data-ink={row.fromInk ?? undefined} style={{ "--df-stage": row.fromColor } as CSSProperties}>{row.from}</span>
                  <span className="df-mono df-meta">→</span>
                </>
              ) : null}
              <span className="df-stage-pill" data-ink={row.toInk} style={{ "--df-stage": row.toColor } as CSSProperties}>{row.to}</span>
            </div>
            <div className="df-mono df-meta">
              {row.when} · {row.who} · held {row.held}
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
  const { user } = useAuth();
  const writes = useWorkspaceWrites();
  const [composer, setComposer] = useState<NoteComposer | null>(null);
  const [content, setContent] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const notesKey = ["/api/crm/projects", opportunityId, "notes"];
  const { data: notes = [] } = useQuery<CrmProjectNoteWithCreator[]>({
    queryKey: notesKey,
    queryFn: () => apiRequest("GET", opportunityNotesPath(opportunityId)),
  });
  const thread = composeOpportunityNotes(notes, new Date(), user?.id ?? "");

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
          {!thread.empty ? (
            <>
              <span className="df-count-chip">{thread.rows.length}</span>
              <Button variant="outline" type="button" onClick={() => open({ mode: "new" }, "")} className="df-btn">
                <Plus strokeWidth={1.6} aria-hidden />
                New Note
              </Button>
            </>
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
          {note.canChange ? (
            <div className="df-cluster">
              <Button
                variant="outline"
                type="button"
                className="df-btn"
                onClick={() => open({ mode: "edit", id: note.id }, note.content)}
                data-testid={`v2-opportunity-edit-note-${note.id}`}
              >
                <Pencil strokeWidth={1.6} aria-hidden />
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
                    <Trash2 strokeWidth={1.6} aria-hidden />
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
                      <Trash2 strokeWidth={1.6} aria-hidden />
                      Delete note
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : null}
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
          Note
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
        <OpportunityFieldInputs
          draft={draft}
          onChange={setDraft}
          clients={clients}
          users={users}
          sources={sources}
          savedSource={row.source}
          autoFocus
          stageOptions={stages.map((stage) => ({ value: stage.id, label: stage.label }))}
          stageDisabled={terminal}
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
  const [reopening, setReopening] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { data: stageChanges = [] } = useStageHistory(row.id);
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

  function onReopen() {
    if (writes.readOnly) setRefusal(writes.refusal());
    else setReopening(true);
  }

  function onOutcomeButton(kind: OpportunityOutcome) {
    if (writes.readOnly) setRefusal(writes.refusal());
    else setOutcome({ kind, row });
  }

  const stageCopy =
    record.stageId === "won"
      ? "Won: it is now a Client Project."
      : record.stageId === "lost"
        ? "Lost. The reason stays with the Opportunity until it is reopened."
        : "Won and Lost close the pipeline: winning makes it a Client Project, losing asks why. A won Opportunity stays won; a lost one can be reopened.";

  return (
    <div className="df-page" data-testid="v2-opportunity-record">
      <header className="df-dossier-head">
        <div className="df-dossier-identity df-opportunity-identity">
          <div className="df-dossier-copy">
            <h1 className="df-record-title">{record.title}</h1>
            <div className="df-dossier-provenance">
              {record.clientLabel ? (
                record.clientHref ? (
                  <Link href={record.clientHref} className="df-mono df-meta">{record.clientLabel}</Link>
                ) : (
                  <span className="df-mono df-meta">{record.clientLabel}</span>
                )
              ) : null}
            </div>
          </div>
          <div className="df-opportunity-head-side">
            <div className="df-dossier-meta">
              <span
                className="df-stage-pill"
                data-ink={record.stageInk}
                style={{ "--df-stage": record.stageColor } as CSSProperties}
              >
                {record.stage}
              </span>
            </div>
            <Button
              variant="outline"
              type="button"
              onClick={onEdit}
              disabled={editing}
              className="df-btn"
              data-testid="v2-opportunity-edit"
            >
              <Pencil strokeWidth={1.6} aria-hidden />
              Edit
            </Button>
          </div>
        </div>
      </header>
      {refusal ? <p className="df-refusal">{refusal}</p> : null}

      <div className="df-opportunity-layout">
        <div className="df-opportunity-record-column">
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

        <div className="df-opportunity-record-column">
          <section className="df-card" data-testid="v2-opportunity-stage">
            <div className="df-card-head">
              <div className="df-card-head-text">
                <h2 className="df-card-title">Stage</h2>
                <p className="df-card-sub">{stageCopy}</p>
              </div>
            </div>
            {record.stageId === "lost" ? (
              <div className="df-opportunity-outcomes">
                <Button variant="outline" type="button" className="df-btn" onClick={onReopen}>
                  Reopen
                </Button>
              </div>
            ) : null}
            {record.stageId === "won" || record.stageId === "lost" ? null : (
              <div className="df-opportunity-outcomes">
                <Button variant="default" type="button" className="df-btn" onClick={() => onOutcomeButton("won")}>
                  Mark as won
                </Button>
                <Button variant="outline" type="button" className="df-btn" onClick={() => onOutcomeButton("lost")}>
                  Mark as lost
                </Button>
              </div>
            )}
            <div className="df-settings-grid">
              {record.lostReason ? (
                <div className="df-settings-row" data-testid="v2-opportunity-lost-reason">
                  <span className="df-settings-label">Lost reason</span>
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
                  <span className="df-settings-label">Lost reason</span>
                  <span className="df-settings-value df-settings-inline">
                    <span className="df-settings-copy">Not recorded</span>
                    <Button variant="outline" type="button" className="df-btn" onClick={onLostReason}>
                      <Plus strokeWidth={1.6} aria-hidden />
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
      {reopening ? (
        <OpportunityReopenDialog
          row={row}
          stages={lists.stages}
          defaultStage={reopenStageOf(stageChanges, lists.stages)}
          onClose={() => setReopening(false)}
        />
      ) : null}
    </div>
  );
}

export function V2OpportunityRecordPage() {
  const [location] = useLocation();
  const match = matchV2Route(location);
  const opportunityId = match.kind === "opportunity-record" ? match.opportunityId : "";
  const { data: row, isLoading, isError, refetch } = useQuery<CrmProjectWithDetails | null>({
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
    const back = (
      <Button variant="outline" className="df-btn" asChild>
        <Link href="/opportunities">Back to Opportunities</Link>
      </Button>
    );
    return (
      <div className="df-page" data-testid="v2-opportunity-record">
        {isError ? (
          <V2EmptyState
            icon="opportunities"
            title="This Opportunity could not be loaded."
            copy="Something went wrong while loading it. Try again, or go back to the pipeline."
            testId="v2-opportunity-load-failed"
            action={
              <span className="df-cluster">
                <Button variant="default" type="button" className="df-btn" onClick={() => refetch()}>
                  Try again
                </Button>
                {back}
              </span>
            }
          />
        ) : (
          <V2EmptyState
            icon="opportunities"
            title="This Opportunity is not in this Workspace, or it was deleted."
            copy="Check the link, or find it on the pipeline."
            testId="v2-opportunity-missing"
            action={back}
          />
        )}
      </div>
    );
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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const { readOnly, refusal, failed } = useWorkspaceWrites();
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
    stages,
    rows: (projectsResponse?.data ?? []).map((row) => {
      const owner = row.opportunityOwnerId ? users.find((member) => member.id === row.opportunityOwnerId) : undefined;
      return { ...toPipelineRow(row), ownerName: owner ? memberName(owner) : null };
    }),
    filterQuery,
    changingId,
    expandedColumns: expanded,
    now: new Date(),
  });
  const showBoard = !isLoading && !isError && !pipeline.emptyState;
  const stacked = layout.stackedRegister;

  // Edge fades: the board says which side still has columns beyond the window.
  useEffect(() => {
    const element = pipelineRef.current;
    if (!element) return;
    const update = () => {
      const more = !stacked && element.scrollWidth > element.clientWidth + 1;
      element.setAttribute("data-more-left", more && element.scrollLeft > 1 ? "true" : "false");
      element.setAttribute(
        "data-more-right",
        more && element.scrollLeft + element.clientWidth < element.scrollWidth - 1 ? "true" : "false",
      );
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [showBoard, stacked, pipeline.columns.length]);

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
    mutationFn: ({ id, status }: { id: string; status: string; previous: string; undo?: boolean }) =>
      apiRequest("PATCH", `/api/crm/projects/${id}`, { status }),
    onSuccess: (_result, { id, status, previous, undo }) => {
      const labelOf = (combined: string) => {
        const stage = opportunityStageFromCombined(combined);
        return stages.find((option) => option.id === stage)?.label ?? stage;
      };
      const toastId = `opportunity-stage-${id}`;
      if (undo) {
        // Its own id: the Undo toast is still being dismissed and would swallow an update.
        notify.success(`Moved back to ${labelOf(status)}`, { id: `${toastId}-undone` });
        return;
      }
      notify.success(`Moved to ${labelOf(status)}`, {
        id: toastId,
        duration: 8000,
        action: { label: "Undo", onClick: () => changeStage.mutate({ id, status: previous, previous: status, undo: true }) },
      });
    },
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

  function startCreate() {
    setDraft(newOpportunityDraft(user?.id ?? ""));
    setWriteRefusal(null);
    setCreating(true);
  }

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
      previous: row.status,
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
      <V2PageSkeleton title="Opportunities" hasSubhead={false} testId="v2-opportunities" status="Loading Opportunities for this Workspace.">
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
        </div>
        {pipeline.emptyState?.kind !== "none" ? (
          <div className="df-library-actions">
            <label className="df-filter-input">
              <Search width={14} height={14} strokeWidth={1.4} style={{ color: "var(--df-archive-slate)" }} />
              <input
                type="search"
                value={filterQuery}
                onChange={(event) => setFilterQuery(event.target.value)}
                placeholder="Search Opportunities"
                aria-label="Search Opportunities"
              />
            </label>
            {readOnly ? null : (
              <Button
                variant="default"
                type="button"
                onClick={startCreate}
                className="df-btn"
              >
                <Plus strokeWidth={1.6} aria-hidden />
                New Opportunity
              </Button>
            )}
          </div>
        ) : null}
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
            stageOptions={openStages.map((stage) => ({ value: stage.id, label: stage.label }))}
          />
          <label className="df-daily-field" data-wide="true">
            First note
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

      {pipeline.emptyState ? (
        <V2RecordEmpty
          model={pipeline.emptyState}
          icon="opportunities"
          action={
            readOnly ? undefined : (
              <Button variant="default" type="button" className="df-btn" onClick={startCreate}>
                <Plus strokeWidth={1.6} aria-hidden />
                New Opportunity
              </Button>
            )
          }
          onClear={() => setFilterQuery("")}
          testIds={{ none: "v2-opportunities-empty" }}
        />
      ) : null}

      {/* The empty Workspace and an unmatched search each show their empty line alone. */}
      {pipeline.emptyState?.kind === "none" || pipeline.emptyState?.kind === "filtered" ? null : (
      <>
      <DragDropContext
        onDragStart={() => pipelineRef.current?.setAttribute("data-dragging", "true")}
        onDragEnd={handleDragEnd}
      >
        <div
          ref={pipelineRef}
          className="df-opportunity-pipeline"
          data-stacked={stacked ? "true" : "false"}
          data-more-left="false"
          data-more-right="false"
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
                <span className="df-count-chip">{column.total}</span>
              </div>
              <Droppable
                droppableId={column.id}
                isDropDisabled={column.locked}
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
                    {column.hiddenCount > 0 || (expanded.has(column.id) && column.total > TERMINAL_PREVIEW) ? (
                      <Button
                        variant="ghost"
                        type="button"
                        size="sm"
                        className="df-opportunity-more"
                        onClick={() =>
                          setExpanded((current) => {
                            const next = new Set(current);
                            if (next.has(column.id)) next.delete(column.id);
                            else next.add(column.id);
                            return next;
                          })
                        }
                      >
                        {column.hiddenCount > 0 ? `Show all ${column.total}` : "Show fewer"}
                      </Button>
                    ) : null}
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
      </>
      )}

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
