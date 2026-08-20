import type { IntelligencePersistence } from "./persistence";

export type { IntelligencePersistence };

export const INTELLIGENCE_TABLES = [
  "document_embeddings",
  "company_document_embeddings",
] as const;

export const intelligenceModule = {
  id: "intelligence",
  name: "Intelligence",
  tables: INTELLIGENCE_TABLES,
  persistence: {} as IntelligencePersistence,
} as const;
