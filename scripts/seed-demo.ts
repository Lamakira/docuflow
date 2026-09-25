/**
 * seed-demo.ts — fills one Workspace with a coherent body of work, so the
 * product can be shown rather than described.
 *
 *   npm run db:seed:demo -- --workspace "User's Workspace"
 *   npm run db:seed:demo -- --workspace "User's Workspace" --undo
 *
 * This is not `seed-defaults.ts`. That one seeds the reference rows a database
 * cannot work without — CRM modules, `org_settings`, the built-in Workspace
 * Roles — and it belongs in every environment. This one invents Clients,
 * Opportunities, Projects, time, Documents and Daily Updates that never
 * happened, and belongs in exactly one place: a machine someone is
 * demonstrating from.
 *
 * Two rules keep it from becoming a liability:
 *
 *  - **It refuses a database that is not local.** A demo Client in a customer's
 *    Workspace is worse than an empty screen.
 *  - **Every row it writes carries a `demo-` id**, so `--undo` removes exactly
 *    what it added and nothing a person created by hand. A normal run undoes
 *    first, which is also what makes it idempotent.
 *
 * Dates are relative to the run, so the register never opens on a dead month.
 */

import { and, eq, like, sql } from "drizzle-orm";
import {
  companyDocumentFolders,
  companyDocuments,
  crmClients,
  crmContacts,
  crmProjects,
  documents,
  memberships,
  notifications,
  projectDailyUpdates,
  projectMembers,
  projects,
  tasks,
  timeEntries,
  workspaceRoles,
  workspaces,
} from "../shared/schema";
import { openDb, type Report, type ScriptDb } from "./lib/db";
import { isEntryPoint } from "./lib/entrypoint";

const ID = "demo-";

/** A local Postgres, and nothing else. */
export function isLocalDatabase(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

type Cast = {
  workspaceId: string;
  ownerId: string;
  memberId: string;
};

function at(daysFromNow: number, hour = 9, minute = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, minute, 0, 0);
  return date;
}

/** Weekdays only: a register full of Sunday work reads as generated. */
function lastWorkingDays(count: number): Date[] {
  const days: Date[] = [];
  for (let back = 1; days.length < count; back += 1) {
    const day = at(-back);
    if (day.getDay() !== 0 && day.getDay() !== 6) days.push(day);
  }
  return days;
}

const CLIENTS = [
  { key: "northwind", name: "Northwind Logistics", company: "Northwind Logistics SA", email: "ops@northwind.example", contact: "Amara Okafor", contactRole: "Operations Director" },
  { key: "brightfold", name: "Brightfold Studio", company: "Brightfold Studio Ltd", email: "hello@brightfold.example", contact: "Tomás Rivera", contactRole: "Founder" },
  { key: "caldera", name: "Caldera Health", company: "Caldera Health BV", email: "it@caldera.example", contact: "Ines Duarte", contactRole: "Head of IT" },
  { key: "mistral", name: "Mistral Freight", company: "Mistral Freight SARL", email: "contact@mistral.example", contact: "Lucie Bonnet", contactRole: "Managing Partner" },
];

/**
 * The pipeline, spread on purpose: an Opportunities board with every card in one
 * column shows nothing about the product. `status` is the combined lifecycle the
 * HTTP layer still reads; `projectStatus` is the split record (ADR-0001).
 */
const WORK = [
  { key: "atlas", name: "Atlas warehouse rollout", client: "northwind", status: "won_in_progress", projectStatus: "active", budgetedHours: 120, assignee: "owner", dueIn: 24 },
  { key: "ledger", name: "Ledger migration", client: "caldera", status: "won_in_review", projectStatus: "in_review", budgetedHours: 80, assignee: "member", dueIn: 6 },
  { key: "onboarding", name: "Client onboarding portal", client: "brightfold", status: "won_completed", projectStatus: "completed", budgetedHours: 60, assignee: "owner", dueIn: -9 },
  { key: "fleet", name: "Fleet telemetry audit", client: "mistral", status: "in_negotiation", projectStatus: "planned", budgetedHours: 40, assignee: "owner", dueIn: 30 },
  { key: "intake", name: "Patient intake redesign", client: "caldera", status: "proposal_sent", projectStatus: "planned", budgetedHours: 90, assignee: "member", dueIn: 45 },
  { key: "depot", name: "Depot scheduling pilot", client: "northwind", status: "follow_up", projectStatus: "planned", budgetedHours: 35, assignee: "owner", dueIn: 52 },
  { key: "brand", name: "Brand system refresh", client: "brightfold", status: "discovering_call_completed", projectStatus: "planned", budgetedHours: 25, assignee: "member", dueIn: 60 },
  { key: "customs", name: "Customs paperwork automation", client: "mistral", status: "lead", projectStatus: "planned", budgetedHours: 50, assignee: "owner", dueIn: 70 },
  { key: "kiosk", name: "Kiosk replacement", client: "caldera", status: "lost", projectStatus: "archived", budgetedHours: 30, assignee: "owner", dueIn: -20 },
];

