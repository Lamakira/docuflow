/**
 * Manage access (#278): the dialog a Workspace Document, File, or Folder
 * opens for its owner and the Administrators. The server holds the rules and
 * refuses what breaks them; this names what it answered.
 */

import {
  ACCESS_ADMINISTRATORS,
  ACCESS_EVERYONE,
  ACCESS_RESTRICTED,
  type AccessLevel,
  type InheritedAccess,
} from "@shared/documentAccess";
import { memberName } from "./today";

export type AccessItemKind = "document" | "folder";

/** What `GET …/:id/access` answers. */
export type AccessStateView = {
  kind: AccessItemKind;
  id: string;
  name: string;
  level: AccessLevel;
  memberIds: string[];
  effectiveLevel: AccessLevel;
  inherited: InheritedAccess;
  allowedLevels: AccessLevel[];
  ownerId: string | null;
  canChange: boolean;
};

export type AccessMember = {
  userId: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  archived?: boolean;
};

export type AccessDraft = { level: AccessLevel; memberIds: string[] };

export type ManageAccessModel = {
  title: string;
  levelOptions: Array<{ value: AccessLevel; label: string }>;
  inheritedCopy: string;
  showMembers: boolean;
  memberChoices: Array<{ userId: string; label: string; checked: boolean; owner: boolean }>;
  membersEmptyCopy: string;
  canSave: boolean;
  hint: string | null;
};

export function accessPath(kind: AccessItemKind, id: string): string {
  return kind === "folder" ? `/api/company-document-folders/${id}/access` : `/api/company-documents/${id}/access`;
}

const LEVEL_NAMES: Record<AccessLevel, string> = {
  [ACCESS_EVERYONE]: "Everyone",
  [ACCESS_RESTRICTED]: "Restricted",
  [ACCESS_ADMINISTRATORS]: "Administrators only",
};

export function accessLevelName(level: AccessLevel): string {
  return LEVEL_NAMES[level];
}

export function composeManageAccess(
  state: AccessStateView,
  members: AccessMember[],
  draft: AccessDraft,
): ManageAccessModel {
  const noun = state.kind === "folder" ? "Folder" : "item";
  const from = state.inherited.from;
  const levelOptions = state.allowedLevels.map((level) => ({
    value: level,
    label:
      level === ACCESS_EVERYONE && from
        ? `Same as ${from.name} (${accessLevelName(state.inherited.level)})`
        : level === ACCESS_RESTRICTED
          ? "Restricted to named Members"
          : accessLevelName(level),
  }));

  const inheritedCopy = from
    ? `Inherited from ${from.name}: ${accessLevelName(state.inherited.level)}. This ${noun} can be more restricted than its Folder, never more open.`
    : state.kind === "folder"
      ? "No Folder above this one restricts it. Folders and items inside inherit what you set here."
      : "No Folder above this item restricts it.";

  const allowed = state.inherited.memberIds ? new Set(state.inherited.memberIds) : null;
  const chosen = new Set(draft.memberIds);
  const memberChoices = members
    .filter((member) => !member.archived)
    .filter((member) => !allowed || allowed.has(member.userId))
    .map((member) => ({
      userId: member.userId,
      label: memberName(member),
      checked: chosen.has(member.userId),
      owner: member.userId === state.ownerId,
    }));

  const restricted = draft.level === ACCESS_RESTRICTED;
  const hint = restricted
    ? draft.memberIds.length === 0
      ? "Name at least one Member for Restricted access."
      : "The owner and Administrators keep access without being named."
    : draft.level === ACCESS_ADMINISTRATORS
      ? "Only the owner and Administrators will see it."
      : null;

  return {
    title: `Manage access · ${state.name}`,
    levelOptions,
    inheritedCopy,
    showMembers: restricted,
    memberChoices,
    membersEmptyCopy: allowed
      ? `No other Member can see ${from?.name ?? "its Folder"}, so none can be named here.`
      : "No active Members to name.",
    canSave: state.canChange && (!restricted || draft.memberIds.length > 0),
    hint,
  };
}

export function toggleAccessMember(draft: AccessDraft, userId: string, checked: boolean): AccessDraft {
  const rest = draft.memberIds.filter((id) => id !== userId);
  return { ...draft, memberIds: checked ? [...rest, userId] : rest };
}
