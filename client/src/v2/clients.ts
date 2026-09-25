import { chromeRefusal } from "./chrome";
import { clientStatusColor, projectStatusColor } from "./palette";
import { projectHref } from "./today";

/**
 * Clients register and Client record (#186).
 * Novelty: register → record identity settles (preventing a jarring change).
 * Do not animate: client-list filtering, row hover beyond existing press, every field as it loads.
 */

export type ClientRegisterRowInput = {
  id: string;
  name: string;
  company: string | null;
  status: string | null;
  source: string | null;
  projectCount: number;
};

export type ClientRegisterInput = {
  workspaceName: string;
  clients: ClientRegisterRowInput[];
  filterQuery: string;
  selectedId: string | null;
};

export type ClientRegisterRow = {
  id: string;
  name: string;
  company: string;
  status: string;
  /** The status's board colour; `swatchStyle` turns it into the badge. */
  statusColor: string;
  source: string;
  projectCount: number;
  href: string;
  selected: boolean;
};

export type ClientRegisterModel = {
  subhead: string;
  empty: boolean;
  emptyCopy: string;
  rows: ClientRegisterRow[];
  count: number;
};

export function clientHref(clientId: string): string {
  return `/clients/${clientId}`;
}

const STATUS_LABEL: Record<string, string> = {
  lead: "LEAD",
  prospect: "PROSPECT",
  client: "CLIENT",
  client_recurrent: "CLIENT RECURRENT",
};

const SOURCE_LABEL: Record<string, string> = {
  fiverr: "FIVERR",
  zoho: "ZOHO",
  direct: "DIRECT",
};

function statusLabel(status: string | null): string {
  if (!status) return "—";
  return STATUS_LABEL[status] ?? status.replace(/_/g, " ").toUpperCase();
}

function sourceLabel(source: string | null): string {
  if (!source) return "—";
  return SOURCE_LABEL[source] ?? source.replace(/_/g, " ").toUpperCase();
}

