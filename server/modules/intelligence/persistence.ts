/**
 * Intelligence owns Index Artifacts (#116). Chatbot corpus LIKE search lives
 * on Knowledge. Embedding tables remain the retrieval projection.
 */

import {
  deleteIndexArtifacts,
  listIndexArtifacts,
  rebuildIndexArtifacts,
  type IndexArtifact,
} from "./indexArtifacts";

export type { IndexArtifact };

export interface IntelligencePersistence {
  rebuildIndexArtifacts(): Promise<{ documents: number; files: number }>;
  listIndexArtifacts(source: {
    kind: "document" | "file";
    id: string;
  }): Promise<IndexArtifact[]>;
  deleteIndexArtifacts(source: { kind: "document" | "file"; id: string }): Promise<void>;
}

export const intelligencePersistence: IntelligencePersistence = {
  rebuildIndexArtifacts,
  listIndexArtifacts,
  deleteIndexArtifacts,
};