const TASKS: Record<string, string[]> = {
  atlas: ["Survey the Bremen site", "Map the WMS integration", "Write the cutover runbook", "Train the floor supervisors"],
  ledger: ["Reconcile the opening balances", "Port the recurring journals", "Sign-off pack for the auditor"],
  onboarding: ["Wire the invitation flow", "Document the handover", "Close out with the client"],
};

/** Only work that has actually started carries time. */
const TRACKED = ["atlas", "ledger", "onboarding"];

const NOTES = [
  "Reviewed the integration mapping with their WMS vendor; two fields still unresolved.",
  "Balances tie out to the cent. Waiting on the auditor's sign-off pack.",
  "Cutover rehearsal ran clean end to end.",
  "Client pushed the training window back a week.",
];

export async function seedDemo(
  db: ScriptDb,
  options: { workspace: string; undo?: boolean },
  report: Report = () => {},
): Promise<void> {
  const cast = await resolveCast(db, options.workspace);

  await removeDemoRows(db, cast.workspaceId);
  if (options.undo) {
    report(`removed every demo row from ${options.workspace}`);
    return;
  }

  await writeClients(db, cast);
  await writeWork(db, cast);
  await writeTasksAndMembers(db, cast);
  await writeTime(db, cast);
  await writeDailyUpdates(db, cast);
  await writeDocuments(db, cast);
  await writeNotifications(db, cast);

  report(`seeded ${CLIENTS.length} Clients, ${WORK.length} Opportunities and Projects`);
  report(`workspace: ${cast.workspaceId}`);
  report("undo with: npm run db:seed:demo -- --workspace <name> --undo");
}

async function resolveCast(db: ScriptDb, workspace: string): Promise<Cast> {
  const [row] = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(sql`${workspaces.id} = ${workspace} OR ${workspaces.name} = ${workspace}`)
    .limit(1);
  if (!row) throw new Error(`No Workspace named or identified by "${workspace}"`);

  const people = await db
    .select({ userId: memberships.userId, slug: workspaceRoles.slug })
    .from(memberships)
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, memberships.workspaceRoleId))
    .where(eq(memberships.workspaceId, row.id));

  const owner = people.find((person) => person.slug === "owner");
  if (!owner) throw new Error(`Workspace "${row.name}" has no Owner to attribute the work to`);
  // A one-person Workspace still demos: the Owner does all of it.
  const member = people.find((person) => person.slug !== "owner") ?? owner;

  return { workspaceId: row.id, ownerId: owner.userId, memberId: member.userId };
}

/**
 * Order matters: `crm_projects` cascades from `projects`, and time, tasks and
 * updates cascade from `crm_projects` — but the Clients a Project points at are
 * `set null`, so they are cleared last and explicitly.
 */
async function removeDemoRows(db: ScriptDb, workspaceId: string): Promise<void> {
  const inWorkspace = (table: { id: unknown; workspaceId: unknown }) =>
    and(like(table.id as never, `${ID}%`), eq(table.workspaceId as never, workspaceId));

  await db.delete(notifications).where(inWorkspace(notifications));
  await db.delete(timeEntries).where(inWorkspace(timeEntries));
  await db.delete(projectDailyUpdates).where(inWorkspace(projectDailyUpdates));
  await db.delete(projectMembers).where(inWorkspace(projectMembers));
  await db.delete(tasks).where(inWorkspace(tasks));
  await db.delete(documents).where(inWorkspace(documents));
  await db.delete(companyDocuments).where(inWorkspace(companyDocuments));
  await db.delete(companyDocumentFolders).where(inWorkspace(companyDocumentFolders));
  await db.delete(crmProjects).where(inWorkspace(crmProjects));
  await db.delete(projects).where(inWorkspace(projects));
  await db.delete(crmContacts).where(inWorkspace(crmContacts));
  await db.delete(crmClients).where(inWorkspace(crmClients));
}

