/**
 * Combined postgres adapter for every domain persistence interface (#113).
 * Later Phase 6 tickets extract implementations into their modules.
 * HTTP still reaches this through `server/storage.ts`.
 */

import { randomUUID } from "node:crypto";
import {
  users,
  projects,
  documents,
  crmProjects,
  crmClients,
  crmContacts,
  crmProjectNotes,
  crmProjectStageHistory,
  crmTags,
  crmProjectTags,
  crmModules,
  crmModuleFields,
  crmCustomFieldValues,
  opportunities,
  companyDocuments,
  companyDocumentFolders,
  auditEvents,
  files,
  notifications,
  audioRecordings,
  tasks,
  timeEntries,
  timeEntryScreenshots,
  type Task,
  type InsertTask,
  projectMembers,
  reminders,
  type ProjectMember,
  type InsertProjectMember,
  type ProjectMemberWithUser,
  type Reminder,
  type InsertReminder,
  type User,
  type SafeUser,
  type InsertUser,
  type Project,
  type InsertProject,
  type Document,
  type InsertDocument,
  type CrmProject,
  type InsertCrmProject,
  type CrmClient,
  type InsertCrmClient,
  type CrmContact,
  type InsertCrmContact,
  type CrmProjectWithDetails,
  type CrmProjectNote,
  type InsertCrmProjectNote,
  type CrmProjectNoteWithCreator,
  type CrmProjectStageHistory,
  type InsertCrmProjectStageHistory,
  type CrmProjectStageHistoryWithUser,
  type CrmTag,
  type InsertCrmTag,
  type CrmProjectTag,
  type CrmModule,
  type InsertCrmModule,
  type CrmModuleField,
  type InsertCrmModuleField,
  type CrmModuleWithFields,
  type CrmCustomFieldValue,
  type InsertCrmCustomFieldValue,
  type Opportunity,
  type InsertOpportunity,
  type CompanyDocument,
  type InsertCompanyDocument,
  type KnowledgeFile,
  type InsertKnowledgeFile,
  type FileScanStatus,
  type CompanyDocumentWithUploader,
  type CompanyDocumentRegisterRow,
  type CompanyDocumentFolder,
  type InsertCompanyDocumentFolder,
  type CompanyDocumentFolderWithCreator,
  type Notification,
  type InsertNotification,
  type NotificationWithDetails,
  type AudioRecording,
  type InsertAudioRecording,
  type TimeEntry,
  type InsertTimeEntry,
  type TimeEntryWithDetails,
  type TimeEntryScreenshot,
  type InsertTimeEntryScreenshot,
  type Device,
  type InsertDevice,
  type AgentPairingCode,
  devices,
  agentPairingCodes,
  agentActivityEvents,
  orgSettings,
  type ScreenshotPolicy,
  type HelpCenterScreenshotsMap,
  DEFAULT_SCREENSHOT_POLICY,
  DEFAULT_ALLOWED_TIMEZONES,
  type EvidenceGrade,
  type EvidenceQualityReport,
  projectDailyUpdates,
  type ProjectDailyUpdate,
  type InsertProjectDailyUpdate,
  type ProjectDailyUpdateWithDetails,
  DOCUMENT_ACCESS_WORKSPACE,
  PARALLEL_WORKSPACE_ID,
  PARALLEL_MEMBER_ROLE_ID,
  memberships,
  deviceEnrollments,
  workspaces,
  toSafeUser,
} from "@shared/schema";
import { db } from "../db";
import {
  currentWorkspaceContext,
  forWorkspaces,
  inWorkspace,
  requireWorkspaceContext,
  runWithWorkspaceContext,
  stampWorkspace,
} from "../workspaceContext";
import {
  activeTimeEntryForUser,
  membershipsForUser,
  notificationWorkspaceForUser,
  workspaceForPairingCode,
} from "../workspaceLocators";
import type { OptionRenameColumn } from "./clients-sales/persistence";

import type { DocumentWriter, FileWriter, ProjectWriter } from "./writers";
import { syncCompanyDocumentEmbeddingFolder } from "../embeddings";
import type { CompanyDocumentSaveOptions, SaveOptions } from "./knowledge/persistence";
import { DEFAULT_PROJECT_PAGES } from "./knowledge/defaultPages";
import type { IStorage } from "./index";
import {
  isOpportunityTerminal,
  opportunityStageFromCombined,
  projectHasOpportunity,
  projectStatusFromCombined,
  WON_STATUSES,
} from "@shared/projectLifecycle";
import { STALE_THRESHOLD_MS, timeEntrySpan, timePortion } from "@shared/timePortion";
import { isUploadedFile } from "@shared/documentFile";
import { BUILT_IN_LISTS, defaultFieldOptions, type OptionRename } from "@shared/pipelineLists";
import {
  deleteIndexArtifacts,
  listIndexArtifacts,
  rebuildIndexArtifacts,
} from "./intelligence/indexArtifacts";
import {
  createAgentActivityEvents,
  createTimeEntryScreenshot,
  deleteTimeEntryScreenshot,
  getTimeEntryScreenshotById,
  getTimeEntryScreenshots,
  isAgentBatchProcessed,
  markAgentBatchProcessed,
  softDeleteTimeEntryScreenshot,
  updateTimeEntryScreenshot,
  type ScreenshotList,
  type ScreenshotListOptions,
} from "./activity/evidence";
import { notDuplicateCapture } from "./activity/duplicates";
import { getScreenshotPolicy, upsertScreenshotPolicy } from "./activity/policy";
import type { ScreenshotCoverageReport } from "./activity/persistence";
import { getAllowedTimezones, upsertAllowedTimezones } from "./time/schedule";
import { applyTimerCommand, listTimerCommands } from "./time/commands";
import { dayCalendar, dayPortions } from "./time/dayCalendar";
import type { TimeExportRow } from "./time/timeExport";
import type {
  AnalyticsOptions,
  TimeEntryPage,
  TimeEntryPageOptions,
  TimePortionOptions,
  TimePortionRow,
  TimeSpanRow,
} from "./time/persistence";
import { assertSeatAvailable } from "./billing/seats";
import { setDailyUpdatesGrant } from "./workspace/membershipManagement";
import type { ImportableUser } from "./identity/userImport";
import { eq, ne, and, desc, like, or, isNull, isNotNull, sql, gte, lt, lte, asc, count, max, notExists, inArray, ilike, getTableColumns, type AnyColumn, type SQL } from "drizzle-orm";
import type {
  CrmProjectListOptions,
  ProjectDocumentScope,
  ProjectDocumentationListOptions,
  ProjectDocumentationPage,
  ProjectDocumentationFile,
} from "./projects/persistence";
import type { CrmClientListOptions, CrmClientRegisterRow } from "./clients-sales/persistence";


/**
 * Devices carry no `workspace_id` of their own: a Device belongs to a Workspace
 * through its enrollment there, not through its User, who may have Memberships
 * in several. Operator reads scope through this (ADR-0006).
 */
function enrolledDeviceIds() {
  return db
    .select({ deviceId: deviceEnrollments.deviceId })
    .from(deviceEnrollments)
    .where(inWorkspace(deviceEnrollments));
}

