export type { KnowledgePersistence } from "./persistence";

export const KNOWLEDGE_TABLES = [
  "documents",
  "company_documents",
  "company_document_folders",
  "audio_recordings",
  "video_transcripts",
] as const;

export const knowledgeModule = {
  id: "knowledge",
  name: "Knowledge",
  tables: KNOWLEDGE_TABLES,
  persistence: "KnowledgePersistence",
} as const;