async function writeClients(db: ScriptDb, cast: Cast): Promise<void> {
  for (const client of CLIENTS) {
    await db.insert(crmClients).values({
      id: `${ID}client-${client.key}`,
      name: client.name,
      company: client.company,
      email: client.email,
      status: "client",
      source: "referral",
      ownerId: cast.ownerId,
      workspaceId: cast.workspaceId,
    });
    await db.insert(crmContacts).values({
      id: `${ID}contact-${client.key}`,
      clientId: `${ID}client-${client.key}`,
      name: client.contact,
      role: client.contactRole,
      email: client.email,
      isPrimary: 1,
      workspaceId: cast.workspaceId,
    });
  }
}

async function writeWork(db: ScriptDb, cast: Cast): Promise<void> {
  for (const item of WORK) {
    const assignee = item.assignee === "owner" ? cast.ownerId : cast.memberId;
    await db.insert(projects).values({
      id: `${ID}project-${item.key}`,
      name: item.name,
      description: `${item.name} for ${CLIENTS.find((client) => client.key === item.client)?.name}.`,
      ownerId: cast.ownerId,
      workspaceId: cast.workspaceId,
    });
    await db.insert(crmProjects).values({
      id: `${ID}crm-${item.key}`,
      projectId: `${ID}project-${item.key}`,
      clientId: `${ID}client-${item.client}`,
      status: item.status,
      projectStatus: item.projectStatus,
      projectType: "one_time",
      assigneeId: assignee,
      startDate: at(-40),
      dueDate: at(item.dueIn),
      actualFinishDate: item.projectStatus === "completed" ? at(item.dueIn) : null,
      budgetedHours: item.budgetedHours,
      budgetedMinutes: 0,
      documentationEnabled: TRACKED.includes(item.key) ? 1 : 0,
      comments: NOTES[WORK.indexOf(item) % NOTES.length],
      workspaceId: cast.workspaceId,
    });
  }
}

async function writeTasksAndMembers(db: ScriptDb, cast: Cast): Promise<void> {
  for (const [key, names] of Object.entries(TASKS)) {
    for (const [index, name] of names.entries()) {
      await db.insert(tasks).values({
        id: `${ID}task-${key}-${index}`,
        crmProjectId: `${ID}crm-${key}`,
        name,
        status: index === 0 ? "done" : index === names.length - 1 ? "open" : "in_progress",
        workspaceId: cast.workspaceId,
      });
    }
    for (const [index, userId] of [cast.ownerId, cast.memberId].entries()) {
      await db
        .insert(projectMembers)
        .values({
          id: `${ID}member-${key}-${index}`,
          crmProjectId: `${ID}crm-${key}`,
          userId,
          workspaceId: cast.workspaceId,
        })
        .onConflictDoNothing();
    }
  }
}

/**
 * Fourteen weekdays of tracked work, alternating between the two people and
 * across the Projects that have started, so Time and Activity open on a shape
 * rather than on a flat line.
 */
async function writeTime(db: ScriptDb, cast: Cast): Promise<void> {
  const days = lastWorkingDays(14);
  let counter = 0;
  for (const [dayIndex, day] of days.entries()) {
    for (const [slot, userId] of [cast.ownerId, cast.memberId].entries()) {
      const key = TRACKED[(dayIndex + slot) % TRACKED.length];
      const taskCount = TASKS[key]?.length ?? 1;
      const hours = 1.5 + ((dayIndex * 7 + slot * 3) % 5) * 0.5;
      const start = new Date(day);
      start.setHours(9 + slot * 4, (dayIndex % 4) * 15, 0, 0);
      const end = new Date(start.getTime() + hours * 3600 * 1000);
      await db.insert(timeEntries).values({
        id: `${ID}time-${counter++}`,
        userId,
        crmProjectId: `${ID}crm-${key}`,
        taskId: `${ID}task-${key}-${(dayIndex + slot) % taskCount}`,
        description: NOTES[(dayIndex + slot) % NOTES.length],
        startTime: start,
        endTime: end,
        duration: Math.round(hours * 3600),
        idleTime: (dayIndex % 3) * 120,
        status: "stopped",
        lastActivityAt: end,
        provenance: "legacy",
        workspaceId: cast.workspaceId,
      });
    }
  }
}