function stalledBefore(): Date {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

/** Not revoked, silent for over 7 days, and enrolled by a Membership still in the Workspace. */
function isStalledDevice() {
  return and(
    inArray(
      devices.id,
      db
        .select({ deviceId: deviceEnrollments.deviceId })
        .from(deviceEnrollments)
        .innerJoin(memberships, eq(memberships.id, deviceEnrollments.membershipId))
        .where(and(inWorkspace(deviceEnrollments), inWorkspace(memberships), isNull(memberships.archivedAt))),
    ),
    isNull(devices.revokedAt),
    lt(devices.lastSeenAt, stalledBefore()),
  );
}

function personName(person: { firstName: string | null; lastName: string | null; email: string }): string {
  return `${person.firstName || ""} ${person.lastName || ""}`.trim() || person.email;
}

/** Idle time is kept beside the tracked time: together they are the wall time. */
function idleRatioOf(seconds: number, idleSeconds: number): number {
  const total = seconds + idleSeconds;
  return total > 0 ? Math.round((idleSeconds / total) * 100) : 0;
}

/**
 * The quarter hour a capture was taken in, counted from 1970. Every time zone is
 * a whole number of quarters from UTC, so its day and hour are read from this.
 */
function captureQuarter() {
  return sql<number>`floor(extract(epoch from ${timeEntryScreenshots.capturedAt}) / 900)::int`;
}

function quarterStart(quarter: number): Date {
  return new Date(quarter * 900_000);
}

/**
 * The Projects a Member may see: one they belong to, one they are assigned
 * while it has no Members, or an Opportunity they own (#310). Owners and
 * Administrators see every Project, so callers leave this condition out for them.
 */
function crmProjectVisibleTo(viewer: string) {
  return or(
    inArray(
      crmProjects.id,
      db.select({ id: projectMembers.crmProjectId }).from(projectMembers).where(eq(projectMembers.userId, viewer)),
    ),
    and(
      eq(crmProjects.assigneeId, viewer),
      sql`not exists (select 1 from ${projectMembers} where ${projectMembers.crmProjectId} = ${crmProjects.id})`,
    ),
    eq(crmProjects.opportunityOwnerId, viewer),
  );
}

/** Delivery work only: no Opportunity, or a won one (`isDeliveryProject`). Documentation-only rows are the caller's to take or leave. */
function crmProjectIsDelivery() {
  return or(
    eq(crmProjects.projectType, "internal"),
    eq(crmProjects.status, "documented"),
    inArray(crmProjects.status, [...WON_STATUSES]),
  );
}

/** The date Project Documentation shows: its latest Document or listed File, else the Project's own. */
function projectDocumentationActivity() {
  return sql`coalesce(
    greatest(
      (select max(coalesce(${documents.updatedAt}, ${documents.createdAt})) from ${documents}
        where ${documents.projectId} = ${projects.id} and ${inWorkspace(documents)}),
      (select max(coalesce(${files.updatedAt}, ${files.createdAt})) from ${files}
        where ${files.projectId} = ${projects.id} and ${files.scanStatus} = 'available' and ${inWorkspace(files)})
    ),
    ${projects.updatedAt}
  )`;
}

/** The columns of a `DocumentPerson`, so no read of the library selects a whole User. */
const documentPersonColumns = {
  id: users.id,
  email: users.email,
  firstName: users.firstName,
  lastName: users.lastName,
  profileImageUrl: users.profileImageUrl,
};

/**
 * The row still carries the time its reader was given. A client holds
 * milliseconds where `defaultNow()` stored microseconds. The column has no time
 * zone and holds UTC digits, so the ISO text is compared rather than a Date.
 */
function unchangedSince(column: AnyColumn, expected: Date | undefined): SQL | undefined {
  if (!expected) return undefined;
  return sql`date_trunc('milliseconds', ${column}) = ${expected.toISOString()}::timestamp`;
}

/** `timeEntrySpan`'s end in SQL, for the overlap with a period. The two must agree. */
function timeEntrySpanEnd(now: Date): SQL {
  const at = sql`${now.toISOString()}::timestamp`;
  const staleBefore = sql`${new Date(now.getTime() - STALE_THRESHOLD_MS).toISOString()}::timestamp`;
  const impliedEnd = sql`${timeEntries.startTime} + greatest(0, coalesce(${timeEntries.duration}, 0)) * interval '1 second'`;
  return sql`greatest(${timeEntries.startTime}, case ${timeEntries.status}
    when 'running' then case when ${timeEntries.lastActivityAt} < ${staleBefore} then ${timeEntries.lastActivityAt} else ${at} end
    when 'paused' then coalesce(${timeEntries.lastActivityAt}, ${impliedEnd})
    else coalesce(${timeEntries.endTime}, ${impliedEnd}) end)`;
}

/** A checked save always moves the time forward, so two in one millisecond cannot share a version. */
function nextUpdatedAt(column: AnyColumn, expected: Date | undefined): Date | SQL {
  const now = new Date();
  if (!expected) return now;
  return sql`greatest(${now.toISOString()}::timestamp, date_trunc('milliseconds', ${column}) + interval '1 millisecond')`;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(userData: InsertUser): Promise<User> {
    return db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values(userData).returning();
      await this.ensureParallelMembership(user, tx);
      return user;
    });
  }

  async upsertUser(userData: { id: string; email?: string | null; firstName?: string | null; lastName?: string | null; profileImageUrl?: string | null }): Promise<User> {
    // If a user with this email already exists under a different OIDC id, update that record
    // instead of inserting — otherwise the email unique constraint will crash the server.
    if (userData.email) {
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, userData.email))
        .limit(1);

      if (existing && existing.id !== userData.id) {
        const [updated] = await db
          .update(users)
          .set({
            firstName: userData.firstName ?? undefined,
            lastName: userData.lastName ?? undefined,
            profileImageUrl: userData.profileImageUrl ?? undefined,
            updatedAt: new Date(),
          })
          .where(eq(users.email, userData.email))
          .returning();
        await this.ensureParallelMembership(updated);
        return updated;
      }
    }

    // Normal upsert by OIDC id
    const [user] = await db
      .insert(users)
      .values({
        id: userData.id,
        email: userData.email ?? "",
        firstName: userData.firstName ?? undefined,
        lastName: userData.lastName ?? undefined,
        profileImageUrl: userData.profileImageUrl ?? undefined,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: userData.email ?? "",
          firstName: userData.firstName ?? undefined,
          lastName: userData.lastName ?? undefined,
          profileImageUrl: userData.profileImageUrl ?? undefined,
          updatedAt: new Date(),
        },
      })
      .returning();
    await this.ensureParallelMembership(user);
    return user;
  }

  /**
   * The `users` columns the IdentityProvider import reads (#108, ADR-0007), in a
   * stable order so a partial run resumes where it stopped. Archived Users are
   * included: authorization is DocuFlow's, so whether an account may act is a
   * Membership question, not a reason to leave its identity unimported.
   *
   * Hashes are gone (#161). An unlinked User is owed a password-set invite, not
   * an import by digest.
   */
  async listUsersForIdentityImport(): Promise<ImportableUser[]> {
    return db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        identityProviderSubjectId: users.identityProviderSubjectId,
      })
      .from(users)
      .orderBy(asc(users.createdAt), asc(users.id));
  }

  /**
   * The User a provider session belongs to, during the dual-auth drain (#109).
   * Only the link is selected: the caller wants an id to build a
   * WorkspaceContext from, not a row.
   */
  async getUserByIdentityProviderSubjectId(
    providerSubjectId: string
  ): Promise<{ id: string } | undefined> {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.identityProviderSubjectId, providerSubjectId))
      .limit(1);
    return user;
  }

  async linkUserToIdentityProvider(userId: string, providerSubjectId: string): Promise<void> {
    await db
      .update(users)
      .set({ identityProviderSubjectId: providerSubjectId, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  /**
   * A new User joins no Workspace (#297): Workspaces add people through
   * Invitations. In the parallel v2 environment only, join Harbour View so the
   * switcher can be demonstrated (#183).
   */
  private async ensureParallelMembership(
    user: User,
    writer: Pick<typeof db, "insert" | "select"> = db
  ): Promise<void> {
    if (process.env.NODE_ENV !== "development") return;
    const [workspace] = await writer
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, PARALLEL_WORKSPACE_ID))
      .limit(1);
    if (!workspace) return;
    await runWithWorkspaceContext({ workspaceId: PARALLEL_WORKSPACE_ID }, async () => {
      const [existing] = await writer
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, PARALLEL_WORKSPACE_ID), eq(memberships.userId, user.id)))
        .limit(1);
      if (existing) return;
      if (!user.isArchived) await assertSeatAvailable(writer);
      await writer
        .insert(memberships)
        .values({
          workspaceId: PARALLEL_WORKSPACE_ID,
          userId: user.id,
          workspaceRoleId: PARALLEL_MEMBER_ROLE_ID,
          archivedAt: user.isArchived ? new Date() : null,
        })
        .onConflictDoNothing();
    });
  }

  async getProjects(userId?: string, scope: ProjectDocumentScope = {}): Promise<Project[]> {
    // A Member reads only the Projects they may see (#307).
    if (scope.visibleToUserId) {
      const rows = await db
        .select({ project: projects })
        .from(projects)
        .innerJoin(crmProjects, eq(crmProjects.projectId, projects.id))
        .where(and(inWorkspace(projects), inWorkspace(crmProjects), crmProjectVisibleTo(scope.visibleToUserId)))
        .orderBy(desc(projects.updatedAt));
      return rows.map((row) => row.project);
    }
    // Return all projects for company-wide visibility inside the Active Workspace.
    return db
      .select()
      .from(projects)
      .where(inWorkspace(projects))
      .orderBy(desc(projects.updatedAt));
  }

  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), inWorkspace(projects)));
    return project;
  }

  async isProjectVisibleTo(projectId: string, userId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: crmProjects.id })
      .from(crmProjects)
      .where(and(eq(crmProjects.projectId, projectId), inWorkspace(crmProjects), crmProjectVisibleTo(userId)))
      .limit(1);
    return Boolean(row);
  }

  async createProject(
    project: InsertProject & { ownerId: string },
    writer: ProjectWriter = db
  ): Promise<Project> {
    const [newProject] = await writer
      .insert(projects)
      .values(stampWorkspace(project))
      .returning();
    return newProject;
  }

  async updateProject(id: string, data: Partial<InsertProject>): Promise<Project | undefined> {
    const [updated] = await db
      .update(projects)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(projects.id, id), inWorkspace(projects)))
      .returning();
    return updated;
  }

  async deleteProject(id: string): Promise<void> {
    await db
      .delete(documents)
      .where(and(eq(documents.projectId, id), inWorkspace(documents)));
    await db.delete(projects).where(and(eq(projects.id, id), inWorkspace(projects)));
  }

  async getDocuments(projectId: string): Promise<Document[]> {
    return db
      .select()
      .from(documents)
      .where(and(eq(documents.projectId, projectId), inWorkspace(documents)))
      .orderBy(asc(documents.position), asc(documents.createdAt), asc(documents.id));
  }

  async getDocument(id: string): Promise<Document | undefined> {
    const [doc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), inWorkspace(documents)));
    return doc;
  }

  async getDocumentAncestors(id: string): Promise<Document[]> {
    const ancestors: Document[] = [];
    let currentId: string | null = id;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const [doc] = await db
        .select()
        .from(documents)
        .where(and(eq(documents.id, currentId), inWorkspace(documents)));
      if (!doc) break;

      if (doc.parentId && doc.id !== id) {
        ancestors.unshift(doc);
      }
      currentId = doc.parentId;
    }

    return ancestors;
  }

  async getRecentDocuments(userId: string, limit: number = 10, scope?: ProjectDocumentScope): Promise<Document[]> {
    const userProjects = await this.getProjects(userId, scope);
    const projectIds = userProjects.map((p) => p.id);

    if (projectIds.length === 0) return [];

    return db
      .select()
      .from(documents)
      .where(
        and(
          or(...projectIds.map((pid) => eq(documents.projectId, pid))),
          inWorkspace(documents)
        )
      )
      .orderBy(desc(documents.updatedAt))
      .limit(limit);
  }

  async createDocument(document: InsertDocument, writer: DocumentWriter = db): Promise<Document> {
    const existingDocs = await writer
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.projectId, document.projectId),
          document.parentId ? eq(documents.parentId, document.parentId) : isNull(documents.parentId),
          inWorkspace(documents)
        )
      );

    const maxPosition = existingDocs.reduce((max, doc) => Math.max(max, doc.position), -1);

    const [newDoc] = await writer
      .insert(documents)
      .values(stampWorkspace({
        ...document,
        position: maxPosition + 1,
      }))
      .returning();

    await writer
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(and(eq(projects.id, document.projectId), inWorkspace(projects)));

    return newDoc;
  }

  async updateDocument(
    id: string,
    data: Partial<InsertDocument>,
    writer: DocumentWriter = db,
    options: SaveOptions = {}
  ): Promise<Document | undefined> {
    const [updated] = await writer
      .update(documents)
      .set({ ...data, updatedAt: nextUpdatedAt(documents.updatedAt, options.expectedUpdatedAt) })
      .where(and(
        eq(documents.id, id),
        inWorkspace(documents),
        unchangedSince(documents.updatedAt, options.expectedUpdatedAt),
      ))
      .returning();

    if (updated) {
      await writer
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, updated.projectId));
    }

    return updated;
  }

  async deleteDocument(id: string): Promise<void> {
    const deleteRecursive = async (docId: string) => {
      const children = await db
        .select()
        .from(documents)
        .where(and(eq(documents.parentId, docId), inWorkspace(documents)));

      for (const child of children) {
        await deleteRecursive(child.id);
      }

      await db.delete(documents).where(and(eq(documents.id, docId), inWorkspace(documents)));
    };

    await deleteRecursive(id);
  }

  async duplicateDocument(id: string): Promise<Document | undefined> {
    const original = await this.getDocument(id);
    if (!original) return undefined;

    return await db.transaction(async (tx) => {
      const generateUniqueTitle = async (
        baseTitle: string,
        parentId: string | null,
        projectId: string
      ): Promise<string> => {
        const siblings = await tx
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.projectId, projectId),
              parentId
                ? eq(documents.parentId, parentId)
                : isNull(documents.parentId)
            )
          );

        const existingTitles = new Set(siblings.map((d) => d.title));
        let title = baseTitle;
        let counter = 1;

        while (existingTitles.has(title)) {
          title = counter === 1 ? `${baseTitle} (Copy)` : `${baseTitle} (Copy ${counter})`;
          counter++;
        }

        return title;
      };

      const newPosition = original.position + 1;

      await tx
        .update(documents)
        .set({
          position: sql`${documents.position} + 1`,
        })
        .where(
          and(
            eq(documents.projectId, original.projectId),
            original.parentId
              ? eq(documents.parentId, original.parentId)
              : isNull(documents.parentId),
            sql`${documents.position} >= ${newPosition}`
          )
        );

      const duplicateRecursive = async (
        doc: Document,
        newParentId: string | null,
        isRoot: boolean
      ): Promise<Document> => {
        const title = await generateUniqueTitle(doc.title, newParentId, doc.projectId);

        const newId = randomUUID();
        const [newDoc] = await tx
          .insert(documents)
          .values(stampWorkspace({
            id: newId,
            title,
            content: doc.content,
            icon: doc.icon,
            projectId: doc.projectId,
            parentId: newParentId,
            position: isRoot ? newPosition : doc.position,
          }))
          .returning();

        const children = await tx
          .select()
          .from(documents)
          .where(eq(documents.parentId, doc.id))
          .orderBy(documents.position);

        for (const child of children) {
          await duplicateRecursive(child, newDoc.id, false);
        }

        return newDoc;
      };

      const duplicatedDoc = await duplicateRecursive(original, original.parentId, true);

      await tx
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, original.projectId));

      return duplicatedDoc;
    });
  }

  async reorderDocument(id: string, newParentId: string | null, newPosition: number): Promise<void> {
    const doc = await this.getDocument(id);
    if (!doc) return;

    await db.transaction(async (tx) => {
      // Get siblings at the new location
      const siblings = await tx
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.projectId, doc.projectId),
            newParentId
              ? eq(documents.parentId, newParentId)
              : isNull(documents.parentId),
            sql`${documents.id} != ${id}`
          )
        )
        .orderBy(asc(documents.position));

      // Reassign positions for all siblings at new location
      for (let i = 0; i < siblings.length; i++) {
        const sibling = siblings[i];
        let targetPosition = i;
        if (i >= newPosition) {
          targetPosition = i + 1;
        }
        if (sibling.position !== targetPosition) {
          await tx
            .update(documents)
            .set({ position: targetPosition })
            .where(eq(documents.id, sibling.id));
        }
      }

      // Update the moved document
      await tx
        .update(documents)
        .set({
          parentId: newParentId,
          position: newPosition,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, id));

      // Update project timestamp
      await tx
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, doc.projectId));
    });
  }

  async search(
    userId: string,
    query: string,
    scope?: ProjectDocumentScope,
  ): Promise<Array<{ type: string; id: string; title: string; projectName?: string }>> {
    const results: Array<{ type: string; id: string; title: string; projectName?: string }> = [];
    const searchPattern = `%${query}%`;

    const userProjects = await db
      .select()
      .from(projects)
      .where(and(eq(projects.ownerId, userId), like(projects.name, searchPattern), inWorkspace(projects)));

    for (const project of userProjects) {
      results.push({
        type: "project",
        id: project.id,
        title: project.name,
      });
    }

    const allUserProjects = await this.getProjects(userId, scope);
    const projectIds = allUserProjects.map((p) => p.id);
    const projectMap = new Map(allUserProjects.map((p) => [p.id, p.name]));

    if (projectIds.length > 0) {
      const matchingDocs = await db
        .select()
        .from(documents)
        .where(
          and(
            or(...projectIds.map((pid) => eq(documents.projectId, pid))),
            like(documents.title, searchPattern)
          )
        )
        .limit(20);

      for (const doc of matchingDocs) {
        results.push({
          type: "document",
          id: doc.id,
          title: doc.title,
          projectName: projectMap.get(doc.projectId),
        });
      }
    }

    return results.slice(0, 20);
  }

  async getAllUserDocuments(userId: string, scope?: ProjectDocumentScope): Promise<Array<Document & { projectName: string }>> {
    const userProjects = await this.getProjects(userId, scope);
    const projectIds = userProjects.map((p) => p.id);
    const projectMap = new Map(userProjects.map((p) => [p.id, p.name]));

    if (projectIds.length === 0) return [];

    const allDocs = await db
      .select()
      .from(documents)
      .where(and(inArray(documents.projectId, projectIds), inWorkspace(documents)))
      .orderBy(documents.projectId, documents.position);

    return allDocs.map(doc => ({
      ...doc,
      projectName: projectMap.get(doc.projectId) || "Unknown Project"
    }));
  }

  // CRM Clients - Company-wide visibility
  async getCrmClients(userId?: string): Promise<CrmClient[]> {
    // Return all clients for company-wide visibility
    return db
      .select()
      .from(crmClients)
      .where(inWorkspace(crmClients))
      .orderBy(asc(crmClients.name));
  }

  async getCrmClientPage(
    options: CrmClientListOptions,
  ): Promise<{ data: CrmClientRegisterRow[]; total: number; page: number; pageSize: number }> {
    const { page, pageSize } = options;
    // The Client Projects: documentation-only Projects are not delivery work,
    // and a row is a Client Project only once its Opportunity is won (open and
    // lost sales are Opportunities, not Projects).
    const clientProjects = sql`from ${crmProjects}
      where ${crmProjects.clientId} = ${crmClients.id}
        and ${crmProjects.workspaceId} = ${crmClients.workspaceId}
        and coalesce(${crmProjects.isDocumentationOnly}, 0) = 0
        and ${inArray(crmProjects.status, [...WON_STATUSES])}`;
    const projectCount = sql<number>`(select count(*)::int ${clientProjects})`;
    const hasOpenProject = sql`exists (select 1 ${clientProjects}
      and ${crmProjects.projectStatus} not in ('completed', 'archived'))`;

    const conditions: any[] = [inWorkspace(crmClients)];
    if (options.status) conditions.push(eq(crmClients.status, options.status));
    if (options.source === "none") conditions.push(isNull(crmClients.source));
    else if (options.source) conditions.push(eq(crmClients.source, options.source));
    if (options.openProjects === true) conditions.push(hasOpenProject);
    if (options.openProjects === false) conditions.push(sql`not ${hasOpenProject}`);
    const needle = options.search?.trim();
    if (needle) {
      const pattern = `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      conditions.push(or(ilike(crmClients.name, pattern), ilike(crmClients.company, pattern)));
    }

    const [countResult] = await db.select({ count: count() }).from(crmClients).where(and(...conditions));

    const direction = options.dir === "desc" ? sql`desc nulls last` : sql`asc nulls last`;
    // Status and source values order the same way as their labels.
    const sortExpression = {
      name: sql`lower(${crmClients.name})`,
      company: sql`lower(nullif(${crmClients.company}, ''))`,
      status: sql`${crmClients.status}`,
      source: sql`${crmClients.source}`,
      projects: projectCount,
      created: sql`${crmClients.createdAt}`,
    };
    const lead = options.sort ? sortExpression[options.sort] : sortExpression.name;
    const rows = await db
      .select({ client: crmClients, projectCount })
      .from(crmClients)
      .where(and(...conditions))
      .orderBy(sql`${lead} ${direction}`, sql`lower(${crmClients.name}) asc`, asc(crmClients.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      data: rows.map((row) => ({ ...row.client, projectCount: Number(row.projectCount) })),
      total: Number(countResult?.count ?? 0),
      page,
      pageSize,
    };
  }

  async getCrmClient(id: string): Promise<CrmClient | undefined> {
    const [client] = await db
      .select()
      .from(crmClients)
      .where(and(eq(crmClients.id, id), inWorkspace(crmClients)));
    return client;
  }

  async createCrmClient(client: InsertCrmClient & { ownerId: string }): Promise<CrmClient> {
    const [newClient] = await db.insert(crmClients).values(stampWorkspace(client)).returning();
    return newClient;
  }

  async updateCrmClient(id: string, data: Partial<InsertCrmClient>): Promise<CrmClient | undefined> {
    const [updated] = await db
      .update(crmClients)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(crmClients.id, id), inWorkspace(crmClients)))
      .returning();
    return updated;
  }

  async deleteCrmClient(id: string): Promise<void> {
    await db.delete(crmClients).where(and(eq(crmClients.id, id), inWorkspace(crmClients)));
  }

  // CRM Contacts
  async getCrmContacts(clientId: string): Promise<CrmContact[]> {
    return db
      .select()
      .from(crmContacts)
      .where(and(eq(crmContacts.clientId, clientId), inWorkspace(crmContacts)))
      .orderBy(desc(crmContacts.isPrimary), asc(crmContacts.name));
  }

  async getCrmContact(id: string): Promise<CrmContact | undefined> {
    const [contact] = await db
      .select()
      .from(crmContacts)
      .where(and(eq(crmContacts.id, id), inWorkspace(crmContacts)));
    return contact;
  }

  async createCrmContact(contact: InsertCrmContact): Promise<CrmContact> {
    const [newContact] = await db.insert(crmContacts).values(stampWorkspace(contact)).returning();
    return newContact;
  }

  async updateCrmContact(id: string, data: Partial<InsertCrmContact>): Promise<CrmContact | undefined> {
    const [updated] = await db
      .update(crmContacts)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(crmContacts.id, id), inWorkspace(crmContacts)))
      .returning();
    return updated;
  }

  async deleteCrmContact(id: string): Promise<void> {
    await db.delete(crmContacts).where(and(eq(crmContacts.id, id), inWorkspace(crmContacts)));
  }

  // CRM Projects - Company-wide visibility
  async getCrmProjects(userId?: string, options?: CrmProjectListOptions): Promise<{ data: CrmProjectWithDetails[]; total: number; page: number; pageSize: number }> {
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 10;
    const offset = (page - 1) * pageSize;

    // Get all projects for company-wide visibility
    const allProjects = await this.getProjects();
    const projectIds = allProjects.map((p) => p.id);

    if (projectIds.length === 0) {
      return { data: [], total: 0, page, pageSize };
    }

    // Build conditions - always exclude documentation-only projects from CRM view
    const conditions: any[] = [
      eq(crmProjects.isDocumentationOnly, 0),
      inWorkspace(crmProjects),
    ];

    if (options?.deliveryOnly) {
      conditions.push(crmProjectIsDelivery());
    }
    if (options?.status) {
      conditions.push(eq(crmProjects.status, options.status));
    }
    if (options?.projectStatus) {
      const statuses = options.projectStatus.split(",").map((value) => value.trim()).filter(Boolean);
      if (statuses.length > 0) conditions.push(inArray(crmProjects.projectStatus, statuses));
    }
    if (options?.clientId) {
      conditions.push(eq(crmProjects.clientId, options.clientId));
    }
    if (options?.projectType) {
      conditions.push(eq(crmProjects.projectType, options.projectType));
    }
    if (options?.tagId) {
      conditions.push(
        inArray(
          crmProjects.id,
          db.select({ id: crmProjectTags.crmProjectId }).from(crmProjectTags).where(eq(crmProjectTags.tagId, options.tagId)),
        ),
      );
    }
    if (options?.dueNone) {
      conditions.push(isNull(crmProjects.dueDate));
    }
    if (options?.dueFrom) {
      conditions.push(gte(crmProjects.dueDate, options.dueFrom));
    }
    if (options?.dueTo) {
      conditions.push(lte(crmProjects.dueDate, options.dueTo));
    }
    if (options?.leadId) {
      conditions.push(sql`coalesce(
        (select ${projectMembers.userId} from ${projectMembers}
          where ${projectMembers.crmProjectId} = ${crmProjects.id}
          order by ${projectMembers.createdAt} asc, ${projectMembers.id} asc limit 1),
        ${crmProjects.assigneeId}
      ) = ${options.leadId}`);
    }
    if (options?.visibleToUserId) {
      conditions.push(crmProjectVisibleTo(options.visibleToUserId));
    }
    const needle = options?.search?.trim();
    if (needle) {
      const pattern = `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      conditions.push(
        or(
          inArray(crmProjects.projectId, db.select({ id: projects.id }).from(projects).where(ilike(projects.name, pattern))),
          inArray(
            crmProjects.clientId,
            db
              .select({ id: crmClients.id })
              .from(crmClients)
              .where(or(ilike(crmClients.name, pattern), ilike(crmClients.company, pattern))),
          ),
        ),
      );
    }

    // Count total
    const [countResult] = await db.select({ count: count() }).from(crmProjects).where(and(...conditions));

    const total = countResult?.count || 0;

    // Get paginated data. A sorted column leads; recency and id keep pages stable under ties.
    const direction = options?.dir === "desc" ? sql`desc nulls last` : sql`asc nulls last`;
    // Every Time Entry of the Project, every user: what the budget meter counts.
    const trackedSecondsSql = sql<number>`coalesce((select sum(${timeEntries.duration}) from ${timeEntries}
      where ${timeEntries.crmProjectId} = "crm_projects"."id" and ${inWorkspace(timeEntries)}), 0)::int`;
    const sortExpression = {
      name: sql`lower((select ${projects.name} from ${projects} where ${projects.id} = ${crmProjects.projectId}))`,
      // The lifecycle, not the alphabet; an unknown status sorts after archived.
      status: sql`case ${crmProjects.projectStatus}
        when 'planned' then 0 when 'active' then 1 when 'on_hold' then 2
        when 'in_review' then 3 when 'completed' then 4 when 'archived' then 5 else 6 end`,
      // BUDGET USED: hours and minutes, as the meter counts them; no budget sorts last either way.
      // Tracked time is every user's, so only a caller who may see it (`withTrackedTime`) may order by it.
      budget: sql`case when coalesce(${crmProjects.budgetedHours}, 0) + coalesce(${crmProjects.budgetedMinutes}, 0) / 60.0 > 0
        then ${trackedSecondsSql}::float / 3600.0
          / (coalesce(${crmProjects.budgetedHours}, 0) + coalesce(${crmProjects.budgetedMinutes}, 0) / 60.0) end`,
      created: sql`${crmProjects.createdAt}`,
      // DUE: no due date sorts last either way.
      due: sql`${crmProjects.dueDate}`,
    };
    const withTrackedTime = options?.withTrackedTime === true;
    const sortKey = options?.sort === "budget" && !withTrackedTime ? undefined : options?.sort;
    const order = sortKey
      ? [sql`${sortExpression[sortKey]} ${direction}`, desc(crmProjects.updatedAt), asc(crmProjects.id)]
      : [desc(crmProjects.updatedAt), asc(crmProjects.id)];
    const crmProjectRows = await db
      .select({ crmProject: crmProjects, trackedSeconds: withTrackedTime ? trackedSecondsSql : sql<number>`null` })
      .from(crmProjects)
      .where(and(...conditions))
      .orderBy(...order)
      .limit(pageSize)
      .offset(offset)
      .then((rows) => rows.map((row) => (withTrackedTime ? { ...row.crmProject, trackedSeconds: Number(row.trackedSeconds) } : row.crmProject)));

    // Get all related data
    const projectMap = new Map(allProjects.map((p) => [p.id, p]));

    // Get clients
    const clientIds = crmProjectRows.map((cp) => cp.clientId).filter(Boolean) as string[];
    const clientsData = clientIds.length > 0 
      ? await db.select().from(crmClients).where(or(...clientIds.map((id) => eq(crmClients.id, id))))
      : [];
    const clientMap = new Map(clientsData.map((c) => [c.id, c]));

    // Get contacts for clients
    const contactsData = clientIds.length > 0
      ? await db.select().from(crmContacts).where(or(...clientIds.map((id) => eq(crmContacts.clientId, id))))
      : [];
    const contactsByClient = new Map<string, CrmContact[]>();
    contactsData.forEach((contact) => {
      const existing = contactsByClient.get(contact.clientId) || [];
      existing.push(contact);
      contactsByClient.set(contact.clientId, existing);
    });

    // Get assignees
    const assigneeIds = crmProjectRows.map((cp) => cp.assigneeId).filter(Boolean) as string[];
    const assigneesData = assigneeIds.length > 0
      ? await db.select().from(users).where(or(...assigneeIds.map((id) => eq(users.id, id))))
      : [];
    const assigneeMap = new Map(assigneesData.map((u) => [u.id, {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      profileImageUrl: u.profileImageUrl,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    } as SafeUser]));

    // Get latest notes for each CRM project
    const crmProjectIds = crmProjectRows.map((cp) => cp.id);
    const latestNotesMap = new Map<string, CrmProjectNoteWithCreator>();
    
    // Get tags for each CRM project
    const tagsMap = new Map<string, CrmTag[]>();
    if (crmProjectIds.length > 0) {
      const projectTagsData = await db
        .select({ projectTag: crmProjectTags, tag: crmTags })
        .from(crmProjectTags)
        .innerJoin(crmTags, eq(crmProjectTags.tagId, crmTags.id))
        .where(or(...crmProjectIds.map(id => eq(crmProjectTags.crmProjectId, id))));
      
      projectTagsData.forEach(({ projectTag, tag }) => {
        const existing = tagsMap.get(projectTag.crmProjectId) || [];
        existing.push(tag);
        tagsMap.set(projectTag.crmProjectId, existing);
      });
    }

    // Get members for each CRM project
    const membersMap = new Map<string, ProjectMemberWithUser[]>();
    if (crmProjectIds.length > 0) {
      const memberRows = await db.query.projectMembers.findMany({
        where: or(...crmProjectIds.map(id => eq(projectMembers.crmProjectId, id))),
        with: { user: true },
        orderBy: [asc(projectMembers.createdAt), asc(projectMembers.id)],
      });
      memberRows.forEach((row) => {
        const { user, ...rest } = row as any;
        const safeUser = user
          ? {
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              profileImageUrl: user.profileImageUrl,
            }
          : undefined;
        const member = { ...rest, user: safeUser } as ProjectMemberWithUser;
        const existing = membersMap.get(member.crmProjectId) || [];
        existing.push(member);
        membersMap.set(member.crmProjectId, existing);
      });
    }
    
    if (crmProjectIds.length > 0) {
      // Get all notes and group by project, keeping only the latest
      const allNotes = await db
        .select()
        .from(crmProjectNotes)
        .where(or(...crmProjectIds.map(id => eq(crmProjectNotes.crmProjectId, id))))
        .orderBy(desc(crmProjectNotes.createdAt));
      
      // Get unique creator IDs for notes
      const noteCreatorIds = [...new Set(allNotes.map(n => n.createdById))];
      const noteCreatorsData = noteCreatorIds.length > 0
        ? await db.select().from(users).where(or(...noteCreatorIds.map(id => eq(users.id, id))))
        : [];
      const noteCreatorMap = new Map(noteCreatorsData.map((u) => [u.id, toSafeUser(u)]));
      
      // Keep only the latest note per project
      allNotes.forEach(note => {
        if (!latestNotesMap.has(note.crmProjectId)) {
          latestNotesMap.set(note.crmProjectId, {
            ...note,
            createdBy: noteCreatorMap.get(note.createdById),
          });
        }
      });
    }

    const data: CrmProjectWithDetails[] = crmProjectRows.map((cp) => {
      const project = projectMap.get(cp.projectId);
      const client = cp.clientId ? clientMap.get(cp.clientId) : undefined;
      const clientContacts = cp.clientId ? contactsByClient.get(cp.clientId) : undefined;
      const assignee = cp.assigneeId ? assigneeMap.get(cp.assigneeId) : undefined;
      const latestNote = latestNotesMap.get(cp.id);
      const tags = tagsMap.get(cp.id) || [];
      const members = membersMap.get(cp.id) || [];

      return {
        ...cp,
        project,
        client: client ? { ...client, contacts: clientContacts } : undefined,
        assignee,
        members,
        latestNote,
        tags,
      };
    });

    return { data, total: Number(total), page, pageSize };
  }

  async getCrmProject(id: string): Promise<CrmProjectWithDetails | undefined> {
    const [crmProject] = await db.select().from(crmProjects).where(and(eq(crmProjects.id, id), inWorkspace(crmProjects)));
    if (!crmProject) return undefined;

    const project = await this.getProject(crmProject.projectId);
    
    let client: (CrmClient & { contacts?: CrmContact[] }) | undefined;
    if (crmProject.clientId) {
      const clientData = await this.getCrmClient(crmProject.clientId);
      if (clientData) {
        const contacts = await this.getCrmContacts(clientData.id);
        client = { ...clientData, contacts };
      }
    }

    let assignee: SafeUser | undefined;
    if (crmProject.assigneeId) {
      const user = await this.getUser(crmProject.assigneeId);
      if (user) {
        assignee = user;
      }
    }

    const members = await this.getProjectMembers(crmProject.id);

    return { ...crmProject, project, client, assignee, members };
  }

  /** Every Time Entry of the Project, every user: Owners and Administrators only may be shown it. */
  async getCrmProjectTrackedSeconds(crmProjectId: string): Promise<number> {
    const [tracked] = await db
      .select({ seconds: sql<number>`coalesce(sum(${timeEntries.duration}), 0)::int` })
      .from(timeEntries)
      .where(and(eq(timeEntries.crmProjectId, crmProjectId), inWorkspace(timeEntries)));
    return Number(tracked?.seconds ?? 0);
  }

  async getCrmProjectByProjectId(projectId: string): Promise<CrmProject | undefined> {
    const [crmProject] = await db
      .select()
      .from(crmProjects)
      .where(and(eq(crmProjects.projectId, projectId), inWorkspace(crmProjects)));
    return crmProject;
  }

  async createCrmProject(crmProject: InsertCrmProject): Promise<CrmProject> {
    const [newCrmProject] = await db.insert(crmProjects).values(stampWorkspace(crmProject)).returning();
    return newCrmProject;
  }

  async getOpportunity(id: string): Promise<Opportunity | undefined> {
    const [row] = await db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, id), inWorkspace(opportunities)));
    return row;
  }

  async getOpportunityByCrmProjectId(crmProjectId: string): Promise<Opportunity | undefined> {
    const [row] = await db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.crmProjectId, crmProjectId), inWorkspace(opportunities)));
    return row;
  }

  async createOpportunity(opportunity: InsertOpportunity): Promise<Opportunity> {
    const [row] = await db.insert(opportunities).values(stampWorkspace(opportunity)).returning();
    return row;
  }

  async updateOpportunity(
    id: string,
    data: Partial<InsertOpportunity>
  ): Promise<Opportunity | undefined> {
    const [updated] = await db
      .update(opportunities)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(opportunities.id, id), inWorkspace(opportunities)))
      .returning();
    return updated;
  }

  async createClientProjectFromOpportunity(
    opportunityId: string,
    projectData: InsertProject & { ownerId: string }
  ): Promise<{ project: Project; crmProject: CrmProject; opportunity: Opportunity }> {
    const opportunity = await this.getOpportunity(opportunityId);
    if (!opportunity) {
      throw new Error("Opportunity not found");
    }
    if (opportunity.stage !== "won") {
      throw new Error("Only a won Opportunity can create a Client Project");
    }
    if (opportunity.crmProjectId) {
      const crmProject = await this.getCrmProject(opportunity.crmProjectId);
      if (!crmProject) {
        throw new Error("Linked Project not found");
      }
      const project = await this.getProject(crmProject.projectId);
      if (!project) {
        throw new Error("Linked Project not found");
      }
      return { project, crmProject, opportunity };
    }

    const project = await this.createProject(projectData);
    const crmProject = await this.createCrmProject({
      projectId: project.id,
      clientId: opportunity.clientId,
      status: "won",
      projectStatus: "planned",
    });
    await this.addProjectMember(crmProject.id, projectData.ownerId);
    const linked = await this.updateOpportunity(opportunity.id, { crmProjectId: crmProject.id });
    if (!linked) {
      throw new Error("Opportunity not found");
    }
    return { project, crmProject, opportunity: linked };
  }

  async updateCrmProject(id: string, data: Partial<InsertCrmProject>): Promise<CrmProject | undefined> {
    const patch = { ...data };
    if (data.status !== undefined) {
      patch.projectStatus = projectStatusFromCombined(data.status);
    }
    const [updated] = await db
      .update(crmProjects)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(crmProjects.id, id))
      .returning();
    if (updated) {
      await this.syncOpportunityForProject(updated);
    }
    return updated;
  }

  private async syncOpportunityForProject(project: CrmProject): Promise<void> {
    const existing = await this.getOpportunityByCrmProjectId(project.id);
    if (!projectHasOpportunity(project)) {
      if (existing) {
        await db.delete(opportunities).where(eq(opportunities.id, existing.id));
      }
      return;
    }
    const stage = opportunityStageFromCombined(project.status);
    if (existing) {
      await this.updateOpportunity(existing.id, { stage, clientId: project.clientId });
      return;
    }
    await this.createOpportunity({
      crmProjectId: project.id,
      clientId: project.clientId,
      stage,
    });
  }

  async deleteCrmProject(id: string): Promise<void> {
    // First get the CRM project to find the linked project ID
    const [crmProject] = await db.select().from(crmProjects).where(and(eq(crmProjects.id, id), inWorkspace(crmProjects)));
    
    if (crmProject && crmProject.projectId) {
      // Delete the CRM project first (FK constraint)
      await db.delete(crmProjects).where(eq(crmProjects.id, id));
      // Then delete the base project
      await db.delete(projects).where(eq(projects.id, crmProject.projectId));
    } else {
      // Just delete the CRM project if no linked project
      await db.delete(crmProjects).where(eq(crmProjects.id, id));
    }
  }

  async createCrmProjectWithBase(
    projectData: InsertProject & { ownerId: string }, 
    crmData?: Partial<InsertCrmProject>
  ): Promise<{ project: Project; crmProject: CrmProject }> {
    const project = await this.createProject(projectData);
    const status = crmData?.status || "lead";
    
    const crmProject = await this.createCrmProject({
      projectId: project.id,
      clientId: crmData?.clientId || null,
      status,
      projectStatus: projectStatusFromCombined(status),
      assigneeId: crmData?.assigneeId || null,
      startDate: crmData?.startDate || null,
      dueDate: crmData?.dueDate || null,
      actualFinishDate: crmData?.actualFinishDate || null,
      comments: crmData?.comments || null,
      documentationEnabled: crmData?.documentationEnabled || 0,
      isDocumentationOnly: crmData?.isDocumentationOnly || 0,
      budgetedHours: crmData?.budgetedHours ?? null,
      budgetedMinutes: crmData?.budgetedMinutes ?? 0,
      actualHours: crmData?.actualHours ?? null,
      opportunityOwnerId: crmData?.opportunityOwnerId ?? null,
      source: crmData?.source ?? null,
      estimatedValueMinor: crmData?.estimatedValueMinor ?? null,
      estimatedValueCurrency: crmData?.estimatedValueCurrency ?? null,
      lostReason: crmData?.lostReason ?? null,
      lostReasonDetail: crmData?.lostReasonDetail ?? null,
    });

    // Auto-add the creator as a project member
    await this.addProjectMember(crmProject.id, projectData.ownerId);

    if (projectHasOpportunity(crmProject)) {
      await this.createOpportunity({
        crmProjectId: crmProject.id,
        clientId: crmProject.clientId,
        stage: opportunityStageFromCombined(status),
      });
    }

    return { project, crmProject };
  }

  async toggleDocumentation(crmProjectId: string, enabled: boolean, userId: string): Promise<CrmProject | undefined> {
    // Get the CRM project to find the associated project
    const crmProject = await db.query.crmProjects.findFirst({
      where: eq(crmProjects.id, crmProjectId),
    });
    
    if (!crmProject) return undefined;
    
    const [updated] = await db
      .update(crmProjects)
      .set({ documentationEnabled: enabled ? 1 : 0, updatedAt: new Date() })
      .where(eq(crmProjects.id, crmProjectId))
      .returning();
    
    // If enabling documentation, create default pages if they don't exist
    if (enabled && crmProject.projectId) {
      const existingDocs = await db
        .select()
        .from(documents)
        .where(eq(documents.projectId, crmProject.projectId));
      
      if (existingDocs.length === 0) {
        for (const page of DEFAULT_PROJECT_PAGES) {
          await this.createDocument({
            projectId: crmProject.projectId,
            parentId: null,
            title: page.title,
            content: page.content,
            createdById: userId,
          });
        }
      }
    }
    
    return updated;
  }

  async getDocumentationEnabledProjects(userId?: string, scope: ProjectDocumentScope = {}): Promise<Project[]> {
    // Both sides of the join are Workspace-owned, so both are scoped. Within the
    // Workspace, `scope` holds a Member to the Projects they may see (#310).
    const result = await db
      .select({ project: projects })
      .from(projects)
      .innerJoin(crmProjects, eq(projects.id, crmProjects.projectId))
      .where(and(
        eq(crmProjects.documentationEnabled, 1),
        inWorkspace(projects),
        inWorkspace(crmProjects),
        scope.visibleToUserId ? crmProjectVisibleTo(scope.visibleToUserId) : undefined
      ))
      .orderBy(desc(projects.updatedAt));
    
    return result.map(r => r.project);
  }

  async getProjectDocumentationPage(options: ProjectDocumentationListOptions): Promise<ProjectDocumentationPage> {
    const { page, pageSize } = options;
    const scope: any[] = [
      inWorkspace(projects),
      inWorkspace(crmProjects),
      or(eq(crmProjects.isDocumentationOnly, 1), crmProjectIsDelivery()),
    ];
    if (options.visibleToUserId) {
      scope.push(crmProjectVisibleTo(options.visibleToUserId));
    }

    const conditions = [...scope];
    if (options.documentation === "enabled") conditions.push(eq(crmProjects.documentationEnabled, 1));
    if (options.documentation === "disabled") conditions.push(sql`coalesce(${crmProjects.documentationEnabled}, 0) = 0`);
    if (options.projectId) conditions.push(eq(projects.id, options.projectId));
    if (options.clientId) conditions.push(eq(crmProjects.clientId, options.clientId));
    const needle = options.search?.trim();
    if (needle) {
      const pattern = `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      conditions.push(
        or(
          ilike(projects.name, pattern),
          inArray(
            projects.id,
            db
              .select({ id: documents.projectId })
              .from(documents)
              .where(and(ilike(documents.title, pattern), inWorkspace(documents))),
          ),
          inArray(
            projects.id,
            db
              .select({ id: files.projectId })
              .from(files)
              .where(and(ilike(files.name, pattern), eq(files.scanStatus, "available"), inWorkspace(files))),
          ),
        ),
      );
    }

    const [countResult] = await db
      .select({ count: count() })
      .from(projects)
      .innerJoin(crmProjects, eq(projects.id, crmProjects.projectId))
      .where(and(...conditions));
    const rows = await db
      .select({
        project: projects,
        crmProject: crmProjects,
        clientName: crmClients.name,
        owner: documentPersonColumns,
      })
      .from(projects)
      .innerJoin(crmProjects, eq(projects.id, crmProjects.projectId))
      .leftJoin(crmClients, and(eq(crmClients.id, crmProjects.clientId), inWorkspace(crmClients)))
      .leftJoin(users, eq(users.id, projects.ownerId))
      .where(and(...conditions))
      .orderBy(desc(projectDocumentationActivity()), asc(projects.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const ids = rows.map((row) => row.project.id);
    const docs = ids.length
      ? await db
          .select({
            id: documents.id,
            title: documents.title,
            projectId: documents.projectId,
            parentId: documents.parentId,
            position: documents.position,
            createdById: documents.createdById,
            createdAt: documents.createdAt,
            updatedAt: documents.updatedAt,
            createdBy: documentPersonColumns,
          })
          .from(documents)
          .leftJoin(users, eq(users.id, documents.createdById))
          .where(and(inArray(documents.projectId, ids), inWorkspace(documents)))
          .orderBy(asc(documents.position), asc(documents.createdAt), asc(documents.id))
      : [];
    const docsByProject = new Map<string, typeof docs>();
    for (const doc of docs) {
      const list = docsByProject.get(doc.projectId) ?? [];
      list.push(doc);
      docsByProject.set(doc.projectId, list);
    }
    const projectFiles = ids.length ? await this.getProjectFiles(ids) : [];
    const filesByProject = new Map<string, typeof projectFiles>();
    for (const file of projectFiles) {
      const list = filesByProject.get(file.projectId) ?? [];
      list.push(file);
      filesByProject.set(file.projectId, list);
    }

    const choices = await db
      .select({
        id: projects.id,
        name: projects.name,
        documentationEnabled: crmProjects.documentationEnabled,
        isDocumentationOnly: crmProjects.isDocumentationOnly,
      })
      .from(projects)
      .innerJoin(crmProjects, eq(projects.id, crmProjects.projectId))
      .where(and(...scope))
      .orderBy(sql`lower(${projects.name})`, asc(projects.id));

    return {
      data: rows.map((row) => ({
        project: row.project,
        crmProjectId: row.crmProject.id,
        clientId: row.crmProject.clientId,
        clientName: row.clientName,
        owner: row.owner,
        documentationEnabled: row.crmProject.documentationEnabled === 1,
        isDocumentationOnly: row.crmProject.isDocumentationOnly === 1,
        documents: docsByProject.get(row.project.id) ?? [],
        files: filesByProject.get(row.project.id) ?? [],
      })),
      total: Number(countResult?.count ?? 0),
      page,
      pageSize,
      projects: choices.map((choice) => ({
        ...choice,
        documentationEnabled: choice.documentationEnabled === 1,
        isDocumentationOnly: choice.isDocumentationOnly === 1,
      })),
    };
  }

  async getMainAdmin(): Promise<SafeUser | undefined> {
    const [admin] = await db.select().from(users).where(eq(users.isMainAdmin, 1)).limit(1);
    if (admin) return toSafeUser(admin);
    const [anyAdmin] = await db.select().from(users).where(eq(users.role, "admin")).limit(1);
    return anyAdmin && toSafeUser(anyAdmin);
  }

  async getAllUsers(opts: { includeArchived?: boolean } = {}): Promise<SafeUser[]> {
    const safeColumns = {
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      profileImageUrl: users.profileImageUrl,
      role: users.role,
      isMainAdmin: users.isMainAdmin,
      canViewDailyUpdates: users.canViewDailyUpdates,
      hoursPerDay: users.hoursPerDay,
      lastLoginAt: users.lastLoginAt,
      isArchived: users.isArchived,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    };
    if (!opts.includeArchived) {
      return await db.select(safeColumns).from(users).where(eq(users.isArchived, false)).orderBy(asc(users.firstName), asc(users.lastName)) as SafeUser[];
    }
    return await db.select(safeColumns).from(users).orderBy(asc(users.firstName), asc(users.lastName)) as SafeUser[];
  }

  /**
   * The Users holding a Membership in the Active Workspace (#297). `getAllUsers`
   * is the platform directory (ADR-0025); a Workspace surface reading it would
   * list every account on the platform. Archived here means the account or the
   * Membership.
   */
  async getWorkspaceUsers(opts: { includeArchived?: boolean } = {}): Promise<SafeUser[]> {
    const archived = sql<boolean>`(${users.isArchived} or ${memberships.archivedAt} is not null)`;
    return await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
        role: users.role,
        isMainAdmin: users.isMainAdmin,
        canViewDailyUpdates: users.canViewDailyUpdates,
        hoursPerDay: users.hoursPerDay,
        lastLoginAt: users.lastLoginAt,
        isArchived: archived,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        opts.includeArchived
          ? inWorkspace(memberships)
          : and(inWorkspace(memberships), eq(users.isArchived, false), isNull(memberships.archivedAt))
      )
      .orderBy(asc(users.firstName), asc(users.lastName)) as SafeUser[];
  }

  /**
   * The platform directory (ADR-0025) archives the account, so every Membership
   * follows it. Restoring takes a Billable Seat in each Workspace it returns to.
   */
  async archiveUser(userId: string, isArchived: boolean): Promise<SafeUser | undefined> {
    // Memberships live in RLS-scoped rows of every Workspace the User belongs
    // to: locate them, then touch each inside its own Workspace context (#323).
    return db.transaction(async (tx) => {
      const now = new Date();
      if (!isArchived) {
        const [account] = await tx
          .select({ isArchived: users.isArchived })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        const returning = account?.isArchived ? await this.archivedWithAccount(userId, tx) : [];
        for (const { workspaceId } of returning) {
          await runWithWorkspaceContext({ workspaceId }, () => assertSeatAvailable(tx));
        }
        const [updated] = await tx
          .update(users)
          .set({ isArchived: false, updatedAt: now })
          .where(eq(users.id, userId))
          .returning();
        for (const { id, workspaceId } of returning) {
          await runWithWorkspaceContext({ workspaceId }, async () => {
            await tx
              .update(memberships)
              .set({ archivedAt: null, updatedAt: now })
              .where(and(eq(memberships.id, id), inWorkspace(memberships)));
          });
        }
        return updated && toSafeUser(updated);
      }
      // The account first: an acceptance or a restore that holds it finishes
      // before the Memberships are read, so none of them stays active.
      const [updated] = await tx
        .update(users)
        .set({ isArchived, updatedAt: now })
        .where(eq(users.id, userId))
        .returning();
      if (updated) {
        const held = await membershipsForUser(userId, tx);
        for (const { workspaceId } of held.filter((row) => row.archivedAt === null)) {
          await runWithWorkspaceContext({ workspaceId }, async () => {
            await tx
              .update(memberships)
              .set({ archivedAt: now, updatedAt: now })
              .where(
                and(
                  eq(memberships.userId, userId),
                  eq(memberships.workspaceId, workspaceId),
                  isNull(memberships.archivedAt),
                ),
              );
          });
        }
      }
      return updated && toSafeUser(updated);
    });
  }

  /**
   * The Memberships that went with the account. They share its stamp (older
   * ones were written a few ms apart). A Membership its own Workspace archived
   * carries that Workspace's Audit Event at the very same instant, and stays.
   */
  private async archivedWithAccount(userId: string, tx: Pick<typeof db, "execute" | "select">) {
    const archived = (await membershipsForUser(userId, tx))
      .flatMap((row) => (row.archivedAt ? [{ ...row, archivedAt: row.archivedAt }] : []))
      .sort((a, b) => a.workspaceId.localeCompare(b.workspaceId));
    const byAccount: typeof archived = [];
    for (const row of archived) {
      const [own] = await runWithWorkspaceContext({ workspaceId: row.workspaceId }, async () =>
        tx
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(
              inWorkspace(auditEvents),
              eq(auditEvents.action, "membership.archived"),
              eq(auditEvents.resourceId, row.id),
              eq(auditEvents.createdAt, row.archivedAt)
            )
          )
          .limit(1)
      );
      if (!own) byAccount.push(row);
    }
    const latest = Math.max(...byAccount.map((row) => row.archivedAt.getTime()));
    return byAccount.filter((row) => latest - row.archivedAt.getTime() <= 5_000);
  }

  async updateUserRole(userId: string, role: string): Promise<SafeUser | undefined> {
    const [updated] = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated && toSafeUser(updated);
  }

  async updateUser(userId: string, data: { firstName?: string; lastName?: string; email?: string; hoursPerDay?: number; canViewDailyUpdates?: number }): Promise<SafeUser | undefined> {
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select({ canViewDailyUpdates: users.canViewDailyUpdates })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      const [updated] = await tx
        .update(users)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      // Only on a change: v1's console sends the whole form on every edit, and
      // a rename must not undo what a Workspace granted on its own (F86).
      if (updated && before && updated.canViewDailyUpdates !== before.canViewDailyUpdates) {
        for (const { id, workspaceId } of await membershipsForUser(userId, tx)) {
          await runWithWorkspaceContext({ workspaceId }, async () => {
            // The Membership before its grant, as a Workspace's own change locks them.
            await tx
              .select({ id: memberships.id })
              .from(memberships)
              .where(and(inWorkspace(memberships), eq(memberships.id, id)))
              .for("update");
            await setDailyUpdatesGrant(tx, id, updated.canViewDailyUpdates === 1);
          });
        }
      }
      return updated && toSafeUser(updated);
    });
  }

  /**
   * Stamp the last login for a User who arrived on an IdentityProvider session
   * (#110). Clerk owns the sign-in, so there is no login moment on this side to
   * hook; the first request of a session is the closest thing, and this runs on
   * every one of them.
   *
   * Conditional in SQL rather than throttled in memory: an hour's resolution is
   * all the admin list shows, one statement is cheaper than a read plus a write,
   * and every replica agrees without sharing state. Most calls match no row.
   */
  async touchUserLastLogin(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(
        and(
          eq(users.id, userId),
          or(isNull(users.lastLoginAt), lt(users.lastLoginAt, new Date(Date.now() - 3600_000)))
        )
      );
  }

  async getAdminUserDetails(userId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    return user;
  }

  async deleteUser(userId: string): Promise<void> {
    await db.delete(users).where(eq(users.id, userId));
  }

  // Company Document Folders
  private companyDocumentFolderRows(where?: SQL) {
    return db
      .select({ folder: companyDocumentFolders, createdBy: documentPersonColumns })
      .from(companyDocumentFolders)
      .leftJoin(users, eq(users.id, companyDocumentFolders.createdById))
      .where(and(where, inWorkspace(companyDocumentFolders)));
  }

  async getCompanyDocumentFolders(): Promise<CompanyDocumentFolderWithCreator[]> {
    const rows = await this.companyDocumentFolderRows().orderBy(asc(companyDocumentFolders.name));
    return rows.map(({ folder, createdBy }) => ({ ...folder, createdBy: createdBy ?? undefined }));
  }

  async getCompanyDocumentFolder(id: string): Promise<CompanyDocumentFolderWithCreator | undefined> {
    const [row] = await this.companyDocumentFolderRows(eq(companyDocumentFolders.id, id));
    return row && { ...row.folder, createdBy: row.createdBy ?? undefined };
  }

  async createCompanyDocumentFolder(folder: InsertCompanyDocumentFolder): Promise<CompanyDocumentFolder> {
    const [newFolder] = await db.insert(companyDocumentFolders).values(stampWorkspace(folder)).returning();
    return newFolder;
  }

  async updateCompanyDocumentFolder(id: string, data: Partial<InsertCompanyDocumentFolder>): Promise<CompanyDocumentFolder | undefined> {
    const [updated] = await db
      .update(companyDocumentFolders)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(companyDocumentFolders.id, id), inWorkspace(companyDocumentFolders)))
      .returning();
    return updated;
  }

  async deleteCompanyDocumentFolder(id: string): Promise<CompanyDocumentFolder | undefined> {
    const [deleted] = await db
      .delete(companyDocumentFolders)
      .where(and(eq(companyDocumentFolders.id, id), inWorkspace(companyDocumentFolders)))
      .returning();
    return deleted;
  }

  // Company Documents
  private companyDocumentRows(where?: SQL) {
    return db
      .select({ document: companyDocuments, uploadedBy: documentPersonColumns })
      .from(companyDocuments)
      .leftJoin(users, eq(users.id, companyDocuments.uploadedById))
      .where(and(where, inWorkspace(companyDocuments)));
  }

  async getCompanyDocuments(folderId?: string): Promise<CompanyDocumentWithUploader[]> {
    const rows = await this.companyDocumentRows(
      folderId ? eq(companyDocuments.folderId, folderId) : isNull(companyDocuments.folderId),
    ).orderBy(desc(companyDocuments.createdAt));
    return rows.map(({ document, uploadedBy }) => ({ ...document, uploadedBy: uploadedBy ?? undefined }));
  }

  async getCompanyDocumentRegister(): Promise<CompanyDocumentRegisterRow[]> {
    const { content: _content, ...columns } = getTableColumns(companyDocuments);
    const rows = await db
      .select({ document: columns, uploadedBy: documentPersonColumns })
      .from(companyDocuments)
      .leftJoin(users, eq(users.id, companyDocuments.uploadedById))
      .where(inWorkspace(companyDocuments))
      .orderBy(desc(companyDocuments.createdAt));
    return rows.map(({ document, uploadedBy }) => ({ ...document, uploadedBy: uploadedBy ?? undefined }));
  }

  async getCompanyDocument(id: string): Promise<CompanyDocumentWithUploader | undefined> {
    const [row] = await this.companyDocumentRows(eq(companyDocuments.id, id));
    if (!row) return undefined;
    const doc = row.document;

    let folder;
    if (doc.folderId) {
      const [f] = await db
        .select()
        .from(companyDocumentFolders)
        .where(and(eq(companyDocumentFolders.id, doc.folderId), inWorkspace(companyDocumentFolders)));
      folder = f;
    }
    return { ...doc, uploadedBy: row.uploadedBy ?? undefined, folder };
  }

  async createCompanyDocument(doc: InsertCompanyDocument & { id?: string }): Promise<CompanyDocument> {
    const [newDoc] = await db.insert(companyDocuments).values(stampWorkspace(doc)).returning();
    await this.syncFileForCompanyDocument(newDoc);
    return newDoc;
  }

  async updateCompanyDocument(
    id: string,
    data: Partial<InsertCompanyDocument>,
    options: CompanyDocumentSaveOptions = {},
  ): Promise<CompanyDocument | undefined> {
    const where = and(eq(companyDocuments.id, id), inWorkspace(companyDocuments));
    return db.transaction(async (tx) => {
      const [before] =
        data.folderId === undefined
          ? []
          : await tx.select({ folderId: companyDocuments.folderId }).from(companyDocuments).where(where).for("update");
      const [updated] = await tx
        .update(companyDocuments)
        .set({ ...data, updatedAt: nextUpdatedAt(companyDocuments.updatedAt, options.expectedUpdatedAt) })
        .where(and(where, unchangedSince(companyDocuments.updatedAt, options.expectedUpdatedAt)))
        .returning();
      if (!updated) return undefined;
      await this.syncFileForCompanyDocument(updated, tx);
      if (before && before.folderId !== updated.folderId) {
        await syncCompanyDocumentEmbeddingFolder(id, tx);
        await tx.insert(auditEvents).values(
          stampWorkspace({
            actorKind: "user" as const,
            actorId: options.actorId,
            action: "document.moved",
            resourceType: "company_documents",
            resourceId: id,
            payload: { from: before.folderId, to: updated.folderId },
          }),
        );
      }
      return updated;
    });
  }

  async deleteCompanyDocument(id: string): Promise<CompanyDocument | undefined> {
    const [deleted] = await db
      .delete(companyDocuments)
      .where(and(eq(companyDocuments.id, id), inWorkspace(companyDocuments)))
      .returning();
    if (deleted) {
      await this.deleteFile(id);
    }
    return deleted;
  }

  async searchCompanyDocuments(query: string): Promise<CompanyDocumentWithUploader[]> {
    const searchPattern = `%${query}%`;
    const docs = await this.companyDocumentRows(
      or(
        like(companyDocuments.name, searchPattern),
        like(companyDocuments.description, searchPattern),
        like(companyDocuments.fileName, searchPattern)
      ),
    ).orderBy(desc(companyDocuments.createdAt));

    const folderIds = [...new Set(docs.filter((d) => d.document.folderId).map((d) => d.document.folderId!))];
    const foldersData = folderIds.length > 0
      ? await db
          .select()
          .from(companyDocumentFolders)
          .where(and(
            or(...folderIds.map(id => eq(companyDocumentFolders.id, id))),
            inWorkspace(companyDocumentFolders)
          ))
      : [];
    const folderMap = new Map(foldersData.map(f => [f.id, f]));
    
    return docs.map(({ document, uploadedBy }) => ({
      ...document,
      uploadedBy: uploadedBy ?? undefined,
      folder: document.folderId ? folderMap.get(document.folderId) : undefined,
    }));
  }

  async searchCompanyDocumentFolders(query: string): Promise<CompanyDocumentFolderWithCreator[]> {
    const rows = await this.companyDocumentFolderRows(like(companyDocumentFolders.name, `%${query}%`)).orderBy(
      desc(companyDocumentFolders.createdAt),
    );
    return rows.map(({ folder, createdBy }) => ({ ...folder, createdBy: createdBy ?? undefined }));
  }

  async getFile(id: string, writer: FileWriter = db): Promise<KnowledgeFile | undefined> {
    const [row] = await writer
      .select()
      .from(files)
      .where(and(eq(files.id, id), inWorkspace(files)));
    return row;
  }

  async getFiles(folderId?: string): Promise<KnowledgeFile[]> {
    return db
      .select()
      .from(files)
      .where(
        and(
          inWorkspace(files),
          folderId ? eq(files.folderId, folderId) : isNull(files.folderId),
          isNull(files.projectId)
        )
      )
      .orderBy(desc(files.createdAt));
  }

  async getProjectFiles(projectIds: string[]): Promise<ProjectDocumentationFile[]> {
    if (projectIds.length === 0) return [];
    const rows = await db
      .select({
        id: files.id,
        name: files.name,
        fileName: files.fileName,
        mimeType: files.mimeType,
        fileSize: files.fileSize,
        projectId: files.projectId,
        uploadedById: files.uploadedById,
        createdAt: files.createdAt,
        updatedAt: files.updatedAt,
        createdBy: documentPersonColumns,
      })
      .from(files)
      .leftJoin(users, eq(users.id, files.uploadedById))
      .where(and(inArray(files.projectId, projectIds), eq(files.scanStatus, "available"), inWorkspace(files)))
      .orderBy(desc(files.createdAt), asc(files.id));
    return rows.map((row) => ({ ...row, projectId: row.projectId! }));
  }

  async createFile(
    file: InsertKnowledgeFile & { id?: string; scanStatus?: FileScanStatus; hold?: boolean },
    writer: FileWriter = db
  ): Promise<KnowledgeFile> {
    const [row] = await writer
      .insert(files)
      .values(stampWorkspace({ ...file, access: DOCUMENT_ACCESS_WORKSPACE }))
      .returning();
    return row;
  }

  async updateFile(
    id: string,
    data: Partial<InsertKnowledgeFile>,
    writer: FileWriter = db
  ): Promise<KnowledgeFile | undefined> {
    const [updated] = await writer
      .update(files)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(files.id, id), inWorkspace(files)))
      .returning();
    return updated;
  }

  async deleteFile(id: string, writer: FileWriter = db): Promise<KnowledgeFile | undefined> {
    const [deleted] = await writer
      .delete(files)
      .where(and(eq(files.id, id), inWorkspace(files)))
      .returning();
    return deleted;
  }

  rebuildIndexArtifacts() {
    return rebuildIndexArtifacts();
  }

  listIndexArtifacts(source: { kind: "document" | "file"; id: string }) {
    return listIndexArtifacts(source);
  }

  deleteIndexArtifacts(source: { kind: "document" | "file"; id: string }) {
    return deleteIndexArtifacts(source);
  }

  private async syncFileForCompanyDocument(doc: CompanyDocument, writer: FileWriter = db): Promise<void> {
    if (!isUploadedFile(doc) || !doc.storagePath) {
      await this.deleteFile(doc.id, writer);
      return;
    }
    const existing = await this.getFile(doc.id, writer);
    const fields: InsertKnowledgeFile = {
      name: doc.name,
      description: doc.description,
      fileName: doc.fileName,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      storagePath: doc.storagePath,
      folderId: doc.folderId,
      uploadedById: doc.uploadedById,
    };
    if (existing) {
      await this.updateFile(doc.id, fields, writer);
      return;
    }
    await this.createFile({ ...fields, id: doc.id }, writer);
  }

  // CRM Project Notes
  async getCrmProjectNotes(crmProjectId: string): Promise<CrmProjectNoteWithCreator[]> {
    const notes = await db
      .select()
      .from(crmProjectNotes)
      .where(eq(crmProjectNotes.crmProjectId, crmProjectId))
      .orderBy(desc(crmProjectNotes.createdAt));
    
    if (notes.length === 0) return [];
    
    const creatorIds = [...new Set(notes.map(n => n.createdById))];
    const creatorsData = await db.select().from(users).where(or(...creatorIds.map(id => eq(users.id, id))));
    const creatorMap = new Map(creatorsData.map((u) => [u.id, toSafeUser(u)]));
    
    return notes.map(n => ({
      ...n,
      createdBy: creatorMap.get(n.createdById),
    }));
  }

  async getCrmProjectLatestNote(crmProjectId: string): Promise<CrmProjectNoteWithCreator | undefined> {
    const [note] = await db
      .select()
      .from(crmProjectNotes)
      .where(eq(crmProjectNotes.crmProjectId, crmProjectId))
      .orderBy(desc(crmProjectNotes.createdAt))
      .limit(1);
    
    if (!note) return undefined;
    
    const [creator] = await db.select().from(users).where(eq(users.id, note.createdById));
    const safeCreator = creator ? toSafeUser(creator) : undefined;
    
    return { ...note, createdBy: safeCreator };
  }

  async createCrmProjectNote(note: InsertCrmProjectNote): Promise<CrmProjectNote> {
    const [newNote] = await db.insert(crmProjectNotes).values(stampWorkspace({
      ...note,
      id: randomUUID(),
    })).returning();
    return newNote;
  }

  async updateCrmProjectNote(id: string, data: Partial<InsertCrmProjectNote>): Promise<CrmProjectNote | undefined> {
    const [updated] = await db
      .update(crmProjectNotes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(crmProjectNotes.id, id))
      .returning();
    return updated;
  }

  async deleteCrmProjectNote(id: string): Promise<void> {
    await db.delete(crmProjectNotes).where(eq(crmProjectNotes.id, id));
  }

  async getCrmProjectStageHistory(crmProjectId: string): Promise<CrmProjectStageHistoryWithUser[]> {
    const history = await db
      .select()
      .from(crmProjectStageHistory)
      .where(eq(crmProjectStageHistory.crmProjectId, crmProjectId))
      .orderBy(desc(crmProjectStageHistory.changedAt));
    
    const historyWithUsers: CrmProjectStageHistoryWithUser[] = [];
    for (const record of history) {
      const [user] = await db.select().from(users).where(eq(users.id, record.changedById));
      historyWithUsers.push({
        ...record,
        changedBy: user ? toSafeUser(user) : undefined,
      });
    }
    return historyWithUsers;
  }

  async createCrmProjectStageHistory(history: InsertCrmProjectStageHistory): Promise<CrmProjectStageHistory> {
    const [created] = await db
      .insert(crmProjectStageHistory)
      .values(stampWorkspace(history))
      .returning();
    return created;
  }

  async getUserNotifications(userId: string): Promise<NotificationWithDetails[]> {
    // A User's notifications span their Workspaces, so each is read inside its
    // own context (#323); the newest 50 across all of them are kept.
    const perWorkspace = await forWorkspaces(await this.activeWorkspaceIdsOf(userId), () =>
      this.getUserNotificationsInWorkspace(userId),
    );
    return perWorkspace
      .flat()
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
      .slice(0, 50);
  }

  private async getUserNotificationsInWorkspace(userId: string): Promise<NotificationWithDetails[]> {
    const notifs = await db
      .select({
        notification: notifications,
        workspaceId: workspaces.id,
        workspaceName: workspaces.name,
      })
      .from(notifications)
      .leftJoin(workspaces, eq(workspaces.id, notifications.workspaceId))
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    if (!notifs.length) return [];

    const fromUserIds = [...new Set(notifs.map((n) => n.notification.fromUserId).filter(Boolean))];
    const crmProjectIds = [...new Set(notifs.map((n) => n.notification.crmProjectId).filter(Boolean))];

    const fromUsersData = fromUserIds.length > 0 
      ? await db.select().from(users).where(sql`${users.id} IN ${fromUserIds}`)
      : [];
    const fromUserMap = new Map(fromUsersData.map((u) => [u.id, toSafeUser(u)]));

    const projectsData = crmProjectIds.length > 0
      ? await db.select().from(crmProjects).leftJoin(projects, eq(crmProjects.projectId, projects.id)).where(sql`${crmProjects.id} IN ${crmProjectIds}`)
      : [];
    const projectMap = new Map(projectsData.map(p => [p.crm_projects.id, { id: p.crm_projects.id, project: p.projects ? { name: p.projects.name } : undefined }]));

    return notifs.map((n) => ({
      ...n.notification,
      fromUser: n.notification.fromUserId ? fromUserMap.get(n.notification.fromUserId) : undefined,
      crmProject: n.notification.crmProjectId ? projectMap.get(n.notification.crmProjectId) : undefined,
      workspace:
        n.workspaceId && n.workspaceName
          ? { id: n.workspaceId, name: n.workspaceName }
          : undefined,
    }));
  }

  /** The User's active Memberships' Workspaces: the set the notification list spans. */
  private async activeWorkspaceIdsOf(userId: string): Promise<{ id: string }[]> {
    const active = (await membershipsForUser(userId)).filter((row) => row.archivedAt === null);
    return [...new Set(active.map((row) => row.workspaceId))].map((id) => ({ id }));
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    // The badge counts what the list lists: every Workspace the User belongs to.
    const perWorkspace = await forWorkspaces(await this.activeWorkspaceIdsOf(userId), async () => {
      const [result] = await db
        .select({ count: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), eq(notifications.isRead, 0)));
      return result?.count || 0;
    });
    return perWorkspace.reduce((sum, n) => sum + n, 0);
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [newNotif] = await db.insert(notifications).values(stampWorkspace({
      ...notification,
      id: randomUUID(),
    })).returning();
    return newNotif;
  }

  async hasRecentNotification(userId: string, type: string, since: Date, fromUserId?: string): Promise<boolean> {
    const [result] = await db
      .select({ count: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, type),
          gte(notifications.createdAt, since),
          fromUserId ? eq(notifications.fromUserId, fromUserId) : undefined,
        ),
      );
    return (result?.count || 0) > 0;
  }

  async markNotificationRead(id: string, userId: string): Promise<void> {
    // The notification may be in any of the User's Workspaces, as listed.
    const workspaceId = await notificationWorkspaceForUser(id, userId);
    if (!workspaceId) return;
    // Awaited inside the callback: a Drizzle builder runs when awaited, not when built.
    await runWithWorkspaceContext({ workspaceId }, async () => {
      await db.update(notifications).set({ isRead: 1 }).where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
    });
  }

  async markAllNotificationsRead(userId: string): Promise<void> {
    await forWorkspaces(await this.activeWorkspaceIdsOf(userId), async () => {
      await db.update(notifications).set({ isRead: 1 }).where(eq(notifications.userId, userId));
    });
  }

  /** Marks one type of the user's notifications read in the request's Workspace only. */
  async markNotificationsReadByType(userId: string, type: string): Promise<void> {
    await db
      .update(notifications)
      .set({ isRead: 1 })
      .where(and(eq(notifications.userId, userId), eq(notifications.type, type), inWorkspace(notifications)));
  }

  async getAudioRecording(id: string): Promise<AudioRecording | undefined> {
    const [recording] = await db.select().from(audioRecordings).where(eq(audioRecordings.id, id));
    return recording;
  }

  async createAudioRecording(recording: InsertAudioRecording): Promise<AudioRecording> {
    const [newRecording] = await db.insert(audioRecordings).values(stampWorkspace({
      ...recording,
      id: randomUUID(),
    })).returning();
    return newRecording;
  }

  async updateAudioRecording(id: string, data: Partial<InsertAudioRecording>): Promise<AudioRecording | undefined> {
    const [updated] = await db
      .update(audioRecordings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(audioRecordings.id, id))
      .returning();
    return updated;
  }

  // CRM Tags
  async getAllCrmTags(): Promise<CrmTag[]> {
    return await db.select().from(crmTags).orderBy(asc(crmTags.name));
  }

  async getCrmTag(id: string): Promise<CrmTag | undefined> {
    const [tag] = await db.select().from(crmTags).where(eq(crmTags.id, id));
    return tag;
  }

  async createCrmTag(tag: InsertCrmTag): Promise<CrmTag> {
    const [newTag] = await db.insert(crmTags).values(stampWorkspace({
      ...tag,
      id: randomUUID(),
    })).returning();
    return newTag;
  }

  async updateCrmTag(id: string, data: Partial<InsertCrmTag>): Promise<CrmTag | undefined> {
    const [updated] = await db
      .update(crmTags)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(crmTags.id, id))
      .returning();
    return updated;
  }

  async deleteCrmTag(id: string): Promise<void> {
    await db.delete(crmTags).where(eq(crmTags.id, id));
  }

  // CRM Project Tags
  async getCrmProjectTags(crmProjectId: string): Promise<CrmTag[]> {
    const results = await db
      .select({ tag: crmTags })
      .from(crmProjectTags)
      .innerJoin(crmTags, eq(crmProjectTags.tagId, crmTags.id))
      .where(eq(crmProjectTags.crmProjectId, crmProjectId))
      .orderBy(asc(crmTags.name));
    return results.map(r => r.tag);
  }

  async addTagToProject(crmProjectId: string, tagId: string): Promise<CrmProjectTag> {
    const [projectTag] = await db.insert(crmProjectTags).values(stampWorkspace({
      id: randomUUID(),
      crmProjectId,
      tagId,
    })).returning();
    return projectTag;
  }

  async removeTagFromProject(crmProjectId: string, tagId: string): Promise<void> {
    await db.delete(crmProjectTags).where(
      and(
        eq(crmProjectTags.crmProjectId, crmProjectId),
        eq(crmProjectTags.tagId, tagId)
      )
    );
  }

  // CRM Modules
  async getCrmModules(): Promise<CrmModuleWithFields[]> {
    const modules = await db
      .select()
      .from(crmModules)
      .where(inWorkspace(crmModules))
      .orderBy(asc(crmModules.displayOrder), asc(crmModules.name));
    const fields = await db
      .select()
      .from(crmModuleFields)
      .where(inWorkspace(crmModuleFields))
      .orderBy(asc(crmModuleFields.displayOrder), asc(crmModuleFields.name));
    
    return modules.map(mod => ({
      ...mod,
      fields: fields.filter(f => f.moduleId === mod.id),
    }));
  }

  async getCrmModule(id: string): Promise<CrmModuleWithFields | undefined> {
    const [mod] = await db
      .select()
      .from(crmModules)
      .where(and(inWorkspace(crmModules), eq(crmModules.id, id)));
    if (!mod) return undefined;

    const fields = await db
      .select()
      .from(crmModuleFields)
      .where(and(inWorkspace(crmModuleFields), eq(crmModuleFields.moduleId, id)))
      .orderBy(asc(crmModuleFields.displayOrder), asc(crmModuleFields.name));
    return { ...mod, fields };
  }

  async createCrmModule(module: InsertCrmModule): Promise<CrmModule> {
    const [newMod] = await db.insert(crmModules).values(stampWorkspace({
      ...module,
      id: randomUUID(),
    })).returning();
    return newMod;
  }

  async updateCrmModule(id: string, data: Partial<InsertCrmModule>): Promise<CrmModule | undefined> {
    const [updated] = await db
      .update(crmModules)
      .set({ ...data, updatedAt: new Date() })
      .where(and(inWorkspace(crmModules), eq(crmModules.id, id)))
      .returning();
    return updated;
  }

  async deleteCrmModule(id: string): Promise<void> {
    await db.delete(crmModules).where(and(inWorkspace(crmModules), eq(crmModules.id, id)));
  }

  // CRM Module Fields
  async getCrmModuleFields(moduleId: string): Promise<CrmModuleField[]> {
    return await db
      .select()
      .from(crmModuleFields)
      .where(and(inWorkspace(crmModuleFields), eq(crmModuleFields.moduleId, moduleId)))
      .orderBy(asc(crmModuleFields.displayOrder), asc(crmModuleFields.name));
  }

  async getCrmModuleField(id: string): Promise<CrmModuleField | undefined> {
    const [field] = await db
      .select()
      .from(crmModuleFields)
      .where(and(inWorkspace(crmModuleFields), eq(crmModuleFields.id, id)));
    return field;
  }

  async createCrmModuleField(field: InsertCrmModuleField): Promise<CrmModuleField> {
    const [newField] = await db.insert(crmModuleFields).values(stampWorkspace({
      ...field,
      options: field.options as string[] | null | undefined,
    })).returning();
    return newField;
  }

  async updateCrmModuleField(id: string, data: Partial<InsertCrmModuleField>): Promise<CrmModuleField | undefined> {
    const [updated] = await db
      .update(crmModuleFields)
      .set({ ...data, options: data.options as string[] | null | undefined, updatedAt: new Date() })
      .where(and(inWorkspace(crmModuleFields), eq(crmModuleFields.id, id)))
      .returning();
    return updated;
  }

  async deleteCrmModuleField(id: string): Promise<void> {
    await db.delete(crmModuleFields).where(and(inWorkspace(crmModuleFields), eq(crmModuleFields.id, id)));
  }

  // CRM Custom Field Values
  async getCrmProjectCustomFields(crmProjectId: string): Promise<CrmCustomFieldValue[]> {
    return await db.select().from(crmCustomFieldValues).where(eq(crmCustomFieldValues.crmProjectId, crmProjectId));
  }

  async setCrmProjectCustomField(crmProjectId: string, fieldId: string, value: string | null): Promise<CrmCustomFieldValue> {
    const existing = await db
      .select()
      .from(crmCustomFieldValues)
      .where(and(eq(crmCustomFieldValues.crmProjectId, crmProjectId), eq(crmCustomFieldValues.fieldId, fieldId)));
    
    if (existing.length > 0) {
      const [updated] = await db
        .update(crmCustomFieldValues)
        .set({ value, updatedAt: new Date() })
        .where(and(eq(crmCustomFieldValues.crmProjectId, crmProjectId), eq(crmCustomFieldValues.fieldId, fieldId)))
        .returning();
      return updated;
    } else {
      const [newVal] = await db.insert(crmCustomFieldValues).values(stampWorkspace({
        id: randomUUID(),
        crmProjectId,
        fieldId,
        value,
      })).returning();
      return newVal;
    }
  }

  async updateCrmModuleFieldOptions(
    id: string,
    data: Partial<InsertCrmModuleField>,
    renames: OptionRename[],
    columns: OptionRenameColumn[],
  ): Promise<CrmModuleField | undefined> {
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(crmModuleFields)
        .set({ ...data, options: data.options as string[] | null | undefined, updatedAt: new Date() })
        .where(and(inWorkspace(crmModuleFields), eq(crmModuleFields.id, id)))
        .returning();
      if (!updated || renames.length === 0) return updated;

      // One CASE per column, so a swap (a → b, b → a) never merges the two.
      const renamed = (column: AnyColumn, pairs: OptionRename[]) =>
        sql`CASE ${sql.join(pairs.map((pair) => sql`WHEN ${column} = ${pair.from} THEN ${pair.to}`), sql` `)} ELSE ${column} END`;
      const froms = (pairs: OptionRename[]) => pairs.map((pair) => pair.from);
      const now = new Date();

      await tx
        .update(crmCustomFieldValues)
        .set({ value: renamed(crmCustomFieldValues.value, renames), updatedAt: now })
        .where(and(
          inWorkspace(crmCustomFieldValues),
          eq(crmCustomFieldValues.fieldId, id),
          inArray(crmCustomFieldValues.value, froms(renames)),
        ));

      for (const column of columns) {
        if (column === "projects.status") {
          await tx
            .update(crmProjects)
            .set({ status: renamed(crmProjects.status, renames), updatedAt: now })
            .where(and(inWorkspace(crmProjects), inArray(crmProjects.status, froms(renames))));
          const stages = renames.filter((pair) => !isOpportunityTerminal(pair.from) && !isOpportunityTerminal(pair.to));
          if (stages.length > 0) {
            await tx
              .update(opportunities)
              .set({ stage: renamed(opportunities.stage, stages), updatedAt: now })
              .where(and(inWorkspace(opportunities), inArray(opportunities.stage, froms(stages))));
          }
        } else if (column === "projects.projectType") {
          await tx
            .update(crmProjects)
            .set({ projectType: renamed(crmProjects.projectType, renames), updatedAt: now })
            .where(and(inWorkspace(crmProjects), inArray(crmProjects.projectType, froms(renames))));
        } else if (column === "projects.source") {
          await tx
            .update(crmProjects)
            .set({ source: renamed(crmProjects.source, renames), updatedAt: now })
            .where(and(inWorkspace(crmProjects), inArray(crmProjects.source, froms(renames))));
        } else if (column === "projects.lostReason") {
          await tx
            .update(crmProjects)
            .set({ lostReason: renamed(crmProjects.lostReason, renames), updatedAt: now })
            .where(and(inWorkspace(crmProjects), inArray(crmProjects.lostReason, froms(renames))));
        } else if (column === "clients.status") {
          await tx
            .update(crmClients)
            .set({ status: renamed(crmClients.status, renames), updatedAt: now })
            .where(and(inWorkspace(crmClients), inArray(crmClients.status, froms(renames))));
        } else if (column === "clients.source") {
          await tx
            .update(crmClients)
            .set({ source: renamed(crmClients.source, renames), updatedAt: now })
            .where(and(inWorkspace(crmClients), inArray(crmClients.source, froms(renames))));
        }
      }
      return updated;
    });
  }

  async ensureCrmSystemLists(): Promise<CrmModuleWithFields[]> {
    await db.transaction(async (tx) => {
      // Two Administrators saving a first change at once must not create two fields.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`crm-system-lists:${requireWorkspaceContext().workspaceId}`}))`);
      const moduleIds = new Map<string, string>();
      for (const list of BUILT_IN_LISTS) {
        const spec = list.module;
        let moduleId = moduleIds.get(spec.slug);
        if (!moduleId) {
          const [existing] = await tx
            .select()
            .from(crmModules)
            .where(and(inWorkspace(crmModules), eq(crmModules.slug, spec.slug)));
          if (existing) {
            if (existing.isSystem !== 1) {
              await tx
                .update(crmModules)
                .set({ isSystem: 1, updatedAt: new Date() })
                .where(and(inWorkspace(crmModules), eq(crmModules.id, existing.id)));
            }
            moduleId = existing.id;
          } else {
            const [created] = await tx
              .insert(crmModules)
              .values(stampWorkspace({ ...spec, id: randomUUID(), isEnabled: 1, isSystem: 1 }))
              .returning();
            moduleId = created.id;
          }
          moduleIds.set(spec.slug, moduleId);
        }

        const [field] = await tx
          .select()
          .from(crmModuleFields)
          .where(and(
            inWorkspace(crmModuleFields),
            eq(crmModuleFields.moduleId, moduleId),
            eq(crmModuleFields.slug, list.field.slug),
          ))
          .orderBy(asc(crmModuleFields.createdAt))
          .limit(1);
        if (!field) {
          await tx.insert(crmModuleFields).values(stampWorkspace({
            ...list.field,
            id: randomUUID(),
            moduleId,
            fieldType: "select",
            options: defaultFieldOptions(list),
            isEnabled: 1,
            isSystem: 1,
          }));
        } else if (field.isSystem !== 1 || !field.options?.length) {
          await tx
            .update(crmModuleFields)
            .set({
              isSystem: 1,
              ...(field.options?.length ? {} : { options: defaultFieldOptions(list) }),
              updatedAt: new Date(),
            })
            .where(and(inWorkspace(crmModuleFields), eq(crmModuleFields.id, field.id)));
        }
      }
    });
    return this.getCrmModules();
  }

  // Time Tracking methods
  async getTimeEntries(options: {
    userId?: string;
    crmProjectId?: string;
    startDate?: Date;
    endDate?: Date;
    status?: string;
    /** Newest first, cut to this many; omitted returns every match. */
    limit?: number;
  }): Promise<TimeEntryWithDetails[]> {
    const conditions = [inWorkspace(timeEntries)];

    if (options.userId) {
      conditions.push(eq(timeEntries.userId, options.userId));
    }
    if (options.crmProjectId) {
      conditions.push(eq(timeEntries.crmProjectId, options.crmProjectId));
    }
    if (options.status) {
      conditions.push(eq(timeEntries.status, options.status));
    }
    if (options.startDate) {
      conditions.push(gte(timeEntries.startTime, options.startDate));
    }
    if (options.endDate) {
      conditions.push(lte(timeEntries.startTime, options.endDate));
    }

    return this.selectTimeEntriesWithDetails(and(...conditions), options.limit);
  }

  /** Two queries whatever the number of rows: the entries joined, then their Tasks. */
  private async selectTimeEntriesWithDetails(where: SQL | undefined, limit?: number): Promise<TimeEntryWithDetails[]> {
    const joined = db
      .select({
        entry: timeEntries,
        user: documentPersonColumns,
        crmProject: crmProjects,
        project: projects,
        client: crmClients,
      })
      .from(timeEntries)
      .leftJoin(users, eq(users.id, timeEntries.userId))
      .leftJoin(crmProjects, and(eq(crmProjects.id, timeEntries.crmProjectId), inWorkspace(crmProjects)))
      .leftJoin(projects, eq(projects.id, crmProjects.projectId))
      .leftJoin(crmClients, eq(crmClients.id, crmProjects.clientId))
      .where(where)
      .orderBy(desc(timeEntries.startTime), asc(timeEntries.id));
    const rows = limit ? await joined.limit(limit) : await joined;

    const taskIds = Array.from(new Set(rows.map((row) => row.entry.taskId).filter((id): id is string => !!id)));
    const taskRows = taskIds.length > 0
      ? await db.select().from(tasks).where(and(inArray(tasks.id, taskIds), inWorkspace(tasks)))
      : [];
    const taskById = new Map(taskRows.map((t) => [t.id, t]));

    return rows.map(({ entry, user, crmProject, project, client }) => ({
      ...entry,
      user: user ?? undefined,
      crmProject: crmProject
        ? { ...crmProject, project: project ?? undefined, client: client ?? undefined }
        : undefined,
      task: entry.taskId ? taskById.get(entry.taskId) : undefined,
    }));
  }

  async getTimeEntriesPage(options: TimeEntryPageOptions): Promise<TimeEntryPage> {
    const portions = await this.getTimePortions(options);
    const shown = portions.slice((options.page - 1) * options.pageSize, options.page * options.pageSize);
    const details = shown.length > 0
      ? await this.selectTimeEntriesWithDetails(
          and(inArray(timeEntries.id, shown.map((row) => row.id)), inWorkspace(timeEntries)),
        )
      : [];
    const portionById = new Map(shown.map((row) => [row.id, row.seconds]));
    return {
      data: details.map((entry) => ({ ...entry, secondsInPeriod: portionById.get(entry.id) ?? 0 })),
      total: portions.length,
      totals: {
        duration: portions.reduce((sum, row) => sum + row.seconds, 0),
        idle: portions.reduce((sum, row) => sum + row.idleSeconds, 0),
      },
    };
  }

  /**
   * The Time Entries touching a period, each with the part of it inside. Every
   * figure of time in a period is summed from here. Stopped entries only,
   * unless `includeActive`.
   */
  async getTimePortions(options: TimePortionOptions): Promise<TimePortionRow[]> {
    return (await this.getTimeSpans(options)).map((row) => ({
      id: row.id,
      userId: row.userId,
      userName: row.userName,
      crmProjectId: row.crmProjectId,
      projectName: row.projectName ?? "Unknown Project",
      taskId: row.taskId,
      taskName: row.taskName,
      seconds: row.seconds,
      idleSeconds: row.idleSeconds,
    }));
  }

  /** The same entries with their whole span, for a reader that splits it further. */
  private async getTimeSpans(options: TimePortionOptions): Promise<TimeSpanRow[]> {
    const now = new Date();
    const conditions = [inWorkspace(timeEntries)];
    if (options.userId) conditions.push(eq(timeEntries.userId, options.userId));
    if (options.crmProjectId) conditions.push(eq(timeEntries.crmProjectId, options.crmProjectId));
    if (options.taskIds) conditions.push(inArray(timeEntries.taskId, options.taskIds));
    if (options.status) conditions.push(eq(timeEntries.status, options.status));
    if (!options.includeActive) conditions.push(eq(timeEntries.status, "stopped"));
    if (options.endDate) conditions.push(lte(timeEntries.startTime, options.endDate));
    if (options.startDate) {
      conditions.push(sql`${timeEntrySpanEnd(now)} >= ${options.startDate.toISOString()}::timestamp`);
    }

    const rows = await db
      .select({
        id: timeEntries.id,
        userId: timeEntries.userId,
        crmProjectId: timeEntries.crmProjectId,
        taskId: timeEntries.taskId,
        startTime: timeEntries.startTime,
        endTime: timeEntries.endTime,
        duration: timeEntries.duration,
        idleTime: timeEntries.idleTime,
        status: timeEntries.status,
        lastActivityAt: timeEntries.lastActivityAt,
        description: timeEntries.description,
        projectName: projects.name,
        clientName: crmClients.name,
        taskName: tasks.name,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(timeEntries)
      .leftJoin(users, eq(users.id, timeEntries.userId))
      .leftJoin(crmProjects, and(eq(crmProjects.id, timeEntries.crmProjectId), inWorkspace(crmProjects)))
      .leftJoin(projects, and(eq(projects.id, crmProjects.projectId), inWorkspace(projects)))
      .leftJoin(crmClients, and(eq(crmClients.id, crmProjects.clientId), inWorkspace(crmClients)))
      .leftJoin(tasks, and(eq(tasks.id, timeEntries.taskId), inWorkspace(tasks)))
      .where(and(...conditions))
      .orderBy(desc(timeEntries.startTime), asc(timeEntries.id));

    return rows.map((row) => {
      const span = timeEntrySpan(row, now);
      return {
        id: row.id,
        userId: row.userId,
        userName: row.email === null ? "Unknown User" : personName({ ...row, email: row.email }),
        crmProjectId: row.crmProjectId,
        projectName: row.projectName,
        clientName: row.clientName,
        taskId: row.taskId,
        taskName: row.taskName,
        description: row.description,
        status: row.status,
        span,
        ...timePortion(span, { start: options.startDate, end: options.endDate }),
      };
    });
  }

  async getTimeEntry(id: string): Promise<TimeEntryWithDetails | undefined> {
    const [entry] = await this.selectTimeEntriesWithDetails(and(eq(timeEntries.id, id), inWorkspace(timeEntries)));
    return entry;
  }

  async getTimeEntryByClientCommandId(clientCommandId: string): Promise<TimeEntry | undefined> {
    const [entry] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.clientCommandId, clientCommandId), inWorkspace(timeEntries)))
      .limit(1);
    return entry;
  }

  async getActiveTimeEntry(userId: string): Promise<TimeEntry | undefined> {
    // A Timer follows the User across Workspaces, so it is located before RLS can see it.
    const located = await activeTimeEntryForUser(userId);
    if (!located) return undefined;
    return runWithWorkspaceContext({ workspaceId: located.workspaceId, userId }, async () => {
      const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, located.id)).limit(1);
      return entry;
    });
  }

  async getStaleRunningEntries(staleThreshold: Date): Promise<TimeEntry[]> {
    return db
      .select()
      .from(timeEntries)
      .where(and(
        eq(timeEntries.status, "running"),
        lt(timeEntries.lastActivityAt, staleThreshold),
        inWorkspace(timeEntries)
      ));
  }

  async getExpiredPausedEntries(pausedBefore: Date): Promise<TimeEntry[]> {
    return db
      .select()
      .from(timeEntries)
      .where(and(
        eq(timeEntries.status, "paused"),
        lt(timeEntries.lastActivityAt, pausedBefore),
        inWorkspace(timeEntries)
      ));
  }

  async createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry> {
    // Safety net: if task_id column doesn't exist yet (migration 002 pending),
    // strip it and retry rather than crashing a timer start.
    const values: any = stampWorkspace({ id: randomUUID(), ...entry });
    const run = () => db.insert(timeEntries).values(values).returning();
    const [newEntry] = await run().catch(async (err: any) => {
      if (err?.code === "42703" && "taskId" in values) {
        const { taskId: _dropped, ...safeValues } = values;
        Object.assign(values, safeValues);
        delete values.taskId;
        return db.insert(timeEntries).values(values).returning();
      }
      throw err;
    });
    return newEntry;
  }

  async updateTimeEntry(id: string, data: Partial<InsertTimeEntry>): Promise<TimeEntry | undefined> {
    const [updated] = await db
      .update(timeEntries)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, id))
      .returning();
    return updated;
  }

  async deleteTimeEntry(id: string): Promise<void> {
    await db.delete(timeEntries).where(and(eq(timeEntries.id, id), inWorkspace(timeEntries)));
  }

  async getTimeStats(options: {
    userId?: string;
    crmProjectId?: string;
    startDate?: Date;
    endDate?: Date;
    includeActive?: boolean;
  }): Promise<{
    totalDuration: number;
    totalIdleTime: number;
    entriesCount: number;
    screenshotCount: number;
    byProject: Array<{ crmProjectId: string; projectName: string; totalDuration: number }>;
    byUser: Array<{ userId: string; userName: string; totalDuration: number }>;
  }> {
    const entries = await this.getTimePortions(options);
    const totalDuration = entries.reduce((sum, e) => sum + e.seconds, 0);
    const totalIdleTime = entries.reduce((sum, e) => sum + e.idleSeconds, 0);

    const projectMap = new Map<string, { projectName: string; totalDuration: number }>();
    const userMap = new Map<string, { userName: string; totalDuration: number }>();
    for (const entry of entries) {
      const project = projectMap.get(entry.crmProjectId) || { projectName: entry.projectName, totalDuration: 0 };
      project.totalDuration += entry.seconds;
      projectMap.set(entry.crmProjectId, project);
      const user = userMap.get(entry.userId) || { userName: entry.userName, totalDuration: 0 };
      user.totalDuration += entry.seconds;
      userMap.set(entry.userId, user);
    }

    // Count live (non-deleted, non-pending) screenshots in the same window
    const screenshotConditions = [inWorkspace(timeEntryScreenshots)];
    if (options.userId) screenshotConditions.push(eq(timeEntryScreenshots.userId, options.userId));
    if (options.startDate) screenshotConditions.push(gte(timeEntryScreenshots.capturedAt, options.startDate));
    if (options.endDate) screenshotConditions.push(lte(timeEntryScreenshots.capturedAt, options.endDate));
    screenshotConditions.push(sql`${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'`);
    screenshotConditions.push(isNull(timeEntryScreenshots.deletedAt));
    const [screenshotRow] = await db
      .select({ cnt: count() })
      .from(timeEntryScreenshots)
      .where(screenshotConditions.length > 0 ? and(...screenshotConditions) : undefined);
    const screenshotCount = screenshotRow?.cnt ?? 0;

    return {
      totalDuration,
      totalIdleTime,
      entriesCount: entries.length,
      screenshotCount,
      byProject: Array.from(projectMap.entries()).map(([crmProjectId, data]) => ({
        crmProjectId,
        ...data,
      })),
      byUser: Array.from(userMap.entries()).map(([userId, data]) => ({
        userId,
        ...data,
      })),
    };
  }

  async getTaskDurationToday(userId: string, taskId: string, start: Date, end: Date): Promise<number> {
    const durations = await this.getTasksDurationToday(userId, [taskId], start, end);
    return durations[taskId] ?? 0;
  }

  async getTasksDurationToday(userId: string, taskIds: string[], start: Date, end: Date): Promise<Record<string, number>> {
    if (taskIds.length === 0) return {};
    const rows = await this.getTimePortions({ userId, taskIds, startDate: start, endDate: end });
    const durations: Record<string, number> = {};
    for (const row of rows) durations[row.taskId!] = (durations[row.taskId!] ?? 0) + row.seconds;
    return durations;
  }

  async getTimeEntriesByIds(ids: string[]): Promise<Array<{ id: string; duration: number; idleTime: number }>> {
    if (ids.length === 0) return [];
    const rows = await db
      .select({ id: timeEntries.id, duration: timeEntries.duration, idleTime: timeEntries.idleTime })
      .from(timeEntries)
      .where(inArray(timeEntries.id, ids));
    return rows.map((r) => ({ id: r.id, duration: r.duration ?? 0, idleTime: r.idleTime ?? 0 }));
  }

  async createTimeEntryScreenshot(screenshot: InsertTimeEntryScreenshot): Promise<TimeEntryScreenshot> {
    return createTimeEntryScreenshot(screenshot);
  }

  async getTimeEntryScreenshotById(id: string): Promise<TimeEntryScreenshot | undefined> {
    return getTimeEntryScreenshotById(id);
  }

  async getTimeEntryScreenshots(options: ScreenshotListOptions): Promise<ScreenshotList> {
    return getTimeEntryScreenshots(options);
  }

  async updateTimeEntryScreenshot(id: string, data: { storageKey: string; contentHash?: string; perceptualHash?: string | null }): Promise<TimeEntryScreenshot | undefined> {
    return updateTimeEntryScreenshot(id, data);
  }

  async deleteTimeEntryScreenshot(id: string): Promise<void> {
    return deleteTimeEntryScreenshot(id);
  }

  async softDeleteTimeEntryScreenshot(
    id: string,
    deletedBy: string,
    reason?: string,
  ): Promise<TimeEntryScreenshot | undefined> {
    return softDeleteTimeEntryScreenshot(id, deletedBy, reason);
  }

  // ═══════════════════════════════════════
  // Tasks
  // ═══════════════════════════════════════

  async getTasks(options: { crmProjectId: string; includeArchived?: boolean }): Promise<Task[]> {
    const conditions = [eq(tasks.crmProjectId, options.crmProjectId), inWorkspace(tasks)];
    if (!options.includeArchived) {
      conditions.push(sql`${tasks.status} != 'archived'`);
    }
    return db.select().from(tasks).where(and(...conditions)).orderBy(asc(tasks.createdAt));
  }

  async getTask(id: string): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(and(eq(tasks.id, id), inWorkspace(tasks)));
    return task;
  }

  async createTask(data: InsertTask): Promise<Task> {
    const [task] = await db.insert(tasks).values(stampWorkspace(data)).returning();
    return task;
  }

  async updateTask(id: string, data: Partial<InsertTask>): Promise<Task | undefined> {
    const [updated] = await db
      .update(tasks)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), inWorkspace(tasks)))
      .returning();
    return updated;
  }

  async deleteTask(id: string): Promise<void> {
    await db.delete(tasks).where(and(eq(tasks.id, id), inWorkspace(tasks)));
  }

  // ═══════════════════════════════════════
  // Project Members (self-managed)
  // ═══════════════════════════════════════

  async getProjectMembers(crmProjectId: string): Promise<ProjectMemberWithUser[]> {
    const rows = await db.query.projectMembers.findMany({
      where: eq(projectMembers.crmProjectId, crmProjectId),
      with: { user: true },
      orderBy: asc(projectMembers.createdAt),
    });
    return rows.map((row) => {
      const { user, ...rest } = row as any;
      if (!user) return rest as ProjectMemberWithUser;
      // Allowlist only non-sensitive, display-relevant user fields
      const safeUser = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
      };
      return { ...rest, user: safeUser } as ProjectMemberWithUser;
    });
  }

  async addProjectMember(crmProjectId: string, userId: string): Promise<ProjectMember> {
    const [existing] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.crmProjectId, crmProjectId), eq(projectMembers.userId, userId)));
    if (existing) return existing;
    const inserted = await db
      .insert(projectMembers)
      .values(stampWorkspace({ crmProjectId, userId }))
      .onConflictDoNothing()
      .returning();
    if (inserted.length > 0) return inserted[0];
    // Lost a concurrent race; fetch the existing row
    const [member] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.crmProjectId, crmProjectId), eq(projectMembers.userId, userId)));
    return member;
  }

  async removeProjectMember(crmProjectId: string, userId: string): Promise<void> {
    await db
      .delete(projectMembers)
      .where(and(eq(projectMembers.crmProjectId, crmProjectId), eq(projectMembers.userId, userId)));
  }

  // ═══════════════════════════════════════

  // ─── Project Daily Updates ───

  async createProjectDailyUpdate(data: InsertProjectDailyUpdate): Promise<ProjectDailyUpdate> {
    const [update] = await db.insert(projectDailyUpdates).values(stampWorkspace(data)).returning();
    return update;
  }

  async getProjectDailyUpdate(id: string): Promise<ProjectDailyUpdate | undefined> {
    const [update] = await db.select().from(projectDailyUpdates).where(eq(projectDailyUpdates.id, id));
    return update;
  }

  async getProjectDailyUpdatesByUser(userId: string, options?: { date?: Date }): Promise<ProjectDailyUpdateWithDetails[]> {
    const conditions: any[] = [eq(projectDailyUpdates.userId, userId)];
    if (options?.date) {
      const start = new Date(options.date.getFullYear(), options.date.getMonth(), options.date.getDate(), 0, 0, 0, 0);
      const end = new Date(options.date.getFullYear(), options.date.getMonth(), options.date.getDate(), 23, 59, 59, 999);
      conditions.push(sql`${projectDailyUpdates.updateDate} >= ${start}`);
      conditions.push(sql`${projectDailyUpdates.updateDate} <= ${end}`);
    }
    const rows = await db.select().from(projectDailyUpdates).where(and(...conditions)).orderBy(desc(projectDailyUpdates.updateDate));
    return this._hydrateDailyUpdates(rows);
  }

  async getProjectDailyUpdatesForAdmin(options?: { startDate?: Date; endDate?: Date; userId?: string; crmProjectId?: string }): Promise<ProjectDailyUpdateWithDetails[]> {
    const conditions: any[] = [];
    if (options?.startDate) conditions.push(sql`${projectDailyUpdates.updateDate} >= ${options.startDate}`);
    if (options?.endDate) conditions.push(sql`${projectDailyUpdates.updateDate} <= ${options.endDate}`);
    if (options?.userId) conditions.push(eq(projectDailyUpdates.userId, options.userId));
    if (options?.crmProjectId) conditions.push(eq(projectDailyUpdates.crmProjectId, options.crmProjectId));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db.select().from(projectDailyUpdates).where(whereClause).orderBy(desc(projectDailyUpdates.updateDate));
    return this._hydrateDailyUpdates(rows);
  }

  private async _hydrateDailyUpdates(rows: ProjectDailyUpdate[]): Promise<ProjectDailyUpdateWithDetails[]> {
    if (rows.length === 0) return [];
    const crmProjectIds = [...new Set(rows.map((r) => r.crmProjectId))];
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const crmRows = crmProjectIds.length > 0 ? await db.select().from(crmProjects).where(inArray(crmProjects.id, crmProjectIds)) : [];
    const projectIds = [...new Set(crmRows.map((r) => r.projectId))];
    const projectsData = projectIds.length > 0 ? await db.select().from(projects).where(inArray(projects.id, projectIds)) : [];
    const usersData = userIds.length > 0 ? await db.select().from(users).where(inArray(users.id, userIds)) : [];
    const crmMap = new Map(crmRows.map((r) => [r.id, r]));
    const projectMap = new Map(projectsData.map((p) => [p.id, p]));
    const userMap = new Map(usersData.map((u) => [u.id, u]));
    return rows.map((row) => {
      const crmProject = crmMap.get(row.crmProjectId);
      const user = userMap.get(row.userId);
      return {
        ...row,
        crmProject: crmProject ? { ...crmProject, project: projectMap.get(crmProject.projectId) } : undefined,
        user: user ? { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, profileImageUrl: user.profileImageUrl, createdAt: user.createdAt, updatedAt: user.updatedAt } as SafeUser : undefined,
      };
    });
  }

  async updateProjectDailyUpdate(id: string, data: Partial<InsertProjectDailyUpdate>): Promise<ProjectDailyUpdate | undefined> {
    const [updated] = await db.update(projectDailyUpdates).set(data).where(eq(projectDailyUpdates.id, id)).returning();
    return updated;
  }

  async deleteProjectDailyUpdate(id: string): Promise<void> {
    await db.delete(projectDailyUpdates).where(eq(projectDailyUpdates.id, id));
  }

