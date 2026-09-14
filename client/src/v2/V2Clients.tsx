import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Redirect, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { CrmClient, CrmContact, CrmProjectWithDetails, SafeUser } from "@shared/schema";
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
  clientHref,
  clientWriteRefusal,
  composeClientRecord,
  composeClientRegister,
  type ClientRegisterRowInput,
} from "./clients";
import { motionForSurface } from "./motion";
import { matchV2Route } from "./presentation";
import { memberName } from "./today";
import { useV2Chrome } from "./V2Shell";

type ClientWithContacts = CrmClient & { contacts?: CrmContact[] };
type ProjectsResponse = { data: CrmProjectWithDetails[]; total?: number };

const RECORD_MOTION = motionForSurface("client-register-record").enterExit;

async function loadClients(): Promise<CrmClient[]> {
  const res = await fetch("/api/crm/clients", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch Clients");
  return res.json();
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

function projectCountByClient(projects: CrmProjectWithDetails[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const project of projects) {
    const clientId = project.clientId ?? project.client?.id;
    if (!clientId) continue;
    counts.set(clientId, (counts.get(clientId) ?? 0) + 1);
  }
  return counts;
}

function toRegisterClient(client: CrmClient, projectCount: number): ClientRegisterRowInput {
  return {
    id: client.id,
    name: client.name,
    company: client.company,
    status: client.status,
    source: client.source,
    projectCount,
  };
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
  const [, setLocation] = useLocation();
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(
    () => new URLSearchParams(window.location.search).get("new") === "1",
  );
  const [name, setName] = useState("");
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);

  const current = memberships?.memberships.find((row) => row.workspaceId === memberships.activeWorkspaceId);
  const workspaceName = current?.workspaceName ?? "this Workspace";
  const readOnly = current?.condition === "Read-only";

  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const owner = users.find((member) => member.isMainAdmin === 1);
  const ownerName = owner ? memberName(owner) : null;

  const { data: clients = [], isLoading, isError } = useQuery<CrmClient[]>({
    queryKey: ["/api/crm/clients", "register"],
    queryFn: loadClients,
  });
  const { data: projectsResponse } = useQuery<ProjectsResponse>({
    queryKey: ["/api/crm/projects", "register"],
    queryFn: loadProjects,
  });

  const counts = projectCountByClient(projectsResponse?.data ?? []);
  const register = composeClientRegister({
    workspaceName,
    clients: clients.map((client) => toRegisterClient(client, counts.get(client.id) ?? 0)),
    filterQuery,
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

  function onCreate(event: FormEvent) {
    event.preventDefault();
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
      <div className="df-page" data-testid="v2-clients">
        <header className="df-today-head">
          <div>
            <h1 className="df-title">Clients</h1>
            <p className="df-subhead">Loading this Workspace…</p>
          </div>
        </header>
        <div className="df-card" style={{ minHeight: 280 }} />
      </div>
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
          <button type="button" className="df-ink-btn" onClick={() => setCreating((open) => !open)}>
            New Client
          </button>
        </div>
      </header>

      {creating ? (
        <form className="df-filter-bar df-clients-filter" onSubmit={onCreate}>
          <label className="df-filter-input">
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Client name"
              aria-label="Client name"
            />
          </label>
          <button type="submit" className="df-ink-btn" disabled={createClient.isPending || !name.trim()}>
            Create
          </button>
        </form>
      ) : null}
      {writeRefusal ? <p className="df-refusal">{writeRefusal}</p> : null}

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
      </div>

      <section className="df-card df-clients-register" data-testid="v2-clients-register">
        {layout.stackedRegister ? null : (
          <div className="df-register-head df-desktop-only">
            <span>CLIENT</span>
            <span>COMPANY</span>
            <span>STATUS</span>
            <span>SOURCE</span>
            <span style={{ textAlign: "right" }}>PROJECTS</span>
          </div>
        )}
        {register.empty ? (
          <p className="df-empty">{register.emptyCopy}</p>
        ) : (
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
              {layout.stackedRegister ? (
                <span className="df-project-mobile">
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div className="df-row-title">{row.name}</div>
                    <div className="df-mono df-meta">
                      {row.company} · {row.status}
                    </div>
                  </span>
                </span>
              ) : (
                <>
                  <span style={{ minWidth: 0 }}>
                    <div
                      className="df-row-title"
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {row.name}
                    </div>
                  </span>
                  <span style={{ fontWeight: 500, fontSize: 13.5 }}>{row.company}</span>
                  <span>
                    <span className="df-status-word">{row.status}</span>
                  </span>
                  <span className="df-mono df-meta">{row.source}</span>
                  <span className="df-mono" style={{ fontSize: 12, textAlign: "right" }}>
                    {row.projectCount}
                  </span>
                </>
              )}
            </Link>
          ))
        )}
        <div className="df-library-foot">
          <span>
            {register.count} {register.count === 1 ? "CLIENT" : "CLIENTS"}
          </span>
        </div>
      </section>
    </div>
  );
}

export function V2ClientRecordPage() {
  const { memberships, showToast } = useV2Chrome();
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

  const seed = (queryClient.getQueryData<CrmClient[]>(["/api/crm/clients", "register"]) ?? []).find(
    (row) => row.id === clientId,
  );

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
                  <span className="df-status" data-status={record.identity.status}>
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
        {writeRefusal ? <p className="df-refusal">{writeRefusal}</p> : null}
        {isLoading ? (
          <div className="df-card" style={{ minHeight: 240 }} />
        ) : record.missing || record.unavailable ? (
          <p className="df-empty">{record.emptyCopy}</p>
        ) : (
          <div className="df-overview">
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <section className="df-card">
                <div className="df-card-head">
                  <h2 className="df-card-title">On this Client</h2>
                  <span className="df-mono df-meta">{record.contacts.length}</span>
                  <button type="button" className="df-ghost-link" onClick={() => setAddingContact((open) => !open)}>Add contact</button>
                </div>
                {addingContact ? (
                  <form className="df-admin-form df-daily-form" onSubmit={(event) => { event.preventDefault(); if (readOnly) return refuse(); if (contactDraft.name.trim()) createContact.mutate(); }}>
                    {(["name", "role", "email", "phone"] as const).map((field) => (
                      <label key={field} className="df-daily-field">{field.toUpperCase()}<input value={contactDraft[field]} onChange={(event) => setContactDraft((value) => ({ ...value, [field]: event.target.value }))} /></label>
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
                    <button className="df-ink-btn" type="submit" disabled={!contactDraft.name.trim() || createContact.isPending}>Create contact</button>
                  </form>
                ) : null}
                {record.contacts.length === 0 ? (
                  <p className="df-empty">{record.contactsEmptyCopy}</p>
                ) : (
                  record.contacts.map((contact) => (
                    <div key={contact.id} className="df-register-row">
                      <span className="df-row-title">{contact.name}</span>
                      <span className="df-mono df-meta">{[contact.role, contact.email, contact.phone, contact.primary ? "PRIMARY" : null].filter(Boolean).join(" · ") || "—"}</span>
                    </div>
                  ))
                )}
              </section>

              <section className="df-card">
                <div className="df-card-head">
                  <h2 className="df-card-title">Client details</h2>
                  <button type="button" className="df-ghost-link" onClick={() => setEditing((open) => !open)}>Edit Client</button>
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
                    <button className="df-ink-btn" type="submit" disabled={updateClient.isPending}>Save Client</button>
                  </form>
                ) : (
                  <>
                    <div className="df-record-fields">
                      {record.details.map((row) => (
                        <div key={row.label} className="df-record-field">
                          <span className="df-record-field-label">{row.label}</span>
                          <span className="df-record-field-value" data-empty={row.value === "—" ? "true" : "false"}>
                            {row.value}
                          </span>
                        </div>
                      ))}
                    </div>
                    {record.notes ? (
                      <p className="df-prose" style={{ padding: "16px 18px" }}>
                        {record.notes}
                      </p>
                    ) : (
                      <p className="df-empty">No notes filed yet.</p>
                    )}
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
                    <span className="df-status-word">{project.status}</span>
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