async function writeDailyUpdates(db: ScriptDb, cast: Cast): Promise<void> {
  const days = lastWorkingDays(5);
  const statuses = ["on_track", "in_progress", "in_review", "blocked_client", "on_track"];
  let counter = 0;
  for (const [index, day] of days.entries()) {
    for (const [slot, userId] of [cast.ownerId, cast.memberId].entries()) {
      const key = TRACKED[(index + slot) % TRACKED.length];
      const status = statuses[(index + slot) % statuses.length];
      await db.insert(projectDailyUpdates).values({
        id: `${ID}update-${counter++}`,
        crmProjectId: `${ID}crm-${key}`,
        userId,
        updateDate: day,
        status,
        whatHappened: NOTES[(index + slot) % NOTES.length],
        whatWasDone: TASKS[key]?.[(index + slot) % (TASKS[key]?.length ?? 1)] ?? "Progressed the plan",
        nextSteps: "Confirm the window with the client and start the next slice.",
        blockageType: status === "blocked_client" ? "external" : null,
        waitingOnClient: status === "blocked_client",
        needsClientUpdate: index === 0,
        workspaceId: cast.workspaceId,
      });
    }
  }
}

function page(title: string, body: string) {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
      { type: "paragraph", content: [{ type: "text", text: body }] },
    ],
  };
}

async function writeDocuments(db: ScriptDb, cast: Cast): Promise<void> {
  await db.insert(companyDocumentFolders).values({
    id: `${ID}folder-handbook`,
    name: "Company handbook",
    description: "Policies every Member is expected to have read.",
    createdById: cast.ownerId,
    workspaceId: cast.workspaceId,
  });

  const workspaceDocs = [
    ["expenses", "Expense policy", "What the company reimburses, the evidence it needs, and who approves it."],
    ["security", "Security baseline", "Device enrolment, screen lock, and what to do about a lost laptop."],
    ["onboarding", "Onboarding checklist", "The first week, in the order it should happen."],
  ];
  for (const [key, name, description] of workspaceDocs) {
    await db.insert(companyDocuments).values({
      id: `${ID}doc-${key}`,
      name,
      description,
      content: page(name, description),
      folderId: `${ID}folder-handbook`,
      uploadedById: cast.ownerId,
      workspaceId: cast.workspaceId,
    });
  }

  const projectDocs = [
    ["atlas-runbook", "atlas", "Cutover runbook", "Every step of the Bremen cutover, in the order it runs, with the rollback beside each one."],
    ["atlas-integration", "atlas", "WMS integration notes", "Field mapping, the two unresolved fields, and who owns each answer."],
    ["ledger-signoff", "ledger", "Auditor sign-off pack", "Opening balances, the recurring journals ported, and the reconciliation."],
  ];
  for (const [key, work, title, body] of projectDocs) {
    await db.insert(documents).values({
      id: `${ID}pdoc-${key}`,
      title,
      content: page(title, body),
      projectId: `${ID}project-${work}`,
      position: 0,
      createdById: cast.ownerId,
      workspaceId: cast.workspaceId,
    });
  }
}

async function writeNotifications(db: ScriptDb, cast: Cast): Promise<void> {
  const rows = [
    { key: "assigned", type: "project_assigned", message: "Ledger migration was assigned to you.", crm: "ledger" },
    { key: "update", type: "daily_update_reminder", message: "Your Daily Update for today is not in yet.", crm: "atlas" },
    { key: "review", type: "project_status", message: "Ledger migration moved to In review.", crm: "ledger" },
  ];
  for (const row of rows) {
    await db.insert(notifications).values({
      id: `${ID}notification-${row.key}`,
      userId: cast.ownerId,
      type: row.type,
      message: row.message,
      crmProjectId: `${ID}crm-${row.crm}`,
      fromUserId: cast.memberId,
      isRead: 0,
      workspaceId: cast.workspaceId,
    });
  }
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (isEntryPoint(import.meta.url)) {
  const workspace = argValue("--workspace") ?? "User's Workspace";
  const undo = process.argv.includes("--undo");
  const url = process.env.DATABASE_URL ?? "";

  if (!isLocalDatabase(url)) {
    console.error("seed-demo refuses a database that is not local.");
    console.error("It writes Clients and Projects that never happened; that belongs on a demo machine only.");
    process.exitCode = 1;
  } else {
    const { db, close } = openDb();
    seedDemo(db, { workspace, undo }, (message) => console.log(message))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
      })
      .finally(() => close());
  }
}

export { CLIENTS, WORK };