// ═══════════════════════════════════════

  async createReminder(data: InsertReminder): Promise<Reminder> {
    const [reminder] = await db.insert(reminders).values(stampWorkspace(data)).returning();
    return reminder;
  }

  async getUserRemindersForProject(userId: string, crmProjectId: string): Promise<Reminder[]> {
    return db
      .select()
      .from(reminders)
      .where(and(eq(reminders.userId, userId), eq(reminders.crmProjectId, crmProjectId)))
      .orderBy(asc(reminders.dueAt));
  }

  async getReminder(id: string): Promise<Reminder | undefined> {
    const [reminder] = await db.select().from(reminders).where(and(eq(reminders.id, id), inWorkspace(reminders)));
    return reminder;
  }

  async updateReminder(
    id: string,
    data: Partial<Pick<Reminder, "title" | "note" | "dueAt" | "status" | "taskId" | "notified" | "notifiedInApp" | "emailSent">>,
  ): Promise<Reminder | undefined> {
    const [updated] = await db
      .update(reminders)
      .set(data)
      .where(and(eq(reminders.id, id), inWorkspace(reminders)))
      .returning();
    return updated;
  }

  async deleteReminder(id: string): Promise<void> {
    await db.delete(reminders).where(and(eq(reminders.id, id), inWorkspace(reminders)));
  }

  // Due, not-done reminders that still have at least one channel pending delivery.
  // The dispatcher marks each channel only after it succeeds, so failed channels retry
  // and succeeded channels are never re-sent (exactly-once per channel).
  async getPendingDueReminders(now: Date): Promise<Reminder[]> {
    return db
      .select()
      .from(reminders)
      .where(
        and(
          lte(reminders.dueAt, now),
          ne(reminders.status, "done"),
          or(eq(reminders.notifiedInApp, 0), eq(reminders.emailSent, 0)),
          inWorkspace(reminders),
        ),
      )
      .orderBy(asc(reminders.dueAt));
  }

  // ═══════════════════════════════════════
  // Desktop Agent
  // ═══════════════════════════════════════

  async createAgentPairingCode(data: { userId: string; code: string; expiresAt: Date }): Promise<AgentPairingCode> {
    const [result] = await db.insert(agentPairingCodes).values(stampWorkspace(data)).returning();
    return result;
  }

  async getAgentPairingCode(code: string): Promise<AgentPairingCode | undefined> {
    const located = await workspaceForPairingCode(code);
    if (!located) return undefined;
    return runWithWorkspaceContext({ workspaceId: located.workspaceId }, async () => {
      const [result] = await db
        .select()
        .from(agentPairingCodes)
        .where(eq(agentPairingCodes.code, code));
      return result;
    });
  }

  async markPairingCodeUsed(id: string): Promise<boolean> {
    const [result] = await db
      .update(agentPairingCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(agentPairingCodes.id, id), isNull(agentPairingCodes.usedAt)))
      .returning({ id: agentPairingCodes.id });
    return Boolean(result);
  }

  async createDevice(data: InsertDevice): Promise<Device> {
    const [result] = await db.insert(devices).values(data).returning();
    const ctx = currentWorkspaceContext();
    if (ctx?.membershipId) {
      await db.insert(deviceEnrollments).values({
        deviceId: result.id,
        workspaceId: ctx.workspaceId,
        membershipId: ctx.membershipId,
      });
    }
    return result;
  }

  async getDevice(id: string): Promise<Device | undefined> {
    const [result] = await db.select().from(devices).where(eq(devices.id, id));
    return result;
  }

  async getDeviceByTokenHash(deviceId: string, tokenHash: string): Promise<Device | undefined> {
    const [result] = await db
      .select()
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.deviceTokenHash, tokenHash)));
    return result;
  }

  async updateDeviceLastSeen(id: string): Promise<void> {
    await db
      .update(devices)
      .set({ lastSeenAt: new Date() })
      .where(eq(devices.id, id));
  }

  async revokeDevice(id: string): Promise<void> {
    await db
      .update(devices)
      .set({ revokedAt: new Date() })
      .where(eq(devices.id, id));
  }

  async revokeDevicesByMachine(userId: string, name: string, os: string | null): Promise<void> {
    await db
      .update(devices)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(devices.userId, userId),
          eq(devices.name, name),
          os ? eq(devices.os, os) : isNull(devices.os),
          isNull(devices.revokedAt)
        )
      );
  }

  async getUserDevices(userId: string): Promise<Device[]> {
    return db
      .select()
      .from(devices)
      .where(eq(devices.userId, userId))
      .orderBy(desc(devices.createdAt));
  }

  async getScreenshotPolicy(): Promise<ScreenshotPolicy> {
    return getScreenshotPolicy();
  }

  async upsertScreenshotPolicy(policy: Partial<ScreenshotPolicy>): Promise<void> {
    return upsertScreenshotPolicy(policy);
  }

  async getAllowedTimezones(): Promise<string[]> {
    return getAllowedTimezones();
  }

  async upsertAllowedTimezones(timezones: string[]): Promise<void> {
    return upsertAllowedTimezones(timezones);
  }

  async applyTimerCommand(
    input: Parameters<typeof applyTimerCommand>[0]
  ): ReturnType<typeof applyTimerCommand> {
    return applyTimerCommand(input);
  }

  async listTimerCommands(userId: string): ReturnType<typeof listTimerCommands> {
    return listTimerCommands(userId);
  }

  async getHelpCenterScreenshots(): Promise<HelpCenterScreenshotsMap> {
    const [row] = await db
      .select()
      .from(orgSettings)
      .where(and(inWorkspace(orgSettings), eq(orgSettings.id, "default")));
    const raw = row?.helpCenterScreenshots;
    if (!raw || typeof raw !== "object") return {};
    return { ...(raw as Record<string, string>) };
  }

  async mergeHelpCenterScreenshots(partial: Record<string, string | null>): Promise<void> {
    const current = await this.getHelpCenterScreenshots();
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries(current)) {
      if (typeof v === "string" && v.length > 0) merged[k] = v;
    }
    for (const [k, v] of Object.entries(partial)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    const [row] = await db
      .select()
      .from(orgSettings)
      .where(and(inWorkspace(orgSettings), eq(orgSettings.id, "default")));
    if (!row) {
      await db.insert(orgSettings).values(stampWorkspace({
        id: "default",
        screenshotPolicy: DEFAULT_SCREENSHOT_POLICY,
        allowedTimezones: [...DEFAULT_ALLOWED_TIMEZONES],
        helpCenterScreenshots: merged,
        updatedAt: new Date(),
      }));
    } else {
      await db
        .update(orgSettings)
        .set({ helpCenterScreenshots: merged, updatedAt: new Date() })
        .where(and(inWorkspace(orgSettings), eq(orgSettings.id, "default")));
    }
  }

  async isAgentBatchProcessed(batchId: string): Promise<boolean> {
    return isAgentBatchProcessed(batchId);
  }

  async markAgentBatchProcessed(batchId: string, deviceId: string, eventCount: number): Promise<void> {
    return markAgentBatchProcessed(batchId, deviceId, eventCount);
  }

  async createAgentActivityEvents(events: Array<{
    deviceId: string;
    userId: string;
    timeEntryId: string | null;
    batchId: string;
    eventType: string;
    timestamp: Date;
    data?: Record<string, unknown>;
  }>): Promise<void> {
    return createAgentActivityEvents(events);
  }

  // ─── Admin Analytics ───
  //
  // Every figure of time is a sum of `timePortion`s over the range (F67), the
  // running and paused entries included, as Time Tracking counts it.

  private analyticsSpans(opts: AnalyticsOptions): Promise<TimeSpanRow[]> {
    return this.getTimeSpans({ ...opts, includeActive: true });
  }

  /** Live captures taken in the range, counted apart from the time so that neither repeats the other. */
  private liveCapturesIn(opts: AnalyticsOptions): SQL[] {
    const conditions = [
      inWorkspace(timeEntryScreenshots),
      gte(timeEntryScreenshots.capturedAt, opts.startDate),
      lte(timeEntryScreenshots.capturedAt, opts.endDate),
      sql`${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'`,
      isNull(timeEntryScreenshots.deletedAt),
    ];
    if (opts.userId) conditions.push(eq(timeEntryScreenshots.userId, opts.userId));
    if (opts.crmProjectId) conditions.push(eq(timeEntryScreenshots.crmProjectId, opts.crmProjectId));
    return conditions;
  }

  private async countDeletedCaptures(opts: AnalyticsOptions): Promise<number> {
    const conditions = [
      inWorkspace(timeEntryScreenshots),
      gte(timeEntryScreenshots.capturedAt, opts.startDate),
      lte(timeEntryScreenshots.capturedAt, opts.endDate),
      sql`${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'`,
      isNotNull(timeEntryScreenshots.deletedAt),
      notDuplicateCapture(),
    ];
    if (opts.userId) conditions.push(eq(timeEntryScreenshots.userId, opts.userId));
    if (opts.crmProjectId) conditions.push(eq(timeEntryScreenshots.crmProjectId, opts.crmProjectId));
    const [row] = await db.select({ count: count() }).from(timeEntryScreenshots).where(and(...conditions));
    return row?.count ?? 0;
  }

  private async countActivityEvents(opts: AnalyticsOptions, eventType?: string): Promise<Map<string, number>> {
    const conditions = [
      inWorkspace(agentActivityEvents),
      gte(agentActivityEvents.timestamp, opts.startDate),
      lte(agentActivityEvents.timestamp, opts.endDate),
    ];
    if (eventType) conditions.push(eq(agentActivityEvents.eventType, eventType));
    if (opts.userId) conditions.push(eq(agentActivityEvents.userId, opts.userId));
    const rows = await db
      .select({ userId: agentActivityEvents.userId, count: count() })
      .from(agentActivityEvents)
      .where(and(...conditions))
      .groupBy(agentActivityEvents.userId);
    return new Map(rows.map((row) => [row.userId, row.count]));
  }

  /** The last contact of each User's Devices enrolled in this Workspace. */
  private async lastContactByUser(): Promise<Map<string, Date | null>> {
    const rows = await db
      .select({ userId: devices.userId, lastSeenAt: max(devices.lastSeenAt) })
      .from(devices)
      .where(and(inArray(devices.id, enrolledDeviceIds()), isNull(devices.revokedAt)))
      .groupBy(devices.userId);
    return new Map(rows.map((row) => [row.userId, row.lastSeenAt]));
  }

  private async userNames(ids: string[]): Promise<(id: string) => string> {
    const rows = ids.length > 0
      ? await db
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
          .from(users)
          .where(inArray(users.id, Array.from(new Set(ids))))
      : [];
    const names = new Map(rows.map((row) => [row.id, personName(row)]));
    return (id) => names.get(id) ?? "Unknown User";
  }

  async getAdminOverview(opts: AnalyticsOptions): Promise<{
    totalTrackedSeconds: number;
    totalIdleSeconds: number;
    entriesCount: number;
    runningNow: number;
    activeUsersToday: number;
    screenshotsInWindow: number;
    lowActivityEntries: number;
    revokedDevices: number;
  }> {
    const now = new Date();
    const calendar = dayCalendar(opts.timeZone);
    const today = calendar.startOfDay(calendar.dayOf(now));

    const [entries, todayEntries, [running], [captures], [revoked]] = await Promise.all([
      this.analyticsSpans(opts),
      this.analyticsSpans({ ...opts, startDate: today, endDate: now }),
      db.select({ count: count() }).from(timeEntries).where(and(inWorkspace(timeEntries), eq(timeEntries.status, "running"))),
      db.select({ count: count() }).from(timeEntryScreenshots).where(and(...this.liveCapturesIn(opts))),
      db.select({ count: count() }).from(devices).where(and(inArray(devices.id, enrolledDeviceIds()), isNotNull(devices.revokedAt))),
    ]);

    return {
      totalTrackedSeconds: entries.reduce((sum, e) => sum + e.seconds, 0),
      totalIdleSeconds: entries.reduce((sum, e) => sum + e.idleSeconds, 0),
      entriesCount: entries.length,
      runningNow: running?.count ?? 0,
      activeUsersToday: new Set(todayEntries.map((e) => e.userId)).size,
      screenshotsInWindow: captures?.count ?? 0,
      lowActivityEntries: entries.filter((e) => e.idleSeconds > e.seconds).length,
      revokedDevices: revoked?.count ?? 0,
    };
  }

  async getAdminProductivity(opts: AnalyticsOptions): Promise<{
    byUser: Array<{ userId: string; userName: string; totalSeconds: number; idleSeconds: number; entriesCount: number }>;
    byProject: Array<{ crmProjectId: string; projectName: string; clientName: string | null; totalSeconds: number; entriesCount: number }>;
    byTask: Array<{ taskId: string; taskName: string; crmProjectId: string; projectName: string; clientName: string | null; totalSeconds: number }>;
    dailyTrend: Array<{ date: string; totalSeconds: number }>;
  }> {
    const calendar = dayCalendar(opts.timeZone);
    const period = { start: opts.startDate, end: opts.endDate };
    const people = new Map<string, { userId: string; userName: string; totalSeconds: number; idleSeconds: number; entriesCount: number }>();
    const projectRows = new Map<string, { crmProjectId: string; projectName: string; clientName: string | null; totalSeconds: number; entriesCount: number }>();
    const taskRows = new Map<string, { taskId: string; taskName: string; crmProjectId: string; projectName: string; clientName: string | null; totalSeconds: number }>();
    const days = new Map<string, number>();

    for (const entry of await this.analyticsSpans(opts)) {
      const { userId, userName, crmProjectId, taskId, clientName } = entry;
      const projectName = entry.projectName ?? "Unknown Project";

      const person = people.get(userId) ?? { userId, userName, totalSeconds: 0, idleSeconds: 0, entriesCount: 0 };
      person.totalSeconds += entry.seconds;
      person.idleSeconds += entry.idleSeconds;
      person.entriesCount += 1;
      people.set(userId, person);

      const project = projectRows.get(crmProjectId) ?? { crmProjectId, projectName, clientName, totalSeconds: 0, entriesCount: 0 };
      project.totalSeconds += entry.seconds;
      project.entriesCount += 1;
      projectRows.set(crmProjectId, project);

      if (taskId) {
        const task = taskRows.get(taskId)
          ?? { taskId, taskName: entry.taskName ?? "Unknown Task", crmProjectId, projectName, clientName, totalSeconds: 0 };
        task.totalSeconds += entry.seconds;
        taskRows.set(taskId, task);
      }

      for (const day of dayPortions(entry.span, period, calendar)) {
        if (day.seconds > 0) days.set(day.date, (days.get(day.date) ?? 0) + day.seconds);
      }
    }

    return {
      byUser: Array.from(people.values()).sort((a, b) => b.totalSeconds - a.totalSeconds || a.userName.localeCompare(b.userName)),
      byProject: Array.from(projectRows.values()).sort((a, b) => b.totalSeconds - a.totalSeconds || a.projectName.localeCompare(b.projectName)),
      byTask: Array.from(taskRows.values()).sort((a, b) => b.totalSeconds - a.totalSeconds || a.taskName.localeCompare(b.taskName)),
      dailyTrend: Array.from(days, ([date, totalSeconds]) => ({ date, totalSeconds })).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  async getTimeExport(opts: AnalyticsOptions): Promise<TimeExportRow[]> {
    return (await this.analyticsSpans(opts)).map((entry) => ({
      ...entry,
      startTime: entry.span.start,
      endTime: entry.status === "stopped" ? entry.span.end : null,
    }));
  }

  async getAdminActivityStats(opts: AnalyticsOptions): Promise<{
    byUser: Array<{
      userId: string;
      userName: string;
      totalSeconds: number;
      idleSeconds: number;
      idleRatio: number;
      idleEventCount: number;
    }>;
  }> {
    const [{ byUser }, idleEvents] = await Promise.all([
      this.getAdminProductivity(opts),
      this.countActivityEvents(opts, "idle_start"),
    ]);
    return {
      byUser: byUser
        .map(({ userId, userName, totalSeconds, idleSeconds }) => ({
          userId,
          userName,
          totalSeconds,
          idleSeconds,
          idleRatio: idleRatioOf(totalSeconds, idleSeconds),
          idleEventCount: idleEvents.get(userId) ?? 0,
        }))
        .sort((a, b) => b.idleRatio - a.idleRatio),
    };
  }

  async getAdminScreenshotStats(opts: AnalyticsOptions): Promise<{
    totalCount: number;
    byUser: Array<{ userId: string; userName: string; count: number }>;
    hourlyDistribution: Array<{ hour: number; count: number }>;
    duplicates: Array<{ contentHash: string; count: number }>;
    deletedCount: number;
  }> {
    const live = this.liveCapturesIn(opts);
    const [perUser, perQuarter, duplicates, deletedCount] = await Promise.all([
      db
        .select({ userId: timeEntryScreenshots.userId, count: count() })
        .from(timeEntryScreenshots)
        .where(and(...live))
        .groupBy(timeEntryScreenshots.userId)
        .orderBy(desc(count())),
      db
        .select({ quarter: captureQuarter(), count: count() })
        .from(timeEntryScreenshots)
        .where(and(...live))
        .groupBy(captureQuarter()),
      db
        .select({ contentHash: timeEntryScreenshots.contentHash, count: count() })
        .from(timeEntryScreenshots)
        .where(and(...live, isNotNull(timeEntryScreenshots.contentHash)))
        .groupBy(timeEntryScreenshots.contentHash)
        .having(sql`COUNT(*) > 1`)
        .orderBy(desc(count()))
        .limit(20),
      this.countDeletedCaptures(opts),
    ]);

    const nameOf = await this.userNames(perUser.map((row) => row.userId));
    const calendar = dayCalendar(opts.timeZone);
    const hours = new Map<number, number>();
    for (const row of perQuarter) {
      const hour = calendar.hourOf(quarterStart(row.quarter));
      hours.set(hour, (hours.get(hour) ?? 0) + row.count);
    }

    return {
      totalCount: perUser.reduce((sum, row) => sum + row.count, 0),
      byUser: perUser.map((row) => ({ userId: row.userId, userName: nameOf(row.userId), count: row.count })),
      hourlyDistribution: Array.from(hours, ([hour, total]) => ({ hour, count: total })).sort((a, b) => a.hour - b.hour),
      duplicates: duplicates.map((row) => ({ contentHash: row.contentHash!, count: row.count })),
      deletedCount,
    };
  }

  async getAdminAlerts(opts: AnalyticsOptions): Promise<{
    highIdleUsers: Array<{ userId: string; userName: string; idleRatio: number; totalSeconds: number }>;
    stalledDevices: Array<{ deviceId: string; deviceName: string; userId: string; userName: string; lastSeenAt: Date | null; daysSinceLastSeen: number }>;
    runningWithoutScreenshots: Array<{ userId: string; userName: string; entryId: string; startedAt: Date }>;
  }> {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

    const [{ byUser }, running, stalled] = await Promise.all([
      this.getAdminProductivity(opts),
      db
        .select({ entryId: timeEntries.id, userId: timeEntries.userId, startedAt: timeEntries.startTime })
        .from(timeEntries)
        .where(and(
          inWorkspace(timeEntries),
          eq(timeEntries.status, "running"),
          lt(timeEntries.startTime, thirtyMinAgo),
          notExists(
            db
              .select({ id: timeEntryScreenshots.id })
              .from(timeEntryScreenshots)
              .where(and(
                inWorkspace(timeEntryScreenshots),
                eq(timeEntryScreenshots.timeEntryId, timeEntries.id),
                gte(timeEntryScreenshots.capturedAt, thirtyMinAgo),
                sql`${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'`,
                isNull(timeEntryScreenshots.deletedAt),
              )),
          ),
        ))
        .orderBy(asc(timeEntries.startTime), asc(timeEntries.id)),
      db
        .select({ deviceId: devices.id, deviceName: devices.name, userId: devices.userId, lastSeenAt: devices.lastSeenAt })
        .from(devices)
        .where(isStalledDevice())
        .orderBy(asc(devices.lastSeenAt)),
    ]);
    const nameOf = await this.userNames([...running, ...stalled].map((row) => row.userId));

    return {
      highIdleUsers: byUser
        .filter((row) => row.totalSeconds + row.idleSeconds >= 3600 && row.idleSeconds > row.totalSeconds)
        .map(({ userId, userName, totalSeconds, idleSeconds }) => ({
          userId,
          userName,
          idleRatio: idleRatioOf(totalSeconds, idleSeconds),
          totalSeconds,
        }))
        .sort((a, b) => b.idleRatio - a.idleRatio),
      stalledDevices: stalled.map((device) => ({
        ...device,
        userName: nameOf(device.userId),
        daysSinceLastSeen: device.lastSeenAt ? Math.floor((Date.now() - device.lastSeenAt.getTime()) / 86400000) : 999,
      })),
      runningWithoutScreenshots: running.map((entry) => ({ ...entry, userName: nameOf(entry.userId) })),
    };
  }

  // ─── Data Quality Report ───
  //
  // v1 only. Flags are purely observational: they describe evidence
  // completeness, not whether tracked time is valid.
  //
  // Quality flag definitions:
  //   low_coverage      — under half of the captures the policy expects
  //   duplicate_heavy   — ≥ 20% of screenshots share a contentHash with another
  //   events_missing    — user has tracked time but zero activity events recorded
  //   stale_device      — user's most recent device hasn't been seen in 7+ days
  async getDataQualityReport(opts: AnalyticsOptions): Promise<{
    byUser: Array<{
      userId: string;
      userName: string;
      trackedSeconds: number;
      screenshotCount: number;
      /** Null when nothing was tracked */
      expectedScreenshots: number | null;
      /** Null when nothing is expected */
      screenshotCoveragePercent: number | null;
      /** Duplicate screenshot count (same contentHash) */
      duplicateScreenshots: number;
      /** Activity events recorded for this user in window */
      activityEventCount: number;
      /** Quality flags raised for this user */
      flags: string[];
    }>;
    org: {
      /** Entries in window with no live screenshot taken in it */
      entriesWithoutAnyScreenshot: number;
      /** Total duplicate screenshot rows (contentHash repeated) */
      orgDuplicateScreenshots: number;
      /** Non-revoked devices not seen in 7+ days */
      stalledDevices: number;
      /** Screenshots tombstoned (soft-deleted by an admin) in this window */
      deletedScreenshots: number;
    };
  }> {
    const repeated = () => sql<number>`(COUNT(*) - COUNT(DISTINCT ${timeEntryScreenshots.contentHash}))::int`;
    const coverage = await this.getScreenshotCoverageReport(opts);
    const people = coverage.byUser.filter((row) => row.entriesCount > 0);
    if (people.length === 0) {
      return { byUser: [], org: { entriesWithoutAnyScreenshot: 0, orgDuplicateScreenshots: 0, stalledDevices: 0, deletedScreenshots: 0 } };
    }

    const [duplicateRows, [orgDuplicates], events, lastContact, [stalled]] = await Promise.all([
      db
        .select({ userId: timeEntryScreenshots.userId, count: repeated() })
        .from(timeEntryScreenshots)
        .where(and(...this.liveCapturesIn(opts), isNotNull(timeEntryScreenshots.contentHash)))
        .groupBy(timeEntryScreenshots.userId),
      db
        .select({ count: repeated() })
        .from(timeEntryScreenshots)
        .where(and(...this.liveCapturesIn({ ...opts, userId: undefined }), isNotNull(timeEntryScreenshots.contentHash))),
      this.countActivityEvents(opts),
      this.lastContactByUser(),
      db.select({ count: count() }).from(devices).where(isStalledDevice()),
    ]);
    const duplicates = new Map(duplicateRows.map((row) => [row.userId, row.count]));
    const sevenDaysAgo = stalledBefore();

    return {
      byUser: people.map((row) => {
        const duplicateScreenshots = duplicates.get(row.userId) ?? 0;
        const activityEventCount = events.get(row.userId) ?? 0;
        const lastSeen = lastContact.get(row.userId) ?? null;

        const flags: string[] = [];
        if (row.coveragePct !== null && row.coveragePct < 50) flags.push("low_coverage");
        if (row.screenshotCount > 0 && duplicateScreenshots / row.screenshotCount >= 0.2) flags.push("duplicate_heavy");
        if (row.trackedSeconds > 0 && activityEventCount === 0) flags.push("events_missing");
        if (lastSeen !== null && lastSeen < sevenDaysAgo) flags.push("stale_device");

        return {
          userId: row.userId,
          userName: row.userName,
          trackedSeconds: row.trackedSeconds,
          screenshotCount: row.screenshotCount,
          expectedScreenshots: row.trackedSeconds > 0 ? row.expectedScreenshots : null,
          screenshotCoveragePercent: row.coveragePct,
          duplicateScreenshots,
          activityEventCount,
          flags,
        };
      }),
      org: {
        entriesWithoutAnyScreenshot: coverage.summary.entriesWithoutScreenshots,
        orgDuplicateScreenshots: orgDuplicates?.count ?? 0,
        stalledDevices: stalled?.count ?? 0,
        deletedScreenshots: coverage.summary.deletedScreenshots,
      },
    };
  }

  // ─── Screenshot Coverage Report ───
  //
  // The live captures taken in the range against what the capture policy
  // promises for the tracked time: one per `captureIntervalMaxMin`, on the
  // Projects it captures. The time is never modified here.
  async getScreenshotCoverageReport(opts: AnalyticsOptions): Promise<ScreenshotCoverageReport> {
    const [entries, captures, policy, deletedScreenshots] = await Promise.all([
      this.analyticsSpans(opts),
      db
        .select({
          timeEntryId: timeEntryScreenshots.timeEntryId,
          userId: timeEntryScreenshots.userId,
          crmProjectId: timeEntryScreenshots.crmProjectId,
          quarter: captureQuarter(),
          count: count(),
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          projectName: projects.name,
        })
        .from(timeEntryScreenshots)
        .innerJoin(users, eq(users.id, timeEntryScreenshots.userId))
        .leftJoin(crmProjects, and(eq(crmProjects.id, timeEntryScreenshots.crmProjectId), inWorkspace(crmProjects)))
        .leftJoin(projects, and(eq(projects.id, crmProjects.projectId), inWorkspace(projects)))
        .where(and(...this.liveCapturesIn(opts)))
        .groupBy(
          timeEntryScreenshots.timeEntryId,
          timeEntryScreenshots.userId,
          timeEntryScreenshots.crmProjectId,
          captureQuarter(),
          users.id,
          projects.id,
        ),
      getScreenshotPolicy(),
      this.countDeletedCaptures(opts),
    ]);

    // `screenshotProjectIds` is left out: every Plan that opens Analytics captures on all Projects.
    const everySeconds = policy.captureIntervalMaxMin * 60;
    const figures = () => ({ trackedSeconds: 0, entriesCount: 0, entriesWithoutScreenshots: 0, screenshotCount: 0 });
    type Figures = ReturnType<typeof figures>;
    const covered = (row: Figures) => {
      const expectedScreenshots = policy.screenshotsEnabled ? Math.floor(row.trackedSeconds / everySeconds) : 0;
      return {
        ...row,
        expectedScreenshots,
        coveragePct: expectedScreenshots > 0 ? Math.min(100, Math.round((row.screenshotCount / expectedScreenshots) * 100)) : null,
      };
    };

    const calendar = dayCalendar(opts.timeZone);
    const period = { start: opts.startDate, end: opts.endDate };
    const people = new Map<string, { userName: string; figures: Figures }>();
    const projectRows = new Map<string, { projectName: string; figures: Figures }>();
    const days = new Map<string, Figures>();
    const personOf = (id: string, userName: string) => {
      const row = people.get(id) ?? { userName, figures: figures() };
      people.set(id, row);
      return row.figures;
    };
    const projectOf = (id: string, projectName: string | null) => {
      const row = projectRows.get(id) ?? { projectName: projectName ?? "Unknown Project", figures: figures() };
      projectRows.set(id, row);
      return row.figures;
    };
    const dayOf = (date: string) => {
      const row = days.get(date) ?? figures();
      days.set(date, row);
      return row;
    };

    const capturesByEntry = new Map<string, number>();
    for (const row of captures) {
      capturesByEntry.set(row.timeEntryId, (capturesByEntry.get(row.timeEntryId) ?? 0) + row.count);
      personOf(row.userId, personName(row)).screenshotCount += row.count;
      projectOf(row.crmProjectId, row.projectName).screenshotCount += row.count;
      dayOf(calendar.dayOf(quarterStart(row.quarter))).screenshotCount += row.count;
    }

    let lowCoverageEntries = 0;
    for (const entry of entries) {
      const entryCaptures = capturesByEntry.get(entry.id) ?? 0;
      for (const row of [personOf(entry.userId, entry.userName), projectOf(entry.crmProjectId, entry.projectName)]) {
        row.trackedSeconds += entry.seconds;
        row.entriesCount += 1;
        if (entryCaptures === 0) row.entriesWithoutScreenshots += 1;
      }
      for (const day of dayPortions(entry.span, period, calendar)) {
        if (day.seconds > 0) dayOf(day.date).trackedSeconds += day.seconds;
      }
      if (policy.screenshotsEnabled && entryCaptures < Math.floor(entry.seconds / everySeconds) * 0.5) lowCoverageEntries += 1;
    }

    const byUser = Array.from(people, ([userId, row]) => ({ userId, userName: row.userName, ...covered(row.figures) }))
      .sort((a, b) => a.userName.localeCompare(b.userName));
    const byProject = Array.from(projectRows, ([crmProjectId, row]) => ({ crmProjectId, projectName: row.projectName, ...covered(row.figures) }))
      .sort((a, b) => a.projectName.localeCompare(b.projectName));
    const byDay = Array.from(days, ([date, row]) => {
      const { entriesCount: _count, entriesWithoutScreenshots: _without, ...rest } = covered(row);
      return { date, ...rest };
    }).sort((a, b) => a.date.localeCompare(b.date));

    const total = (key: "trackedSeconds" | "screenshotCount" | "expectedScreenshots" | "entriesCount" | "entriesWithoutScreenshots") =>
      byUser.reduce((sum, row) => sum + row[key], 0);
    const expectedScreenshots = total("expectedScreenshots");
    const totalScreenshots = total("screenshotCount");

    return {
      summary: {
        totalTrackedSeconds: total("trackedSeconds"),
        totalScreenshots,
        expectedScreenshots,
        coveragePercent: expectedScreenshots > 0 ? Math.min(100, Math.round((totalScreenshots / expectedScreenshots) * 100)) : null,
        totalEntries: total("entriesCount"),
        entriesWithoutScreenshots: total("entriesWithoutScreenshots"),
        lowCoverageEntries,
        deletedScreenshots,
        captureEveryMinutes: policy.screenshotsEnabled ? policy.captureIntervalMaxMin : null,
      },
      byUser,
      byProject,
      byDay,
    };
  }

  // ─── Evidence Quality Report ───
  //
  // v1 only. A composite 0–100 score per user describing how well their
  // tracked sessions are supported by observable evidence. The time is never
  // modified here: the score is an observational label only.
  //
  // Score components:
  //   coverageScore  (0–40)  screenshot count vs what the capture policy expects
  //   qualityScore   (0–30)  deductions: dup ratio + low physical-activity screenshots
  //   eventsScore    (0–20)  activity events linked to entries exist
  //   deviceScore    (0–10)  device heartbeat freshness
  //
  async getEvidenceQualityReport(opts: AnalyticsOptions): Promise<EvidenceQualityReport> {
    const [coverage, signalRows, events, lastContact] = await Promise.all([
      this.getScreenshotCoverageReport(opts),
      // AVG is a numeric, which the driver hands over as text unless cast.
      db
        .select({
          userId: timeEntryScreenshots.userId,
          uniqueHashes: sql<number>`COUNT(DISTINCT ${timeEntryScreenshots.contentHash})::int`,
          keyboard: sql<number | null>`AVG(${timeEntryScreenshots.keyboardActivityPercent})::float8`,
          mouse: sql<number | null>`AVG(${timeEntryScreenshots.mouseActivityPercent})::float8`,
        })
        .from(timeEntryScreenshots)
        .where(and(...this.liveCapturesIn(opts)))
        .groupBy(timeEntryScreenshots.userId),
      this.countActivityEvents(opts),
      this.lastContactByUser(),
    ]);
    const signals = new Map(signalRows.map((row) => [row.userId, row]));

    // ── Scoring ────────────────────────────────────────────────────────────────
    const oneDayMs  = 86_400_000;
    const sevenDaysMs = 7 * oneDayMs;

    const byUser = coverage.byUser.filter((row) => row.entriesCount > 0).map(r => {
      const signal       = signals.get(r.userId);
      const shotCount    = r.screenshotCount;
      const uniqueHashes = signal?.uniqueHashes ?? 0;
      const eventCount   = events.get(r.userId) ?? 0;
      const lastSeen     = lastContact.get(r.userId) ?? null;

      // 1. Coverage (0–40)
      const expected = r.expectedScreenshots;
      const coveragePct = expected > 0 ? Math.min(1, shotCount / expected) : 0;
      const coverageScore = Math.round(40 * coveragePct);

      // 2. Quality (0–30): deductions for duplicates and low-activity screenshots
      const dupCount  = Math.max(0, shotCount - uniqueHashes);
      const dupRatio  = shotCount > 0 ? dupCount / shotCount : 0;
      // Full dup penalty (15 pts) at ≥ 50% duplicate ratio
      const dupPenalty = Math.round(15 * Math.min(1, dupRatio * 2));
      // Activity penalty: avg (keyboard + mouse) < 20% → points lost
      const avgKeyboard = signal?.keyboard ?? null;
      const avgMouse    = signal?.mouse ?? null;
      const avgActivity = (avgKeyboard !== null || avgMouse !== null)
        ? ((avgKeyboard ?? 0) + (avgMouse ?? 0)) / 2
        : null;
      // No screenshots → no activity signal → no penalty (don't double-penalise)
      const activityPenalty = avgActivity !== null
        ? Math.round(15 * Math.max(0, 1 - avgActivity / 20))
        : 0;
      const qualityScore = Math.max(0, 30 - dupPenalty - activityPenalty);

      // 3. Events (0–20): any linked activity events in window
      const eventsScore = eventCount > 0 ? 20 : 0;

      // 4. Device freshness (0–10)
      const ageMs = lastSeen ? Date.now() - lastSeen.getTime() : null;
      const deviceScore = ageMs === null ? 0 : ageMs <= oneDayMs ? 10 : ageMs <= sevenDaysMs ? 5 : 0;

      const totalScore = coverageScore + qualityScore + eventsScore + deviceScore;
      const grade: EvidenceGrade =
        totalScore >= 75 ? "strong" :
        totalScore >= 50 ? "moderate" :
        totalScore >= 25 ? "weak" : "insufficient";

      return {
        userId:              r.userId,
        userName:            r.userName,
        entryCount:          r.entriesCount,
        trackedSeconds:      r.trackedSeconds,
        coverageScore,
        qualityScore,
        eventsScore,
        deviceScore,
        totalScore,
        grade,
        screenshotCount:     shotCount,
        expectedScreenshots: expected,
        dupRatio:            Math.round(dupRatio * 100) / 100,
        avgActivityPct:      avgActivity !== null ? Math.round(avgActivity) : null,
        hasEvents:           eventCount > 0,
        deviceLastSeenDaysAgo: ageMs === null ? null : Math.floor(ageMs / oneDayMs),
      };
    }).sort((a, b) => a.totalScore - b.totalScore); // worst first

    const gradeDistribution = { strong: 0, moderate: 0, weak: 0, insufficient: 0 };
    for (const u of byUser) gradeDistribution[u.grade]++;

    return { gradeDistribution, byUser };
  }

  async getAdminAllDevices(): Promise<Array<{
    id: string;
    userId: string;
    userName: string;
    name: string;
    os: string | null;
    clientVersion: string | null;
    lastSeenAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date | null;
  }>> {
    const allDevices = await db
      .select()
      .from(devices)
      .where(inArray(devices.id, enrolledDeviceIds()))
      .orderBy(desc(devices.lastSeenAt));
    const nameOf = await this.userNames(allDevices.map((d) => d.userId));
    return allDevices.map((d) => ({
      id: d.id,
      userId: d.userId,
      userName: nameOf(d.userId),
      name: d.name,
      os: d.os ?? null,
      clientVersion: d.clientVersion ?? null,
      lastSeenAt: d.lastSeenAt ?? null,
      revokedAt: d.revokedAt ?? null,
      createdAt: d.createdAt ?? null,
    }));
  }
}
