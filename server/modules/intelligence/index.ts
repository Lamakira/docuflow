export type { IntelligencePersistence } from "./persistence";

export const INTELLIGENCE_TABLES = [
  "document_embeddings",
  "company_document_embeddings",
] as const;

export const intelligenceModule = {
  id: "intelligence",
  name: "Intelligence",
  tables: INTELLIGENCE_TABLES,
  persistence: "IntelligencePersistence",
} as const;
