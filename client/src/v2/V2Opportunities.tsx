import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent } from "react";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvided,
  type DropResult,
} from "@hello-pangea/dnd";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { CrmClient, CrmProjectWithDetails, SafeUser } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { motionForSurface } from "./motion";
import { memberName } from "./today";
import { useV2Chrome } from "./V2Shell";
import {
  canChangeOpportunityStage,
  combinedStatusForStage,
  composeOpportunityPipeline,
  composeOpportunityStages,
  opportunityWriteRefusal,
  stageOptionsFromFieldOptions,
  type OpportunityCard,
  type OpportunityPipelineRowInput,
} from "./opportunities";

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
  };
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
  const href = card.projectHref;

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
    if (!href || dragging) return;
    if (!isOpportunityCardClick(event, origin.current)) return;
    origin.current = null;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    onOpen(href);
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
      data-href={href ?? undefined}
      data-testid={`v2-opportunity-card-${card.id}`}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <div className="df-row-title">{card.name}</div>
      {card.clientLabel ? <div className="df-opportunity-card-client">{card.clientLabel}</div> : null}
    </article>
  );
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
  const { layout, memberships } = useV2Chrome();
  const [, setLocation] = useLocation();
  const [filterQuery, setFilterQuery] = useState("");
  const [changingId, setChangingId] = useState<string | null>(null);
  const pipelineRef = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);

  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";

  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const owner = users.find((member) => member.isMainAdmin === 1);
  const ownerName = owner ? memberName(owner) : null;

  const { data: fields = [] } = useQuery<ModuleField[]>({
    queryKey: ["/api/modules/projects/fields"],
  });
  const { data: clients = [] } = useQuery<CrmClient[]>({
    queryKey: ["/api/crm/clients"],
  });
  const { data: projectsResponse, isLoading, isError } = useQuery<OpportunityRowsResponse>({
    queryKey: ["/api/crm/projects", "register"],
    queryFn: loadOpportunityRows,
  });

  const statusField = fields.find((field) => field.slug === "status");
  const stages = useMemo(
    () => composeOpportunityStages(stageOptionsFromFieldOptions(statusField?.options)),
    [statusField],
  );

  const pipeline = composeOpportunityPipeline({
    workspaceName,
    stages,
    rows: (projectsResponse?.data ?? []).map(toPipelineRow),
    filterQuery,
    changingId,
  });

  const createOpportunity = useMutation({
    mutationFn: (input: { name: string; clientId: string | null }) =>
      apiRequest("POST", "/api/crm/projects", {
        name: input.name,
        clientId: input.clientId,
        status: "lead",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      setName("");
      setClientId("");
      setCreating(false);
      setWriteRefusal(null);
    },
    onError: (error: Error) => {
      setWriteRefusal(
        opportunityWriteRefusal({
          readOnly,
          workspaceName,
          errorMessage: error.message,
          ownerName,
        }),
      );
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
      setWriteRefusal(
        opportunityWriteRefusal({
          readOnly,
          workspaceName,
          errorMessage: error.message,
          ownerName,
          capability: "Change Opportunity Stage",
        }),
      );
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      window.setTimeout(() => setChangingId(null), 180);
    },
  });

  function onCreate(event: FormEvent) {
    event.preventDefault();
    const opportunityName = name.trim();
    if (!opportunityName) return;
    if (readOnly) {
      setWriteRefusal(opportunityWriteRefusal({ readOnly: true, workspaceName }));
      return;
    }
    createOpportunity.mutate({ name: opportunityName, clientId: clientId || null });
  }

  function onStageChange(row: CrmProjectWithDetails, fromStage: string, nextStage: string) {
    if (!canChangeOpportunityStage(fromStage, nextStage)) return;
    if (readOnly) {
      setWriteRefusal(opportunityWriteRefusal({ readOnly: true, workspaceName }));
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
      <div className="df-page" data-testid="v2-opportunities">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Opportunities</h1>
            <p className="df-subhead">Loading this Workspace…</p>
          </div>
        </header>
        <div className="df-card" style={{ minHeight: 280 }} />
      </div>
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
          <button type="button" className="df-ink-btn" onClick={() => setCreating((open) => !open)}>
            New Opportunity
          </button>
        </div>
      </header>

      {creating ? (
        <form className="df-filter-bar df-opportunities-filter" onSubmit={onCreate}>
          <label className="df-filter-input">
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Opportunity name"
              aria-label="Opportunity name"
            />
          </label>
          <label className="df-filter-chip">
            CLIENT
            <select
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              aria-label="Client"
            >
              <option value="">NONE</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="df-ink-btn" disabled={createOpportunity.isPending || !name.trim()}>
            Create
          </button>
        </form>
      ) : null}
      {writeRefusal ? <p className="df-refusal">{writeRefusal}</p> : null}

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
            >
              <div className="df-card-head">
                <h2 className="df-card-title">{column.label}</h2>
                <span className="df-count-chip">{column.cards.length}</span>
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
    </div>
  );
}
