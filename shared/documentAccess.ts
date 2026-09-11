/** Document Access as CONTEXT.md uses it: workspace-visible vs restricted. */

export function isVisibleDocumentAccess(access: string | null | undefined): boolean {
  const value = (access ?? "workspace").toLowerCase();
  return value === "workspace" || value === "everyone";
}
