import OpenAI from "openai";
import { config } from "./config";
import { db } from "./db";
import { documentEmbeddings, documents, projects, companyDocumentEmbeddings, companyDocuments, companyDocumentFolders } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import crypto from "crypto";

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

function getOpenAIClient(): OpenAI {
  const apiKey = config.openaiApiKey;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  return new OpenAI({ apiKey });
}

export function extractTextFromContent(content: any): string {
  if (!content) return "";
  
  let text = "";
  
  function traverse(node: any) {
    if (!node) return;
    
    if (node.type === "text" && node.text) {
      text += node.text + " ";
    }
    
    if (node.type === "heading") {
      text += "\n";
    }
    
    if (node.type === "paragraph") {
      text += "\n";
    }
    
    if (node.type === "bulletList" || node.type === "orderedList") {
      text += "\n";
    }
    
    if (node.type === "listItem") {
      text += "- ";
    }
    
    if (node.type === "codeBlock") {
      text += "\n```\n";
    }
    
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach(traverse);
    }
    
    if (node.type === "codeBlock") {
      text += "\n```\n";
    }
  }
  
  traverse(content);
  return text.trim().replace(/\n{3,}/g, "\n\n");
}

export function chunkText(text: string, title: string): string[] {
  if (!text || text.length === 0) {
    return [`Page: ${title}\n(Empty page)`];
  }
  
  const fullText = `Page: ${title}\n\n${text}`;
  
  if (fullText.length <= CHUNK_SIZE) {
    return [fullText];
  }
  
  const chunks: string[] = [];
  const words = fullText.split(/\s+/);
  let currentChunk = "";
  
  for (const word of words) {
    if ((currentChunk + " " + word).length > CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      const overlapWords = currentChunk.split(/\s+/).slice(-Math.floor(CHUNK_OVERLAP / 5));
      currentChunk = overlapWords.join(" ") + " " + word;
    } else {
      currentChunk = currentChunk ? currentChunk + " " + word : word;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

function computeHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").substring(0, 64);
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const openai = getOpenAIClient();
  
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  
  return response.data[0].embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  
  const openai = getOpenAIClient();
  
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  
  return response.data.map(d => d.embedding);
}

export async function updateDocumentEmbeddings(
  documentId: string,
  projectId: string,
  ownerId: string,
  title: string,
  content: any,
  projectName: string,
  breadcrumbs: string[] = []
): Promise<void> {
  const textContent = extractTextFromContent(content);
  const chunks = chunkText(textContent, title);
  
  // Only the two columns the staleness check reads: selecting the whole row
  // would pull every chunk's 1536-dimension vector across the wire for nothing.
  const existingEmbeddings = await db
    .select({
      chunkIndex: documentEmbeddings.chunkIndex,
      contentHash: documentEmbeddings.contentHash,
    })
    .from(documentEmbeddings)
    .where(eq(documentEmbeddings.documentId, documentId));
  
  const existingHashes = new Map(
    existingEmbeddings.map(e => [e.chunkIndex, e.contentHash])
  );
  
  // Check if content has changed by comparing chunk hashes
  let needsUpdate = existingEmbeddings.length !== chunks.length;
  if (!needsUpdate) {
    for (let i = 0; i < chunks.length; i++) {
      const hash = computeHash(chunks[i]);
      if (existingHashes.get(i) !== hash) {
        needsUpdate = true;
        break;
      }
    }
  }
  
  if (!needsUpdate) {
    return; // No changes, skip embedding generation
  }
  
  // Generate all embeddings FIRST before deleting existing ones
  // This prevents data loss if embedding generation fails
  let embeddings: number[][];
  try {
    embeddings = await generateEmbeddings(chunks);
  } catch (error) {
    console.error("Failed to generate embeddings for document:", documentId, error);
    throw error; // Don't delete existing embeddings if we can't generate new ones
  }
  
  // Now that we have new embeddings, delete old ones and insert new
  await db.delete(documentEmbeddings).where(eq(documentEmbeddings.documentId, documentId));
  
  for (let i = 0; i < chunks.length; i++) {
    const hash = computeHash(chunks[i]);
    const embeddingArray = embeddings[i];
    const embeddingString = `[${embeddingArray.join(",")}]`;
    
    await db.execute(sql`
      INSERT INTO document_embeddings (
        document_id, project_id, owner_id, chunk_index, chunk_text, content_hash, embedding, metadata
      ) VALUES (
        ${documentId}, ${projectId}, ${ownerId}, ${i}, ${chunks[i]}, ${hash}, 
        ${embeddingString}::vector,
        ${JSON.stringify({ title, projectName, breadcrumbs })}::jsonb
      )
    `);
  }
}

export async function deleteDocumentEmbeddings(documentId: string): Promise<void> {
  await db.delete(documentEmbeddings).where(eq(documentEmbeddings.documentId, documentId));
}

export async function deleteProjectEmbeddings(projectId: string): Promise<void> {
  await db.delete(documentEmbeddings).where(eq(documentEmbeddings.projectId, projectId));
}

export interface SearchResult {
  documentId: string;
  projectId: string;
  chunkText: string;
  title: string;
  projectName: string;
  breadcrumbs: string[];
  similarity: number;
}

export async function searchSimilarChunks(
  userId: string,
  query: string,
  limit: number = 15
): Promise<SearchResult[]> {
  const queryEmbedding = await generateEmbedding(query);
  const embeddingString = `[${queryEmbedding.join(",")}]`;
  
  const results = await db.execute(sql`
    SELECT 
      document_id,
      project_id,
      chunk_text,
      metadata,
      1 - (embedding <=> ${embeddingString}::vector) as similarity
    FROM document_embeddings
    WHERE owner_id = ${userId}
    ORDER BY embedding <=> ${embeddingString}::vector
    LIMIT ${limit}
  `);
  
  return (results.rows as any[]).map(row => ({
    documentId: row.document_id,
    projectId: row.project_id,
    chunkText: row.chunk_text,
    title: row.metadata?.title || "Untitled",
    projectName: row.metadata?.projectName || "Unknown Project",
    breadcrumbs: row.metadata?.breadcrumbs || [],
    similarity: parseFloat(row.similarity),
  }));
}

export async function hasEmbeddings(userId: string): Promise<boolean> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(documentEmbeddings)
    .where(eq(documentEmbeddings.ownerId, userId));
  
  return (result[0]?.count || 0) > 0;
}

export async function rebuildAllEmbeddings(userId: string): Promise<{ processed: number; errors: string[] }> {
  const userProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.ownerId, userId));
  
  let processed = 0;
  const errors: string[] = [];
  
  for (const project of userProjects) {
    const projectDocs = await db
      .select()
      .from(documents)
      .where(eq(documents.projectId, project.id));
    
    for (const doc of projectDocs) {
      try {
        const breadcrumbs = await getDocumentBreadcrumbs(doc.id);
        await updateDocumentEmbeddings(
          doc.id,
          project.id,
          userId,
          doc.title,
          doc.content,
          project.name,
          breadcrumbs
        );
        processed++;
      } catch (error: any) {
        errors.push(`Failed to embed document ${doc.id}: ${error.message}`);
      }
    }
  }
  
  return { processed, errors };
}

