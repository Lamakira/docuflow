import type { DocumentWriter } from "../writers";
import type {
  Document,
  InsertDocument,
  CompanyDocument,
  InsertCompanyDocument,
  CompanyDocumentWithUploader,
  CompanyDocumentFolder,
  InsertCompanyDocumentFolder,
  CompanyDocumentFolderWithCreator,
  AudioRecording,
  InsertAudioRecording,
} from "@shared/schema";

export interface KnowledgePersistence {
  getDocuments(projectId: string): Promise<Document[]>;
  getDocument(id: string): Promise<Document | undefined>;
  getDocumentAncestors(id: string): Promise<Document[]>;
  getRecentDocuments(userId: string, limit?: number): Promise<Document[]>;
  createDocument(document: InsertDocument, writer?: DocumentWriter): Promise<Document>;
  updateDocument(
    id: string,
    data: Partial<InsertDocument>,
    writer?: DocumentWriter
  ): Promise<Document | undefined>;
  deleteDocument(id: string): Promise<void>;
  duplicateDocument(id: string): Promise<Document | undefined>;
  reorderDocument(id: string, newParentId: string | null, newPosition: number): Promise<void>;

  getCompanyDocumentFolders(): Promise<CompanyDocumentFolderWithCreator[]>;
  getCompanyDocumentFolder(id: string): Promise<CompanyDocumentFolderWithCreator | undefined>;
  createCompanyDocumentFolder(
    folder: InsertCompanyDocumentFolder
  ): Promise<CompanyDocumentFolder>;
  updateCompanyDocumentFolder(
    id: string,
    data: Partial<InsertCompanyDocumentFolder>
  ): Promise<CompanyDocumentFolder | undefined>;
  deleteCompanyDocumentFolder(id: string): Promise<CompanyDocumentFolder | undefined>;

  getCompanyDocuments(folderId?: string): Promise<CompanyDocumentWithUploader[]>;
  getCompanyDocument(id: string): Promise<CompanyDocumentWithUploader | undefined>;
  createCompanyDocument(doc: InsertCompanyDocument): Promise<CompanyDocument>;
  updateCompanyDocument(
    id: string,
    data: Partial<InsertCompanyDocument>
  ): Promise<CompanyDocument | undefined>;
  deleteCompanyDocument(id: string): Promise<CompanyDocument | undefined>;
  searchCompanyDocuments(query: string): Promise<CompanyDocumentWithUploader[]>;
  searchCompanyDocumentFolders(query: string): Promise<CompanyDocumentFolderWithCreator[]>;

  getAudioRecording(id: string): Promise<AudioRecording | undefined>;
  createAudioRecording(recording: InsertAudioRecording): Promise<AudioRecording>;
  updateAudioRecording(
    id: string,
    data: Partial<InsertAudioRecording>
  ): Promise<AudioRecording | undefined>;
}

export type { DocumentWriter };
