import type { ProjectWriter } from "../writers";
import type {
  Project,
  InsertProject,
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

export interface ProjectsPersistence {
  getProjects(userId: string): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(
    project: InsertProject & { ownerId: string },
    writer?: ProjectWriter
  ): Promise<Project>;
  updateProject(id: string, data: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<void>;

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