async function getDocumentBreadcrumbs(documentId: string): Promise<string[]> {
  const breadcrumbs: string[] = [];
  let currentId: string | null = documentId;
  const visited = new Set<string>();
  
  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    
    const [doc] = await db.select().from(documents).where(eq(documents.id, currentId));
    if (!doc) break;
    
    if (doc.id !== documentId) {
      breadcrumbs.unshift(doc.title);
    }
    currentId = doc.parentId;
  }
  
  return breadcrumbs;
}

// ============ Company Document Embeddings Functions ============

export interface CompanyDocSearchResult {
  companyDocumentId: string;
  folderId: string | null;
  chunkText: string;
  title: string;
  folderName: string;
  similarity: number;
}

export async function updateCompanyDocumentEmbeddings(
  companyDocumentId: string,
  folderId: string | null,
  title: string,
  content: any,
  folderName: string = "Root",
  mimeType?: string
): Promise<void> {
  const textContent = extractTextFromContent(content);
  const chunks = chunkText(textContent, title);
  
  // Two columns only, for the same reason as the document-side check above.
  const existingEmbeddings = await db
    .select({
      chunkIndex: companyDocumentEmbeddings.chunkIndex,
      contentHash: companyDocumentEmbeddings.contentHash,
    })
    .from(companyDocumentEmbeddings)
    .where(eq(companyDocumentEmbeddings.companyDocumentId, companyDocumentId));
  
  const existingHashes = new Map(
    existingEmbeddings.map(e => [e.chunkIndex, e.contentHash])
  );
  
  let needsUpdate = existingEmbeddings.length !== chunks.length;
  if (!needsUpdate) {
    for (let i = 0; i < chunks.length; i++) {
      const hash = computeHash(chunks[i]);
      if (existingHashes.get(i) !== hash) {
        needsUpdate = true;
        break;
      }
    }
  }
  
  if (!needsUpdate) {
    return;
  }
  
  let embeddings: number[][];
  try {
    embeddings = await generateEmbeddings(chunks);
  } catch (error) {
    console.error("Failed to generate embeddings for company document:", companyDocumentId, error);
    throw error;
  }
  
  await db.delete(companyDocumentEmbeddings).where(eq(companyDocumentEmbeddings.companyDocumentId, companyDocumentId));
  
  for (let i = 0; i < chunks.length; i++) {
    const hash = computeHash(chunks[i]);
    const embeddingArray = embeddings[i];
    const embeddingString = `[${embeddingArray.join(",")}]`;
    
    await db.execute(sql`
      INSERT INTO company_document_embeddings (
        company_document_id, folder_id, chunk_index, chunk_text, content_hash, embedding, metadata
      ) VALUES (
        ${companyDocumentId}, ${folderId}, ${i}, ${chunks[i]}, ${hash}, 
        ${embeddingString}::vector,
        ${JSON.stringify({ title, folderName, mimeType })}::jsonb
      )
    `);
  }
}

