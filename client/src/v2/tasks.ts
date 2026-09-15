/**
 * The Task protocol (#214). A Task belongs to exactly one Project
 * (CONTEXT.md, "Task"), and there is exactly one of these: the Dossier Tasks
 * list and the Projects & Tasks manager under Time Tracking read and write the
 * same `/api/tasks` records, with the same Task Status words.
 */

import { chromeRefusal } from "./chrome";

const TASK_STATUS_LABEL: Record<string, string> = {
  open: "TO DO",
  in_progress: "IN PROGRESS",
  done: "DONE",
  archived: "ARCHIVED",
};

export function taskStatusLabel(status: string): string {
  return TASK_STATUS_LABEL[status] ?? status.replace(/_/g, " ").toUpperCase();
}

export function tasksPath(crmProjectId: string, options: { includeArchived?: boolean } = {}): string {
  const params = new URLSearchParams({ crmProjectId });
  if (options.includeArchived) params.set("includeArchived", "true");
  return `/api/tasks?${params.toString()}`;
}

export function taskPath(taskId: string): string {
  return `/api/tasks/${taskId}`;
}

export type ProjectTaskProject = {
  id: string;
  project?: { name?: string | null } | null;
  client?: { name?: string | null } | null;
};

export type ProjectTask = {
  id: string;
  crmProjectId: string;
  name: string;
  status: string;
};

export type ProjectTasksInput = {
  workspaceName: string;
  readOnly: boolean;
  search: string;
  selectedProjectId: string | null;
  projects: ProjectTaskProject[];
  tasks: ProjectTask[];
};

export type TaskManagerRow = {
  id: string;
  name: string;
  status: string;
  statusValue: string;
  archived: boolean;
};

export type ProjectTasksModel = {
  subhead: string;
  projects: Array<{ id: string; name: string; selected: boolean }>;
  projectsEmpty: boolean;
  projectsEmptyCopy: string;
  selectedProjectName: string | null;
  chooseCopy: string;
  canWrite: boolean;
  refusal: string | null;
  active: { rows: TaskManagerRow[]; empty: boolean; emptyCopy: string };
  archived: { rows: TaskManagerRow[]; count: number };
  /** Every Task on the Project, open work first — what the table sorts over. */
  rows: TaskManagerRow[];
};

function toTaskRow(task: ProjectTask): TaskManagerRow {
  return {
    id: task.id,
    name: task.name,
    status: taskStatusLabel(task.status),
    statusValue: task.status,
    archived: task.status === "archived",
  };
}

export function composeProjectTasks(input: ProjectTasksInput): ProjectTasksModel {
  const needle = input.search.trim().toLowerCase();
  const matching = input.projects.filter(
    (project) => !needle || fullProjectName(project).toLowerCase().includes(needle),
  );
  const projects = matching.map((project) => ({
    id: project.id,
    name: projectName(project),
    selected: project.id === input.selectedProjectId,
  }));

  const selected = input.projects.find((project) => project.id === input.selectedProjectId) ?? null;
  const tasks = input.selectedProjectId
    ? input.tasks.filter((task) => task.crmProjectId === input.selectedProjectId)
    : [];
  const active = tasks.filter((task) => task.status !== "archived").map(toTaskRow);
  const archived = tasks.filter((task) => task.status === "archived").map(toTaskRow);

  return {
    subhead: `Tasks on the Projects in ${input.workspaceName}.`,
    projects,
    projectsEmpty: projects.length === 0,
    projectsEmptyCopy: needle
      ? "No Project matches that search."
      : "No Project in this Workspace yet.",
    selectedProjectName: selected ? fullProjectName(selected) : null,
    chooseCopy: "Choose a Project to read and manage its Tasks.",
    canWrite: !input.readOnly,
    refusal: input.readOnly
      ? chromeRefusal({
          kind: "workspace-condition",
          workspaceName: input.workspaceName,
          condition: "Read-only",
        })
      : null,
    active: {
      rows: active,
      empty: active.length === 0,
      emptyCopy: "No Task on this Project yet.",
    },
    archived: { rows: archived, count: archived.length },
    rows: [...active, ...archived],
  };
}

function projectName(project: ProjectTaskProject): string {
  return project.project?.name?.trim() || "Untitled Project";
}

function fullProjectName(project: ProjectTaskProject): string {
  const client = project.client?.name?.trim();
  return client ? `${client} · ${projectName(project)}` : projectName(project);
}