export function composeClientRegister(input: ClientRegisterInput): ClientRegisterModel {
  const needle = input.filterQuery.trim().toLowerCase();
  const rows = input.clients
    .filter((client) => {
      if (!needle) return true;
      const haystack = `${client.name} ${client.company ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    })
    .map((client) => ({
      id: client.id,
      name: client.name || "Untitled Client",
      company: client.company || "—",
      status: statusLabel(client.status),
      statusColor: clientStatusColor(client.status),
      source: sourceLabel(client.source),
      projectCount: client.projectCount,
      href: clientHref(client.id),
      selected: client.id === input.selectedId,
    }));
  const empty = rows.length === 0;
  return {
    subhead: `Clients in ${input.workspaceName}.`,
    empty,
    emptyCopy: empty
      ? needle
        ? "No Clients match this filter."
        : "No Clients in this Workspace yet."
      : "",
    rows,
    count: rows.length,
  };
}

export type ClientRecordContact = {
  id: string;
  name: string;
  role: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: number | null;
};

export type ClientRecordProjectInput = {
  id: string;
  name: string;
  projectStatus: string;
};

export type ClientIdentitySeed = {
  name: string;
  company: string | null;
  status: string | null;
  source: string | null;
  email?: string | null;
  phone?: string | null;
  phoneFormat?: string | null;
  fiverrUsername?: string | null;
};

export type ClientRecordInput = {
  client: {
    id: string;
    name: string;
    company: string | null;
    email: string | null;
    phone?: string | null;
    phoneFormat?: string | null;
    status: string | null;
    source: string | null;
    fiverrUsername?: string | null;
    notes: string | null;
    contacts: ClientRecordContact[];
  } | null;
  seed?: ClientIdentitySeed | null;
  pending?: boolean;
  loadFailed?: boolean;
  projects: ClientRecordProjectInput[];
};

export type ClientRecordIdentity = {
  title: string;
  kindLabel: string;
  status: string;
  statusColor: string;
  company: string;
  email: string | null;
  source: string;
  phone: string | null;
  phoneFormat: string | null;
  fiverrUsername: string | null;
};

/** A Contact reads like a person, the way a Membership does on People (#213). */
export type ClientRecordContactRow = {
  id: string;
  name: string;
  initials: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  primary: boolean;
};

export type ClientRecordModel = {
  missing: boolean;
  unavailable: boolean;
  emptyCopy: string;
  identity: ClientRecordIdentity | null;
  contacts: ClientRecordContactRow[];
  contactsEmptyCopy: string;
  projects: Array<{ id: string; name: string; status: string; statusColor: string; href: string }>;
  projectsEmptyCopy: string;
  notes: string | null;
  /** What the editor just wrote, readable without reopening the editor (#213). */
  details: Array<{ label: string; value: string; wide?: true }>;
};

const PROJECT_STATUS_LABEL: Record<string, string> = {
  planned: "PLANNED",
  active: "ACTIVE",
  on_hold: "ON HOLD",
  in_review: "IN REVIEW",
  completed: "COMPLETED",
  archived: "ARCHIVED",
};

function projectStatusLabel(status: string): string {
  return PROJECT_STATUS_LABEL[status] ?? status.replace(/_/g, " ").toUpperCase();
}

function identityFrom(client: ClientIdentitySeed): ClientRecordIdentity {
  return {
    title: client.name || "Untitled Client",
    kindLabel: "CLIENT",
    status: statusLabel(client.status),
    statusColor: clientStatusColor(client.status),
    company: client.company || "—",
    email: client.email ?? null,
    source: sourceLabel(client.source),
    phone: client.phone ?? null,
    phoneFormat: client.phoneFormat ?? null,
    fiverrUsername: client.fiverrUsername ?? null,
  };
}

function emptyRecord(partial: Pick<ClientRecordModel, "missing" | "unavailable" | "emptyCopy" | "identity">): ClientRecordModel {
  return {
    contacts: [],
    contactsEmptyCopy: "",
    projects: [],
    projectsEmptyCopy: "",
    notes: null,
    details: [],
    ...partial,
  };
}

export function composeClientRecord(input: ClientRecordInput): ClientRecordModel {
  if (input.loadFailed) {
    return emptyRecord({
      missing: false,
      unavailable: true,
      emptyCopy: "This Client could not be loaded.",
      identity: input.client ? identityFrom(input.client) : input.seed ? identityFrom(input.seed) : null,
    });
  }

  if (input.pending) {
    return emptyRecord({
      missing: false,
      unavailable: false,
      emptyCopy: "",
      identity: input.client
        ? identityFrom(input.client)
        : input.seed
          ? identityFrom(input.seed)
          : identityFrom({ name: "Client", company: null, status: null, source: null }),
    });
  }

  if (!input.client) {
    return emptyRecord({
      missing: true,
      unavailable: false,
      emptyCopy: "This Client is not in this Workspace.",
      identity: null,
    });
  }

  const contacts = input.client.contacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    initials: contactInitials(contact.name),
    role: contact.role,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    primary: contact.isPrimary === 1,
  }));
  const projects = input.projects.map((project) => ({
    id: project.id,
    name: project.name || "Untitled Project",
    status: projectStatusLabel(project.projectStatus),
    statusColor: projectStatusColor(project.projectStatus),
    href: projectHref(project.id),
  }));

  return {
    missing: false,
    unavailable: false,
    emptyCopy: "",
    identity: identityFrom(input.client),
    contacts,
    contactsEmptyCopy: contacts.length === 0 ? "No one filed on this Client yet." : "",
    projects,
    projectsEmptyCopy: projects.length === 0 ? "No Client Projects yet." : "",
    notes: input.client.notes,
    details: clientDetails(identityFrom(input.client), input.client.notes),
  };
}

/**
 * The editor writes the whole Client, so the card has to read the whole Client
 * back. Before this the card showed only `notes`, and everything else the form
 * saved was invisible until the editor was reopened (#213).
 */
/** Two letters from a person's name, one when they gave only one word. */
function contactInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

function clientDetails(
  identity: ClientRecordIdentity,
  notes: string | null,
): Array<{ label: string; value: string; wide?: true }> {
  const rows: Array<{ label: string; value: string; wide?: true }> = [
    { label: "COMPANY", value: identity.company },
    { label: "EMAIL", value: identity.email ?? "—" },
    { label: "PHONE", value: identity.phone ?? "—" },
    { label: "SOURCE", value: identity.source },
  ];
  if (identity.fiverrUsername) {
    rows.push({ label: "FIVERR", value: `@${identity.fiverrUsername}` });
  }
  // Notes belong in the same block: a separate paragraph below stacked two
  // gutters and left a band of empty card between them.
  rows.push({ label: "NOTES", value: notes?.trim() || "—", wide: true });
  return rows;
}

export function clientWriteRefusal(input: {
  readOnly: boolean;
  workspaceName: string;
  errorMessage?: string;
  ownerName?: string | null;
}): string {
  if (input.readOnly || /read-only/i.test(input.errorMessage ?? "")) {
    return chromeRefusal({
      kind: "workspace-condition",
      workspaceName: input.workspaceName,
      condition: "Read-only",
    });
  }
  const message = input.errorMessage ?? "";
  if (/permission denied|not authorized|access denied|forbidden/i.test(message)) {
    return chromeRefusal({
      kind: "capability",
      capability: "Create Clients",
      ownerName: input.ownerName,
    });
  }
  return chromeRefusal({ kind: "generic", message: message || "Failed to create Client" });
}
