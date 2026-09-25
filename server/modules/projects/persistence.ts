import type { ProjectWriter } from "../writers";
import type {
  Document,
  Project,
  InsertProject,
  CrmProject,
  InsertCrmProject,
  CrmProjectWithDetails,
  Task,
  InsertTask,
  ProjectMember,
  InsertProjectMember,
  ProjectMemberWithUser,
  Reminder,
  InsertReminder,
  ProjectDailyUpdate,
  InsertProjectDailyUpdate,
  ProjectDailyUpdateWithDetails,
} from "@shared/schema";

/** Every filter narrows the set before it is paged, so `total` counts what the filters kept (#275). */
export type CrmProjectListOptions = {
  page?: number;
  pageSize?: number;
  /** The combined lifecycle (`lead`, `won_in_progress`, …). */
  status?: string;
  /** Project Status (`planned`, `active`, …), what the v2 register groups by. */
  projectStatus?: string;
  /** Project name, Client name or company. */
  search?: string;
  clientId?: string;
  /** The first Project Member, or the assignee when there is none — the register's LEAD column. */
  leadId?: string;
  tagId?: string;
  projectType?: string;
  /** Inclusive bounds on the due date. */
  dueFrom?: Date;
  dueTo?: Date;
  /** Only Projects with no due date. */
  dueNone?: boolean;
  /** Only the Projects this User may see as a Member: one they belong to, or are assigned when it has no Members. */
  visibleToUserId?: string;
  /** A register column; most recently updated first when unset. */
  sort?: CrmProjectSort;
  dir?: "asc" | "desc";
};

export const CRM_PROJECT_SORTS = ["name", "status", "budget"] as const;
export type CrmProjectSort = (typeof CRM_PROJECT_SORTS)[number];

/** The Project Documentation register, paged by Project (#275). */
export type ProjectDocumentationListOptions = {
  page: number;
  pageSize: number;
  /** A Project name, or the title of one of its Documents. */
  search?: string;
  /** The `projects` id. */
  projectId?: string;
  clientId?: string;
  documentation: "enabled" | "disabled" | "all";
  /** As `CrmProjectListOptions.visibleToUserId`. */
  visibleToUserId?: string;
};

/** A Document as the register lists it: no content. */
export type ProjectDocumentationDocument = Pick<
  Document,
  "id" | "title" | "projectId" | "parentId" | "position" | "createdById" | "createdAt" | "updatedAt"
>;

export type ProjectDocumentationEntry = {
  project: Project;
  crmProjectId: string;
  clientId: string | null;
  documentationEnabled: boolean;
  documents: ProjectDocumentationDocument[];
};

export type ProjectDocumentationPage = {
  data: ProjectDocumentationEntry[];
  total: number;
  page: number;
  pageSize: number;
  /** Every Project the reader may see, whatever the filters, for the PROJECT chip and the New Document picker. */
  projects: Array<{ id: string; name: string; documentationEnabled: boolean }>;
};

export interface ProjectsPersistence {
  getProjects(userId: string): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(
    project: InsertProject & { ownerId: string },
    writer?: ProjectWriter
  ): Promise<Project>;
  updateProject(id: string, data: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<void>;

  getCrmProjects(
    userId: string,
    options?: CrmProjectListOptions
  ): Promise<{ data: CrmProjectWithDetails[]; total: number; page: number; pageSize: number }>;
  getCrmProject(id: string): Promise<CrmProjectWithDetails | undefined>;
  getCrmProjectByProjectId(projectId: string): Promise<CrmProject | undefined>;
  createCrmProject(crmProject: InsertCrmProject): Promise<CrmProject>;
  createCrmProjectWithBase(
    projectData: InsertProject & { ownerId: string },
    crmData?: Partial<InsertCrmProject>
  ): Promise<{ project: Project; crmProject: CrmProject }>;
  updateCrmProject(id: string, data: Partial<InsertCrmProject>): Promise<CrmProject | undefined>;
  deleteCrmProject(id: string): Promise<void>;
  toggleDocumentation(crmProjectId: string, enabled: boolean): Promise<CrmProject | undefined>;
  getDocumentationEnabledProjects(userId?: string): Promise<Project[]>;
  getProjectDocumentationPage(options: ProjectDocumentationListOptions): Promise<ProjectDocumentationPage>;

  getTasks(options: { crmProjectId: string; includeArchived?: boolean }): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  createTask(data: InsertTask): Promise<Task>;
  updateTask(id: string, data: Partial<InsertTask>): Promise<Task | undefined>;
  deleteTask(id: string): Promise<void>;

  getProjectMembers(crmProjectId: string): Promise<ProjectMemberWithUser[]>;
  addProjectMember(crmProjectId: string, userId: string): Promise<ProjectMember>;
  removeProjectMember(crmProjectId: string, userId: string): Promise<void>;

  createProjectDailyUpdate(data: InsertProjectDailyUpdate): Promise<ProjectDailyUpdate>;
  getProjectDailyUpdate(id: string): Promise<ProjectDailyUpdate | undefined>;
  getProjectDailyUpdatesByUser(
    userId: string,
    options?: { date?: Date }
  ): Promise<ProjectDailyUpdateWithDetails[]>;
  getProjectDailyUpdatesForAdmin(options?: {
    startDate?: Date;
    endDate?: Date;
    userId?: string;
    crmProjectId?: string;
  }): Promise<ProjectDailyUpdateWithDetails[]>;
  updateProjectDailyUpdate(
    id: string,
    data: Partial<InsertProjectDailyUpdate>
  ): Promise<ProjectDailyUpdate | undefined>;
  deleteProjectDailyUpdate(id: string): Promise<void>;

  createReminder(data: InsertReminder): Promise<Reminder>;
  getUserRemindersForProject(userId: string, crmProjectId: string): Promise<Reminder[]>;
  getReminder(id: string): Promise<Reminder | undefined>;
  updateReminder(
    id: string,
    data: Partial<
      Pick<
        Reminder,
        | "title"
        | "note"
        | "dueAt"
        | "status"
        | "taskId"
        | "notified"
        | "notifiedInApp"
        | "emailSent"
      >
    >
  ): Promise<Reminder | undefined>;
  deleteReminder(id: string): Promise<void>;
  getPendingDueReminders(now: Date): Promise<Reminder[]>;
}

export type { ProjectWriter };
