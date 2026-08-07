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
  companyDocuments,
  companyDocumentFolders,
  teams,
  teamMembers,
  teamInvites,
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
  type CompanyDocument,
  type InsertCompanyDocument,
  type CompanyDocumentWithUploader,
  type CompanyDocumentFolder,
  type InsertCompanyDocumentFolder,
  type CompanyDocumentFolderWithCreator,
  type Team,
  type InsertTeam,
  type TeamMember,
  type InsertTeamMember,
  type TeamMemberWithUser,
  type TeamInvite,
  type InsertTeamInvite,
  type TeamInviteWithTeam,
  type TeamWithDetails,
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
  agentProcessedBatches,
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
} from "@shared/schema";
import { db } from "./db";
import { eq, ne, and, desc, like, or, isNull, sql, gt, gte, lt, lte, asc, count, inArray } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(userData: InsertUser): Promise<User>;
  upsertUser(userData: { id: string; email?: string | null; firstName?: string | null; lastName?: string | null; profileImageUrl?: string | null }): Promise<User>;
  
  getProjects(userId: string): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(project: InsertProject & { ownerId: string }): Promise<Project>;
  updateProject(id: string, data: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<void>;
  
  getDocuments(projectId: string): Promise<Document[]>;
  getDocument(id: string): Promise<Document | undefined>;
  getDocumentAncestors(id: string): Promise<Document[]>;
  getRecentDocuments(userId: string, limit?: number): Promise<Document[]>;
  createDocument(document: InsertDocument): Promise<Document>;
  updateDocument(id: string, data: Partial<InsertDocument>): Promise<Document | undefined>;
  deleteDocument(id: string): Promise<void>;
  duplicateDocument(id: string): Promise<Document | undefined>;
  reorderDocument(id: string, newParentId: string | null, newPosition: number): Promise<void>;
  
  search(userId: string, query: string): Promise<Array<{ type: string; id: string; title: string; projectName?: string }>>;
  
  // Get all documents for a user across all projects (for chatbot knowledge base)
  getAllUserDocuments(userId: string): Promise<Array<Document & { projectName: string }>>;
  
  // CRM Clients
  getCrmClients(userId: string): Promise<CrmClient[]>;
  getCrmClient(id: string): Promise<CrmClient | undefined>;
  createCrmClient(client: InsertCrmClient & { ownerId: string }): Promise<CrmClient>;
  updateCrmClient(id: string, data: Partial<InsertCrmClient>): Promise<CrmClient | undefined>;
  deleteCrmClient(id: string): Promise<void>;
  
  // CRM Contacts
  getCrmContacts(clientId: string): Promise<CrmContact[]>;
  getCrmContact(id: string): Promise<CrmContact | undefined>;
  createCrmContact(contact: InsertCrmContact): Promise<CrmContact>;
  updateCrmContact(id: string, data: Partial<InsertCrmContact>): Promise<CrmContact | undefined>;
  deleteCrmContact(id: string): Promise<void>;
  
  // CRM Projects
  getCrmProjects(userId: string, options?: { 
    page?: number; 
    pageSize?: number; 
    status?: string;
    search?: string;
  }): Promise<{ data: CrmProjectWithDetails[]; total: number; page: number; pageSize: number }>;
  getCrmProject(id: string): Promise<CrmProjectWithDetails | undefined>;
  getCrmProjectByProjectId(projectId: string): Promise<CrmProject | undefined>;
  createCrmProject(crmProject: InsertCrmProject): Promise<CrmProject>;
  createCrmProjectWithBase(projectData: InsertProject & { ownerId: string }, crmData?: Partial<InsertCrmProject>): Promise<{ project: Project; crmProject: CrmProject }>;
  updateCrmProject(id: string, data: Partial<InsertCrmProject>): Promise<CrmProject | undefined>;
  deleteCrmProject(id: string): Promise<void>;
  toggleDocumentation(crmProjectId: string, enabled: boolean): Promise<CrmProject | undefined>;
  getDocumentationEnabledProjects(userId?: string): Promise<Project[]>;

  getMainAdmin(): Promise<SafeUser | undefined>;
  getAllUsers(opts?: { includeArchived?: boolean }): Promise<SafeUser[]>;
  archiveUser(userId: string, isArchived: boolean): Promise<SafeUser | undefined>;
  
  // Update user role (admin only)
  updateUserRole(userId: string, role: string): Promise<SafeUser | undefined>;
  
  // Admin user management
  updateUser(userId: string, data: { firstName?: string; lastName?: string; email?: string; hoursPerDay?: number; canViewDailyUpdates?: number }): Promise<SafeUser | undefined>;
  updateUserPassword(userId: string, hashedPassword: string, plainPassword?: string): Promise<SafeUser | undefined>;
  updateUserLastLogin(userId: string): Promise<void>;
  getAdminUserDetails(userId: string): Promise<User | undefined>;
  deleteUser(userId: string): Promise<void>;
  getUserWithPassword(userId: string): Promise<User | undefined>;
  
  // Company Document Folders
  getCompanyDocumentFolders(): Promise<CompanyDocumentFolderWithCreator[]>;
  getCompanyDocumentFolder(id: string): Promise<CompanyDocumentFolderWithCreator | undefined>;
  createCompanyDocumentFolder(folder: InsertCompanyDocumentFolder): Promise<CompanyDocumentFolder>;
  updateCompanyDocumentFolder(id: string, data: Partial<InsertCompanyDocumentFolder>): Promise<CompanyDocumentFolder | undefined>;
  deleteCompanyDocumentFolder(id: string): Promise<CompanyDocumentFolder | undefined>;
  
  // Company Documents
  getCompanyDocuments(folderId?: string): Promise<CompanyDocumentWithUploader[]>;
  getCompanyDocument(id: string): Promise<CompanyDocumentWithUploader | undefined>;
  createCompanyDocument(doc: InsertCompanyDocument): Promise<CompanyDocument>;
  updateCompanyDocument(id: string, data: Partial<InsertCompanyDocument>): Promise<CompanyDocument | undefined>;
  deleteCompanyDocument(id: string): Promise<CompanyDocument | undefined>;
  searchCompanyDocuments(query: string): Promise<CompanyDocumentWithUploader[]>;
  searchCompanyDocumentFolders(query: string): Promise<CompanyDocumentFolderWithCreator[]>;
  
  // Teams
  getTeams(userId: string): Promise<TeamWithDetails[]>;
  getTeam(id: string): Promise<TeamWithDetails | undefined>;
  createTeam(team: InsertTeam & { ownerId: string }): Promise<Team>;
  updateTeam(id: string, data: Partial<InsertTeam>): Promise<Team | undefined>;
  deleteTeam(id: string): Promise<void>;
  
  // Team Members
  getTeamMembers(teamId: string): Promise<TeamMemberWithUser[]>;
  addTeamMember(teamId: string, userId: string, role?: string): Promise<TeamMember>;
  updateTeamMemberRole(teamId: string, userId: string, role: string): Promise<TeamMember | undefined>;
  removeTeamMember(teamId: string, userId: string): Promise<void>;
  isTeamMember(teamId: string, userId: string): Promise<boolean>;
  
  // Team Invites
  getTeamInvites(teamId: string): Promise<TeamInviteWithTeam[]>;
  getTeamInviteByCode(code: string): Promise<TeamInviteWithTeam | undefined>;
  createTeamInvite(invite: InsertTeamInvite): Promise<TeamInvite>;
  useTeamInvite(code: string, userId: string): Promise<{ success: boolean; team?: Team; error?: string }>;
  deactivateTeamInvite(id: string): Promise<void>;
  
  // CRM Project Notes
  getCrmProjectNotes(crmProjectId: string): Promise<CrmProjectNoteWithCreator[]>;
  getCrmProjectLatestNote(crmProjectId: string): Promise<CrmProjectNoteWithCreator | undefined>;
  createCrmProjectNote(note: InsertCrmProjectNote): Promise<CrmProjectNote>;
  updateCrmProjectNote(id: string, data: Partial<InsertCrmProjectNote>): Promise<CrmProjectNote | undefined>;
  deleteCrmProjectNote(id: string): Promise<void>;
  
  // CRM Project Stage History
  getCrmProjectStageHistory(crmProjectId: string): Promise<CrmProjectStageHistoryWithUser[]>;
  createCrmProjectStageHistory(history: InsertCrmProjectStageHistory): Promise<CrmProjectStageHistory>;
  
  // Notifications
  getUserNotifications(userId: string): Promise<NotificationWithDetails[]>;
  getUnreadNotificationCount(userId: string): Promise<number>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  hasRecentNotification(userId: string, type: string, since: Date): Promise<boolean>;
  markNotificationRead(id: string, userId: string): Promise<void>;
  markAllNotificationsRead(userId: string): Promise<void>;
  
  // Audio Recordings
  getAudioRecording(id: string): Promise<AudioRecording | undefined>;
  createAudioRecording(recording: InsertAudioRecording): Promise<AudioRecording>;
  updateAudioRecording(id: string, data: Partial<InsertAudioRecording>): Promise<AudioRecording | undefined>;
  
  // CRM Tags
  getAllCrmTags(): Promise<CrmTag[]>;
  getCrmTag(id: string): Promise<CrmTag | undefined>;
  createCrmTag(tag: InsertCrmTag): Promise<CrmTag>;
  updateCrmTag(id: string, data: Partial<InsertCrmTag>): Promise<CrmTag | undefined>;
  deleteCrmTag(id: string): Promise<void>;
  
  // CRM Project Tags
  getCrmProjectTags(crmProjectId: string): Promise<CrmTag[]>;
  addTagToProject(crmProjectId: string, tagId: string): Promise<CrmProjectTag>;
  removeTagFromProject(crmProjectId: string, tagId: string): Promise<void>;
  
  // CRM Modules
  getCrmModules(): Promise<CrmModuleWithFields[]>;
  getCrmModule(id: string): Promise<CrmModuleWithFields | undefined>;
  createCrmModule(module: InsertCrmModule): Promise<CrmModule>;
  updateCrmModule(id: string, data: Partial<InsertCrmModule>): Promise<CrmModule | undefined>;
  deleteCrmModule(id: string): Promise<void>;
  
  // CRM Module Fields
  getCrmModuleFields(moduleId: string): Promise<CrmModuleField[]>;
  getCrmModuleField(id: string): Promise<CrmModuleField | undefined>;
  createCrmModuleField(field: InsertCrmModuleField): Promise<CrmModuleField>;
  updateCrmModuleField(id: string, data: Partial<InsertCrmModuleField>): Promise<CrmModuleField | undefined>;
  deleteCrmModuleField(id: string): Promise<void>;
  
  // CRM Custom Field Values
  getCrmProjectCustomFields(crmProjectId: string): Promise<CrmCustomFieldValue[]>;
  setCrmProjectCustomField(crmProjectId: string, fieldId: string, value: string | null): Promise<CrmCustomFieldValue>;
  updateCrmFieldValuesOnOptionRename(fieldId: string, oldLabel: string, newLabel: string): Promise<void>;
  updateCrmProjectsColumnOnOptionRename(column: "status" | "projectType", oldLabel: string, newLabel: string): Promise<void>;
  updateCrmClientsColumnOnOptionRename(column: "status", oldLabel: string, newLabel: string): Promise<void>;
  
  // Time Tracking
  getTimeEntries(options: { 
    userId?: string; 
    crmProjectId?: string; 
    startDate?: Date; 
    endDate?: Date;
    status?: string;
  }): Promise<TimeEntryWithDetails[]>;
  getTimeEntry(id: string): Promise<TimeEntryWithDetails | undefined>;
  getTimeEntryByClientCommandId(clientCommandId: string): Promise<TimeEntry | undefined>;
  getActiveTimeEntry(userId: string): Promise<TimeEntry | undefined>;
  /** Find running entries whose lastActivityAt is older than `staleThreshold` */
  getStaleRunningEntries(staleThreshold: Date): Promise<TimeEntry[]>;
  createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry>;
  updateTimeEntry(id: string, data: Partial<InsertTimeEntry>): Promise<TimeEntry | undefined>;
  deleteTimeEntry(id: string): Promise<void>;
  getTimeStats(options: { userId?: string; crmProjectId?: string; startDate?: Date; endDate?: Date }): Promise<{
    totalDuration: number;
    totalIdleTime: number;
    entriesCount: number;
    screenshotCount: number;
    byProject: Array<{ crmProjectId: string; projectName: string; totalDuration: number }>;
    byUser: Array<{ userId: string; userName: string; totalDuration: number }>;
  }>;
  /** Sum of stopped entry durations for a specific task today (for resume-from-accumulated UX). */
  getTaskDurationToday(userId: string, taskId: string, start: Date, end: Date): Promise<number>;
  /** Batch: today's stopped duration for multiple tasks — returns map taskId → seconds. */
  getTasksDurationToday(userId: string, taskIds: string[], start: Date, end: Date): Promise<Record<string, number>>;
  /** Batch-fetch duration/idleTime for a set of time entry IDs (for screenshot enrichment). */
  getTimeEntriesByIds(ids: string[]): Promise<Array<{ id: string; duration: number; idleTime: number }>>;

  // Time Entry Screenshots
  createTimeEntryScreenshot(screenshot: InsertTimeEntryScreenshot): Promise<TimeEntryScreenshot>;
  /** Returns the row regardless of soft-delete status (callers must check deletedAt). */
  getTimeEntryScreenshotById(id: string): Promise<TimeEntryScreenshot | undefined>;
  /** Lists live (non-deleted) screenshots only. */
  getTimeEntryScreenshots(options: {
    timeEntryId?: string;
    userId?: string;
    crmProjectId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ data: TimeEntryScreenshot[]; total: number }>;
  updateTimeEntryScreenshot(id: string, data: { storageKey: string; contentHash?: string }): Promise<TimeEntryScreenshot | undefined>;
  /** Hard delete — for internal use only (e.g. tests). Public API must use softDeleteTimeEntryScreenshot. */
  deleteTimeEntryScreenshot(id: string): Promise<void>;
  /**
   * Soft delete: marks the row as tombstoned, preserving metadata for analytics.
   * The GCS storage object is NOT deleted — storageKey is kept as an audit trail.
   * Returns the updated row, or undefined if not found or already deleted.
   */
  softDeleteTimeEntryScreenshot(
    id: string,
    deletedBy: string,
    reason?: string,
  ): Promise<TimeEntryScreenshot | undefined>;

  // Tasks
  getTasks(options: { crmProjectId: string; includeArchived?: boolean }): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  createTask(data: InsertTask): Promise<Task>;
  updateTask(id: string, data: Partial<InsertTask>): Promise<Task | undefined>;
  deleteTask(id: string): Promise<void>;

  // Project Members (self-managed)
  getProjectMembers(crmProjectId: string): Promise<ProjectMemberWithUser[]>;
  addProjectMember(crmProjectId: string, userId: string): Promise<ProjectMember>;
  removeProjectMember(crmProjectId: string, userId: string): Promise<void>;

  // Project Daily Updates
  createProjectDailyUpdate(data: InsertProjectDailyUpdate): Promise<ProjectDailyUpdate>;
  getProjectDailyUpdate(id: string): Promise<ProjectDailyUpdate | undefined>;
  getProjectDailyUpdatesByUser(userId: string, options?: { date?: Date }): Promise<ProjectDailyUpdateWithDetails[]>;
  getProjectDailyUpdatesForAdmin(options?: { startDate?: Date; endDate?: Date; userId?: string; crmProjectId?: string }): Promise<ProjectDailyUpdateWithDetails[]>;
  updateProjectDailyUpdate(id: string, data: Partial<InsertProjectDailyUpdate>): Promise<ProjectDailyUpdate | undefined>;
  deleteProjectDailyUpdate(id: string): Promise<void>;

  // Reminders (self only)
  createReminder(data: InsertReminder): Promise<Reminder>;
  getUserRemindersForProject(userId: string, crmProjectId: string): Promise<Reminder[]>;
  getReminder(id: string): Promise<Reminder | undefined>;
  updateReminder(id: string, data: Partial<Pick<Reminder, "title" | "note" | "dueAt" | "status" | "taskId" | "notified" | "notifiedInApp" | "emailSent">>): Promise<Reminder | undefined>;
  deleteReminder(id: string): Promise<void>;
  getPendingDueReminders(now: Date): Promise<Reminder[]>;

  // ─── Desktop Agent ───

  // Pairing codes
  createAgentPairingCode(data: { userId: string; code: string; expiresAt: Date }): Promise<AgentPairingCode>;
  getAgentPairingCode(code: string): Promise<AgentPairingCode | undefined>;
  markPairingCodeUsed(id: string): Promise<void>;

  // Devices
  createDevice(data: InsertDevice): Promise<Device>;
  getDevice(id: string): Promise<Device | undefined>;
  getDeviceByTokenHash(deviceId: string, tokenHash: string): Promise<Device | undefined>;
  updateDeviceLastSeen(id: string): Promise<void>;
  revokeDevice(id: string): Promise<void>;
  revokeDevicesByMachine(userId: string, name: string, os: string | null): Promise<void>;
  getUserDevices(userId: string): Promise<Device[]>;

  // Org settings
  getScreenshotPolicy(): Promise<ScreenshotPolicy>;
  upsertScreenshotPolicy(policy: Partial<ScreenshotPolicy>): Promise<void>;
  getAllowedTimezones(): Promise<string[]>;
  upsertAllowedTimezones(timezones: string[]): Promise<void>;
  getHelpCenterScreenshots(): Promise<HelpCenterScreenshotsMap>;
  mergeHelpCenterScreenshots(partial: Record<string, string | null>): Promise<void>;

  // Agent batch idempotency
  isAgentBatchProcessed(batchId: string): Promise<boolean>;
  markAgentBatchProcessed(batchId: string, deviceId: string, eventCount: number): Promise<void>;

  // Agent activity events
  createAgentActivityEvents(events: Array<{
    deviceId: string;
    userId: string;
    timeEntryId: string | null;
    batchId: string;
    eventType: string;
    timestamp: Date;
    data?: Record<string, unknown>;
  }>): Promise<void>;

  // ─── Evidence Quality Report ───
  // Computes a composite evidence score (0–100) per user for the given window.
  // Score NEVER modifies tracked time — it is a read-only observational label.
  getEvidenceQualityReport(opts: {
    startDate: Date;
    endDate: Date;
    userId?: string;
  }): Promise<EvidenceQualityReport>;
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
    const [user] = await db
      .insert(users)
      .values(userData)
      .returning();
    return user;
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
        return updated;
      }
    }

    // Normal upsert by OIDC id
    const [user] = await db
      .insert(users)
      .values({
        id: userData.id,
        email: userData.email ?? "",
        password: "REPLIT_OIDC_USER",
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
    return user;
  }

  async getProjects(userId?: string): Promise<Project[]> {
    // Return all projects for company-wide visibility
    return db
      .select()
      .from(projects)
      .orderBy(desc(projects.updatedAt));
  }

  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async createProject(project: InsertProject & { ownerId: string }): Promise<Project> {
    const [newProject] = await db.insert(projects).values(project).returning();
    return newProject;
  }

  async updateProject(id: string, data: Partial<InsertProject>): Promise<Project | undefined> {
    const [updated] = await db
      .update(projects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return updated;
  }

  async deleteProject(id: string): Promise<void> {
    await db.delete(documents).where(eq(documents.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }

  async getDocuments(projectId: string): Promise<Document[]> {
    return db
      .select()
      .from(documents)
      .where(eq(documents.projectId, projectId))
      .orderBy(documents.position);
  }

  async getDocument(id: string): Promise<Document | undefined> {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    return doc;
  }

  async getDocumentAncestors(id: string): Promise<Document[]> {
    const ancestors: Document[] = [];
    let currentId: string | null = id;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const [doc] = await db.select().from(documents).where(eq(documents.id, currentId));
      if (!doc) break;

      if (doc.parentId && doc.id !== id) {
        ancestors.unshift(doc);
      }
      currentId = doc.parentId;
    }

    return ancestors;
  }

  async getRecentDocuments(userId: string, limit: number = 10): Promise<Document[]> {
    const userProjects = await this.getProjects(userId);
    const projectIds = userProjects.map((p) => p.id);

    if (projectIds.length === 0) return [];

    return db
      .select()
      .from(documents)
      .where(
        or(...projectIds.map((pid) => eq(documents.projectId, pid)))
      )
      .orderBy(desc(documents.updatedAt))
      .limit(limit);
  }

  async createDocument(document: InsertDocument): Promise<Document> {
    const existingDocs = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.projectId, document.projectId),
          document.parentId ? eq(documents.parentId, document.parentId) : isNull(documents.parentId)
        )
      );

    const maxPosition = existingDocs.reduce((max, doc) => Math.max(max, doc.position), -1);

    const [newDoc] = await db
      .insert(documents)
      .values({
        ...document,
        position: maxPosition + 1,
      })
      .returning();

    await db
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, document.projectId));

    return newDoc;
  }

  async updateDocument(id: string, data: Partial<InsertDocument>): Promise<Document | undefined> {
    const [updated] = await db
      .update(documents)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(documents.id, id))
      .returning();

    if (updated) {
      await db
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
        .where(eq(documents.parentId, docId));

      for (const child of children) {
        await deleteRecursive(child.id);
      }

      await db.delete(documents).where(eq(documents.id, docId));
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
          .values({
            id: newId,
            title,
            content: doc.content,
            icon: doc.icon,
            projectId: doc.projectId,
            parentId: newParentId,
            position: isRoot ? newPosition : doc.position,
          })
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

  async search(userId: string, query: string): Promise<Array<{ type: string; id: string; title: string; projectName?: string }>> {
    const results: Array<{ type: string; id: string; title: string; projectName?: string }> = [];
    const searchPattern = `%${query}%`;

    const userProjects = await db
      .select()
      .from(projects)
      .where(and(eq(projects.ownerId, userId), like(projects.name, searchPattern)));

    for (const project of userProjects) {
      results.push({
        type: "project",
        id: project.id,
        title: project.name,
      });
    }

    const allUserProjects = await this.getProjects(userId);
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

  async getAllUserDocuments(userId: string): Promise<Array<Document & { projectName: string }>> {
    const userProjects = await this.getProjects(userId);
    const projectIds = userProjects.map((p) => p.id);
    const projectMap = new Map(userProjects.map((p) => [p.id, p.name]));

    if (projectIds.length === 0) return [];

    const allDocs = await db
      .select()
      .from(documents)
      .where(or(...projectIds.map((pid) => eq(documents.projectId, pid))))
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
      .orderBy(asc(crmClients.name));
  }

  async getCrmClient(id: string): Promise<CrmClient | undefined> {
    const [client] = await db.select().from(crmClients).where(eq(crmClients.id, id));
    return client;
  }

  async createCrmClient(client: InsertCrmClient & { ownerId: string }): Promise<CrmClient> {
    const [newClient] = await db.insert(crmClients).values(client).returning();
    return newClient;
  }

  async updateCrmClient(id: string, data: Partial<InsertCrmClient>): Promise<CrmClient | undefined> {
    const [updated] = await db
      .update(crmClients)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(crmClients.id, id))
      .returning();
    return updated;
  }

  async deleteCrmClient(id: string): Promise<void> {
    await db.delete(crmClients).where(eq(crmClients.id, id));
  }

  // CRM Contacts
  async getCrmContacts(clientId: string): Promise<CrmContact[]> {
    return db
      .select()
      .from(crmContacts)
      .where(eq(crmContacts.clientId, clientId))
      .orderBy(desc(crmContacts.isPrimary), asc(crmContacts.name));
  }

  async getCrmContact(id: string): Promise<CrmContact | undefined> {
    const [contact] = await db.select().from(crmContacts).where(eq(crmContacts.id, id));
    return contact;
  }

  async createCrmContact(contact: InsertCrmContact): Promise<CrmContact> {
    const [newContact] = await db.insert(crmContacts).values(contact).returning();
    return newContact;
  }

  async updateCrmContact(id: string, data: Partial<InsertCrmContact>): Promise<CrmContact | undefined> {
    const [updated] = await db
      .update(crmContacts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(crmContacts.id, id))
      .returning();
    return updated;
  }

  async deleteCrmContact(id: string): Promise<void> {
    await db.delete(crmContacts).where(eq(crmContacts.id, id));
  }

  // CRM Projects - Company-wide visibility
  async getCrmProjects(userId?: string, options?: { 
    page?: number; 
    pageSize?: number; 
    status?: string;
    search?: string;
  }): Promise<{ data: CrmProjectWithDetails[]; total: number; page: number; pageSize: number }> {
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
      eq(crmProjects.isDocumentationOnly, 0)
    ];

    if (options?.status) {
      conditions.push(eq(crmProjects.status, options.status));
    }

    // Count total
    const [countResult] = await db.select({ count: count() }).from(crmProjects).where(and(...conditions));

    const total = countResult?.count || 0;

    // Get paginated data
    const crmProjectRows = await db.select().from(crmProjects).where(and(...conditions)).orderBy(desc(crmProjects.updatedAt)).limit(pageSize).offset(offset);

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
        orderBy: asc(projectMembers.createdAt),
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
      const noteCreatorMap = new Map(noteCreatorsData.map(u => [u.id, {
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        profileImageUrl: u.profileImageUrl,
        role: u.role,
        isMainAdmin: u.isMainAdmin,
        lastGeneratedPassword: u.lastGeneratedPassword,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      } as SafeUser]));
      
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

    // Build result with search filter if needed
    let data: CrmProjectWithDetails[] = crmProjectRows.map((cp) => {
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

    // Filter by search if provided
    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      data = data.filter((item) => 
        item.project?.name.toLowerCase().includes(searchLower) ||
        item.client?.name.toLowerCase().includes(searchLower) ||
        item.client?.company?.toLowerCase().includes(searchLower)
      );
    }

    return { data, total: Number(total), page, pageSize };
  }

  async getCrmProject(id: string): Promise<CrmProjectWithDetails | undefined> {
    const [crmProject] = await db.select().from(crmProjects).where(eq(crmProjects.id, id));
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

  async getCrmProjectByProjectId(projectId: string): Promise<CrmProject | undefined> {
    const [crmProject] = await db.select().from(crmProjects).where(eq(crmProjects.projectId, projectId));
    return crmProject;
  }

  async createCrmProject(crmProject: InsertCrmProject): Promise<CrmProject> {
    const [newCrmProject] = await db.insert(crmProjects).values(crmProject).returning();
    return newCrmProject;
  }

  async updateCrmProject(id: string, data: Partial<InsertCrmProject>): Promise<CrmProject | undefined> {
    const [updated] = await db
      .update(crmProjects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(crmProjects.id, id))
      .returning();
    return updated;
  }

  async deleteCrmProject(id: string): Promise<void> {
    // First get the CRM project to find the linked project ID
    const [crmProject] = await db.select().from(crmProjects).where(eq(crmProjects.id, id));
    
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
    
    const crmProject = await this.createCrmProject({
      projectId: project.id,
      clientId: crmData?.clientId || null,
      status: crmData?.status || "lead",
      assigneeId: crmData?.assigneeId || null,
      startDate: crmData?.startDate || null,
      dueDate: crmData?.dueDate || null,
      actualFinishDate: crmData?.actualFinishDate || null,
      comments: crmData?.comments || null,
      documentationEnabled: crmData?.documentationEnabled || 0,
      isDocumentationOnly: crmData?.isDocumentationOnly || 0,
      budgetedHours: crmData?.budgetedHours ?? null,
      actualHours: crmData?.actualHours ?? null,
    });

    // Auto-add the creator as a project member
    await this.addProjectMember(crmProject.id, projectData.ownerId);

    return { project, crmProject };
  }

  async toggleDocumentation(crmProjectId: string, enabled: boolean): Promise<CrmProject | undefined> {
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
        const defaultDocTemplates: { title: string; content: any }[] = [
          {
            title: "Resources",
            content: {
              type: "doc",
              content: [
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Login Details" }] },
                { type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "[Add login credentials information here]" }] },
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Conversations" }] },
                { type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "[Add conversation references or summaries here]" }] },
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Recordings" }] },
                { type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "[Add meeting or call recording links here]" }] },
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Files" }] },
                { type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "[Add related documents or attachments here]" }] },
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Clients Notes" }] },
                { type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "[Add client notes and remarks here]" }] },
              ],
            },
          },
          {
            title: "Requirements",
            content: {
              type: "doc",
              content: [
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Document Information" }] },
                { type: "bulletList", content: [
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Client: [Client Name]" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Prepared By: TECHMA Inc." }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Date: [Insert Date]" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Project Title: [Enhancement / Fix / Integration Name]" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Platforms: [Zoho CRM, Creator, API, etc.]" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Engagement Type: Hourly / Small Fixed Scope" }] }] },
                ] },
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Table of Contents" }] },
                { type: "orderedList", attrs: { start: 1 }, content: [
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Overview" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Objectives" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Scope of Work" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Functional Changes" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Business Rules & Logic" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Constraints" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Acceptance Criteria" }] }] },
                ] },
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "1. Overview" }] },
                { type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Brief description of what this update addresses." }] },
                { type: "heading", attrs: { level: 2, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Include:" }] },
                { type: "bulletList", content: [
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Current issue or need" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Affected system/module" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Business impact" }] }] },
                ] },
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "2. Objectives" }] },
                { type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "What this update aims to achieve." }] },
                { type: "heading", attrs: { level: 2, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Examples:" }] },
                { type: "bulletList", content: [
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Improve upload behavior" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Fix incorrect logic" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Add missing automation" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Increase visibility in CRM" }] }] },
                ] },
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "3. Scope of Work" }] },
                { type: "heading", attrs: { level: 2, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Included" }] },
                { type: "bulletList", content: [
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "[Feature / Fix 1]" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "[Feature / Fix 2]" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "[Enhancement 3]" }] }] },
                ] },
                { type: "heading", attrs: { level: 2, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Not Included" }] },
                { type: "bulletList", content: [
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Major redesign" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "New modules" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Unrelated automation" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Third-party migrations" }] }] },
                ] },
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "4. Functional Changes" }] },
                { type: "heading", attrs: { level: 2, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "4.1 Change / Feature Name" }] },
                { type: "heading", attrs: { level: 3, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Current Behavior:" }] },
                { type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Describe how it works now." }] },
                { type: "heading", attrs: { level: 3, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Required Behavior:" }] },
                { type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Describe expected behavior after update." }] },
                { type: "heading", attrs: { level: 3, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "System Impact:" }] },
                { type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Where this change applies (Portal / CRM / API / UI)." }] },
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "5. Business Rules & Logic" }] },
                { type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "If/then logic and validation rules." }] },
                { type: "heading", attrs: { level: 2, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Examples:" }] },
                { type: "bulletList", content: [
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "If field is empty \u2192 hide button" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "If deal is updated \u2192 redirect upload" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Updates must apply without user reinvite" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Logic must be dynamic (no hardcoding)" }] }] },
                ] },
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "6. Constraints" }] },
                { type: "bulletList", content: [
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Must not disrupt live users" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Must not require portal reinvite" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Must remain compatible with existing integrations" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "CRM remains system of record" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "(Add project-specific constraints as needed.)" }] }] },
                ] },
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "7. Acceptance Criteria" }] },
                { type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "The project will be considered complete when:" }] },
                { type: "bulletList", content: [
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "All listed changes are implemented" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "No regression issues occur" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Existing users remain unaffected" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Client confirms expected behavior" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "No manual workaround is required" }] }] },
                ] },
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "VIDEO" }] },
              ],
            },
          },
          {
            title: "Deliverables",
            content: {
              type: "doc",
              content: [
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }, { type: "underline" }], text: "Client" }] },
                { type: "heading", attrs: { level: 2, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Text" }] },
                { type: "paragraph", attrs: { textAlign: null } },
                { type: "heading", attrs: { level: 2, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Video" }] },
                { type: "paragraph", attrs: { textAlign: null } },
                { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }, { type: "underline" }], text: "Internal" }] },
                { type: "heading", attrs: { level: 2, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Text" }] },
                { type: "paragraph", attrs: { textAlign: null } },
                { type: "heading", attrs: { level: 2, textAlign: null }, content: [{ type: "text", marks: [{ type: "bold" }], text: "Video" }] },
                { type: "paragraph", attrs: { textAlign: null } },
              ],
            },
          },
        ];

        for (const tmpl of defaultDocTemplates) {
          await this.createDocument({
            projectId: crmProject.projectId,
            parentId: null,
            title: tmpl.title,
            content: tmpl.content,
          });
        }
      }
    }
    
    return updated;
  }

  async getDocumentationEnabledProjects(userId?: string): Promise<Project[]> {
    // Company-wide visibility - return all documentation-enabled projects
    const result = await db
      .select({ project: projects })
      .from(projects)
      .innerJoin(crmProjects, eq(projects.id, crmProjects.projectId))
      .where(eq(crmProjects.documentationEnabled, 1))
      .orderBy(desc(projects.updatedAt));
    
    return result.map(r => r.project);
  }

  async getMainAdmin(): Promise<SafeUser | undefined> {
    const [admin] = await db.select().from(users).where(eq(users.isMainAdmin, 1)).limit(1);
    if (admin) return admin;
    const [anyAdmin] = await db.select().from(users).where(eq(users.role, "admin")).limit(1);
    return anyAdmin;
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

  async archiveUser(userId: string, isArchived: boolean): Promise<SafeUser | undefined> {
    const [updated] = await db
      .update(users)
      .set({ isArchived, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  async updateUserRole(userId: string, role: string): Promise<SafeUser | undefined> {
    const [updated] = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  async updateUser(userId: string, data: { firstName?: string; lastName?: string; email?: string; hoursPerDay?: number; canViewDailyUpdates?: number }): Promise<SafeUser | undefined> {
    const [updated] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  async updateUserPassword(userId: string, hashedPassword: string, plainPassword?: string): Promise<SafeUser | undefined> {
    const updateData: any = { password: hashedPassword, updatedAt: new Date() };
    if (plainPassword) {
      updateData.lastGeneratedPassword = plainPassword;
    }
    const [updated] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  async updateUserLastLogin(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, userId));
  }

  async getAdminUserDetails(userId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    return user;
  }

  async deleteUser(userId: string): Promise<void> {
    await db.delete(users).where(eq(users.id, userId));
  }

  async getUserWithPassword(userId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    return user;
  }

  // Company Document Folders
  async getCompanyDocumentFolders(): Promise<CompanyDocumentFolderWithCreator[]> {
    const folders = await db
      .select()
      .from(companyDocumentFolders)
      .orderBy(asc(companyDocumentFolders.name));
    
    const creatorIds = [...new Set(folders.map(f => f.createdById))];
    const creatorsData = creatorIds.length > 0
      ? await db.select().from(users).where(or(...creatorIds.map(id => eq(users.id, id))))
      : [];
    const creatorMap = new Map(creatorsData.map(u => [u.id, u]));
    
    return folders.map(folder => ({
      ...folder,
      createdBy: creatorMap.get(folder.createdById),
    }));
  }

  async getCompanyDocumentFolder(id: string): Promise<CompanyDocumentFolderWithCreator | undefined> {
    const [folder] = await db.select().from(companyDocumentFolders).where(eq(companyDocumentFolders.id, id));
    if (!folder) return undefined;
    
    const [creator] = await db.select().from(users).where(eq(users.id, folder.createdById));
    return { ...folder, createdBy: creator };
  }

  async createCompanyDocumentFolder(folder: InsertCompanyDocumentFolder): Promise<CompanyDocumentFolder> {
    const [newFolder] = await db.insert(companyDocumentFolders).values(folder).returning();
    return newFolder;
  }

  async updateCompanyDocumentFolder(id: string, data: Partial<InsertCompanyDocumentFolder>): Promise<CompanyDocumentFolder | undefined> {
    const [updated] = await db
      .update(companyDocumentFolders)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(companyDocumentFolders.id, id))
      .returning();
    return updated;
  }

  async deleteCompanyDocumentFolder(id: string): Promise<CompanyDocumentFolder | undefined> {
    const [deleted] = await db.delete(companyDocumentFolders).where(eq(companyDocumentFolders.id, id)).returning();
    return deleted;
  }

  // Company Documents
  async getCompanyDocuments(folderId?: string): Promise<CompanyDocumentWithUploader[]> {
    const docs = await db
      .select()
      .from(companyDocuments)
      .where(folderId ? eq(companyDocuments.folderId, folderId) : isNull(companyDocuments.folderId))
      .orderBy(desc(companyDocuments.createdAt));
    
    const uploaderIds = [...new Set(docs.map(d => d.uploadedById))];
    const uploadersData = uploaderIds.length > 0
      ? await db.select().from(users).where(or(...uploaderIds.map(id => eq(users.id, id))))
      : [];
    const uploaderMap = new Map(uploadersData.map(u => [u.id, u]));
    
    return docs.map(doc => ({
      ...doc,
      uploadedBy: uploaderMap.get(doc.uploadedById),
    }));
  }

  async getCompanyDocument(id: string): Promise<CompanyDocumentWithUploader | undefined> {
    const [doc] = await db.select().from(companyDocuments).where(eq(companyDocuments.id, id));
    if (!doc) return undefined;
    
    const [uploader] = await db.select().from(users).where(eq(users.id, doc.uploadedById));
    let folder;
    if (doc.folderId) {
      const [f] = await db.select().from(companyDocumentFolders).where(eq(companyDocumentFolders.id, doc.folderId));
      folder = f;
    }
    return { ...doc, uploadedBy: uploader, folder };
  }

  async createCompanyDocument(doc: InsertCompanyDocument): Promise<CompanyDocument> {
    const [newDoc] = await db.insert(companyDocuments).values(doc).returning();
    return newDoc;
  }

  async updateCompanyDocument(id: string, data: Partial<InsertCompanyDocument>): Promise<CompanyDocument | undefined> {
    const [updated] = await db
      .update(companyDocuments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(companyDocuments.id, id))
      .returning();
    return updated;
  }

  async deleteCompanyDocument(id: string): Promise<CompanyDocument | undefined> {
    const [deleted] = await db.delete(companyDocuments).where(eq(companyDocuments.id, id)).returning();
    return deleted;
  }

  async searchCompanyDocuments(query: string): Promise<CompanyDocumentWithUploader[]> {
    const searchPattern = `%${query}%`;
    const docs = await db
      .select()
      .from(companyDocuments)
      .where(or(
        like(companyDocuments.name, searchPattern),
        like(companyDocuments.description, searchPattern),
        like(companyDocuments.fileName, searchPattern)
      ))
      .orderBy(desc(companyDocuments.createdAt));
    
    const uploaderIds = [...new Set(docs.map(d => d.uploadedById))];
    const uploadersData = uploaderIds.length > 0
      ? await db.select().from(users).where(or(...uploaderIds.map(id => eq(users.id, id))))
      : [];
    const uploaderMap = new Map(uploadersData.map(u => [u.id, u]));
    
    const folderIds = [...new Set(docs.filter(d => d.folderId).map(d => d.folderId!))];
    const foldersData = folderIds.length > 0
      ? await db.select().from(companyDocumentFolders).where(or(...folderIds.map(id => eq(companyDocumentFolders.id, id))))
      : [];
    const folderMap = new Map(foldersData.map(f => [f.id, f]));
    
    return docs.map(doc => ({
      ...doc,
      uploadedBy: uploaderMap.get(doc.uploadedById),
      folder: doc.folderId ? folderMap.get(doc.folderId) : undefined,
    }));
  }

  async searchCompanyDocumentFolders(query: string): Promise<CompanyDocumentFolderWithCreator[]> {
    const searchPattern = `%${query}%`;
    const folders = await db
      .select()
      .from(companyDocumentFolders)
      .where(like(companyDocumentFolders.name, searchPattern))
      .orderBy(desc(companyDocumentFolders.createdAt));
    
    const creatorIds = [...new Set(folders.map(f => f.createdById))];
    const creatorsData = creatorIds.length > 0
      ? await db.select().from(users).where(or(...creatorIds.map(id => eq(users.id, id))))
      : [];
    const creatorMap = new Map(creatorsData.map(u => [u.id, u]));
    
    return folders.map(folder => ({
      ...folder,
      createdBy: creatorMap.get(folder.createdById),
    }));
  }

  // Teams
  async getTeams(userId: string): Promise<TeamWithDetails[]> {
    // Get teams where user is owner or member
    const ownedTeams = await db.select().from(teams).where(eq(teams.ownerId, userId));
    
    const memberTeamIds = await db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId));
    
    const memberTeams = memberTeamIds.length > 0
      ? await db.select().from(teams).where(or(...memberTeamIds.map(m => eq(teams.id, m.teamId))))
      : [];
    
    // Combine and deduplicate
    const allTeamsMap = new Map<string, Team>();
    [...ownedTeams, ...memberTeams].forEach(t => allTeamsMap.set(t.id, t));
    const allTeams = Array.from(allTeamsMap.values());
    
    // Get owners and member counts
    const ownerIds = [...new Set(allTeams.map(t => t.ownerId))];
    const ownersData = ownerIds.length > 0
      ? await db.select().from(users).where(or(...ownerIds.map(id => eq(users.id, id))))
      : [];
    const ownerMap = new Map(ownersData.map(u => [u.id, u]));
    
    // Get member counts
    const memberCounts = await Promise.all(
      allTeams.map(async (t) => {
        const [result] = await db.select({ count: count() }).from(teamMembers).where(eq(teamMembers.teamId, t.id));
        return { teamId: t.id, count: result?.count || 0 };
      })
    );
    const countMap = new Map(memberCounts.map(c => [c.teamId, c.count]));
    
    return allTeams.map(t => ({
      ...t,
      owner: ownerMap.get(t.ownerId),
      memberCount: countMap.get(t.id) || 0,
    }));
  }

  async getTeam(id: string): Promise<TeamWithDetails | undefined> {
    const [team] = await db.select().from(teams).where(eq(teams.id, id));
    if (!team) return undefined;
    
    const [owner] = await db.select().from(users).where(eq(users.id, team.ownerId));
    const members = await this.getTeamMembers(id);
    
    return {
      ...team,
      owner,
      members,
      memberCount: members.length,
    };
  }

  async createTeam(team: InsertTeam & { ownerId: string }): Promise<Team> {
    const [newTeam] = await db.insert(teams).values({
      ...team,
      id: randomUUID(),
    }).returning();
    
    // Add owner as a member with 'owner' role
    await this.addTeamMember(newTeam.id, team.ownerId, "owner");
    
    return newTeam;
  }

  async updateTeam(id: string, data: Partial<InsertTeam>): Promise<Team | undefined> {
    const [updated] = await db
      .update(teams)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(teams.id, id))
      .returning();
    return updated;
  }

  async deleteTeam(id: string): Promise<void> {
    await db.delete(teams).where(eq(teams.id, id));
  }

  // Team Members
  async getTeamMembers(teamId: string): Promise<TeamMemberWithUser[]> {
    const members = await db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
    
    if (members.length === 0) return [];
    
    const userIds = members.map(m => m.userId);
    const usersData = await db.select().from(users).where(or(...userIds.map(id => eq(users.id, id))));
    const userMap = new Map(usersData.map(u => [u.id, u]));
    
    return members.map(m => ({
      ...m,
      user: userMap.get(m.userId),
    }));
  }

  async addTeamMember(teamId: string, userId: string, role: string = "member"): Promise<TeamMember> {
    const [member] = await db.insert(teamMembers).values({
      id: randomUUID(),
      teamId,
      userId,
      role,
    }).returning();
    return member;
  }

  async updateTeamMemberRole(teamId: string, userId: string, role: string): Promise<TeamMember | undefined> {
    const [updated] = await db
      .update(teamMembers)
      .set({ role })
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
      .returning();
    return updated;
  }

  async removeTeamMember(teamId: string, userId: string): Promise<void> {
    await db.delete(teamMembers).where(
      and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))
    );
  }

  async isTeamMember(teamId: string, userId: string): Promise<boolean> {
    const [member] = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    return !!member;
  }

  // Team Invites
  async getTeamInvites(teamId: string): Promise<TeamInviteWithTeam[]> {
    const invites = await db
      .select()
      .from(teamInvites)
      .where(eq(teamInvites.teamId, teamId))
      .orderBy(desc(teamInvites.createdAt));
    
    if (invites.length === 0) return [];
    
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    const creatorIds = [...new Set(invites.map(i => i.createdById))];
    const creatorsData = await db.select().from(users).where(or(...creatorIds.map(id => eq(users.id, id))));
    const creatorMap = new Map(creatorsData.map(u => [u.id, u]));
    
    return invites.map(i => ({
      ...i,
      team,
      createdBy: creatorMap.get(i.createdById),
    }));
  }

  async getTeamInviteByCode(code: string): Promise<TeamInviteWithTeam | undefined> {
    const [invite] = await db.select().from(teamInvites).where(eq(teamInvites.code, code));
    if (!invite) return undefined;
    
    const [team] = await db.select().from(teams).where(eq(teams.id, invite.teamId));
    const [createdBy] = await db.select().from(users).where(eq(users.id, invite.createdById));
    
    return {
      ...invite,
      team,
      createdBy,
    };
  }

  async createTeamInvite(invite: InsertTeamInvite): Promise<TeamInvite> {
    const [newInvite] = await db.insert(teamInvites).values({
      ...invite,
      id: randomUUID(),
    }).returning();
    return newInvite;
  }

  async useTeamInvite(code: string, userId: string): Promise<{ success: boolean; team?: Team; error?: string }> {
    const invite = await this.getTeamInviteByCode(code);
    
    if (!invite) {
      return { success: false, error: "Invitation not found" };
    }
    
    if (invite.isActive !== "true") {
      return { success: false, error: "This invitation is no longer active" };
    }
    
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return { success: false, error: "This invitation has expired" };
    }
    
    if (invite.maxUses && invite.useCount >= invite.maxUses) {
      return { success: false, error: "This invitation has reached its maximum uses" };
    }
    
    // Check if already a member
    const isMember = await this.isTeamMember(invite.teamId, userId);
    if (isMember) {
      return { success: false, error: "You are already a member of this team" };
    }
    
    // Add as member
    await this.addTeamMember(invite.teamId, userId, "member");
    
    // Increment use count
    await db
      .update(teamInvites)
      .set({ useCount: invite.useCount + 1 })
      .where(eq(teamInvites.id, invite.id));
    
    return { success: true, team: invite.team };
  }

  async deactivateTeamInvite(id: string): Promise<void> {
    await db.update(teamInvites).set({ isActive: "false" }).where(eq(teamInvites.id, id));
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
    const creatorMap = new Map(creatorsData.map(u => [u.id, { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, profileImageUrl: u.profileImageUrl, role: u.role, hoursPerDay: u.hoursPerDay, isMainAdmin: u.isMainAdmin, canViewDailyUpdates: u.canViewDailyUpdates, lastGeneratedPassword: u.lastGeneratedPassword, isArchived: u.isArchived, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, updatedAt: u.updatedAt }]));
    
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
    const safeCreator = creator ? { id: creator.id, email: creator.email, firstName: creator.firstName, lastName: creator.lastName, profileImageUrl: creator.profileImageUrl, role: creator.role, hoursPerDay: creator.hoursPerDay, isMainAdmin: creator.isMainAdmin, canViewDailyUpdates: creator.canViewDailyUpdates, lastGeneratedPassword: creator.lastGeneratedPassword, isArchived: creator.isArchived, lastLoginAt: creator.lastLoginAt, createdAt: creator.createdAt, updatedAt: creator.updatedAt } : undefined;
    
    return { ...note, createdBy: safeCreator };
  }

  async createCrmProjectNote(note: InsertCrmProjectNote): Promise<CrmProjectNote> {
    const [newNote] = await db.insert(crmProjectNotes).values({
      ...note,
      id: randomUUID(),
    }).returning();
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
        changedBy: user ? {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImageUrl: user.profileImageUrl,
          role: user.role,
          hoursPerDay: user.hoursPerDay,
          isMainAdmin: user.isMainAdmin,
          canViewDailyUpdates: user.canViewDailyUpdates,
          lastGeneratedPassword: user.lastGeneratedPassword,
          isArchived: user.isArchived,
          lastLoginAt: user.lastLoginAt,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        } : undefined,
      });
    }
    return historyWithUsers;
  }

  async createCrmProjectStageHistory(history: InsertCrmProjectStageHistory): Promise<CrmProjectStageHistory> {
    const [created] = await db
      .insert(crmProjectStageHistory)
      .values(history)
      .returning();
    return created;
  }

  async getUserNotifications(userId: string): Promise<NotificationWithDetails[]> {
    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    if (!notifs.length) return [];

    const fromUserIds = [...new Set(notifs.map(n => n.fromUserId).filter(Boolean))];
    const crmProjectIds = [...new Set(notifs.map(n => n.crmProjectId).filter(Boolean))];

    const fromUsersData = fromUserIds.length > 0 
      ? await db.select().from(users).where(sql`${users.id} IN ${fromUserIds}`)
      : [];
    const fromUserMap = new Map(fromUsersData.map(u => [u.id, { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, profileImageUrl: u.profileImageUrl, role: u.role, hoursPerDay: u.hoursPerDay, isMainAdmin: u.isMainAdmin, canViewDailyUpdates: u.canViewDailyUpdates, lastGeneratedPassword: u.lastGeneratedPassword, isArchived: u.isArchived, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, updatedAt: u.updatedAt }]));

    const projectsData = crmProjectIds.length > 0
      ? await db.select().from(crmProjects).leftJoin(projects, eq(crmProjects.projectId, projects.id)).where(sql`${crmProjects.id} IN ${crmProjectIds}`)
      : [];
    const projectMap = new Map(projectsData.map(p => [p.crm_projects.id, { id: p.crm_projects.id, project: p.projects ? { name: p.projects.name } : undefined }]));

    return notifs.map(n => ({
      ...n,
      fromUser: n.fromUserId ? fromUserMap.get(n.fromUserId) : undefined,
      crmProject: n.crmProjectId ? projectMap.get(n.crmProjectId) : undefined,
    }));
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, 0)));
    return result?.count || 0;
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [newNotif] = await db.insert(notifications).values({
      ...notification,
      id: randomUUID(),
    }).returning();
    return newNotif;
  }

  async hasRecentNotification(userId: string, type: string, since: Date): Promise<boolean> {
    const [result] = await db
      .select({ count: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, type),
          gte(notifications.createdAt, since),
        ),
      );
    return (result?.count || 0) > 0;
  }

  async markNotificationRead(id: string, userId: string): Promise<void> {
    await db.update(notifications).set({ isRead: 1 }).where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
  }

  async markAllNotificationsRead(userId: string): Promise<void> {
    await db.update(notifications).set({ isRead: 1 }).where(eq(notifications.userId, userId));
  }

  async getAudioRecording(id: string): Promise<AudioRecording | undefined> {
    const [recording] = await db.select().from(audioRecordings).where(eq(audioRecordings.id, id));
    return recording;
  }

  async createAudioRecording(recording: InsertAudioRecording): Promise<AudioRecording> {
    const [newRecording] = await db.insert(audioRecordings).values({
      ...recording,
      id: randomUUID(),
    }).returning();
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
    const [newTag] = await db.insert(crmTags).values({
      ...tag,
      id: randomUUID(),
    }).returning();
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
    const [projectTag] = await db.insert(crmProjectTags).values({
      id: randomUUID(),
      crmProjectId,
      tagId,
    }).returning();
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
    const modules = await db.select().from(crmModules).orderBy(asc(crmModules.displayOrder), asc(crmModules.name));
    const fields = await db.select().from(crmModuleFields).orderBy(asc(crmModuleFields.displayOrder), asc(crmModuleFields.name));
    
    return modules.map(mod => ({
      ...mod,
      fields: fields.filter(f => f.moduleId === mod.id),
    }));
  }

  async getCrmModule(id: string): Promise<CrmModuleWithFields | undefined> {
    const [mod] = await db.select().from(crmModules).where(eq(crmModules.id, id));
    if (!mod) return undefined;
    
    const fields = await db.select().from(crmModuleFields).where(eq(crmModuleFields.moduleId, id)).orderBy(asc(crmModuleFields.displayOrder), asc(crmModuleFields.name));
    return { ...mod, fields };
  }

  async createCrmModule(module: InsertCrmModule): Promise<CrmModule> {
    const [newMod] = await db.insert(crmModules).values({
      ...module,
      id: randomUUID(),
    }).returning();
    return newMod;
  }

  async updateCrmModule(id: string, data: Partial<InsertCrmModule>): Promise<CrmModule | undefined> {
    const [updated] = await db
      .update(crmModules)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(crmModules.id, id))
      .returning();
    return updated;
  }

  async deleteCrmModule(id: string): Promise<void> {
    await db.delete(crmModules).where(eq(crmModules.id, id));
  }

  // CRM Module Fields
  async getCrmModuleFields(moduleId: string): Promise<CrmModuleField[]> {
    return await db.select().from(crmModuleFields).where(eq(crmModuleFields.moduleId, moduleId)).orderBy(asc(crmModuleFields.displayOrder), asc(crmModuleFields.name));
  }

  async getCrmModuleField(id: string): Promise<CrmModuleField | undefined> {
    const [field] = await db.select().from(crmModuleFields).where(eq(crmModuleFields.id, id));
    return field;
  }

  async createCrmModuleField(field: InsertCrmModuleField): Promise<CrmModuleField> {
    const [newField] = await db.insert(crmModuleFields).values({
      ...field,
      options: field.options as string[] | null | undefined,
    }).returning();
    return newField;
  }

  async updateCrmModuleField(id: string, data: Partial<InsertCrmModuleField>): Promise<CrmModuleField | undefined> {
    const [updated] = await db
      .update(crmModuleFields)
      .set({ ...data, options: data.options as string[] | null | undefined, updatedAt: new Date() })
      .where(eq(crmModuleFields.id, id))
      .returning();
    return updated;
  }

  async deleteCrmModuleField(id: string): Promise<void> {
    await db.delete(crmModuleFields).where(eq(crmModuleFields.id, id));
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
      const [newVal] = await db.insert(crmCustomFieldValues).values({
        id: randomUUID(),
        crmProjectId,
        fieldId,
        value,
      }).returning();
      return newVal;
    }
  }

  async updateCrmFieldValuesOnOptionRename(fieldId: string, oldLabel: string, newLabel: string): Promise<void> {
    // Update all field values that have the old option label to use the new label
    await db
      .update(crmCustomFieldValues)
      .set({ value: newLabel, updatedAt: new Date() })
      .where(and(
        eq(crmCustomFieldValues.fieldId, fieldId),
        eq(crmCustomFieldValues.value, oldLabel)
      ));
  }

  async updateCrmProjectsColumnOnOptionRename(column: "status" | "projectType", oldLabel: string, newLabel: string): Promise<void> {
    // Update crmProjects table directly for system fields
    if (column === "status") {
      await db
        .update(crmProjects)
        .set({ status: newLabel, updatedAt: new Date() })
        .where(eq(crmProjects.status, oldLabel));
    } else if (column === "projectType") {
      await db
        .update(crmProjects)
        .set({ projectType: newLabel, updatedAt: new Date() })
        .where(eq(crmProjects.projectType, oldLabel));
    }
  }

  async updateCrmClientsColumnOnOptionRename(column: "status", oldLabel: string, newLabel: string): Promise<void> {
    // Update crmClients table directly for system fields
    if (column === "status") {
      await db
        .update(crmClients)
        .set({ status: newLabel, updatedAt: new Date() })
        .where(eq(crmClients.status, oldLabel));
    }
  }

  // Time Tracking methods
  async getTimeEntries(options: {
    userId?: string;
    crmProjectId?: string;
    startDate?: Date;
    endDate?: Date;
    /** Filter: endTime >= value. Use for overlap queries (e.g. cross-midnight entries). */
    endDateGte?: Date;
    status?: string;
  }): Promise<TimeEntryWithDetails[]> {
    const conditions = [];

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
      conditions.push(sql`${timeEntries.startTime} >= ${options.startDate}`);
    }
    if (options.endDate) {
      conditions.push(sql`${timeEntries.startTime} <= ${options.endDate}`);
    }
    if (options.endDateGte) {
      conditions.push(sql`${timeEntries.endTime} >= ${options.endDateGte}`);
    }
    
    const entries = await db
      .select()
      .from(timeEntries)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(timeEntries.startTime));
    
    // Fetch user and project details
    const enrichedEntries: TimeEntryWithDetails[] = [];
    for (const entry of entries) {
      const [user] = await db.select().from(users).where(eq(users.id, entry.userId));
      const [crmProject] = await db.select().from(crmProjects).where(eq(crmProjects.id, entry.crmProjectId));
      
      let projectDetails = undefined;
      let clientDetails = undefined;
      
      if (crmProject) {
        const [project] = await db.select().from(projects).where(eq(projects.id, crmProject.projectId));
        projectDetails = project;
        
        if (crmProject.clientId) {
          const [client] = await db.select().from(crmClients).where(eq(crmClients.id, crmProject.clientId));
          clientDetails = client;
        }
      }
      
      const { password, ...safeUser } = user || {};
      
      enrichedEntries.push({
        ...entry,
        user: user ? safeUser as SafeUser : undefined,
        crmProject: crmProject ? {
          ...crmProject,
          project: projectDetails,
          client: clientDetails,
        } : undefined,
      });
    }
    
    return enrichedEntries;
  }

  async getTimeEntry(id: string): Promise<TimeEntryWithDetails | undefined> {
    const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, id));
    if (!entry) return undefined;
    
    const [user] = await db.select().from(users).where(eq(users.id, entry.userId));
    const [crmProject] = await db.select().from(crmProjects).where(eq(crmProjects.id, entry.crmProjectId));
    
    let projectDetails = undefined;
    let clientDetails = undefined;
    
    if (crmProject) {
      const [project] = await db.select().from(projects).where(eq(projects.id, crmProject.projectId));
      projectDetails = project;
      
      if (crmProject.clientId) {
        const [client] = await db.select().from(crmClients).where(eq(crmClients.id, crmProject.clientId));
        clientDetails = client;
      }
    }
    
    const { password, ...safeUser } = user || {};
    
    return {
      ...entry,
      user: user ? safeUser as SafeUser : undefined,
      crmProject: crmProject ? {
        ...crmProject,
        project: projectDetails,
        client: clientDetails,
      } : undefined,
    };
  }

  async getTimeEntryByClientCommandId(clientCommandId: string): Promise<TimeEntry | undefined> {
    const [entry] = await db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.clientCommandId, clientCommandId))
      .limit(1);
    return entry;
  }

  async getActiveTimeEntry(userId: string): Promise<TimeEntry | undefined> {
    const [entry] = await db
      .select()
      .from(timeEntries)
      .where(and(
        eq(timeEntries.userId, userId),
        or(
          eq(timeEntries.status, "running"),
          eq(timeEntries.status, "paused")
        )
      ))
      .orderBy(desc(timeEntries.startTime))
      .limit(1);
    return entry;
  }

  async getStaleRunningEntries(staleThreshold: Date): Promise<TimeEntry[]> {
    return db
      .select()
      .from(timeEntries)
      .where(and(
        eq(timeEntries.status, "running"),
        lt(timeEntries.lastActivityAt, staleThreshold)
      ));
  }

  async createTimeEntry(entry: InsertTimeEntry): Promise<TimeEntry> {
    // Safety net: if task_id column doesn't exist yet (migration 002 pending),
    // strip it and retry rather than crashing a timer start.
    const values: any = { id: randomUUID(), ...entry };
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
    await db.delete(timeEntries).where(eq(timeEntries.id, id));
  }

  async getTimeStats(options: {
    userId?: string;
    crmProjectId?: string;
    startDate?: Date;
    endDate?: Date
  }): Promise<{
    totalDuration: number;
    totalIdleTime: number;
    entriesCount: number;
    screenshotCount: number;
    byProject: Array<{ crmProjectId: string; projectName: string; totalDuration: number }>;
    byUser: Array<{ userId: string; userName: string; totalDuration: number }>;
  }> {
    // Use overlap filter: startTime <= endDate AND endTime >= startDate.
    // This correctly includes cross-midnight entries (started before window, stopped within window).
    const entries = await this.getTimeEntries({
      userId: options.userId,
      crmProjectId: options.crmProjectId,
      endDate: options.endDate,           // startTime <= endDate
      endDateGte: options.startDate,      // endTime   >= startDate
      status: "stopped",
    });

    // For entries that started before the window (cross-midnight), attribute only the
    // portion of entry.duration that falls within [startDate, endDate] using proportional
    // estimation. For entries fully within the window, use entry.duration as-is.
    const clamp = (e: { startTime: Date | string; endTime: Date | string | null; duration: number | null }): number => {
      if (!options.startDate || !options.endDate || !e.endTime) return e.duration || 0;
      const eStart = new Date(e.startTime).getTime();
      const wStart = options.startDate.getTime();
      if (eStart >= wStart) return e.duration || 0; // started within window — use as-is
      const eEnd = new Date(e.endTime).getTime();
      const wEnd = options.endDate.getTime();
      const totalMs = eEnd - eStart;
      if (totalMs <= 0) return 0;
      const inWindowMs = Math.min(eEnd, wEnd) - wStart;
      if (inWindowMs <= 0) return 0;
      return Math.round((e.duration || 0) * inWindowMs / totalMs);
    };

    const totalDuration = entries.reduce((sum, e) => sum + clamp(e), 0);
    const totalIdleTime = entries.reduce((sum, e) => sum + (e.idleTime || 0), 0);

    // Group by project
    const projectMap = new Map<string, { projectName: string; totalDuration: number }>();
    for (const entry of entries) {
      const projectId = entry.crmProjectId;
      const projectName = entry.crmProject?.project?.name || "Unknown Project";
      const existing = projectMap.get(projectId) || { projectName, totalDuration: 0 };
      existing.totalDuration += clamp(entry);
      projectMap.set(projectId, existing);
    }

    // Group by user
    const userMap = new Map<string, { userName: string; totalDuration: number }>();
    for (const entry of entries) {
      const userId = entry.userId;
      const userName = entry.user ? `${entry.user.firstName || ""} ${entry.user.lastName || ""}`.trim() || entry.user.email : "Unknown User";
      const existing = userMap.get(userId) || { userName, totalDuration: 0 };
      existing.totalDuration += clamp(entry);
      userMap.set(userId, existing);
    }
    
    // Count live (non-deleted, non-pending) screenshots in the same window
    const screenshotConditions = [];
    if (options.userId) screenshotConditions.push(eq(timeEntryScreenshots.userId, options.userId));
    if (options.startDate) screenshotConditions.push(gt(timeEntryScreenshots.capturedAt, options.startDate));
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
    const [row] = await db
      .select({ total: sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)` })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.userId, userId),
        eq(timeEntries.taskId, taskId),
        eq(timeEntries.status, "stopped"),
        sql`${timeEntries.startTime} >= ${start}`,
        sql`${timeEntries.startTime} <= ${end}`,
      ));
    return Number(row?.total ?? 0);
  }

  async getTasksDurationToday(userId: string, taskIds: string[], start: Date, end: Date): Promise<Record<string, number>> {
    if (taskIds.length === 0) return {};
    const rows = await db
      .select({
        taskId: timeEntries.taskId,
        total: sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)`,
      })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.userId, userId),
        inArray(timeEntries.taskId, taskIds),
        eq(timeEntries.status, "stopped"),
        sql`${timeEntries.startTime} >= ${start}`,
        sql`${timeEntries.startTime} <= ${end}`,
      ))
      .groupBy(timeEntries.taskId);
    return Object.fromEntries(rows.map((r) => [r.taskId, Number(r.total)]));
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
    const [result] = await db.insert(timeEntryScreenshots).values(screenshot).returning();
    return result;
  }

  async getTimeEntryScreenshotById(id: string): Promise<TimeEntryScreenshot | undefined> {
    const [screenshot] = await db
      .select()
      .from(timeEntryScreenshots)
      .where(eq(timeEntryScreenshots.id, id));
    return screenshot;
  }

  async getTimeEntryScreenshots(options: {
    timeEntryId?: string;
    userId?: string;
    crmProjectId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ data: TimeEntryScreenshot[]; total: number }> {
    const conditions = [];
    if (options.timeEntryId) conditions.push(eq(timeEntryScreenshots.timeEntryId, options.timeEntryId));
    if (options.userId) conditions.push(eq(timeEntryScreenshots.userId, options.userId));
    if (options.crmProjectId) conditions.push(eq(timeEntryScreenshots.crmProjectId, options.crmProjectId));
    if (options.startDate) conditions.push(gt(timeEntryScreenshots.capturedAt, options.startDate));
    if (options.endDate) conditions.push(lte(timeEntryScreenshots.capturedAt, options.endDate));
    // Exclude pending uploads (upload not yet received from agent)
    conditions.push(sql`${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'`);
    // Exclude soft-deleted tombstones — they are invisible to all user-facing views
    conditions.push(isNull(timeEntryScreenshots.deletedAt));

    const where = and(...conditions);
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(timeEntryScreenshots)
        .where(where)
        .orderBy(desc(timeEntryScreenshots.capturedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(timeEntryScreenshots)
        .where(where),
    ]);

    return { data, total: countResult[0]?.count ?? 0 };
  }

  async updateTimeEntryScreenshot(id: string, data: { storageKey: string; contentHash?: string }): Promise<TimeEntryScreenshot | undefined> {
    const [result] = await db
      .update(timeEntryScreenshots)
      .set({ storageKey: data.storageKey, ...(data.contentHash ? { contentHash: data.contentHash } : {}) })
      .where(eq(timeEntryScreenshots.id, id))
      .returning();
    return result;
  }

  async deleteTimeEntryScreenshot(id: string): Promise<void> {
    await db.delete(timeEntryScreenshots).where(eq(timeEntryScreenshots.id, id));
  }

  async softDeleteTimeEntryScreenshot(
    id: string,
    deletedBy: string,
    reason?: string,
  ): Promise<TimeEntryScreenshot | undefined> {
    // Refuse to re-tombstone an already-deleted row
    const [existing] = await db
      .select({ deletedAt: timeEntryScreenshots.deletedAt })
      .from(timeEntryScreenshots)
      .where(eq(timeEntryScreenshots.id, id));
    if (!existing || existing.deletedAt !== null) return undefined;

    const [updated] = await db
      .update(timeEntryScreenshots)
      .set({
        deletedAt: new Date(),
        deletedBy,
        deleteReason: reason ?? null,
      })
      .where(eq(timeEntryScreenshots.id, id))
      .returning();
    return updated;
  }

  // ═══════════════════════════════════════
  // Tasks
  // ═══════════════════════════════════════

  async getTasks(options: { crmProjectId: string; includeArchived?: boolean }): Promise<Task[]> {
    const conditions = [eq(tasks.crmProjectId, options.crmProjectId)];
    if (!options.includeArchived) {
      conditions.push(sql`${tasks.status} != 'archived'`);
    }
    return db.select().from(tasks).where(and(...conditions)).orderBy(asc(tasks.createdAt));
  }

  async getTask(id: string): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    return task;
  }

  async createTask(data: InsertTask): Promise<Task> {
    const [task] = await db.insert(tasks).values(data).returning();
    return task;
  }

  async updateTask(id: string, data: Partial<InsertTask>): Promise<Task | undefined> {
    const [updated] = await db
      .update(tasks)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    return updated;
  }

  async deleteTask(id: string): Promise<void> {
    await db.delete(tasks).where(eq(tasks.id, id));
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
      .values({ crmProjectId, userId })
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
    const [update] = await db.insert(projectDailyUpdates).values(data).returning();
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
    const [reminder] = await db.insert(reminders).values(data).returning();
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
    const [reminder] = await db.select().from(reminders).where(eq(reminders.id, id));
    return reminder;
  }

  async updateReminder(
    id: string,
    data: Partial<Pick<Reminder, "title" | "note" | "dueAt" | "status" | "taskId" | "notified" | "notifiedInApp" | "emailSent">>,
  ): Promise<Reminder | undefined> {
    const [updated] = await db.update(reminders).set(data).where(eq(reminders.id, id)).returning();
    return updated;
  }

  async deleteReminder(id: string): Promise<void> {
    await db.delete(reminders).where(eq(reminders.id, id));
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
        ),
      )
      .orderBy(asc(reminders.dueAt));
  }

  // ═══════════════════════════════════════
  // Desktop Agent
  // ═══════════════════════════════════════

  async createAgentPairingCode(data: { userId: string; code: string; expiresAt: Date }): Promise<AgentPairingCode> {
    const [result] = await db.insert(agentPairingCodes).values(data).returning();
    return result;
  }

  async getAgentPairingCode(code: string): Promise<AgentPairingCode | undefined> {
    const [result] = await db
      .select()
      .from(agentPairingCodes)
      .where(eq(agentPairingCodes.code, code));
    return result;
  }

  async markPairingCodeUsed(id: string): Promise<void> {
    await db
      .update(agentPairingCodes)
      .set({ usedAt: new Date() })
      .where(eq(agentPairingCodes.id, id));
  }

  async createDevice(data: InsertDevice): Promise<Device> {
    const [result] = await db.insert(devices).values(data).returning();
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
    const [row] = await db.select().from(orgSettings).where(eq(orgSettings.id, "default"));
    return { ...DEFAULT_SCREENSHOT_POLICY, ...(row?.screenshotPolicy ?? {}) };
  }

  async upsertScreenshotPolicy(policy: Partial<ScreenshotPolicy>): Promise<void> {
    const current = await this.getScreenshotPolicy();
    const merged: ScreenshotPolicy = { ...current, ...policy };
    await db
      .insert(orgSettings)
      .values({ id: "default", screenshotPolicy: merged, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: orgSettings.id,
        set: { screenshotPolicy: merged, updatedAt: new Date() },
      });
  }

  async getAllowedTimezones(): Promise<string[]> {
    const [row] = await db.select().from(orgSettings).where(eq(orgSettings.id, "default"));
    return row?.allowedTimezones ?? DEFAULT_ALLOWED_TIMEZONES;
  }

  async upsertAllowedTimezones(timezones: string[]): Promise<void> {
    await db
      .insert(orgSettings)
      .values({ id: "default", allowedTimezones: timezones, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: orgSettings.id,
        set: { allowedTimezones: timezones, updatedAt: new Date() },
      });
  }

  async getHelpCenterScreenshots(): Promise<HelpCenterScreenshotsMap> {
    const [row] = await db.select().from(orgSettings).where(eq(orgSettings.id, "default"));
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
    const [row] = await db.select().from(orgSettings).where(eq(orgSettings.id, "default"));
    if (!row) {
      await db.insert(orgSettings).values({
        id: "default",
        screenshotPolicy: DEFAULT_SCREENSHOT_POLICY,
        allowedTimezones: [...DEFAULT_ALLOWED_TIMEZONES],
        helpCenterScreenshots: merged,
        updatedAt: new Date(),
      });
    } else {
      await db
        .update(orgSettings)
        .set({ helpCenterScreenshots: merged, updatedAt: new Date() })
        .where(eq(orgSettings.id, "default"));
    }
  }

  async isAgentBatchProcessed(batchId: string): Promise<boolean> {
    const [result] = await db
      .select()
      .from(agentProcessedBatches)
      .where(eq(agentProcessedBatches.batchId, batchId));
    return !!result;
  }

  async markAgentBatchProcessed(batchId: string, deviceId: string, eventCount: number): Promise<void> {
    await db.insert(agentProcessedBatches).values({ batchId, deviceId, eventCount });
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
    if (events.length === 0) return;
    await db.insert(agentActivityEvents).values(events);
  }

  // ─── Admin Analytics ───

  async getAdminOverview(opts: { startDate: Date; endDate: Date }): Promise<{
    totalTrackedSeconds: number;
    totalIdleSeconds: number;
    entriesCount: number;
    runningNow: number;
    activeUsersToday: number;
    screenshotsInWindow: number;
    lowActivityEntries: number;
    revokedDevices: number;
  }> {
    const { startDate, endDate } = opts;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [entriesStats] = await db.select({
      totalDuration: sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)::int`,
      totalIdleTime: sql<number>`COALESCE(SUM(${timeEntries.idleTime}), 0)::int`,
      entriesCount: sql<number>`COUNT(*)::int`,
      lowActivity: sql<number>`COUNT(CASE WHEN ${timeEntries.duration} > 0 AND ${timeEntries.idleTime} > ${timeEntries.duration} * 0.5 THEN 1 END)::int`,
    }).from(timeEntries).where(and(
      eq(timeEntries.status, "stopped"),
      sql`${timeEntries.startTime} >= ${startDate}`,
      sql`${timeEntries.startTime} <= ${endDate}`,
    ));

    const [runningStats] = await db.select({
      runningNow: sql<number>`COUNT(*)::int`,
    }).from(timeEntries).where(eq(timeEntries.status, "running"));

    const [activeToday] = await db.select({
      count: sql<number>`COUNT(DISTINCT ${timeEntries.userId})::int`,
    }).from(timeEntries).where(sql`${timeEntries.startTime} >= ${todayStart}`);

    const [screenshotsCount] = await db.select({
      count: sql<number>`COUNT(*)::int`,
    }).from(timeEntryScreenshots).where(and(
      sql`${timeEntryScreenshots.capturedAt} >= ${startDate}`,
      sql`${timeEntryScreenshots.capturedAt} <= ${endDate}`,
      sql`${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'`,
      isNull(timeEntryScreenshots.deletedAt),
    ));

    const [revokedCount] = await db.select({
      count: sql<number>`COUNT(*)::int`,
    }).from(devices).where(sql`${devices.revokedAt} IS NOT NULL`);

    return {
      totalTrackedSeconds: entriesStats?.totalDuration ?? 0,
      totalIdleSeconds: entriesStats?.totalIdleTime ?? 0,
      entriesCount: entriesStats?.entriesCount ?? 0,
      runningNow: runningStats?.runningNow ?? 0,
      activeUsersToday: activeToday?.count ?? 0,
      screenshotsInWindow: screenshotsCount?.count ?? 0,
      lowActivityEntries: entriesStats?.lowActivity ?? 0,
      revokedDevices: revokedCount?.count ?? 0,
    };
  }

  async getAdminProductivity(opts: {
    startDate: Date;
    endDate: Date;
    userId?: string;
    crmProjectId?: string;
  }): Promise<{
    byUser: Array<{ userId: string; userName: string; totalSeconds: number; idleSeconds: number; entriesCount: number }>;
    byProject: Array<{ crmProjectId: string; projectName: string; totalSeconds: number; entriesCount: number }>;
    byTask: Array<{ taskId: string | null; taskName: string; totalSeconds: number }>;
    dailyTrend: Array<{ date: string; totalSeconds: number }>;
  }> {
    const { startDate, endDate, userId, crmProjectId } = opts;

    const baseConditions: any[] = [
      eq(timeEntries.status, "stopped"),
      sql`${timeEntries.startTime} >= ${startDate}`,
      sql`${timeEntries.startTime} <= ${endDate}`,
    ];
    if (userId) baseConditions.push(eq(timeEntries.userId, userId));
    if (crmProjectId) baseConditions.push(eq(timeEntries.crmProjectId, crmProjectId));

    const byUserRaw = await db.select({
      userId: timeEntries.userId,
      totalSeconds: sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)::int`,
      idleSeconds: sql<number>`COALESCE(SUM(${timeEntries.idleTime}), 0)::int`,
      entriesCount: sql<number>`COUNT(*)::int`,
    }).from(timeEntries).where(and(...baseConditions))
      .groupBy(timeEntries.userId)
      .orderBy(sql`SUM(${timeEntries.duration}) DESC`);

    const userIds = byUserRaw.map(r => r.userId);
    const usersList = userIds.length > 0
      ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
          .from(users).where(inArray(users.id, userIds))
      : [];
    const usersMap = new Map(usersList.map(u => [u.id, u]));
    const nameOf = (uid: string) => {
      const u = usersMap.get(uid);
      return u ? (`${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email) : "Unknown";
    };

    const byUser = byUserRaw.map(r => ({
      userId: r.userId,
      userName: nameOf(r.userId),
      totalSeconds: r.totalSeconds,
      idleSeconds: r.idleSeconds,
      entriesCount: r.entriesCount,
    }));

    const byProjectRaw = await db.select({
      crmProjectId: timeEntries.crmProjectId,
      totalSeconds: sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)::int`,
      entriesCount: sql<number>`COUNT(*)::int`,
    }).from(timeEntries).where(and(...baseConditions))
      .groupBy(timeEntries.crmProjectId)
      .orderBy(sql`SUM(${timeEntries.duration}) DESC`);

    const projectIds = byProjectRaw.map(r => r.crmProjectId);
    const projectNameMap = new Map<string, string>();
    if (projectIds.length > 0) {
      const crmList = await db.select({ id: crmProjects.id, projectId: crmProjects.projectId })
        .from(crmProjects).where(inArray(crmProjects.id, projectIds));
      const wikiIds = crmList.map(p => p.projectId).filter(Boolean) as string[];
      const wikiList = wikiIds.length > 0
        ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, wikiIds))
        : [];
      const wikiMap = new Map(wikiList.map(p => [p.id, p.name]));
      for (const cp of crmList) {
        projectNameMap.set(cp.id, (cp.projectId && wikiMap.get(cp.projectId)) || "Unknown Project");
      }
    }

    const byProject = byProjectRaw.map(r => ({
      crmProjectId: r.crmProjectId,
      projectName: projectNameMap.get(r.crmProjectId) || "Unknown Project",
      totalSeconds: r.totalSeconds,
      entriesCount: r.entriesCount,
    }));

    const byTaskRaw = await db.select({
      taskId: timeEntries.taskId,
      totalSeconds: sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)::int`,
    }).from(timeEntries).where(and(...baseConditions, sql`${timeEntries.taskId} IS NOT NULL`))
      .groupBy(timeEntries.taskId)
      .orderBy(sql`SUM(${timeEntries.duration}) DESC`)
      .limit(20);

    const taskIds = byTaskRaw.map(r => r.taskId).filter(Boolean) as string[];
    const tasksList = taskIds.length > 0
      ? await db.select({ id: tasks.id, name: tasks.name }).from(tasks).where(inArray(tasks.id, taskIds))
      : [];
    const tasksMap = new Map(tasksList.map(t => [t.id, t.name]));

    const byTask = byTaskRaw.map(r => ({
      taskId: r.taskId,
      taskName: (r.taskId && tasksMap.get(r.taskId)) || "Unknown Task",
      totalSeconds: r.totalSeconds,
    }));

    const dailyTrend = await db.select({
      date: sql<string>`DATE(${timeEntries.startTime})::text`,
      totalSeconds: sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)::int`,
    }).from(timeEntries).where(and(...baseConditions))
      .groupBy(sql`DATE(${timeEntries.startTime})`)
      .orderBy(sql`DATE(${timeEntries.startTime}) ASC`);

    return { byUser, byProject, byTask, dailyTrend };
  }

  async getAdminActivityStats(opts: {
    startDate: Date;
    endDate: Date;
    userId?: string;
  }): Promise<{
    byUser: Array<{
      userId: string;
      userName: string;
      totalSeconds: number;
      idleSeconds: number;
      idleRatio: number;
      idleEventCount: number;
    }>;
  }> {
    const { startDate, endDate, userId } = opts;

    const entryConds: any[] = [
      eq(timeEntries.status, "stopped"),
      sql`${timeEntries.startTime} >= ${startDate}`,
      sql`${timeEntries.startTime} <= ${endDate}`,
    ];
    if (userId) entryConds.push(eq(timeEntries.userId, userId));

    const entriesPerUser = await db.select({
      userId: timeEntries.userId,
      totalSeconds: sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)::int`,
      idleSeconds: sql<number>`COALESCE(SUM(${timeEntries.idleTime}), 0)::int`,
    }).from(timeEntries).where(and(...entryConds)).groupBy(timeEntries.userId);

    const eventConds: any[] = [
      eq(agentActivityEvents.eventType, "idle_start"),
      sql`${agentActivityEvents.timestamp} >= ${startDate}`,
      sql`${agentActivityEvents.timestamp} <= ${endDate}`,
    ];
    if (userId) eventConds.push(eq(agentActivityEvents.userId, userId));

    const idleEvents = await db.select({
      userId: agentActivityEvents.userId,
      idleEventCount: sql<number>`COUNT(*)::int`,
    }).from(agentActivityEvents).where(and(...eventConds)).groupBy(agentActivityEvents.userId);

    const idleMap = new Map(idleEvents.map(e => [e.userId, e.idleEventCount]));

    const uids = entriesPerUser.map(r => r.userId);
    const usersList = uids.length > 0
      ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
          .from(users).where(inArray(users.id, uids))
      : [];
    const usersMap = new Map(usersList.map(u => [u.id, u]));

    const byUser = entriesPerUser.map(r => {
      const u = usersMap.get(r.userId);
      const userName = u ? (`${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email) : "Unknown";
      const total = r.totalSeconds + r.idleSeconds;
      const idleRatio = total > 0 ? Math.round((r.idleSeconds / total) * 100) : 0;
      return { userId: r.userId, userName, totalSeconds: r.totalSeconds, idleSeconds: r.idleSeconds, idleRatio, idleEventCount: idleMap.get(r.userId) ?? 0 };
    }).sort((a, b) => b.idleRatio - a.idleRatio);

    return { byUser };
  }

  async getAdminScreenshotStats(opts: {
    startDate: Date;
    endDate: Date;
    userId?: string;
  }): Promise<{
    totalCount: number;
    byUser: Array<{ userId: string; userName: string; count: number }>;
    hourlyDistribution: Array<{ hour: number; count: number }>;
    duplicates: Array<{ contentHash: string; count: number }>;
    deletedCount: number;
  }> {
    const { startDate, endDate, userId } = opts;

    const conds: any[] = [
      sql`${timeEntryScreenshots.capturedAt} >= ${startDate}`,
      sql`${timeEntryScreenshots.capturedAt} <= ${endDate}`,
      sql`${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'`,
      isNull(timeEntryScreenshots.deletedAt),
    ];
    if (userId) conds.push(eq(timeEntryScreenshots.userId, userId));

    const [countResult] = await db.select({
      count: sql<number>`COUNT(*)::int`,
    }).from(timeEntryScreenshots).where(and(...conds));

    const byUserRaw = await db.select({
      userId: timeEntryScreenshots.userId,
      count: sql<number>`COUNT(*)::int`,
    }).from(timeEntryScreenshots).where(and(...conds))
      .groupBy(timeEntryScreenshots.userId)
      .orderBy(sql`COUNT(*) DESC`);

    const uids = byUserRaw.map(r => r.userId);
    const usersList = uids.length > 0
      ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
          .from(users).where(inArray(users.id, uids))
      : [];
    const usersMap = new Map(usersList.map(u => [u.id, u]));

    const byUser = byUserRaw.map(r => {
      const u = usersMap.get(r.userId);
      return { userId: r.userId, userName: u ? (`${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email) : "Unknown", count: r.count };
    });

    const hourlyRaw = await db.select({
      hour: sql<number>`EXTRACT(HOUR FROM ${timeEntryScreenshots.capturedAt})::int`,
      count: sql<number>`COUNT(*)::int`,
    }).from(timeEntryScreenshots).where(and(...conds))
      .groupBy(sql`EXTRACT(HOUR FROM ${timeEntryScreenshots.capturedAt})`)
      .orderBy(sql`EXTRACT(HOUR FROM ${timeEntryScreenshots.capturedAt}) ASC`);

    const duplicatesRaw = await db.select({
      contentHash: timeEntryScreenshots.contentHash,
      count: sql<number>`COUNT(*)::int`,
    }).from(timeEntryScreenshots).where(and(...conds, sql`${timeEntryScreenshots.contentHash} IS NOT NULL`))
      .groupBy(timeEntryScreenshots.contentHash)
      .having(sql`COUNT(*) > 1`)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(20);

    // Count tombstoned screenshots in the same time window (evidence removed by an admin)
    const deletedConds: any[] = [
      sql`${timeEntryScreenshots.capturedAt} >= ${startDate}`,
      sql`${timeEntryScreenshots.capturedAt} <= ${endDate}`,
      sql`${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'`,
      sql`${timeEntryScreenshots.deletedAt} IS NOT NULL`,
    ];
    if (userId) deletedConds.push(eq(timeEntryScreenshots.userId, userId));
    const [deletedResult] = await db.select({
      count: sql<number>`COUNT(*)::int`,
    }).from(timeEntryScreenshots).where(and(...deletedConds));

    return {
      totalCount: countResult?.count ?? 0,
      byUser,
      hourlyDistribution: hourlyRaw,
      duplicates: duplicatesRaw.map(r => ({ contentHash: r.contentHash!, count: r.count })),
      deletedCount: deletedResult?.count ?? 0,
    };
  }

  async getAdminAlerts(opts: { startDate: Date; endDate: Date }): Promise<{
    highIdleUsers: Array<{ userId: string; userName: string; idleRatio: number; totalSeconds: number }>;
    stalledDevices: Array<{ deviceId: string; deviceName: string; userId: string; userName: string; lastSeenAt: Date | null; daysSinceLastSeen: number }>;
    runningWithoutScreenshots: Array<{ userId: string; userName: string; entryId: string; startedAt: Date }>;
  }> {
    const { startDate, endDate } = opts;

    const entriesPerUser = await db.select({
      userId: timeEntries.userId,
      totalSeconds: sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)::int`,
      idleSeconds: sql<number>`COALESCE(SUM(${timeEntries.idleTime}), 0)::int`,
    }).from(timeEntries).where(and(
      eq(timeEntries.status, "stopped"),
      sql`${timeEntries.startTime} >= ${startDate}`,
      sql`${timeEntries.startTime} <= ${endDate}`,
    )).groupBy(timeEntries.userId);

    const highIdleRaw = entriesPerUser.filter(r => {
      const total = r.totalSeconds + r.idleSeconds;
      return total >= 3600 && r.idleSeconds / total > 0.5;
    });

    // Running entries — check last screenshot
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const runningEntries = await db.select({
      id: timeEntries.id,
      userId: timeEntries.userId,
      startTime: timeEntries.startTime,
    }).from(timeEntries).where(eq(timeEntries.status, "running")).limit(50);

    const runningNoShot: Array<{ userId: string; entryId: string; startedAt: Date }> = [];
    for (const entry of runningEntries) {
      const [lastShot] = await db.select({ capturedAt: timeEntryScreenshots.capturedAt })
        .from(timeEntryScreenshots)
        .where(and(
          eq(timeEntryScreenshots.timeEntryId, entry.id),
          sql`${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'`,
          isNull(timeEntryScreenshots.deletedAt),
        ))
        .orderBy(desc(timeEntryScreenshots.capturedAt))
        .limit(1);
      if (!lastShot || lastShot.capturedAt < thirtyMinAgo) {
        runningNoShot.push({ userId: entry.userId, entryId: entry.id, startedAt: entry.startTime });
      }
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const stalledDevicesRaw = await db.select({
      id: devices.id,
      userId: devices.userId,
      name: devices.name,
      lastSeenAt: devices.lastSeenAt,
    }).from(devices).where(and(
      isNull(devices.revokedAt),
      sql`${devices.lastSeenAt} IS NOT NULL`,
      sql`${devices.lastSeenAt} < ${sevenDaysAgo}`,
    )).orderBy(asc(devices.lastSeenAt)).limit(20);

    const allUids = [...new Set([
      ...highIdleRaw.map(r => r.userId),
      ...runningNoShot.map(r => r.userId),
      ...stalledDevicesRaw.map(d => d.userId),
    ])];
    const usersList = allUids.length > 0
      ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
          .from(users).where(inArray(users.id, allUids))
      : [];
    const usersMap = new Map(usersList.map(u => [u.id, u]));
    const nameOf = (uid: string) => {
      const u = usersMap.get(uid);
      return u ? (`${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email) : "Unknown";
    };

    return {
      highIdleUsers: highIdleRaw.map(r => {
        const total = r.totalSeconds + r.idleSeconds;
        return { userId: r.userId, userName: nameOf(r.userId), idleRatio: Math.round((r.idleSeconds / total) * 100), totalSeconds: r.totalSeconds };
      }).sort((a, b) => b.idleRatio - a.idleRatio),
      stalledDevices: stalledDevicesRaw.map(d => ({
        deviceId: d.id,
        deviceName: d.name,
        userId: d.userId,
        userName: nameOf(d.userId),
        lastSeenAt: d.lastSeenAt,
        daysSinceLastSeen: d.lastSeenAt ? Math.floor((Date.now() - d.lastSeenAt.getTime()) / 86400000) : 999,
      })),
      runningWithoutScreenshots: runningNoShot.map(r => ({
        userId: r.userId,
        userName: nameOf(r.userId),
        entryId: r.entryId,
        startedAt: r.startedAt,
      })),
    };
  }

  // ─── Data Quality Report ───
  //
  // Computes evidence-layer quality flags per user, relative to their tracked
  // time. Business metrics (duration, idle time) are NEVER modified here.
  // Quality flags are purely observational: they describe evidence completeness,
  // not whether tracked time is valid.
  //
  // Quality flag definitions:
  //   low_coverage      — fewer than 1 screenshot per 10 min of tracked time
  //   duplicate_heavy   — ≥ 20% of screenshots share a contentHash with another
  //   events_missing    — user has tracked time but zero activity events recorded
  //   stale_device      — user's most recent device hasn't been seen in 7+ days
  async getDataQualityReport(opts: {
    startDate: Date;
    endDate: Date;
    userId?: string;
  }): Promise<{
    byUser: Array<{
      userId: string;
      userName: string;
      /** Business truth: tracked seconds from time_entries only */
      trackedSeconds: number;
      /** Evidence count: screenshots in window (independent of tracked time) */
      screenshotCount: number;
      /** Expected screenshots at 1 per 10 min; null when trackedSeconds = 0 */
      expectedScreenshots: number | null;
      /** screenshotCount / expectedScreenshots × 100; null when expected = null */
      screenshotCoveragePercent: number | null;
      /** Duplicate screenshot count (same contentHash) */
      duplicateScreenshots: number;
      /** Activity events recorded for this user in window */
      activityEventCount: number;
      /** Quality flags raised for this user */
      flags: string[];
    }>;
    org: {
      /** Stopped entries in window that have zero associated screenshots */
      entriesWithoutAnyScreenshot: number;
      /** Total duplicate screenshot rows (contentHash repeated) */
      orgDuplicateScreenshots: number;
      /** Non-revoked devices not seen in 7+ days */
      stalledDevices: number;
      /** Screenshots tombstoned (soft-deleted by an admin) in this window */
      deletedScreenshots: number;
    };
  }> {
    const { startDate, endDate, userId } = opts;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // ── 1. Business truth: tracked seconds per user (time_entries ONLY) ──────
    const entryConds: any[] = [
      eq(timeEntries.status, "stopped"),
      sql`${timeEntries.startTime} >= ${startDate}`,
      sql`${timeEntries.startTime} <= ${endDate}`,
    ];
    if (userId) entryConds.push(eq(timeEntries.userId, userId));

    const trackedPerUser = await db.select({
      userId: timeEntries.userId,
      trackedSeconds: sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)::int`,
    }).from(timeEntries).where(and(...entryConds)).groupBy(timeEntries.userId);

    if (trackedPerUser.length === 0) {
      return { byUser: [], org: { entriesWithoutAnyScreenshot: 0, orgDuplicateScreenshots: 0, stalledDevices: 0, deletedScreenshots: 0 } };
    }

    const allUserIds = trackedPerUser.map(r => r.userId);

    // ── 2. Evidence: screenshots per user in window ───────────────────────────
    const shotConds: any[] = [
      sql`${timeEntryScreenshots.capturedAt} >= ${startDate}`,
      sql`${timeEntryScreenshots.capturedAt} <= ${endDate}`,
      sql`${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'`,
      isNull(timeEntryScreenshots.deletedAt),
      inArray(timeEntryScreenshots.userId, allUserIds),
    ];
    const shotsPerUser = await db.select({
      userId: timeEntryScreenshots.userId,
      screenshotCount: sql<number>`COUNT(*)::int`,
    }).from(timeEntryScreenshots).where(and(...shotConds)).groupBy(timeEntryScreenshots.userId);
    const shotCountMap = new Map(shotsPerUser.map(r => [r.userId, r.screenshotCount]));

    // ── 3. Evidence: duplicate screenshots per user ───────────────────────────
    const dupRows = await db.select({
      userId: timeEntryScreenshots.userId,
      dupCount: sql<number>`(COUNT(*) - COUNT(DISTINCT ${timeEntryScreenshots.contentHash}))::int`,
    }).from(timeEntryScreenshots)
      .where(and(...shotConds, sql`${timeEntryScreenshots.contentHash} IS NOT NULL`))
      .groupBy(timeEntryScreenshots.userId);
    const dupMap = new Map(dupRows.map(r => [r.userId, r.dupCount]));

    // ── 4. Evidence: activity events per user ────────────────────────────────
    const evtConds: any[] = [
      sql`${agentActivityEvents.timestamp} >= ${startDate}`,
      sql`${agentActivityEvents.timestamp} <= ${endDate}`,
      inArray(agentActivityEvents.userId, allUserIds),
    ];
    const eventsPerUser = await db.select({
      userId: agentActivityEvents.userId,
      eventCount: sql<number>`COUNT(*)::int`,
    }).from(agentActivityEvents).where(and(...evtConds)).groupBy(agentActivityEvents.userId);
    const evtMap = new Map(eventsPerUser.map(r => [r.userId, r.eventCount]));

    // ── 5. Evidence: most-recent device lastSeenAt per user ──────────────────
    const deviceRows = await db.select({
      userId: devices.userId,
      lastSeenAt: sql<Date | null>`MAX(${devices.lastSeenAt})`,
    }).from(devices)
      .where(and(isNull(devices.revokedAt), inArray(devices.userId, allUserIds)))
      .groupBy(devices.userId);
    const deviceMap = new Map(deviceRows.map(r => [r.userId, r.lastSeenAt]));

    // ── 6. Org-level: stopped entries with zero live (non-tombstoned) screenshots
    const [entriesNoShotRow] = await db.select({
      count: sql<number>`COUNT(*)::int`,
    }).from(timeEntries)
      .where(and(
        ...entryConds,
        sql`NOT EXISTS (
          SELECT 1 FROM ${timeEntryScreenshots}
          WHERE ${timeEntryScreenshots.timeEntryId} = ${timeEntries.id}
            AND ${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'
            AND ${timeEntryScreenshots.deletedAt} IS NULL
        )`,
      ));

    // ── 7. Org-level: total duplicate screenshots (live only) ────────────────
    const [orgDupRow] = await db.select({
      dupCount: sql<number>`(COUNT(*) - COUNT(DISTINCT ${timeEntryScreenshots.contentHash}))::int`,
    }).from(timeEntryScreenshots)
      .where(and(
        sql`${timeEntryScreenshots.capturedAt} >= ${startDate}`,
        sql`${timeEntryScreenshots.capturedAt} <= ${endDate}`,
        sql`${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'`,
        isNull(timeEntryScreenshots.deletedAt),
        sql`${timeEntryScreenshots.contentHash} IS NOT NULL`,
      ));

    // ── 7b. Org-level: tombstoned screenshots (evidence removed by admins) ───
    const [deletedShotRow] = await db.select({
      count: sql<number>`COUNT(*)::int`,
    }).from(timeEntryScreenshots)
      .where(and(
        sql`${timeEntryScreenshots.capturedAt} >= ${startDate}`,
        sql`${timeEntryScreenshots.capturedAt} <= ${endDate}`,
        sql`${timeEntryScreenshots.deletedAt} IS NOT NULL`,
      ));

    // ── 8. Org-level: stalled devices ────────────────────────────────────────
    const [stalledRow] = await db.select({
      count: sql<number>`COUNT(*)::int`,
    }).from(devices).where(and(
      isNull(devices.revokedAt),
      sql`${devices.lastSeenAt} IS NOT NULL`,
      sql`${devices.lastSeenAt} < ${sevenDaysAgo}`,
    ));

    // ── 9. Resolve user names ────────────────────────────────────────────────
    const usersList = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(users).where(inArray(users.id, allUserIds));
    const usersMap = new Map(usersList.map(u => [u.id, u]));
    const nameOf = (uid: string) => {
      const u = usersMap.get(uid);
      return u ? (`${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email) : "Unknown";
    };

    // ── 10. Assemble per-user report ─────────────────────────────────────────
    const byUser = trackedPerUser.map(r => {
      const trackedSeconds = r.trackedSeconds;
      const screenshotCount = shotCountMap.get(r.userId) ?? 0;
      const duplicateScreenshots = dupMap.get(r.userId) ?? 0;
      const activityEventCount = evtMap.get(r.userId) ?? 0;
      const lastSeen = deviceMap.get(r.userId) ?? null;

      // Expected: 1 screenshot per 10 min of tracked time
      const expectedScreenshots = trackedSeconds > 0 ? Math.ceil(trackedSeconds / 600) : null;
      const screenshotCoveragePercent =
        expectedScreenshots !== null && expectedScreenshots > 0
          ? Math.round((screenshotCount / expectedScreenshots) * 100)
          : null;

      const flags: string[] = [];
      // low_coverage: < 50% of expected screenshots
      if (screenshotCoveragePercent !== null && screenshotCoveragePercent < 50) {
        flags.push("low_coverage");
      }
      // duplicate_heavy: ≥ 20% of screenshots are duplicates
      if (screenshotCount > 0 && duplicateScreenshots / screenshotCount >= 0.2) {
        flags.push("duplicate_heavy");
      }
      // events_missing: tracked time but zero activity events
      if (trackedSeconds > 0 && activityEventCount === 0) {
        flags.push("events_missing");
      }
      // stale_device: most-recent device not seen in 7+ days
      if (lastSeen !== null && new Date(lastSeen) < sevenDaysAgo) {
        flags.push("stale_device");
      }

      return {
        userId: r.userId,
        userName: nameOf(r.userId),
        trackedSeconds,
        screenshotCount,
        expectedScreenshots,
        screenshotCoveragePercent,
        duplicateScreenshots,
        activityEventCount,
        flags,
      };
    });

    return {
      byUser,
      org: {
        entriesWithoutAnyScreenshot: entriesNoShotRow?.count ?? 0,
        orgDuplicateScreenshots: orgDupRow?.dupCount ?? 0,
        stalledDevices: stalledRow?.count ?? 0,
        deletedScreenshots: deletedShotRow?.count ?? 0,
      },
    };
  }

  // ─── Screenshot Coverage Report ───
  //
  // Measures evidence completeness relative to tracked time.
  // Business truth (duration, idleTime) is NEVER modified here.
  //
  // Coverage model:
  //   expected = ceil(trackedSeconds / 600)   — 1 screenshot per 10 min
  //   coveragePct = min(100, round(actual / expected × 100))
  //   low_coverage = coveragePct < 50
  //   no_coverage  = actual == 0 (entry has zero screenshots)
  //
  // Each query uses a LEFT JOIN so entries with zero screenshots are still
  // counted — their screenshotCount is simply 0, not excluded.
  async getScreenshotCoverageReport(opts: {
    startDate: Date;
    endDate: Date;
    userId?: string;
    crmProjectId?: string;
  }): Promise<{
    summary: {
      totalTrackedSeconds: number;
      totalScreenshots: number;
      expectedScreenshots: number;
      coveragePercent: number | null;
      totalEntries: number;
      entriesWithoutScreenshots: number;
      lowCoverageEntries: number;
      /** Screenshots tombstoned (soft-deleted by an admin) in this window */
      deletedScreenshots: number;
    };
    byUser: Array<{
      userId: string;
      userName: string;
      trackedSeconds: number;
      entriesCount: number;
      entriesWithoutScreenshots: number;
      screenshotCount: number;
      expectedScreenshots: number;
      coveragePct: number | null;
    }>;
    byProject: Array<{
      crmProjectId: string;
      projectName: string;
      trackedSeconds: number;
      entriesCount: number;
      entriesWithoutScreenshots: number;
      screenshotCount: number;
      expectedScreenshots: number;
      coveragePct: number | null;
    }>;
    byDay: Array<{
      date: string;
      trackedSeconds: number;
      screenshotCount: number;
      expectedScreenshots: number;
      coveragePct: number | null;
    }>;
  }> {
    const { startDate, endDate, userId, crmProjectId } = opts;

    // Shared filter conditions on time_entries (business truth source)
    const entryConds: any[] = [
      eq(timeEntries.status, "stopped"),
      sql`${timeEntries.startTime} >= ${startDate}`,
      sql`${timeEntries.startTime} <= ${endDate}`,
    ];
    if (userId) entryConds.push(eq(timeEntries.userId, userId));
    if (crmProjectId) entryConds.push(eq(timeEntries.crmProjectId, crmProjectId));

    // LEFT JOIN condition: only count live (non-pending, non-tombstoned) screenshots
    const shotJoinCond = and(
      eq(timeEntryScreenshots.timeEntryId, timeEntries.id),
      sql`${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'`,
      isNull(timeEntryScreenshots.deletedAt),
    );

    // ── Run 4 aggregation queries in parallel ──────────────────────────────
    const [perUserRaw, perProjectRaw, perDayRaw, lowCovRow] = await Promise.all([

      // Q1: Per-user — tracked seconds, entry count, screenshot count, entries-with-shots
      // LEFT JOIN ensures entries with zero screenshots appear with screenshotCount = 0
      db.select({
        userId: timeEntries.userId,
        trackedSeconds:  sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)::int`,
        entriesCount:    sql<number>`COUNT(DISTINCT ${timeEntries.id})::int`,
        screenshotCount: sql<number>`COUNT(${timeEntryScreenshots.id})::int`,
        entriesWithShots: sql<number>`COUNT(DISTINCT CASE WHEN ${timeEntryScreenshots.id} IS NOT NULL THEN ${timeEntries.id} END)::int`,
      }).from(timeEntries)
        .leftJoin(timeEntryScreenshots, shotJoinCond)
        .where(and(...entryConds))
        .groupBy(timeEntries.userId),

      // Q2: Per-project — same shape as Q1
      db.select({
        crmProjectId:    timeEntries.crmProjectId,
        trackedSeconds:  sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)::int`,
        entriesCount:    sql<number>`COUNT(DISTINCT ${timeEntries.id})::int`,
        screenshotCount: sql<number>`COUNT(${timeEntryScreenshots.id})::int`,
        entriesWithShots: sql<number>`COUNT(DISTINCT CASE WHEN ${timeEntryScreenshots.id} IS NOT NULL THEN ${timeEntries.id} END)::int`,
      }).from(timeEntries)
        .leftJoin(timeEntryScreenshots, shotJoinCond)
        .where(and(...entryConds))
        .groupBy(timeEntries.crmProjectId),

      // Q3: Per-day — grouped by DATE(start_time) so the day axis matches tracked time
      db.select({
        date:            sql<string>`DATE(${timeEntries.startTime})::text`,
        trackedSeconds:  sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)::int`,
        screenshotCount: sql<number>`COUNT(${timeEntryScreenshots.id})::int`,
      }).from(timeEntries)
        .leftJoin(timeEntryScreenshots, shotJoinCond)
        .where(and(...entryConds))
        .groupBy(sql`DATE(${timeEntries.startTime})`)
        .orderBy(sql`DATE(${timeEntries.startTime}) ASC`),

      // Q4: Count entries where live screenshot coverage < 50% of expected
      //     (correlated subquery — acceptable for a single count row)
      db.select({
        count: sql<number>`COUNT(*)::int`,
      }).from(timeEntries)
        .where(and(
          ...entryConds,
          sql`${timeEntries.duration} > 0`,
          sql`(
            SELECT COUNT(*) FROM ${timeEntryScreenshots}
            WHERE ${timeEntryScreenshots.timeEntryId} = ${timeEntries.id}
              AND ${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%'
              AND ${timeEntryScreenshots.deletedAt} IS NULL
          ) < CEIL(${timeEntries.duration}::numeric / 600) * 0.5`,
        )),
    ]);

    // ── Count tombstoned screenshots in the window (runs in parallel above ideally,
    //    but kept separate to avoid complicating the LEFT-JOIN shape) ──────────
    const deletedCondsCoverage: any[] = [
      sql`${timeEntryScreenshots.capturedAt} >= ${startDate}`,
      sql`${timeEntryScreenshots.capturedAt} <= ${endDate}`,
      sql`${timeEntryScreenshots.deletedAt} IS NOT NULL`,
    ];
    if (userId) deletedCondsCoverage.push(eq(timeEntryScreenshots.userId, userId));
    const [deletedShotCovRow] = await db.select({
      count: sql<number>`COUNT(*)::int`,
    }).from(timeEntryScreenshots).where(and(...deletedCondsCoverage));

    // ── Resolve user names ─────────────────────────────────────────────────
    const allUserIds = [...new Set(perUserRaw.map(r => r.userId))];
    const usersList = allUserIds.length > 0
      ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
          .from(users).where(inArray(users.id, allUserIds))
      : [];
    const usersMap = new Map(usersList.map(u => [u.id, u]));
    const nameOf = (uid: string) => {
      const u = usersMap.get(uid);
      return u ? (`${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email) : "Unknown";
    };

    // ── Resolve project names ──────────────────────────────────────────────
    const allProjectIds = [...new Set(perProjectRaw.map(r => r.crmProjectId))];
    const projectNameMap = new Map<string, string>();
    if (allProjectIds.length > 0) {
      const crmList = await db.select({ id: crmProjects.id, projectId: crmProjects.projectId })
        .from(crmProjects).where(inArray(crmProjects.id, allProjectIds));
      const wikiIds = crmList.map(p => p.projectId).filter(Boolean) as string[];
      if (wikiIds.length > 0) {
        const wikiList = await db.select({ id: projects.id, name: projects.name })
          .from(projects).where(inArray(projects.id, wikiIds));
        const wikiMap = new Map(wikiList.map(p => [p.id, p.name]));
        for (const cp of crmList) {
          projectNameMap.set(cp.id, (cp.projectId && wikiMap.get(cp.projectId)) || "Unknown Project");
        }
      }
    }

    // ── Helper: compute coverage % ─────────────────────────────────────────
    const coveragePct = (shots: number, tracked: number): number | null => {
      const expected = Math.ceil(tracked / 600);
      if (expected === 0) return null;
      return Math.min(100, Math.round((shots / expected) * 100));
    };

    // ── Assemble byUser ────────────────────────────────────────────────────
    const byUser = perUserRaw
      .map(r => ({
        userId: r.userId,
        userName: nameOf(r.userId),
        trackedSeconds: r.trackedSeconds,
        entriesCount: r.entriesCount,
        entriesWithoutScreenshots: r.entriesCount - r.entriesWithShots,
        screenshotCount: r.screenshotCount,
        expectedScreenshots: r.trackedSeconds > 0 ? Math.ceil(r.trackedSeconds / 600) : 0,
        coveragePct: r.trackedSeconds > 0 ? coveragePct(r.screenshotCount, r.trackedSeconds) : null,
      }))
      .sort((a, b) => {
        // Sort: no-coverage first, then ascending coverage %, then by name
        const aP = a.coveragePct ?? -1;
        const bP = b.coveragePct ?? -1;
        return aP - bP;
      });

    // ── Assemble byProject ─────────────────────────────────────────────────
    const byProject = perProjectRaw
      .map(r => ({
        crmProjectId: r.crmProjectId,
        projectName: projectNameMap.get(r.crmProjectId) || "Unknown Project",
        trackedSeconds: r.trackedSeconds,
        entriesCount: r.entriesCount,
        entriesWithoutScreenshots: r.entriesCount - r.entriesWithShots,
        screenshotCount: r.screenshotCount,
        expectedScreenshots: r.trackedSeconds > 0 ? Math.ceil(r.trackedSeconds / 600) : 0,
        coveragePct: r.trackedSeconds > 0 ? coveragePct(r.screenshotCount, r.trackedSeconds) : null,
      }))
      .sort((a, b) => {
        const aP = a.coveragePct ?? -1;
        const bP = b.coveragePct ?? -1;
        return aP - bP;
      });

    // ── Assemble byDay ─────────────────────────────────────────────────────
    const byDay = perDayRaw.map(r => {
      const expected = r.trackedSeconds > 0 ? Math.ceil(r.trackedSeconds / 600) : 0;
      return {
        date: r.date,
        trackedSeconds: r.trackedSeconds,
        screenshotCount: r.screenshotCount,
        expectedScreenshots: expected,
        coveragePct: r.trackedSeconds > 0 ? coveragePct(r.screenshotCount, r.trackedSeconds) : null,
      };
    });

    // ── Assemble summary (derived from byUser — no extra query needed) ─────
    const totalTrackedSeconds = perUserRaw.reduce((s, r) => s + r.trackedSeconds, 0);
    const totalEntries = perUserRaw.reduce((s, r) => s + r.entriesCount, 0);
    const totalScreenshots = perUserRaw.reduce((s, r) => s + r.screenshotCount, 0);
    const totalEntriesWithShots = perUserRaw.reduce((s, r) => s + r.entriesWithShots, 0);
    const expectedScreenshots = totalTrackedSeconds > 0 ? Math.ceil(totalTrackedSeconds / 600) : 0;

    return {
      summary: {
        totalTrackedSeconds,
        totalScreenshots,
        expectedScreenshots,
        coveragePercent: expectedScreenshots > 0
          ? Math.min(100, Math.round((totalScreenshots / expectedScreenshots) * 100))
          : null,
        totalEntries,
        entriesWithoutScreenshots: totalEntries - totalEntriesWithShots,
        lowCoverageEntries: lowCovRow[0]?.count ?? 0,
        deletedScreenshots: deletedShotCovRow?.count ?? 0,
      },
      byUser,
      byProject,
      byDay,
    };
  }

  // ─── Evidence Quality Report ───
  //
  // Produces a composite 0–100 score per user describing how well their
  // tracked sessions are supported by observable evidence.
  //
  // IMPORTANT: This method is READ-ONLY with respect to business metrics.
  // duration / idleTime on time_entries is NEVER modified, recalculated,
  // or referenced as output.  The score is an observational label only.
  //
  // Score components:
  //   coverageScore  (0–40)  screenshot count vs 1-per-10-min expectation
  //   qualityScore   (0–30)  deductions: dup ratio + low physical-activity screenshots
  //   eventsScore    (0–20)  activity events linked to entries exist
  //   deviceScore    (0–10)  device heartbeat freshness
  //
  async getEvidenceQualityReport(opts: {
    startDate: Date;
    endDate: Date;
    userId?: string;
  }): Promise<EvidenceQualityReport> {
    const { startDate, endDate, userId } = opts;

    const entryConds: any[] = [
      eq(timeEntries.status, "stopped"),
      sql`${timeEntries.startTime} >= ${startDate}`,
      sql`${timeEntries.startTime} <= ${endDate}`,
    ];
    if (userId) entryConds.push(eq(timeEntries.userId, userId));

    // ── Q1+Q2 combined: per-user entry stats + screenshot signals (single LEFT JOIN) ──
    // Aggregate by user across all stopped entries in the window:
    //   – entry count + total tracked seconds (from time_entries)
    //   – live screenshot count + unique content_hash count (dedupe signal)
    //   – avg keyboard & mouse activity % (low-activity screenshot signal)
    const perUserRaw = await db.select({
      userId:         timeEntries.userId,
      entryCount:     sql<number>`COUNT(DISTINCT ${timeEntries.id})::int`,
      trackedSeconds: sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)::int`,
      shotCount:      sql<number>`COUNT(${timeEntryScreenshots.id})
                        FILTER (WHERE ${timeEntryScreenshots.deletedAt} IS NULL
                          AND ${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%')`,
      uniqueHashes:   sql<number>`COUNT(DISTINCT ${timeEntryScreenshots.contentHash})
                        FILTER (WHERE ${timeEntryScreenshots.deletedAt} IS NULL
                          AND ${timeEntryScreenshots.contentHash} IS NOT NULL)`,
      avgKeyboardPct: sql<number | null>`AVG(${timeEntryScreenshots.keyboardActivityPercent})
                        FILTER (WHERE ${timeEntryScreenshots.deletedAt} IS NULL
                          AND ${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%')`,
      avgMousePct:    sql<number | null>`AVG(${timeEntryScreenshots.mouseActivityPercent})
                        FILTER (WHERE ${timeEntryScreenshots.deletedAt} IS NULL
                          AND ${timeEntryScreenshots.storageKey} NOT LIKE 'pending-%')`,
    }).from(timeEntries)
      .leftJoin(timeEntryScreenshots, eq(timeEntryScreenshots.timeEntryId, timeEntries.id))
      .where(and(...entryConds))
      .groupBy(timeEntries.userId);

    if (perUserRaw.length === 0) {
      return { gradeDistribution: { strong: 0, moderate: 0, weak: 0, insufficient: 0 }, byUser: [] };
    }

    const allUserIds = perUserRaw.map(r => r.userId);

    // ── Q3: activity event count per user ──────────────────────────────────────
    const eventsRaw = await db.select({
      userId:     agentActivityEvents.userId,
      eventCount: sql<number>`COUNT(*)::int`,
    }).from(agentActivityEvents)
      .where(and(
        sql`${agentActivityEvents.timestamp} >= ${startDate}`,
        sql`${agentActivityEvents.timestamp} <= ${endDate}`,
        inArray(agentActivityEvents.userId, allUserIds),
      ))
      .groupBy(agentActivityEvents.userId);
    const evtMap = new Map(eventsRaw.map(r => [r.userId, r.eventCount]));

    // ── Q4: device freshness per user (most recent non-revoked lastSeenAt) ─────
    const deviceRaw = await db.select({
      userId:      devices.userId,
      lastSeenAt:  sql<Date | null>`MAX(${devices.lastSeenAt})`,
    }).from(devices)
      .where(and(isNull(devices.revokedAt), inArray(devices.userId, allUserIds)))
      .groupBy(devices.userId);
    const deviceMap = new Map(deviceRaw.map(r => [r.userId, r.lastSeenAt]));

    // ── Q5: resolve user display names ──────────────────────────────────────────
    const usersList = await db.select({
      id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email,
    }).from(users).where(inArray(users.id, allUserIds));
    const usersMap = new Map(usersList.map(u => [u.id, u]));
    const nameOf = (uid: string) => {
      const u = usersMap.get(uid);
      return u ? (`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email) : "Unknown";
    };

    // ── Scoring ────────────────────────────────────────────────────────────────
    const oneDayMs  = 86_400_000;
    const sevenDaysMs = 7 * oneDayMs;

    const byUser = perUserRaw.map(r => {
      const shotCount    = r.shotCount    ?? 0;
      const uniqueHashes = r.uniqueHashes ?? 0;
      const eventCount   = evtMap.get(r.userId) ?? 0;
      const lastSeen     = deviceMap.get(r.userId) ?? null;

      // 1. Coverage (0–40): expected = 1 screenshot per 10 min of tracked time
      const expected = r.trackedSeconds > 0 ? Math.ceil(r.trackedSeconds / 600) : 0;
      const coveragePct = expected > 0 ? Math.min(1, shotCount / expected) : 0;
      const coverageScore = Math.round(40 * coveragePct);

      // 2. Quality (0–30): deductions for duplicates and low-activity screenshots
      const dupCount  = Math.max(0, shotCount - uniqueHashes);
      const dupRatio  = shotCount > 0 ? dupCount / shotCount : 0;
      // Full dup penalty (15 pts) at ≥ 50% duplicate ratio
      const dupPenalty = Math.round(15 * Math.min(1, dupRatio * 2));
      // Activity penalty: avg (keyboard + mouse) < 20% → points lost
      const avgKeyboard = typeof r.avgKeyboardPct === "number" ? r.avgKeyboardPct : null;
      const avgMouse    = typeof r.avgMousePct    === "number" ? r.avgMousePct    : null;
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
      let deviceScore = 0;
      if (lastSeen) {
        const ageMs = Date.now() - new Date(lastSeen).getTime();
        if (ageMs <= oneDayMs)    deviceScore = 10;
        else if (ageMs <= sevenDaysMs) deviceScore = 5;
      }

      const totalScore = coverageScore + qualityScore + eventsScore + deviceScore;
      const grade: EvidenceGrade =
        totalScore >= 75 ? "strong" :
        totalScore >= 50 ? "moderate" :
        totalScore >= 25 ? "weak" : "insufficient";

      const deviceLastSeenDaysAgo = lastSeen
        ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / oneDayMs)
        : null;

      return {
        userId:              r.userId,
        userName:            nameOf(r.userId),
        entryCount:          r.entryCount,
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
        deviceLastSeenDaysAgo,
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
    const allDevices = await db.select().from(devices).orderBy(desc(devices.lastSeenAt));
    const uids = [...new Set(allDevices.map(d => d.userId))];
    const usersList = uids.length > 0
      ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
          .from(users).where(inArray(users.id, uids))
      : [];
    const usersMap = new Map(usersList.map(u => [u.id, u]));

    return allDevices.map(d => {
      const u = usersMap.get(d.userId);
      return {
        id: d.id,
        userId: d.userId,
        userName: u ? (`${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email) : "Unknown",
        name: d.name,
        os: d.os ?? null,
        clientVersion: d.clientVersion ?? null,
        lastSeenAt: d.lastSeenAt ?? null,
        revokedAt: d.revokedAt ?? null,
        createdAt: d.createdAt ?? null,
      };
    });
  }
}

export const storage = new DatabaseStorage();
