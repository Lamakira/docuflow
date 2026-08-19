import { config } from "./config";
import { db } from "./db";
import { videoTranscripts, documents, projects, documentEmbeddings } from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { generateEmbeddings, chunkText } from "./embeddings";
import crypto from "crypto";
import { extractLoomTranscript, extractFathomTranscript } from "./browser-transcript";
import { stampWorkspace, requireWorkspaceContext } from "./workspaceContext";

export interface VideoInfo {
  url: string;
  videoId: string;
  provider: "loom" | "fathom";
}

export interface TranscriptResult {
  success: boolean;
  transcript?: string;
  error?: string;
}

function computeHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").substring(0, 64);
}

export function extractVideoInfo(url: string): VideoInfo | null {
  try {
    const urlObj = new URL(url);
    
    if (urlObj.hostname.includes("loom.com")) {
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      let videoId = "";
      
      if (pathParts[0] === "share" && pathParts[1]) {
        videoId = pathParts[1].split('?')[0];
      } else if (pathParts[0] === "embed" && pathParts[1]) {
        videoId = pathParts[1].split('?')[0];
      } else if (pathParts.length === 1) {
        videoId = pathParts[0].split('?')[0];
      }
      
      if (videoId) {
        return { url, videoId, provider: "loom" };
      }
    }
    
    if (urlObj.hostname.includes("fathom.video")) {
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      let videoId = "";
      
      if ((pathParts[0] === "share" || pathParts[0] === "embed" || pathParts[0] === "call") && pathParts[1]) {
        videoId = pathParts[1].split('?')[0];
      } else if (pathParts.length === 1) {
        videoId = pathParts[0].split('?')[0];
      }
      
      if (videoId) {
        return { url, videoId, provider: "fathom" };
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

export function extractVideosFromContent(content: any): VideoInfo[] {
  const videos: VideoInfo[] = [];
  
  function traverse(node: any) {
    if (!node) return;
    
    if (node.type === "videoEmbed" && node.attrs?.src) {
      const info = extractVideoInfo(node.attrs.src);
      if (info) {
        videos.push(info);
      }
    }
    
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach(traverse);
    }
  }
  
  traverse(content);
  return videos;
}

async function fetchLoomTranscriptBrowser(videoId: string): Promise<TranscriptResult> {
  console.log(`[Loom] Using Playwright browser extraction for video: ${videoId}`);
  return await extractLoomTranscript(videoId);
}

async function fetchFathomTranscriptBrowser(videoId: string): Promise<TranscriptResult> {
  const apiKey = config.fathomApiKey;
  
  if (apiKey) {
    try {
      const response = await fetch(`https://api.fathom.ai/external/v1/recordings/${videoId}/transcript`, {
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.transcript && Array.isArray(data.transcript)) {
          const transcript = data.transcript.map((segment: any) => {
            const speaker = segment.speaker?.display_name || 'Speaker';
            const text = segment.text || '';
            return `${speaker}: ${text}`;
          }).join('\n');
          
          return { success: true, transcript };
        }
        
        if (typeof data.transcript === 'string') {
          return { success: true, transcript: data.transcript };
        }
      } else if (response.status === 401) {
        console.log('[Fathom] API key invalid, falling back to browser extraction');
      } else if (response.status !== 404) {
        console.log(`[Fathom] API error ${response.status}, falling back to browser extraction`);
      }
    } catch (error) {
      console.error("[Fathom] API error, falling back to browser extraction:", error);
    }
  }
  
  console.log(`[Fathom] Using Playwright browser extraction for video: ${videoId}`);
  return await extractFathomTranscript(videoId);
}

export async function fetchTranscript(provider: string, videoId: string): Promise<TranscriptResult> {
  if (provider === "loom") {
    return fetchLoomTranscriptBrowser(videoId);
  } else if (provider === "fathom") {
    return fetchFathomTranscriptBrowser(videoId);
  }
  
  return { success: false, error: `Unsupported video provider: ${provider}` };
}

async function createTranscriptEmbeddings(
  transcriptId: string,
  transcript: string,
  documentId: string,
  projectId: string,
  ownerId: string,
  videoProvider: string,
  projectName: string,
  documentTitle: string,
  breadcrumbs: string[] = []
): Promise<void> {
  const title = `Video Transcript (${videoProvider})`;
  const chunks = chunkText(transcript, title);
  
  // Two columns only — the staleness check reads nothing else, and the row
  // carries a 1536-dimension vector.
  const existingEmbeddings = await db
    .select({
      chunkIndex: documentEmbeddings.chunkIndex,
      contentHash: documentEmbeddings.contentHash,
    })
    .from(documentEmbeddings)
    .where(
      and(
        eq(documentEmbeddings.documentId, documentId),
        sql`metadata->>'transcriptId' = ${transcriptId}`
      )
    );
  
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
    console.error("Failed to generate embeddings for transcript:", transcriptId, error);
    throw error;
  }
  
  await db.delete(documentEmbeddings).where(
    and(
      eq(documentEmbeddings.documentId, documentId),
      sql`metadata->>'transcriptId' = ${transcriptId}`
    )
  );
  
  const { workspaceId } = requireWorkspaceContext();
  const fullBreadcrumbs = [...breadcrumbs, documentTitle];
  
  for (let i = 0; i < chunks.length; i++) {
    const hash = computeHash(chunks[i]);
    const embeddingArray = embeddings[i];
    const embeddingString = `[${embeddingArray.join(",")}]`;
    
    await db.execute(sql`
      INSERT INTO document_embeddings (
        document_id, project_id, owner_id, chunk_index, chunk_text, content_hash, embedding, metadata, workspace_id
      ) VALUES (
        ${documentId}, ${projectId}, ${ownerId}, ${i}, ${chunks[i]}, ${hash}, 
        ${embeddingString}::vector,
        ${JSON.stringify({ 
          title: `${documentTitle} - ${title}`, 
          projectName, 
          breadcrumbs: fullBreadcrumbs,
          transcriptId,
          isVideoTranscript: true,
          videoProvider
        })}::jsonb,
        ${workspaceId}
      )
    `);
  }
}

async function deleteTranscriptEmbeddings(transcriptId: string, documentId: string): Promise<void> {
  await db.delete(documentEmbeddings).where(
    and(
      eq(documentEmbeddings.documentId, documentId),
      sql`metadata->>'transcriptId' = ${transcriptId}`
    )
  );
}

export async function deleteDocumentTranscripts(documentId: string): Promise<void> {
  const transcripts = await db
    .select()
    .from(videoTranscripts)
    .where(eq(videoTranscripts.documentId, documentId));
  
  for (const transcript of transcripts) {
    await deleteTranscriptEmbeddings(transcript.id, documentId);
  }
  
  await db.delete(videoTranscripts).where(eq(videoTranscripts.documentId, documentId));
}

export async function syncDocumentVideoTranscripts(
  documentId: string,
  projectId: string,
  ownerId: string,
  content: any,
  projectName: string,
  documentTitle: string,
  breadcrumbs: string[] = [],
  options: { awaitProcessing?: boolean } = {}
): Promise<{ added: number; removed: number; errors: string[] }> {
  const videosInContent = extractVideosFromContent(content);
  const videoIdsInContent = new Set(videosInContent.map(v => v.videoId));
  
  const existingTranscripts = await db
    .select()
    .from(videoTranscripts)
    .where(eq(videoTranscripts.documentId, documentId));
  
  const existingVideoIds = new Set(existingTranscripts.map(t => t.videoId));
  
  const result = { added: 0, removed: 0, errors: [] as string[] };
  
  for (const transcript of existingTranscripts) {
    if (!videoIdsInContent.has(transcript.videoId)) {
      try {
        await deleteTranscriptEmbeddings(transcript.id, documentId);
        await db.delete(videoTranscripts).where(eq(videoTranscripts.id, transcript.id));
        result.removed++;
      } catch (error: any) {
        result.errors.push(`Failed to remove transcript for video ${transcript.videoId}: ${error.message}`);
      }
    }
  }
  
  for (const video of videosInContent) {
    if (!existingVideoIds.has(video.videoId)) {
      try {
        const [inserted] = await db.insert(videoTranscripts).values(stampWorkspace({
          videoUrl: video.url,
          videoId: video.videoId,
          provider: video.provider,
          documentId,
          projectId,
          ownerId,
          status: "pending",
        })).returning();
        
        const processing = processTranscript(inserted.id, video.provider, video.videoId, documentId, projectId, ownerId, projectName, documentTitle, breadcrumbs);
        if (options.awaitProcessing) {
          await processing;
        } else {
          processing.catch(err => console.error("Background transcript processing failed:", err));
        }
        
        result.added++;
      } catch (error: any) {
        result.errors.push(`Failed to add transcript for video ${video.videoId}: ${error.message}`);
      }
    }
  }
  
  return result;
}

async function processTranscript(
  transcriptId: string,
  provider: string,
  videoId: string,
  documentId: string,
  projectId: string,
  ownerId: string,
  projectName: string,
  documentTitle: string,
  breadcrumbs: string[] = []
): Promise<void> {
  await db.update(videoTranscripts)
    .set({ status: "processing", updatedAt: new Date() })
    .where(eq(videoTranscripts.id, transcriptId));
  
  const result = await fetchTranscript(provider, videoId);
  
  if (result.success && result.transcript) {
    await db.update(videoTranscripts)
      .set({ 
        transcript: result.transcript, 
        status: "completed", 
        errorMessage: null,
        updatedAt: new Date() 
      })
      .where(eq(videoTranscripts.id, transcriptId));
    
    try {
      await createTranscriptEmbeddings(
        transcriptId,
        result.transcript,
        documentId,
        projectId,
        ownerId,
        provider,
        projectName,
        documentTitle,
        breadcrumbs
      );
    } catch (error: any) {
      console.error("Failed to create transcript embeddings:", error);
    }
  } else {
    await db.update(videoTranscripts)
      .set({ 
        status: "error", 
        errorMessage: result.error,
        updatedAt: new Date() 
      })
      .where(eq(videoTranscripts.id, transcriptId));
  }
}

export async function retryTranscript(
  transcriptId: string,
  projectName: string,
  documentTitle: string,
  breadcrumbs: string[] = []
): Promise<{ success: boolean; error?: string }> {
  const [transcript] = await db
    .select()
    .from(videoTranscripts)
    .where(eq(videoTranscripts.id, transcriptId));
  
  if (!transcript) {
    return { success: false, error: "Transcript not found" };
  }
  
  await processTranscript(
    transcript.id,
    transcript.provider,
    transcript.videoId,
    transcript.documentId,
    transcript.projectId,
    transcript.ownerId,
    projectName,
    documentTitle,
    breadcrumbs
  );
  
  return { success: true };
}

export async function getDocumentTranscripts(documentId: string) {
  return db
    .select()
    .from(videoTranscripts)
    .where(eq(videoTranscripts.documentId, documentId));
}

export async function getTranscriptStatus(documentId: string): Promise<{
  total: number;
  pending: number;
  processing: number;
  completed: number;
  error: number;
  transcripts: Array<{
    id: string;
    videoId: string;
    provider: string;
    status: string;
    errorMessage: string | null;
  }>;
}> {
  const transcripts = await getDocumentTranscripts(documentId);
  
  return {
    total: transcripts.length,
    pending: transcripts.filter(t => t.status === "pending").length,
    processing: transcripts.filter(t => t.status === "processing").length,
    completed: transcripts.filter(t => t.status === "completed").length,
    error: transcripts.filter(t => t.status === "error").length,
    transcripts: transcripts.map(t => ({
      id: t.id,
      videoId: t.videoId,
      provider: t.provider,
      status: t.status,
      errorMessage: t.errorMessage,
    })),
  };
}
