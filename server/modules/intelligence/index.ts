import {
  intelligencePersistence,
  type IntelligencePersistence,
} from "./persistence";

export type { IntelligencePersistence, IndexArtifact } from "./persistence";
export {
  rebuildIndexArtifacts,
  listIndexArtifacts,
  deleteIndexArtifacts,
} from "./indexArtifacts";

export const INTELLIGENCE_TABLES = [
  "document_embeddings",
  "company_document_embeddings",
  "index_artifacts",
] as const;

export const intelligenceModule = {
  id: "intelligence",
  name: "Intelligence",
  tables: INTELLIGENCE_TABLES,
  persistence: intelligencePersistence,
} as const;
