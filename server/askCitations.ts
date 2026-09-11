import { companyDocuments } from "@shared/schema";
import { isVisibleDocumentAccess } from "@shared/documentAccess";
import { db } from "./db";

export type ChatCitation = {
  id: string;
  title: string;
  kind: "document" | "project-document";
  access?: string | null;
};

export { isVisibleDocumentAccess };

export function uniqueChatCitations(citations: ChatCitation[]): ChatCitation[] {
  const seen = new Set<string>();
  const out: ChatCitation[] = [];
  for (const citation of citations) {
    if (!isVisibleDocumentAccess(citation.access)) continue;
    const key = `${citation.kind}:${citation.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(citation);
  }
  return out;
}

export async function workspaceDocumentAccessById(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: companyDocuments.id, access: companyDocuments.access })
    .from(companyDocuments);
  return new Map(rows.map((row) => [row.id, row.access]));
}

export function workspaceDocumentVisible(
  documentId: string,
  accessById: Map<string, string>,
): boolean {
  const access = accessById.get(documentId);
  if (access === undefined) return false;
  return isVisibleDocumentAccess(access);
}
