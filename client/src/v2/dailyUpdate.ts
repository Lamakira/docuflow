/**
 * Daily Update destination (#190).
 * Submits through existing `/api/daily-updates` writes.
 * Do not animate field focus.
 */

import { dailyUpdateBlockageTypeOptions, dailyUpdateStatusOptions } from "@shared/schema";
import { chromeRefusal } from "./chrome";
import { formatDateChip } from "./today";

export type DailyUpdateProject = {
  id: string;
  name: string;
};

export type DailyUpdateSubmissionInput = {
  id: string;
  crmProjectId: string;
  status: string;
  whatHappened?: string | null;
  whatWasDone?: string | null;
  nextSteps?: string | null;
  blockageType?: string | null;
  waitingOnClient?: boolean;
  crmProject?: { project?: { name?: string | null } | null } | null;
};

export type DailyUpdatePageInput = {
  now: Date;
  workspaceName: string;
  readOnly: boolean;
  projects: DailyUpdateProject[];
  submissions: DailyUpdateSubmissionInput[];
};

export type DailyUpdateSubmissionRow = {
  id: string;
  project: string;
  status: string;
  prose: string | null;
  nextPlans: string | null;
  blocker: string | null;
};

export type DailyUpdatePageModel = {
  dateChip: string;
  subhead: string;
  kind: "empty" | "submitted" | "refusal";
  emptyCopy: string;
  refusal: string | null;
  submissions: DailyUpdateSubmissionRow[];
  canSubmit: boolean;
};

function statusLabel(status: string): string {
  return dailyUpdateStatusOptions.find((option) => option.value === status)?.label ?? status;
}

function projectName(submission: DailyUpdateSubmissionInput, projects: DailyUpdateProject[]): string {
  return (
    submission.crmProject?.project?.name?.trim() ||
    projects.find((project) => project.id === submission.crmProjectId)?.name ||
    "Untitled Project"
  );
}

function blockerCopy(submission: DailyUpdateSubmissionInput): string | null {
  if (submission.waitingOnClient) return "Waiting on the Client.";
  if (!submission.blockageType) return null;
  return (
    dailyUpdateBlockageTypeOptions.find((option) => option.value === submission.blockageType)?.label ??
    submission.blockageType
  );
}

function submissionRows(
  submissions: DailyUpdateSubmissionInput[],
  projects: DailyUpdateProject[],
): DailyUpdateSubmissionRow[] {
  return submissions.map((submission) => {
    const prose = (submission.whatHappened || submission.whatWasDone || "").trim();
    const nextPlans = (submission.nextSteps || "").trim();
    return {
      id: submission.id,
      project: projectName(submission, projects),
      status: statusLabel(submission.status),
      prose: prose || null,
      nextPlans: nextPlans || null,
      blocker: blockerCopy(submission),
    };
  });
}

export function composeDailyUpdatePage(input: DailyUpdatePageInput): DailyUpdatePageModel {
  const submissions = submissionRows(input.submissions, input.projects);
  const empty = submissions.length === 0;
  const canSubmit = !input.readOnly && input.projects.length > 0;
  if (input.readOnly) {
    return {
      dateChip: formatDateChip(input.now),
      subhead: `Today's Daily Update in ${input.workspaceName}.`,
      kind: "refusal",
      emptyCopy: "",
      refusal: chromeRefusal({
        kind: "workspace-condition",
        workspaceName: input.workspaceName,
        condition: "Read-only",
      }),
      submissions,
      canSubmit: false,
    };
  }

  return {
    dateChip: formatDateChip(input.now),
    subhead: `Today's Daily Update in ${input.workspaceName}.`,
    kind: empty ? "empty" : "submitted",
    emptyCopy: empty
      ? canSubmit
        ? "No Daily Update submitted for today yet."
        : "No Projects to file a Daily Update against yet."
      : "",
    refusal: null,
    submissions,
    canSubmit,
  };
}
