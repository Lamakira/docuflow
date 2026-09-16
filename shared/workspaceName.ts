/**
 * What makes a Workspace name valid (#217, Flow 1). One definition, because the
 * field, the BFF, and the column have to agree: `workspaces.name` is
 * `varchar(255)`, so a longer name is a database error rather than a refusal
 * the person can read.
 */

export const WORKSPACE_NAME_MAX = 255;

export type WorkspaceNameError = "empty" | "too-long" | null;

export function workspaceNameError(name: string): WorkspaceNameError {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length > WORKSPACE_NAME_MAX) return "too-long";
  return null;
}
