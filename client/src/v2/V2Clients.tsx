import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link, Redirect, useLocation, useSearch } from "wouter";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { createColumnHelper, rowSortingFeature, tableFeatures, useTable, type SortingState } from "@tanstack/react-table";
import type { CrmClient, CrmContact, CrmProjectWithDetails } from "@shared/schema";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  clearClientFilters,
  clientFilterLabels,
  clientHref,
  clientRegisterPath,
  clientWriteRefusal,
  composeClientRecord,
  composeClientRegister,
  readClientFilters,
  writeClientFilters,
  CLIENT_OPEN_OPTIONS,
  CLIENT_SORTS,
  CLIENT_SOURCE_OPTIONS,
  CLIENT_STATUS_OPTIONS,
  type ClientRegisterFilters,
  type ClientRegisterRow,
  type ClientRegisterRowInput,
  type ClientSort,
} from "./clients";
import { composePaging } from "./paging";
import { motionForSurface } from "./motion";
import { swatchStyle } from "./palette";
import { matchV2Route } from "./presentation";
import { useWorkspaceOwnerName } from "./useWorkspaceOwner";
import { useV2Chrome } from "./V2Shell";
import { V2FormDialog } from "./V2FormDialog";
import { V2FilterSelect } from "./V2Select";
import { V2RegisterPager } from "./V2RegisterPager";
import { Button } from "@/components/ui/button";
import { SkeletonRegister, SkeletonSection, V2PageSkeleton } from "./V2Skeleton";

type ClientWithContacts = CrmClient & { contacts?: CrmContact[] };
type ProjectsResponse = { data: CrmProjectWithDetails[]; total?: number };
type ClientPage = { data: Array<CrmClient & { projectCount: number }>; total: number };

const RECORD_MOTION = motionForSurface("client-register-record").enterExit;
const SEARCH_SETTLE_MS = 250;

async function loadClientPage(path: string): Promise<ClientPage> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch Clients");
  return res.json();
}

/** The register row a record was opened from, so its identity shows before the record loads. */
function registerSeed(clientId: string): CrmClient | undefined {
  for (const [, page] of queryClient.getQueriesData<ClientPage>({ queryKey: ["/api/crm/clients", "register-page"] })) {
    const row = page?.data.find((client) => client.id === clientId);
    if (row) return row;
  }
  return undefined;
}

