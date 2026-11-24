import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { chromeRefusal } from "./chrome";
import { isStandingRefusal, notify } from "./notify";
import { linkConsequence } from "./projectDocumentation";
import { V2FormDialog } from "./V2FormDialog";
import { V2ProjectPicker } from "./V2ProjectPicker";

type LinkTarget = { id: string; name: string; clientName: string | null };

const TARGETS_PAGE_SIZE = 500;

/** Every delivery Project the reader may see; the server leaves sales and documentation-only Projects out. */
async function loadLinkTargets(): Promise<LinkTarget[]> {
  const targets: LinkTarget[] = [];
  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams({
      scope: "visible",
      kind: "delivery",
      page: String(page),
      pageSize: String(TARGETS_PAGE_SIZE),
    });
    const body = (await apiRequest("GET", `/api/crm/projects?${params.toString()}`)) as {
      data: Array<{ id: string; project?: { name: string } | null; client?: { name: string } | null }>;
      total: number;
    };
    for (const row of body.data) {
      targets.push({ id: row.id, name: row.project?.name || "Untitled Project", clientName: row.client?.name ?? null });
    }
    if (body.data.length === 0 || page * TARGETS_PAGE_SIZE >= body.total) break;
  }
  return targets.sort((a, b) => a.name.localeCompare(b.name));
}

/** Both Projects' records, Documents, and Files, and every list that names them. Files are cached under one path string each. */
function staleProjects() {
  queryClient.invalidateQueries({ queryKey: ["/api/projects/documentable"] });
  queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
  queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
  queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
  queryClient.invalidateQueries({
    predicate: (query) => {
      const path = query.queryKey[0];
      return typeof path === "string" && (path.startsWith("/api/projects/") || path.startsWith("/api/crm/projects/"));
    },
  });
}

/**
 * Moves a documentation-only Project's Documents and Files to a delivery
 * Project. The caller renders the trigger for an Owner or Administrator only;
 * the route refuses everyone else.
 */
export function V2LinkDocumentationDialog({
  open,
  onOpenChange,
  source,
  readOnlyRefusal,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: { crmProjectId: string; name: string; documents: number; files: number };
  readOnlyRefusal?: string | null;
  onLinked?: (targetCrmId: string) => void;
}) {
  const [targetId, setTargetId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTargetId(null);
    setRefusal(null);
  }, [open, source.crmProjectId]);

  const { data = [], isError, isLoading } = useQuery<LinkTarget[]>({
    queryKey: ["/api/crm/projects", "link-targets"],
    queryFn: loadLinkTargets,
    enabled: open,
    staleTime: 0,
  });
  useEffect(() => {
    if (open && isError) notify.error(null, { fallback: "The Projects could not be loaded.", id: "v2-link-targets" });
  }, [open, isError]);

  const targets = data.filter((project) => project.id !== source.crmProjectId);
  const target = targets.find((project) => project.id === targetId) ?? null;

  const link = useMutation({
    mutationFn: (chosen: LinkTarget) =>
      apiRequest("POST", `/api/crm/projects/${encodeURIComponent(source.crmProjectId)}/link-documentation`, {
        targetId: chosen.id,
      }),
    onSuccess: (_result, chosen) => {
      staleProjects();
      notify.success(`Documents moved to ${chosen.name}`);
      onOpenChange(false);
      onLinked?.(chosen.id);
    },
    onError: (error: Error) => {
      if (!isStandingRefusal(error)) return notify.error(error);
      setRefusal(chromeRefusal({ kind: "generic", message: error.message }));
    },
  });

  function onSubmit() {
    if (!target) return;
    if (readOnlyRefusal) {
      setRefusal(readOnlyRefusal);
      return;
    }
    link.mutate(target);
  }

  return (
    <V2FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && link.isPending) return;
        onOpenChange(next);
      }}
      title="Link to a Project"
      description={`Choose the Project that takes the Documents and Files in ${source.name}.`}
      submitLabel="Move documents"
      pending={link.isPending}
      canSubmit={Boolean(target)}
      onSubmit={onSubmit}
      refusal={refusal}
      testId="v2-link-documentation"
    >
      <div className="df-daily-field">
        Project
        {/* Modal, or the Dialog's scroll lock keeps the wheel from the list. */}
        <V2ProjectPicker
          modal
          options={targets.map((project) => ({ id: project.id, label: project.name, meta: project.clientName }))}
          value={target?.id ?? ""}
          onChange={(id) => {
            setTargetId(id);
            setRefusal(null);
          }}
          state={isLoading ? "loading" : isError ? "failed" : "ready"}
          testId="v2-link-documentation-target"
        />
      </div>
      {target ? (
        <p className="df-prose" data-testid="v2-link-documentation-consequence">
          {linkConsequence({ name: source.name, documents: source.documents, files: source.files, target: target.name })}
        </p>
      ) : null}
    </V2FormDialog>
  );
}
