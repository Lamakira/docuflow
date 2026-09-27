import { isReadableDocument, isVisibleDocumentAccess } from "@shared/documentAccess";

export type ChatCitation = {
  id: string;
  title: string;
  kind: "document" | "project-document";
  access?: string | null;
  /** Stamped once the reader's Document Access was checked (#278). */
  effectiveAccess?: string | null;
};

export { isVisibleDocumentAccess };

export function uniqueChatCitations(citations: ChatCitation[]): ChatCitation[] {
  const seen = new Set<string>();
  const out: ChatCitation[] = [];
  for (const citation of citations) {
    if (!isReadableDocument(citation)) continue;
    const key = `${citation.kind}:${citation.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(citation);
  }
  return out;
}

/** A Workspace Document the answer may draw on: one this reader can see. */
export function workspaceDocumentVisible(documentId: string, visible: ReadonlyMap<string, string>): boolean {
  return visible.has(documentId);
}
