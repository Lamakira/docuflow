import { useQuery } from "@tanstack/react-query";
import type { CrmClient, CrmProjectWithDetails } from "@shared/schema";
import {
  documentOwnerKey,
  documentQueryKey,
  isSaleDocumentOwner,
  loadDocument,
  loadDocumentOwner,
  type DocumentOwner,
  type LoadedDocument,
} from "./documentEditor";
import { matchV2Route, type V2RecordRoot } from "./presentation";
/**
 * Where the open record files when its path cannot say (F60, F61). Reads what
 * the record's page loaded; runs nothing itself.
 */
export function useRecordRoot(location: string): V2RecordRoot | null {
  const route = matchV2Route(location);
  const dossierId = route.kind === "dossier" ? route.projectId : "";
  const documentId = route.kind === "document-editor" && route.source === "project" ? route.documentId : "";
  const { data: project } = useQuery<CrmProjectWithDetails | null>({
    queryKey: ["/api/crm/projects", dossierId],
    enabled: false,
  });
  const { data: document } = useQuery<LoadedDocument>({
    queryKey: documentQueryKey("project", documentId),
    queryFn: () => loadDocument("project", documentId),
    enabled: false,
  });
  const ownedProjectId = document?.record?.projectId ?? "";
  const { data: owner } = useQuery<DocumentOwner | null>({
    queryKey: documentOwnerKey(ownedProjectId),
    queryFn: () => loadDocumentOwner(ownedProjectId),
    enabled: false,
  });
  if (project?.isDocumentationOnly) return "project-documentation";
  return isSaleDocumentOwner(owner) ? "opportunities" : null;
}

/**
 * The open record's name, for the breadcrumb and the browser tab. The record's
 * page fills these cache entries; this only reads them (enabled: false) and
 * re-renders when the data lands.
 */
export function useRecordLabel(location: string): string | undefined {
  const route = matchV2Route(location);
  const opportunityId = route.kind === "opportunity-record" ? route.opportunityId : "";
  const projectId = route.kind === "dossier" ? route.projectId : "";
  const clientId = route.kind === "client-record" ? route.clientId : "";
  const { data: opportunityRecord } = useQuery<CrmProjectWithDetails | null>({
    queryKey: ["/api/crm/projects", opportunityId],
    enabled: false,
  });
  const { data: projectRecord } = useQuery<CrmProjectWithDetails | null>({
    queryKey: ["/api/crm/projects", projectId],
    enabled: false,
  });
  const { data: clientRecord } = useQuery<CrmClient | null>({
    queryKey: ["/api/crm/clients", clientId],
    enabled: false,
  });
  const documentId = route.kind === "document-editor" && route.source === "workspace" ? route.documentId : "";
  const { data: documentRecord } = useQuery<LoadedDocument>({
    queryKey: documentQueryKey("workspace", documentId),
    // Never run from here, but an observer's options become its query's: the default
    // queryFn would answer the editor's own refetches with a URL that does not exist.
    queryFn: () => loadDocument("workspace", documentId),
    enabled: false,
  });
  const projectDocumentId = route.kind === "document-editor" && route.source === "project" ? route.documentId : "";
  const { data: projectDocumentRecord } = useQuery<LoadedDocument>({
    queryKey: documentQueryKey("project", projectDocumentId),
    queryFn: () => loadDocument("project", projectDocumentId),
    enabled: false,
  });
  return route.kind === "opportunity-record"
    ? opportunityRecord?.project?.name?.trim() || undefined
    : route.kind === "dossier"
      ? projectRecord?.project?.name?.trim() || undefined
      : route.kind === "client-record"
        ? clientRecord?.name?.trim() || undefined
        : route.kind === "document-editor"
          ? (documentRecord ?? projectDocumentRecord)?.record?.name?.trim() || undefined
          : undefined;
}
