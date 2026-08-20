import type { Document } from "@shared/schema";

export interface IntelligencePersistence {
  search(
    userId: string,
    query: string
  ): Promise<Array<{ type: string; id: string; title: string; projectName?: string }>>;
  getAllUserDocuments(userId: string): Promise<Array<Document & { projectName: string }>>;
}