async function loadProjects(): Promise<ProjectsResponse> {
  const pageSize = 200;
  const rows: CrmProjectWithDetails[] = [];
  let page = 1;
  let total = 0;

  for (;;) {
    const res = await fetch(`/api/crm/projects?page=${page}&pageSize=${pageSize}`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to fetch Projects");
    const body = (await res.json()) as ProjectsResponse;
    const batch = body.data ?? [];
    total = body.total ?? rows.length + batch.length;
    rows.push(...batch);
    if (rows.length >= total || batch.length === 0) break;
    page += 1;
  }

  return { data: rows, total };
}

function toRegisterClient(client: CrmClient & { projectCount: number }): ClientRegisterRowInput {
  return {
    id: client.id,
    name: client.name,
    company: client.company,
    status: client.status,
    source: client.source,
    projectCount: client.projectCount,
  };
}

const clientTableFeatures = tableFeatures({ rowSortingFeature });
const clientColumn = createColumnHelper<typeof clientTableFeatures, ClientRegisterRow>();

function isClientSort(id: string): id is ClientSort {
  return (CLIENT_SORTS as readonly string[]).includes(id);
}

/**
 * The desktop register (#275), drawn like the Projects one: TanStack Table
 * holds the columns and the sort state, the server holds the order.
 */
function ClientRegisterTable({
  rows,
  sort,
  dir,
  onSort,
  onOpen,
}: {
  rows: ClientRegisterRow[];
  sort: ClientSort | "";
  dir: "asc" | "desc";
  onSort: (sort: ClientSort | "", dir: "asc" | "desc") => void;
  onOpen: (row: ClientRegisterRow) => void;
}) {
  const sorting: SortingState = sort ? [{ id: sort, desc: dir === "desc" }] : [];
  const columns = useMemo(
    () =>
      clientColumn.columns([
        clientColumn.accessor("name", {
          header: "CLIENT",
          cell: ({ row }) => (
            <Link
              href={row.original.href}
              className="df-row-title df-row-link"
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}
            >
              {row.original.name}
            </Link>
          ),
        }),
        clientColumn.accessor("company", {
          header: "COMPANY",
          cell: ({ row }) => <span style={{ fontWeight: 500, fontSize: 13.5 }}>{row.original.company}</span>,
        }),
        clientColumn.accessor("status", {
          header: "STATUS",
          cell: ({ row }) => (
            <span className="df-status-word" data-swatch="" style={swatchStyle(row.original.statusColor)}>{row.original.status}</span>
          ),
        }),
        clientColumn.accessor("source", {
          header: "SOURCE",
          cell: ({ row }) => <span className="df-mono df-meta">{row.original.source}</span>,
        }),
        clientColumn.accessor("projectCount", {
          id: "projects",
          header: "PROJECTS",
          cell: ({ row }) => <span className="df-mono" style={{ fontSize: 12 }}>{row.original.projectCount}</span>,
        }),
      ]),
    [],
  );

  const table = useTable({
    features: clientTableFeatures,
    columns,
    data: rows,
    manualSorting: true,
    enableMultiSort: false,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      if (first && isClientSort(first.id)) onSort(first.id, first.desc ? "desc" : "asc");
      else onSort("", "asc");
    },
  });

  function onRowClick(event: MouseEvent<HTMLTableRowElement>, row: ClientRegisterRow) {
    if ((event.target as HTMLElement).closest("a, button")) return;
    if (event.metaKey || event.ctrlKey) {
      window.open(row.href, "_blank", "noopener,noreferrer");
      return;
    }
    onOpen(row);
  }

  return (
    <Table className="df-table" data-testid="v2-clients-table">
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="df-table-head-row">
            {group.headers.map((header) => {
              const direction = header.column.getIsSorted();
              return (
                <TableHead
                  key={header.id}
                  className="df-table-head"
                  data-column={header.column.id}
                  aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined}
                >
                  {header.isPlaceholder ? null : (
                    <button
                      type="button"
                      className="df-table-sort"
                      data-sorted={direction || "none"}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <table.FlexRender header={header} />
                      <span aria-hidden="true">
                        {direction === "asc" ? "↑" : direction === "desc" ? "↓" : ""}
                      </span>
                    </button>
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
            data-selected={row.original.selected ? "true" : "false"}
            data-testid={`v2-client-row-${row.original.id}`}
            onClick={(event) => onRowClick(event, row.original)}
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

export function V2ClientRecordRedirect() {
  const [location] = useLocation();
  const match = matchV2Route(location);
  if (match.kind === "client-record") return <Redirect to={clientHref(match.clientId)} />;
  return <Redirect to="/clients" />;
}

const CLIENT_SOURCES = [
  { id: "none", label: "NONE" },
  { id: "direct", label: "DIRECT" },
  { id: "zoho", label: "ZOHO" },
  { id: "fiverr", label: "FIVERR" },
] as const;

export function V2ClientsPage() {
  const { layout, memberships } = useV2Chrome();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const filters = readClientFilters(search);
  const [filterQuery, setFilterQuery] = useState(filters.q);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(
    () => new URLSearchParams(window.location.search).get("new") === "1",
  );
  const [name, setName] = useState("");
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);

  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";

  const ownerName = useWorkspaceOwnerName();

  function setFilters(next: ClientRegisterFilters) {
    setLocation(`/clients${writeClientFilters(search, next)}`, { replace: true });
  }

  // The search box answers each keystroke; the URL, and so the server page,
  // follows once typing settles.
  useEffect(() => {
    if (filterQuery === filters.q) return;
    const timer = window.setTimeout(() => setFilters({ ...filters, q: filterQuery, page: 1 }), SEARCH_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [filterQuery]);

  const registerPath = clientRegisterPath(filters);
  const { data: clientPage, isLoading, isError } = useQuery<ClientPage>({
    queryKey: ["/api/crm/clients", "register-page", registerPath],
    placeholderData: keepPreviousData,
    queryFn: () => loadClientPage(registerPath),
  });
  const paging = composePaging({
    page: filters.page,
    pageSize: filters.pageSize,
    total: clientPage?.total ?? 0,
    noun: { one: "CLIENT", many: "CLIENTS" },
  });

  // A shared link past the last page lands on the last one instead of nothing.
  useEffect(() => {
    if (!clientPage || filters.page <= paging.pageCount) return;
    setFilters({ ...filters, page: paging.pageCount });
  }, [clientPage, filters.page, paging.pageCount]);

  // The server already narrowed these rows; the composer only names what did it.
  const register = composeClientRegister({
    workspaceName,
    clients: (clientPage?.data ?? []).map(toRegisterClient),
    filterQuery: "",
    activeFilters: clientFilterLabels(filters),
    selectedId,
  });

  const createClient = useMutation({
    mutationFn: (clientName: string) => apiRequest("POST", "/api/crm/clients", { name: clientName }),
    onSuccess: (created: { id?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/clients"] });
      setName("");
      setCreating(false);
      setWriteRefusal(null);
      if (created?.id) {
        setSelectedId(created.id);
        setLocation(clientHref(created.id));
      }
    },
    onError: (error: Error) => {
      setWriteRefusal(
        clientWriteRefusal({
          readOnly,
          workspaceName,
          errorMessage: error.message,
          ownerName,
        }),
      );
    },
  });

  function onCreate() {
    const clientName = name.trim();
    if (!clientName) return;
    if (readOnly) {
      setWriteRefusal(clientWriteRefusal({ readOnly: true, workspaceName }));
      return;
    }
    createClient.mutate(clientName);
  }

  if (isLoading) {
    return (
      <V2PageSkeleton title="Clients" testId="v2-clients" status="Loading Clients for this Workspace.">
        <SkeletonRegister
          className="df-clients-register"
          heads={["CLIENT", "COMPANY", "STATUS", "SOURCE", "PROJECTS"]}
        />
      </V2PageSkeleton>
    );
  }

  if (isError) {
    return (
      <div className="df-page" data-testid="v2-clients">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Clients</h1>
            <p className="df-subhead">{register.subhead}</p>
          </div>
        </header>
        <p className="df-empty">Clients in this Workspace could not be loaded.</p>
      </div>
    );
  }

  return (
    <div className="df-page" data-testid="v2-clients">
      <header className="df-today-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="df-title">Clients</h1>
          <p className="df-subhead">{register.subhead}</p>
        </div>
        <div className="df-library-actions">
          <Button
            variant="default"
            type="button"
            onClick={() => {
              setWriteRefusal(null);
              setCreating(true);
            }}
            className="df-btn"
          >
            New Client
          </Button>
        </div>
      </header>

      <V2FormDialog
        open={creating}
        onOpenChange={setCreating}
        title="New Client"
        description="A Client is who the Projects are delivered for. Company, contacts and source are set on its record."
        submitLabel="Create Client"
        pending={createClient.isPending}
        canSubmit={Boolean(name.trim())}
        onSubmit={onCreate}
        refusal={writeRefusal}
        testId="v2-clients-new"
      >
        <label className="df-daily-field">
          NAME
          <input
            type="text"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            placeholder="Client name"
            aria-label="Client name"
          />
        </label>
      </V2FormDialog>
      {writeRefusal && !creating ? <p className="df-refusal">{writeRefusal}</p> : null}

      <div className="df-filter-bar df-clients-filter">
        <label className="df-filter-input">
          <input
            type="search"
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder="Filter Clients"
            aria-label="Filter Clients"
          />
        </label>
        <V2FilterSelect
          label="STATUS"
          ariaLabel="Filter by Client status"
          value={filters.status}
          active={filters.status !== "all"}
          options={[{ value: "all", label: "ALL" }, ...CLIENT_STATUS_OPTIONS]}
          onChange={(status) => setFilters({ ...filters, status, page: 1 })}
        />
        <V2FilterSelect
          label="SOURCE"
          ariaLabel="Filter by source"
          value={filters.source}
          active={filters.source !== "all"}
          options={[{ value: "all", label: "ALL" }, ...CLIENT_SOURCE_OPTIONS]}
          onChange={(source) => setFilters({ ...filters, source, page: 1 })}
        />
        <V2FilterSelect
          label="OPEN PROJECTS"
          ariaLabel="Filter by open Projects"
          value={filters.open}
          active={filters.open !== "all"}
          options={[{ value: "all", label: "ANY" }, ...CLIENT_OPEN_OPTIONS]}
          onChange={(open) => setFilters({ ...filters, open, page: 1 })}
        />
      </div>

      <section className="df-card df-clients-register" data-testid="v2-clients-register">
        {register.empty ? (
          <div className="df-empty-state">
            <p className="df-empty">{register.emptyCopy}</p>
            {register.filtered ? (
              <Button
                variant="outline"
                type="button"
                className="df-btn"
                onClick={() => {
                  setFilterQuery("");
                  setFilters(clearClientFilters(filters));
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : layout.stackedRegister ? (
          register.rows.map((row) => (
            <Link
              key={row.id}
              href={row.href}
              className="df-register-row"
              data-selected={row.selected ? "true" : "false"}
              data-testid={`v2-client-row-${row.id}`}
              onPointerDown={() => setSelectedId(row.id)}
              onClick={() => setSelectedId(row.id)}
            >
              <span className="df-project-mobile">
                <span style={{ minWidth: 0, flex: 1 }}>
                  <div className="df-row-title">{row.name}</div>
                  <div className="df-mono df-meta">
                    {row.company} · {row.status}
                  </div>
                </span>
              </span>
            </Link>
          ))
        ) : (
          <ClientRegisterTable
            rows={register.rows}
            sort={filters.sort}
            dir={filters.dir}
            onSort={(sort, dir) => setFilters({ ...filters, sort, dir, page: 1 })}
            onOpen={(row) => {
              setSelectedId(row.id);
              setLocation(row.href);
            }}
          />
        )}
        <V2RegisterPager
          paging={paging}
          ariaLabel="Clients pages"
          onPage={(page) => setFilters({ ...filters, page })}
          onPageSize={(pageSize) => setFilters({ ...filters, pageSize, page: 1 })}
        />
      </section>
    </div>
  );
}

export function V2ClientRecordPage() {
  const { layout, memberships, showToast } = useV2Chrome();
  const [location] = useLocation();
  const match = matchV2Route(location);
  const clientId = match.kind === "client-record" ? match.clientId : "";
  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";
  const [editing, setEditing] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [draft, setDraft] = useState({ email: "", phone: "", company: "", notes: "", source: "", fiverrUsername: "" });
  const [contactDraft, setContactDraft] = useState({ name: "", role: "", email: "", phone: "", isPrimary: false });
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);

  const seed = registerSeed(clientId);

  const { data: client, isLoading, isError } = useQuery<ClientWithContacts | null>({
    queryKey: ["/api/crm/clients", clientId],
    enabled: Boolean(clientId),
    queryFn: async () => {
      const res = await fetch(`/api/crm/clients/${clientId}`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch Client");
      return res.json();
    },
  });
  const { data: projectsResponse } = useQuery<ProjectsResponse>({
    queryKey: ["/api/crm/projects", "register"],
    enabled: Boolean(clientId),
    queryFn: loadProjects,
  });

  const linkedProjects = useMemo(
    () =>
      (projectsResponse?.data ?? []).filter(
        (project) => (project.clientId ?? project.client?.id) === clientId,
      ),
    [projectsResponse, clientId],
  );

  useEffect(() => {
    if (!client) return;
    setDraft({
      email: client.email ?? "",
      phone: client.phone ?? "",
      company: client.company ?? "",
      notes: client.notes ?? "",
      source: client.source ?? "",
      fiverrUsername: client.fiverrUsername ?? "",
    });
  }, [client]);

  function refuse(error?: Error) {
    setWriteRefusal(clientWriteRefusal({ readOnly, workspaceName, errorMessage: error?.message }));
  }

  const updateClient = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/crm/clients/${clientId}`, {
      email: draft.email || null,
      phone: draft.phone || null,
      company: draft.company || null,
      notes: draft.notes || null,
      source: draft.source || null,
      fiverrUsername: draft.source === "fiverr" ? draft.fiverrUsername || null : null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/clients", clientId] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/clients"] });
      setEditing(false);
      setWriteRefusal(null);
      showToast("Client saved.");
    },
    onError: (error: Error) => refuse(error),
  });

  const createContact = useMutation({
    mutationFn: () => apiRequest("POST", `/api/crm/clients/${clientId}/contacts`, {
      name: contactDraft.name.trim(),
      role: contactDraft.role || null,
      email: contactDraft.email || null,
      phone: contactDraft.phone || null,
      isPrimary: contactDraft.isPrimary ? 1 : 0,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/clients", clientId] });
      setContactDraft({ name: "", role: "", email: "", phone: "", isPrimary: false });
      setAddingContact(false);
      setWriteRefusal(null);
    },
    onError: (error: Error) => refuse(error),
  });

  const record = composeClientRecord({
    client: client
      ? {
          id: client.id,
          name: client.name,
          company: client.company,
          email: client.email,
          phone: client.phone,
          phoneFormat: client.phoneFormat,
          status: client.status,
          source: client.source,
          fiverrUsername: client.fiverrUsername,
          notes: client.notes,
          contacts: (client.contacts ?? []).map((contact) => ({
            id: contact.id,
            name: contact.name,
            role: contact.role ?? null,
            email: contact.email ?? null,
            phone: contact.phone ?? null,
            isPrimary: contact.isPrimary ?? 0,
          })),
        }
      : null,
    seed: seed
      ? {
          name: seed.name,
          company: seed.company,
          status: seed.status,
          source: seed.source,
          email: seed.email,
        }
      : null,
    pending: isLoading,
    loadFailed: isError,
    projects: linkedProjects.map((project) => ({
      id: project.id,
      name: project.project?.name || "Untitled Project",
      projectStatus: project.projectStatus,
    })),
  });

  if (!clientId) return <Redirect to="/clients" />;

  return (
    <div data-testid="v2-client-record">
      <header className="df-dossier-head">
        <div className="df-dossier-identity df-client-identity">
          <div className="df-dossier-copy">
            {record.identity ? (
              <>
                <div className="df-dossier-meta">
                  <span className="df-status">{record.identity.kindLabel}</span>
                  <span className="df-status" data-status={record.identity.status} data-swatch="" style={swatchStyle(record.identity.statusColor)}>
                    {record.identity.status}
                  </span>
                </div>
                <div className="df-dossier-title-row">
                  <h1 className="df-record-title">{record.identity.title}</h1>
                </div>
                <div className="df-dossier-provenance">
                  <span className="df-mono df-meta">{record.identity.company}</span>
                  {record.identity.email ? (
                    <span className="df-mono df-meta">{record.identity.email}</span>
                  ) : null}
                  <span className="df-mono df-meta">{record.identity.source}</span>
                  {record.identity.phone ? <span className="df-mono df-meta">{record.identity.phone}</span> : null}
                  {record.identity.fiverrUsername ? <span className="df-mono df-meta">FIVERR @{record.identity.fiverrUsername}</span> : null}
                </div>
              </>
            ) : (
              <>
                <h1 className="df-record-title">{record.unavailable ? "Client unavailable" : "Client not found"}</h1>
                <p className="df-subhead">{record.emptyCopy}</p>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="df-dossier-body df-client-record-body" data-motion={RECORD_MOTION}>
        {writeRefusal && !addingContact ? <p className="df-refusal">{writeRefusal}</p> : null}
        {isLoading ? (
          <div className="df-overview" aria-busy="true">
            <div className="df-stack">
              <SkeletonSection title="On this Client" lines={3} />
            </div>
            <div className="df-stack">
              <SkeletonSection title="Client details" lines={4} />
              <SkeletonSection title="Client Projects" lines={2} />
            </div>
          </div>
        ) : record.missing || record.unavailable ? (
          <p className="df-empty">{record.emptyCopy}</p>
        ) : (
          <div className="df-overview">
            <div className="df-stack">
              <section className="df-card df-client-contacts">
                <div className="df-card-head">
                  <h2 className="df-card-title">On this Client</h2>
                  <span className="df-mono df-meta">{record.contacts.length}</span>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => {
                      setWriteRefusal(null);
                      setAddingContact(true);
                    }}
                    className="df-btn"
                  >
                    Add contact
                  </Button>
                </div>
                <V2FormDialog
                  open={addingContact}
                  onOpenChange={setAddingContact}
                  title="Add contact"
                  description={`A person to reach at ${record.identity?.title ?? "this Client"}.`}
                  submitLabel="Create contact"
                  pending={createContact.isPending}
                  canSubmit={Boolean(contactDraft.name.trim())}
                  onSubmit={() => {
                    if (readOnly) return refuse();
                    createContact.mutate();
                  }}
                  refusal={writeRefusal}
                  testId="v2-client-add-contact"
                >
                  {(["name", "role", "email", "phone"] as const).map((field, index) => (
                    <label key={field} className="df-daily-field">
                      {field.toUpperCase()}
                      <input
                        value={contactDraft[field]}
                        autoFocus={index === 0}
                        onChange={(event) => setContactDraft((value) => ({ ...value, [field]: event.target.value }))}
                      />
                    </label>
                  ))}
                  <div className="df-checkbox-row">
                    <Checkbox
                      id="df-contact-primary"
                      className="df-checkbox"
                      checked={contactDraft.isPrimary}
                      onCheckedChange={(next) => setContactDraft((value) => ({ ...value, isPrimary: next === true }))}
                    />
                    <label htmlFor="df-contact-primary">Primary contact</label>
                  </div>
                </V2FormDialog>
                {record.contacts.length === 0 ? (
                  <p className="df-empty">{record.contactsEmptyCopy}</p>
                ) : layout.stackedRegister ? (
                  record.contacts.map((contact) => (
                    <div key={contact.id} className="df-register-row">
                      <span className="df-people-member">
                        <span className="df-avatar">{contact.initials}</span>
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <div className="df-row-title">
                            {contact.name}
                            {contact.primary ? <span className="df-flag">PRIMARY</span> : null}
                          </div>
                          <div className="df-mono df-meta" data-case="preserve">
                            {[contact.role, contact.email, contact.phone].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </span>
                      </span>
                    </div>
                  ))
                ) : (
                  <>
                  <div className="df-register-head df-desktop-only">
                    <span>CONTACT</span>
                    <span>PHONE</span>
                    <span>ROLE</span>
                    <span />
                  </div>
                  {record.contacts.map((contact) => (
                    <div key={contact.id} className="df-register-row df-client-contact-row">
                      {/* A Contact is a person, so it reads like one: the People
                          row shape, not a name with every field joined beside it. */}
                      <span className="df-people-member">
                        <span className="df-avatar">{contact.initials}</span>
                        <span style={{ minWidth: 0 }}>
                          <div className="df-row-title">{contact.name}</div>
                          {contact.email ? (
                            <div className="df-mono df-meta" data-case="preserve">
                              {contact.email}
                            </div>
                          ) : null}
                        </span>
                      </span>
                      <span className="df-mono df-meta">{contact.phone ?? "—"}</span>
                      {/* A role is free text, not a state from a closed set, so
                          it is read as text; PRIMARY is a boolean, so it is a flag. */}
                      <span className="df-contact-role">{contact.role ?? "—"}</span>
                      <span className="df-contact-badges">
                        {contact.primary ? <span className="df-flag">PRIMARY</span> : null}
                      </span>
                    </div>
                  ))}
                  </>
                )}
              </section>

              <section className="df-card">
                <div className="df-card-head">
                  <h2 className="df-card-title">Client details</h2>
                  <Button variant="outline" type="button" onClick={() => setEditing((open) => !open)} className="df-btn">Edit Client</Button>
                </div>
                {editing ? (
                  <form className="df-admin-form df-daily-form" onSubmit={(event) => { event.preventDefault(); if (readOnly) return refuse(); updateClient.mutate(); }}>
                    {(["company", "email", "phone"] as const).map((field) => <label key={field} className="df-daily-field">{field.toUpperCase()}<input value={draft[field]} onChange={(event) => setDraft((value) => ({ ...value, [field]: event.target.value }))} /></label>)}
                    <div className="df-daily-field">
                      SOURCE
                      <Select
                        value={draft.source || "none"}
                        onValueChange={(next) => setDraft((value) => ({ ...value, source: next === "none" ? "" : next }))}
                      >
                        <SelectTrigger className="df-filter-chip df-select-trigger" aria-label="Client source">
                          <SelectValue />
                        </SelectTrigger>
                        {/* Radix portals outside `.df-v2`, so the panel carries the class itself. */}
                        <SelectContent className="df-v2 df-select-content">
                          {CLIENT_SOURCES.map((source) => (
                            <SelectItem key={source.id} value={source.id} className="df-select-item">
                              {source.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {draft.source === "fiverr" ? <label className="df-daily-field">FIVERR USERNAME<input value={draft.fiverrUsername} onChange={(event) => setDraft((value) => ({ ...value, fiverrUsername: event.target.value }))} /></label> : null}
                    <label className="df-daily-field">NOTES<textarea value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} /></label>
                    <Button variant="default" type="submit" disabled={updateClient.isPending} className="df-btn">Save Client</Button>
                  </form>
                ) : (
                  <>
                    <div className="df-record-fields">
                      {record.details.map((row) => (
                        <div
                          key={row.label}
                          className="df-record-field"
                          data-wide={row.wide ? "true" : "false"}
                        >
                          <span className="df-record-field-label">{row.label}</span>
                          <span className="df-record-field-value" data-empty={row.value === "—" ? "true" : "false"}>
                            {row.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>
            </div>

            <section className="df-card">
              <div className="df-card-head">
                <h2 className="df-card-title">Client Projects</h2>
                <span className="df-mono df-meta">{record.projects.length}</span>
              </div>
              {record.projects.length === 0 ? (
                <p className="df-empty">{record.projectsEmptyCopy}</p>
              ) : (
                record.projects.map((project) => (
                  <Link key={project.id} href={project.href} className="df-register-row">
                    <span className="df-row-title">{project.name}</span>
                    <span className="df-status-word" data-swatch="" style={swatchStyle(project.statusColor)}>{project.status}</span>
                  </Link>
                ))
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