export async function deleteCompanyDocumentEmbeddings(companyDocumentId: string): Promise<void> {
  await db.delete(companyDocumentEmbeddings).where(eq(companyDocumentEmbeddings.companyDocumentId, companyDocumentId));
}

export async function searchCompanyDocumentChunks(
  query: string,
  limit: number = 10
): Promise<CompanyDocSearchResult[]> {
  const queryEmbedding = await generateEmbedding(query);
  const embeddingString = `[${queryEmbedding.join(",")}]`;
  
  const results = await db.execute(sql`
    SELECT 
      company_document_id,
      folder_id,
      chunk_text,
      metadata,
      1 - (embedding <=> ${embeddingString}::vector) as similarity
    FROM company_document_embeddings
    ORDER BY embedding <=> ${embeddingString}::vector
    LIMIT ${limit}
  `);
  
  return (results.rows as any[]).map(row => ({
    companyDocumentId: row.company_document_id,
    folderId: row.folder_id,
    chunkText: row.chunk_text,
    title: row.metadata?.title || "Untitled",
    folderName: row.metadata?.folderName || "Root",
    similarity: parseFloat(row.similarity),
  }));
}

export async function hasCompanyDocumentEmbeddings(): Promise<boolean> {
  const result = await db.execute(sql`SELECT COUNT(*) as count FROM company_document_embeddings`);
  return ((result.rows[0] as any)?.count || 0) > 0;
}

export async function rebuildAllCompanyDocumentEmbeddings(): Promise<{ processed: number; errors: string[] }> {
  const allDocs = await db.select().from(companyDocuments);
  const allFolders = await db.select().from(companyDocumentFolders);
  const folderMap = new Map(allFolders.map(f => [f.id, f.name]));
  
  let processed = 0;
  const errors: string[] = [];
  
  for (const doc of allDocs) {
    if (!doc.content) continue;
    
    try {
      const folderName = doc.folderId ? folderMap.get(doc.folderId) || "Unknown Folder" : "Root";
      await updateCompanyDocumentEmbeddings(
        doc.id,
        doc.folderId,
        doc.name,
        doc.content,
        folderName,
        doc.mimeType || undefined
      );
      processed++;
    } catch (error: any) {
      errors.push(`Failed to embed company document ${doc.id}: ${error.message}`);
    }
  }
  
  return { processed, errors };
}
