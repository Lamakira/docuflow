import type { KnowledgePersistence } from "./persistence";

export type { KnowledgePersistence };

export const KNOWLEDGE_TABLES = [
  "documents",
  "company_documents",
  "company_document_folders",
  "files",
  "audio_recordings",
  "video_transcripts",
] as const;

export const knowledgeModule = {
  id: "knowledge",
  name: "Knowledge",
  tables: KNOWLEDGE_TABLES,
  persistence: {} as KnowledgePersistence,
} as const;
