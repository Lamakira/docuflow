import { useMemo, useState, type FormEvent } from "react";
import { Link } from "wouter";
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

export function V2OpportunitiesPage() {
  const { layout, memberships } = useV2Chrome();
  const [filterQuery, setFilterQuery] = useState("");
  const [changingId, setChangingId] = useState<string | null>(null);
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
    onMutate: async ({ id }) => {
      setChangingId(id);
      setWriteRefusal(null);
    },
    onError: (error: Error) => {
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

      <div
        className="df-opportunity-pipeline"
        data-stacked={layout.stackedRegister ? "true" : "false"}
        data-testid="v2-opportunities-pipeline"
      >
        {pipeline.columns.map((column) => (
          <section key={column.id} className="df-card df-opportunity-column" data-terminal={column.terminal ? "true" : "false"}>
            <div className="df-card-head">
              <h2 className="df-card-title">{column.label}</h2>
              <span className="df-count-chip">{column.cards.length}</span>
            </div>
            {column.cards.length === 0 ? (
              pipeline.empty ? null : <p className="df-empty">None in this stage.</p>
            ) : (
              column.cards.map((card) => {
                const row = rowsById.get(card.id);
                const stageMotion = card.changing ? STAGE_CHANGE_MOTION : "none";
                return (
                  <article
                    key={card.id}
                    className="df-opportunity-card"
                    data-testid={`v2-opportunity-card-${card.id}`}
                  >
                    {card.projectHref ? (
                      <Link href={card.projectHref} className="df-row-title">
                        {card.name}
                      </Link>
                    ) : (
                      <div className="df-row-title">{card.name}</div>
                    )}
                    <div className="df-meta">{card.clientLabel}</div>
                    {card.canChangeStage ? (
                      <select
                        className="df-opportunity-stage"
                        data-status={card.stage}
                        data-motion={stageMotion}
                        value={card.stage}
                        aria-label="Opportunity Stage"
                        disabled={changeStage.isPending && changingId === card.id}
                        onChange={(event) => row && onStageChange(row, card.stage, event.target.value)}
                      >
                        {pipeline.columns.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className="df-opportunity-stage"
                        data-status={card.stage}
                        data-motion={stageMotion}
                      >
                        {card.stageLabel}
                      </span>
                    )}
                  </article>
                );
              })
            )}
          </section>
        ))}
      </div>

      <div className="df-library-foot">
        {pipeline.count} {pipeline.count === 1 ? "Opportunity" : "Opportunities"}
      </div>
    </div>
  );
}
