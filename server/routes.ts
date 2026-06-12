import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, getUserId, hashPassword, verifyPassword, regenerateSession } from "./auth";
import { z } from "zod";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { ObjectPermission } from "./objectAcl";
import { registerAgentRoutes } from "./agentRoutes";
import { registerDownloadRoutes } from "./downloadRoutes";
import mammoth from "mammoth";
import { 
  insertProjectSchema, 
  insertDocumentSchema, 
  insertCrmClientSchema,
  insertCrmContactSchema,
  insertCrmProjectSchema,
  insertReminderSchema,
  crmProjectStatusValues,
  crmProjectTypeValues
} from "@shared/schema";
import OpenAI from "openai";
import {
  updateDocumentEmbeddings,
  deleteDocumentEmbeddings,
  deleteProjectEmbeddings,
  searchSimilarChunks,
  hasEmbeddings,
  rebuildAllEmbeddings,
  updateCompanyDocumentEmbeddings,
  deleteCompanyDocumentEmbeddings,
  searchCompanyDocumentChunks,
  rebuildAllCompanyDocumentEmbeddings,
} from "./embeddings";
import {
  syncDocumentVideoTranscripts,
  getTranscriptStatus,
  retryTranscript,
} from "./transcripts";
import { sendWelcomeEmail, sendPasswordUpdateEmail, sendProjectAssignmentEmail, sendReminderDueEmail } from "./email";
import { extractTextFromFile, isSupportedForExtraction, isVideoFile } from "./contentExtraction";
import { logTimeEvent, logError, logStaleSession, logInfo } from "./logger";
import { isTasksEnabled } from "./migrationFlags";
import { HELP_SCREENSHOT_SLOT_IDS, isHelpScreenshotSlotId } from "@shared/helpCenterScreenshotSlots";

// Helper to get OpenAI client lazily (only when needed, not at import time)
function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
  return new OpenAI({ apiKey });
}

// Helper to extract text content from TipTap JSON
function extractTextFromContent(content: any): string {
  if (!content) return "";
  
  let text = "";
  
  function traverse(node: any) {
    if (!node) return;
    
    if (node.type === "text" && node.text) {
      text += node.text + " ";
    }
    
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach(traverse);
    }
  }
  
  traverse(content);
  return text.trim();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);

  /**
   * Public readiness endpoint — used by the Desktop Agent's waitForBackend().
   * No auth required. Returns JSON immediately.
   * Registered first, before all other routes and the static catch-all.
   */
  app.get("/api/ping", (_req, res) => {
    res.json({ ok: true, server: "DocuFlow", agentAuth: "email-password-v1" });
  });

  // Desktop Agent routes (pairing, auth, ingestion)
  registerAgentRoutes(app);

  // Desktop installer download + CI publish endpoints
  registerDownloadRoutes(app);

  // Auth user endpoint - returns current user info or null if not authenticated
  app.get("/api/auth/user", async (req: Request, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.json(null);
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.json(null);
      }
      
      // Return user without password
      const { password, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      console.error("Error fetching auth user:", error);
      res.json(null);
    }
  });

  // Register endpoint
  const registerSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
  });

  app.post("/api/auth/register", async (req: Request, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const { email, password, firstName, lastName } = parsed.data;

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      // Hash password and create user
      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        firstName: firstName || null,
        lastName: lastName || null,
        profileImageUrl: null,
      });

      // Regenerate session to prevent fixation attacks, then set userId
      await regenerateSession(req);
      (req.session as any).userId = user.id;

      // Return user without password
      const { password: _, ...safeUser } = user;
      res.status(201).json(safeUser);
    } catch (error) {
      console.error("Error registering user:", error);
      res.status(500).json({ message: "Failed to register user" });
    }
  });

  // Login endpoint
  const loginSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
  });

  app.post("/api/auth/login", async (req: Request, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const { email, password } = parsed.data;

      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const isValid = await verifyPassword(password, user.password);
      if (!isValid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      await storage.updateUserLastLogin(user.id);

      try {
        await regenerateSession(req);
      } catch (e) {
      }
      (req.session as any).userId = user.id;

      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (error: any) {
      console.error("Error logging in:", error?.message || error, error?.stack);
      res.status(500).json({ message: "Failed to login" });
    }
  });

  // Logout endpoint
  app.post("/api/auth/logout", (req: Request, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Error destroying session:", err);
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/projects", isAuthenticated, async (req: Request, res) => {
    try {
      const userId = getUserId(req)!;
      const projects = await storage.getProjects(userId);
      res.json(projects);
    } catch (error) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });

  // Get documentation-enabled projects only (for documentation sidebar)
  // NOTE: This must come BEFORE /api/projects/:id to avoid "documentable" matching :id
  app.get("/api/projects/documentable", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const projects = await storage.getDocumentationEnabledProjects(userId);
      res.json(projects);
    } catch (error) {
      console.error("Error fetching documentable projects:", error);
      res.status(500).json({ message: "Failed to fetch documentable projects" });
    }
  });

  app.get("/api/projects/:id", isAuthenticated, async (req: any, res) => {
    try {
      const project = await storage.getProject(req.params.id);

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Company-wide visibility - all authenticated users can view any project
      res.json(project);
    } catch (error) {
      console.error("Error fetching project:", error);
      res.status(500).json({ message: "Failed to fetch project" });
    }
  });

  // NOTE: This endpoint is deprecated - projects must be created through CRM
  // This endpoint now redirects to CRM project creation for backwards compatibility
  app.post("/api/projects", isAuthenticated, async (req: any, res) => {
    // Return error indicating projects must be created through CRM
    return res.status(400).json({ 
      message: "Projects must be created through Project Management. Use POST /api/crm/projects instead.",
      redirectTo: "/api/crm/projects"
    });
  });

  // NOTE: Project updates should go through CRM for metadata consistency
  // This endpoint is restricted to only allow name updates (for sidebar rename functionality)
  app.patch("/api/projects/:id", isAuthenticated, async (req: any, res) => {
    try {
      const project = await storage.getProject(req.params.id);

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Company-wide access - all authenticated users can update projects
      // Only allow name updates from this endpoint - other fields should go through CRM
      const updateSchema = z.object({
        name: z.string().min(1).optional(),
      });
      const parsed = updateSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }

      const updated = await storage.updateProject(req.params.id, parsed.data);
      res.json(updated);
    } catch (error) {
      console.error("Error updating project:", error);
      res.status(500).json({ message: "Failed to update project" });
    }
  });

  // NOTE: Project deletion should go through CRM to maintain business rules
  // This endpoint is deprecated - use DELETE /api/crm/projects/:id instead
  app.delete("/api/projects/:id", isAuthenticated, async (req: any, res) => {
    // Return error indicating projects must be deleted through CRM
    return res.status(400).json({ 
      message: "Projects must be deleted through Project Management. Use DELETE /api/crm/projects/:id instead.",
      redirectTo: "/api/crm/projects"
    });
  });

  app.get("/api/projects/:projectId/documents", isAuthenticated, async (req: any, res) => {
    try {
      const project = await storage.getProject(req.params.projectId);

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Company-wide visibility - all authenticated users can view documents
      const documents = await storage.getDocuments(req.params.projectId);
      res.json(documents);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  app.post("/api/projects/:projectId/documents", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const project = await storage.getProject(req.params.projectId);

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Company-wide access - all authenticated users can create documents
      const createSchema = z.object({
        title: z.string().min(1),
        parentId: z.string().nullable().optional(),
        content: z.any().optional(),
        icon: z.string().optional(),
      });

      const parsed = createSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }

      const document = await storage.createDocument({
        title: parsed.data.title,
        parentId: parsed.data.parentId || null,
        content: parsed.data.content || null,
        icon: parsed.data.icon || null,
        projectId: req.params.projectId,
        position: 0,
        createdById: userId,
      });

      // Get breadcrumbs from parent if it exists
      let breadcrumbs: string[] = [];
      if (parsed.data.parentId) {
        const ancestors = await storage.getDocumentAncestors(document.id);
        breadcrumbs = ancestors.map(a => a.title);
      }

      // Generate embeddings for the new document asynchronously
      updateDocumentEmbeddings(
        document.id,
        req.params.projectId,
        userId,
        document.title,
        document.content,
        project.name,
        breadcrumbs
      ).catch(err => console.error("Error generating embeddings:", err));

      // Sync video transcripts asynchronously
      if (document.content) {
        syncDocumentVideoTranscripts(
          document.id,
          req.params.projectId,
          userId,
          document.content,
          project.name,
          document.title,
          breadcrumbs
        ).catch(err => console.error("Error syncing video transcripts:", err));
      }

      res.status(201).json(document);
    } catch (error) {
      console.error("Error creating document:", error);
      res.status(500).json({ message: "Failed to create document" });
    }
  });

  app.get("/api/documents/recent", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const documents = await storage.getRecentDocuments(userId, 10);
      res.json(documents);
    } catch (error) {
      console.error("Error fetching recent documents:", error);
      res.status(500).json({ message: "Failed to fetch recent documents" });
    }
  });

  app.get("/api/documents/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const document = await storage.getDocument(req.params.id);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      const project = await storage.getProject(document.projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Company-wide visibility - all authenticated users can view documents
      // Get creator info if createdById is set
      let createdBy = null;
      if (document.createdById) {
        createdBy = await storage.getUser(document.createdById);
      }

      res.json({ ...document, createdBy });
    } catch (error) {
      console.error("Error fetching document:", error);
      res.status(500).json({ message: "Failed to fetch document" });
    }
  });

  app.get("/api/documents/:id/ancestors", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const document = await storage.getDocument(req.params.id);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      const project = await storage.getProject(document.projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Company-wide visibility
      const ancestors = await storage.getDocumentAncestors(req.params.id);
      res.json(ancestors);
    } catch (error) {
      console.error("Error fetching ancestors:", error);
      res.status(500).json({ message: "Failed to fetch ancestors" });
    }
  });

  app.patch("/api/documents/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const document = await storage.getDocument(req.params.id);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      const project = await storage.getProject(document.projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Company-wide access - all authenticated users can edit documents
      const updateSchema = z.object({
        title: z.string().optional(),
        content: z.any().optional(),
        icon: z.string().nullable().optional(),
        parentId: z.string().nullable().optional(),
        position: z.number().optional(),
      });

      const parsed = updateSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }

      const updated = await storage.updateDocument(req.params.id, parsed.data);
      
      // Update embeddings if title or content changed
      if (updated && (parsed.data.title !== undefined || parsed.data.content !== undefined)) {
        const ancestors = await storage.getDocumentAncestors(req.params.id);
        const breadcrumbs = ancestors.map(a => a.title);
        
        updateDocumentEmbeddings(
          updated.id,
          updated.projectId,
          userId,
          updated.title,
          updated.content,
          project.name,
          breadcrumbs
        ).catch(err => console.error("Error updating embeddings:", err));

        // Sync video transcripts when content changes
        if (parsed.data.content !== undefined && updated.content) {
          syncDocumentVideoTranscripts(
            updated.id,
            updated.projectId,
            userId,
            updated.content,
            project.name,
            updated.title,
            breadcrumbs
          ).catch(err => console.error("Error syncing video transcripts:", err));
        }
      }
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating document:", error);
      res.status(500).json({ message: "Failed to update document" });
    }
  });

  app.delete("/api/documents/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const document = await storage.getDocument(req.params.id);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      const project = await storage.getProject(document.projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Company-wide access - all authenticated users can delete documents
      // Delete embeddings first (cascade should handle this, but be explicit)
      try {
        await deleteDocumentEmbeddings(req.params.id);
      } catch (err) {
        console.error("Error deleting embeddings:", err);
      }
      
      // Delete video transcripts and their embeddings
      try {
        const { deleteDocumentTranscripts } = await import("./transcripts");
        await deleteDocumentTranscripts(req.params.id);
      } catch (err) {
        console.error("Error deleting video transcripts:", err);
      }
      
      await storage.deleteDocument(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  app.post("/api/documents/:id/duplicate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const document = await storage.getDocument(req.params.id);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      const project = await storage.getProject(document.projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Company-wide access - all authenticated users can duplicate documents
      const newDoc = await storage.duplicateDocument(req.params.id);
      res.status(201).json(newDoc);
    } catch (error) {
      console.error("Error duplicating document:", error);
      res.status(500).json({ message: "Failed to duplicate document" });
    }
  });

  // Reorder documents within a project
  app.post("/api/projects/:projectId/documents/reorder", isAuthenticated, async (req: any, res) => {
    try {
      const { projectId } = req.params;
      const { documentId, newParentId, newPosition } = req.body;

      if (!documentId || typeof newPosition !== "number") {
        return res.status(400).json({ message: "documentId and newPosition are required" });
      }

      const document = await storage.getDocument(documentId);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      if (document.projectId !== projectId) {
        return res.status(400).json({ message: "Document does not belong to this project" });
      }

      // Update the document's parent and position
      await storage.reorderDocument(documentId, newParentId, newPosition);
      res.json({ success: true });
    } catch (error) {
      console.error("Error reordering document:", error);
      res.status(500).json({ message: "Failed to reorder document" });
    }
  });

  app.get("/api/search", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const query = (req.query.q as string) || "";

      if (!query || query.length < 1) {
        return res.json([]);
      }

      const results = await storage.search(userId, query);
      res.json(results);
    } catch (error) {
      console.error("Error searching:", error);
      res.status(500).json({ message: "Failed to search" });
    }
  });

  app.get("/public-objects/:filePath(*)", async (req, res) => {
    const filePath = req.params.filePath;
    const forceDownload = req.query.download === 'true';
    const originalFilename = req.query.filename as string | undefined;
    const objectStorageService = new ObjectStorageService();
    try {
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      
      // Set Content-Disposition header for forced downloads
      if (forceDownload) {
        // Use original filename if provided, otherwise fall back to path
        const filename = originalFilename || filePath.split('/').pop() || 'download';
        res.set('Content-Disposition', `attachment; filename="${filename}"`);
      }
      
      objectStorageService.downloadObject(file, res);
    } catch (error) {
      console.error("Error searching for public object:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/objects/:objectPath(*)", async (req: any, res) => {
    // Optional authentication - allows public files to be accessed without login
    const userId = getUserId(req);
    const objectStorageService = new ObjectStorageService();
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      const canAccess = await objectStorageService.canAccessObjectEntity({
        objectFile,
        userId: userId,
        requestedPermission: ObjectPermission.READ,
      });
      if (!canAccess) {
        return res.sendStatus(401);
      }
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error checking object access:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  app.post("/api/objects/upload", isAuthenticated, async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  app.post("/api/objects/upload-public", isAuthenticated, async (req, res) => {
    const objectStorageService = new ObjectStorageService();
    try {
      const uploadURL = await objectStorageService.getPublicUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting public upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  app.put("/api/document-images", isAuthenticated, async (req: Request, res) => {
    if (!req.body.imageURL) {
      return res.status(400).json({ error: "imageURL is required" });
    }

    const userId = getUserId(req)!;

    try {
      const objectStorageService = new ObjectStorageService();
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
        req.body.imageURL,
        {
          owner: userId,
          visibility: "public",
        }
      );

      res.status(200).json({
        objectPath: objectPath,
      });
    } catch (error) {
      console.error("Error setting image:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.put("/api/document-attachments", isAuthenticated, async (req: Request, res) => {
    if (!req.body.fileURL) {
      return res.status(400).json({ error: "fileURL is required" });
    }

    const userId = getUserId(req)!;

    try {
      const objectStorageService = new ObjectStorageService();
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
        req.body.fileURL,
        {
          owner: userId,
          visibility: "public",
        }
      );

      res.status(200).json({
        objectPath: objectPath,
      });
    } catch (error) {
      console.error("Error setting document attachment:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Audio recording upload and transcription endpoints
  app.post("/api/audio/upload", isAuthenticated, async (req: Request, res) => {
    const userId = getUserId(req)!;
    const { audioUrl, documentId, companyDocumentId } = req.body;

    if (!audioUrl) {
      return res.status(400).json({ error: "audioUrl is required" });
    }

    try {
      const objectStorageService = new ObjectStorageService();
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
        audioUrl,
        {
          owner: userId,
          visibility: "public",
        }
      );

      // Create audio recording record
      const recording = await storage.createAudioRecording({
        documentId: documentId || null,
        companyDocumentId: companyDocumentId || null,
        ownerId: userId,
        audioUrl: objectPath,
        transcriptStatus: "pending",
      });

      // Start transcription in background
      transcribeAudioInBackground(recording.id, objectPath);

      res.status(200).json({
        id: recording.id,
        audioUrl: objectPath,
        transcriptStatus: "pending",
      });
    } catch (error) {
      console.error("Error uploading audio:", error);
      res.status(500).json({ error: "Failed to upload audio" });
    }
  });

  // Get audio recording by ID (for polling transcript status)
  app.get("/api/audio/:id", isAuthenticated, async (req: Request, res) => {
    const userId = getUserId(req)!;
    const { id } = req.params;

    try {
      const recording = await storage.getAudioRecording(id);
      if (!recording) {
        return res.status(404).json({ error: "Audio recording not found" });
      }

      if (recording.ownerId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(recording);
    } catch (error) {
      console.error("Error fetching audio recording:", error);
      res.status(500).json({ error: "Failed to fetch audio recording" });
    }
  });

  // Helper function to transcribe audio in background
  async function transcribeAudioInBackground(recordingId: string, audioUrl: string) {
    try {
      await storage.updateAudioRecording(recordingId, { transcriptStatus: "processing" });

      const objectStorageService = new ObjectStorageService();
      
      // Get the audio file from storage
      const normalizedPath = objectStorageService.normalizeObjectEntityPath(audioUrl);
      const file = await objectStorageService.getObjectEntityFile(normalizedPath);
      
      if (!file) {
        throw new Error("Audio file not found");
      }

      // Download the audio file to a buffer
      const [buffer] = await file.download();
      
      // Create a File object for OpenAI
      const audioFile = new File([buffer], "audio.webm", { type: "audio/webm" });

      // Transcribe using OpenAI Whisper
      const openai = getOpenAIClient();
      const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-1",
      });

      await storage.updateAudioRecording(recordingId, {
        transcript: transcription.text,
        transcriptStatus: "completed",
      });

      console.log(`Transcription completed for recording ${recordingId}`);
    } catch (error) {
      console.error(`Error transcribing audio ${recordingId}:`, error);
      await storage.updateAudioRecording(recordingId, { transcriptStatus: "error" });
    }
  }

  // Rebuild embeddings for all user documents
  // This is useful for initial setup or after bulk imports
  app.post("/api/embeddings/rebuild", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      
      // Get all user's projects and documents
      const projects = await storage.getProjects(userId);
      const projectMap = new Map(projects.map(p => [p.id, p]));
      const allDocuments = await storage.getAllUserDocuments(userId);
      
      // Rebuild embeddings for each document
      const results = { processed: 0, errors: 0 };
      
      for (const doc of allDocuments) {
        try {
          const project = projectMap.get(doc.projectId);
          if (!project) continue;
          
          const ancestors = await storage.getDocumentAncestors(doc.id);
          const breadcrumbs = ancestors.map(a => a.title);
          
          await updateDocumentEmbeddings(
            doc.id,
            doc.projectId,
            userId,
            doc.title,
            doc.content,
            project.name,
            breadcrumbs
          );
          
          results.processed++;
        } catch (error) {
          console.error(`Error rebuilding embeddings for document ${doc.id}:`, error);
          results.errors++;
        }
      }
      
      res.json({
        message: "Embeddings rebuild complete",
        ...results,
        total: allDocuments.length
      });
    } catch (error: any) {
      console.error("Error rebuilding embeddings:", error);
      res.status(500).json({ message: "Failed to rebuild embeddings", error: error.message });
    }
  });

  // Get transcript status for a document
  app.get("/api/documents/:id/transcripts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const document = await storage.getDocument(req.params.id);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      const project = await storage.getProject(document.projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Company-wide visibility
      const status = await getTranscriptStatus(req.params.id);
      res.json(status);
    } catch (error) {
      console.error("Error fetching transcript status:", error);
      res.status(500).json({ message: "Failed to fetch transcript status" });
    }
  });

  // Retry a failed transcript extraction
  app.post("/api/transcripts/:id/retry", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      
      // Get transcript and verify ownership
      const { db } = await import("./db");
      const { videoTranscripts } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      
      const [transcript] = await db
        .select()
        .from(videoTranscripts)
        .where(eq(videoTranscripts.id, req.params.id));

      if (!transcript) {
        return res.status(404).json({ message: "Transcript not found" });
      }

      // Company-wide access - all authenticated users can retry transcripts
      const document = await storage.getDocument(transcript.documentId);
      const project = await storage.getProject(transcript.projectId);
      
      if (!document || !project) {
        return res.status(404).json({ message: "Document or project not found" });
      }

      // Get ancestors for breadcrumbs
      const ancestors = await storage.getDocumentAncestors(document.id);
      const breadcrumbs = ancestors.map(a => a.title);

      const result = await retryTranscript(
        transcript.id,
        project.name,
        document.title,
        breadcrumbs
      );

      if (result.success) {
        res.json({ message: "Transcript retry initiated" });
      } else {
        res.status(500).json({ message: result.error || "Failed to retry transcript" });
      }
    } catch (error) {
      console.error("Error retrying transcript:", error);
      res.status(500).json({ message: "Failed to retry transcript" });
    }
  });

  // Manually trigger transcript sync for a document
  app.post("/api/documents/:id/sync-transcripts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const document = await storage.getDocument(req.params.id);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      const project = await storage.getProject(document.projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Company-wide access
      if (!document.content) {
        return res.json({ message: "No content to sync", added: 0, removed: 0 });
      }

      // Get ancestors for breadcrumbs
      const ancestors = await storage.getDocumentAncestors(document.id);
      const breadcrumbs = ancestors.map(a => a.title);

      const result = await syncDocumentVideoTranscripts(
        document.id,
        document.projectId,
        userId,
        document.content,
        project.name,
        document.title,
        breadcrumbs
      );

      res.json({
        message: "Transcript sync initiated",
        ...result
      });
    } catch (error) {
      console.error("Error syncing transcripts:", error);
      res.status(500).json({ message: "Failed to sync transcripts" });
    }
  });

  // Chat API endpoint - uses projects and pages as knowledge base
  // Knowledge base is dynamic: always fetches fresh data from database
  // Supports dual-mode: projects, company, or both
  app.post("/api/chat", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      
      const chatSchema = z.object({
        message: z.string().min(1),
        conversationHistory: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string()
        })).optional(),
        mode: z.enum(["projects", "company", "both"]).optional().default("both")
      });
      
      const parsed = chatSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }
      
      const { message, conversationHistory = [], mode } = parsed.data;
      
      // Lazily get OpenAI client - handles missing API key gracefully
      let openai: OpenAI;
      try {
        openai = getOpenAIClient();
      } catch (error: any) {
        console.error("OpenAI API key not configured:", error.message);
        return res.status(500).json({ message: "Chat service is not configured. Please add your OpenAI API key." });
      }
      
      let projectOverview = "";
      let companyDocsOverview = "";
      let relevantContext = "";
      let searchResults: { chunkText: string; title: string; projectName: string; breadcrumbs: string[]; similarity: number }[] = [];
      let usedFallback = false;
      
      // Get project overview and docs if mode includes projects
      if (mode === "projects" || mode === "both") {
        const projects = await storage.getProjects(userId);
        projectOverview = "# Available Projects\n\n";
        for (const project of projects) {
          projectOverview += `- **${project.name}**`;
          if (project.description) {
            projectOverview += `: ${project.description}`;
          }
          projectOverview += "\n";
        }
        
        // Use vector search to find relevant documentation chunks
        try {
          searchResults = await searchSimilarChunks(userId, message, mode === "both" ? 10 : 15);
          
          if (searchResults.length > 0) {
            relevantContext = "# Relevant Project Documentation\n\n";
            
            const byDocument = new Map<string, typeof searchResults>();
            for (const result of searchResults) {
              const key = `${result.projectName}/${result.title}`;
              const existing = byDocument.get(key) || [];
              existing.push(result);
              byDocument.set(key, existing);
            }
            
            Array.from(byDocument.entries()).forEach(([docKey, chunks]) => {
              const first = chunks[0];
              const breadcrumbPath = first.breadcrumbs.length > 0 
                ? first.breadcrumbs.join(" > ") + " > " + first.title
                : first.title;
              
              relevantContext += `## ${first.projectName} / ${breadcrumbPath}\n\n`;
              
              for (const chunk of chunks) {
                relevantContext += chunk.chunkText + "\n\n";
              }
            });
          }
        } catch (error) {
          console.error("Error searching embeddings:", error);
        }
        
        // Fallback for project docs
        if (searchResults.length === 0) {
          usedFallback = true;
          const allDocuments = await storage.getAllUserDocuments(userId);
          const projects = await storage.getProjects(userId);
          const projectMap = new Map(projects.map(p => [p.id, p]));
          
          if (allDocuments.length > 0) {
            relevantContext = "# Project Documentation Content\n\n";
            const MAX_FALLBACK_CHARS = mode === "both" ? 25000 : 50000;
            
            for (const doc of allDocuments) {
              if (relevantContext.length >= MAX_FALLBACK_CHARS) {
                relevantContext += "\n[Additional content available via semantic search...]\n";
                break;
              }
            
            const project = projectMap.get(doc.projectId);
            const projectName = project?.name || "Unknown Project";
            
              relevantContext += `## ${projectName} / ${doc.title}\n`;
              const textContent = extractTextFromContent(doc.content);
              if (textContent) {
                relevantContext += textContent + "\n\n";
              } else {
                relevantContext += "(Empty page)\n\n";
              }
            }
          }
        }
      }
      
      // Get company documents if mode includes company
      if (mode === "company" || mode === "both") {
        const companyDocs = await storage.getCompanyDocuments();
        const folders = await storage.getCompanyDocumentFolders();
        const folderMap = new Map(folders.map(f => [f.id, f]));
        
        // Always build company docs overview when in company or both mode
        companyDocsOverview = "# Company Documents\n\n";
        if (companyDocs.length > 0) {
          for (const doc of companyDocs) {
            const folder = doc.folderId ? folderMap.get(doc.folderId) : null;
            companyDocsOverview += `- **${doc.name}**`;
            if (folder) {
              companyDocsOverview += ` (in ${folder.name})`;
            }
            if (doc.fileName) {
              companyDocsOverview += ` [File: ${doc.fileName}]`;
            }
            if (doc.description) {
              companyDocsOverview += `: ${doc.description}`;
            }
            companyDocsOverview += "\n";
          }
          
          // Use vector search for company documents
          try {
            const companySearchResults = await searchCompanyDocumentChunks(message, mode === "both" ? 8 : 12);
            
            if (companySearchResults.length > 0) {
              relevantContext += "\n\n# Relevant Company Documents\n\n";
              
              const byCompanyDoc = new Map<string, typeof companySearchResults>();
              for (const result of companySearchResults) {
                const key = `${result.folderName}/${result.title}`;
                const existing = byCompanyDoc.get(key) || [];
                existing.push(result);
                byCompanyDoc.set(key, existing);
              }
              
              Array.from(byCompanyDoc.entries()).forEach(([docKey, chunks]) => {
                const first = chunks[0];
                const docPath = first.folderName !== "Root" 
                  ? `${first.folderName} / ${first.title}`
                  : first.title;
                
                relevantContext += `## Company: ${docPath}\n\n`;
                
                for (const chunk of chunks) {
                  relevantContext += chunk.chunkText + "\n\n";
                }
              });
            }
          } catch (companySearchError) {
            console.error("Error searching company document embeddings:", companySearchError);
          }
          
          // Fallback: If no embeddings found, include company docs directly
          if (!relevantContext.includes("# Relevant Company Documents")) {
            const companyContent: string[] = [];
            const MAX_COMPANY_CHARS = mode === "both" ? 15000 : 30000;
            let companyCharsUsed = 0;
            
            for (const doc of companyDocs) {
              if (companyCharsUsed >= MAX_COMPANY_CHARS) break;
              
              const folder = doc.folderId ? folderMap.get(doc.folderId) : null;
              const folderPath = folder ? `${folder.name} / ` : "";
              
              let docContent = `## Company: ${folderPath}${doc.name}\n`;
              
              if (doc.description) {
                docContent += `**Description:** ${doc.description}\n\n`;
              }
              
              if (doc.content) {
                const textContent = extractTextFromContent(doc.content);
                if (textContent) {
                  docContent += textContent + "\n\n";
                }
              }
              
              if (docContent.length + companyCharsUsed <= MAX_COMPANY_CHARS) {
                companyContent.push(docContent);
                companyCharsUsed += docContent.length;
              }
            }
            
            if (companyContent.length > 0) {
              relevantContext += "\n\n# Company Document Content\n\n" + companyContent.join("");
            }
          }
        } else {
          companyDocsOverview += "(No company documents available)\n";
        }
      }
      
      // Build system message based on mode
      const modeDescription = mode === "projects" 
        ? "project documentation" 
        : mode === "company" 
          ? "company documents" 
          : "both project documentation and company documents";
      
      const systemMessage = `You are DocuFlow Assistant, a helpful AI that assists users with their documentation. You currently have access to ${modeDescription}. When documents are created, updated, or deleted, the knowledge base is automatically updated.

${projectOverview}

${companyDocsOverview}

${relevantContext || "No specific documentation found related to this query. The documentation may be empty or the question may not relate to existing content."}

Instructions:
- Answer questions based on the documentation when the relevant content is shown above
- You can reference specific pages, projects, folders, and their content
- Help with documentation-related tasks like organizing content, suggesting improvements, or finding information
- Be concise and helpful
- If the relevant documentation section is empty or doesn't contain what was asked about, you can still help but clarify that the specific information wasn't found
- When referencing documentation, be specific about which source (project page or company document) the information comes from
- For questions about project documentation, reference the project and page names
- For questions about company documents, reference the folder and document names`;

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemMessage },
        ...conversationHistory.map(msg => ({
          role: msg.role as "user" | "assistant",
          content: msg.content
        })),
        { role: "user", content: message }
      ];
      
      // Call OpenAI with gpt-4.1-nano as requested by user
      const response = await openai.chat.completions.create({
        model: "gpt-4.1-nano",
        messages,
        max_completion_tokens: 1024,
      });
      
      const assistantMessage = response.choices[0]?.message?.content || "I'm sorry, I couldn't generate a response.";
      
      res.json({ 
        message: assistantMessage,
        model: "gpt-4.1-nano",
        relevantDocs: searchResults.length,
        usedFallback
      });
    } catch (error: any) {
      console.error("Error in chat:", error);
      res.status(500).json({ message: "Failed to process chat request", error: error.message });
    }
  });

  // ========== CRM Routes ==========

  // Get all CRM clients for the user
  app.get("/api/crm/clients", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const clients = await storage.getCrmClients(userId);
      res.json(clients);
    } catch (error) {
      console.error("Error fetching CRM clients:", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  // Get single CRM client with contacts
  app.get("/api/crm/clients/:id", isAuthenticated, async (req: any, res) => {
    try {
      const client = await storage.getCrmClient(req.params.id);
      
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      // Company-wide visibility - all authenticated users can view clients
      const contacts = await storage.getCrmContacts(client.id);
      res.json({ ...client, contacts });
    } catch (error) {
      console.error("Error fetching CRM client:", error);
      res.status(500).json({ message: "Failed to fetch client" });
    }
  });

  // Create CRM client
  app.post("/api/crm/clients", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const parsed = insertCrmClientSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      const client = await storage.createCrmClient({ ...parsed.data, ownerId: userId });
      res.status(201).json(client);
    } catch (error) {
      console.error("Error creating CRM client:", error);
      res.status(500).json({ message: "Failed to create client" });
    }
  });

  // Update CRM client
  app.patch("/api/crm/clients/:id", isAuthenticated, async (req: any, res) => {
    try {
      const client = await storage.getCrmClient(req.params.id);
      
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      // Company-wide access - all authenticated users can update clients
      const updateSchema = insertCrmClientSchema.partial();
      const parsed = updateSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      const updated = await storage.updateCrmClient(req.params.id, parsed.data);
      res.json(updated);
    } catch (error) {
      console.error("Error updating CRM client:", error);
      res.status(500).json({ message: "Failed to update client" });
    }
  });

  // Delete CRM client
  app.delete("/api/crm/clients/:id", isAuthenticated, async (req: any, res) => {
    try {
      const client = await storage.getCrmClient(req.params.id);
      
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      // Company-wide access - all authenticated users can delete clients
      await storage.deleteCrmClient(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting CRM client:", error);
      res.status(500).json({ message: "Failed to delete client" });
    }
  });

  // Create CRM contact for a client
  app.post("/api/crm/clients/:clientId/contacts", isAuthenticated, async (req: any, res) => {
    try {
      const client = await storage.getCrmClient(req.params.clientId);
      
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      
      // Company-wide access - all authenticated users can create contacts
      const parsed = insertCrmContactSchema.safeParse({ ...req.body, clientId: req.params.clientId });
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      const contact = await storage.createCrmContact(parsed.data);
      res.status(201).json(contact);
    } catch (error) {
      console.error("Error creating CRM contact:", error);
      res.status(500).json({ message: "Failed to create contact" });
    }
  });

  // Update CRM contact
  app.patch("/api/crm/contacts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const contact = await storage.getCrmContact(req.params.id);
      
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }
      
      // Company-wide access - all authenticated users can update contacts
      const updateSchema = insertCrmContactSchema.partial().omit({ clientId: true });
      const parsed = updateSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      const updated = await storage.updateCrmContact(req.params.id, parsed.data);
      res.json(updated);
    } catch (error) {
      console.error("Error updating CRM contact:", error);
      res.status(500).json({ message: "Failed to update contact" });
    }
  });

  // Delete CRM contact
  app.delete("/api/crm/contacts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const contact = await storage.getCrmContact(req.params.id);
      
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }
      
      // Company-wide access - all authenticated users can delete contacts
      await storage.deleteCrmContact(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting CRM contact:", error);
      res.status(500).json({ message: "Failed to delete contact" });
    }
  });

  // Get all CRM projects for Kanban view (no pagination)
  app.get("/api/crm/projects/all-kanban", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      
      // Fetch all projects without pagination for kanban view
      const result = await storage.getCrmProjects(userId, { page: 1, pageSize: 10000 });
      res.json(result);
    } catch (error) {
      console.error("Error fetching CRM projects for kanban:", error);
      res.status(500).json({ message: "Failed to fetch CRM projects" });
    }
  });

  // Get paginated CRM projects
  app.get("/api/crm/projects", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 10;
      const status = req.query.status as string | undefined;
      const search = req.query.search as string | undefined;
      
      const result = await storage.getCrmProjects(userId, { page, pageSize, status, search });
      res.json(result);
    } catch (error) {
      console.error("Error fetching CRM projects:", error);
      res.status(500).json({ message: "Failed to fetch CRM projects" });
    }
  });

  // Get single CRM project with details
  app.get("/api/crm/projects/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const crmProject = await storage.getCrmProject(req.params.id);
      
      if (!crmProject) {
        return res.status(404).json({ message: "CRM Project not found" });
      }
      
      // Company-wide visibility - all authenticated users can view CRM projects
      res.json(crmProject);
    } catch (error) {
      console.error("Error fetching CRM project:", error);
      res.status(500).json({ message: "Failed to fetch CRM project" });
    }
  });

  // Create CRM project with base project atomically (new flow: CRM is source of truth)
  app.post("/api/crm/projects", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      
      const createSchema = z.object({
        name: z.string().min(1, "Project name is required"),
        description: z.string().nullable().optional(),
        icon: z.string().optional(),
        clientId: z.string().nullable().optional(),
        status: z.string().optional(),
        projectType: z.string().optional(),
        assigneeId: z.string().nullable().optional(),
        startDate: z.string().nullable().optional(),
        dueDate: z.string().nullable().optional(),
        actualFinishDate: z.string().nullable().optional(),
        comments: z.string().nullable().optional(),
        budgetedHours: z.number().nullable().optional(),
        actualHours: z.number().nullable().optional(),
        documentationEnabled: z.boolean().optional(),
        isDocumentationOnly: z.boolean().optional(),
        memberIds: z.array(z.string()).optional(),
      });
      
      const parsed = createSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      // Enforce unique project name per user
      const existing = await storage.getCrmProjects(userId, { pageSize: 1000 });
      const nameConflict = existing.data.some(
        (p: any) => (p.project?.name || p.name || '').trim().toLowerCase() === parsed.data.name.trim().toLowerCase()
      );
      if (nameConflict) {
        return res.status(409).json({ message: `A project named "${parsed.data.name}" already exists` });
      }

      const { project, crmProject } = await storage.createCrmProjectWithBase(
        {
          name: parsed.data.name,
          description: parsed.data.description || null,
          icon: parsed.data.icon || "folder",
          ownerId: userId,
        },
        {
          clientId: parsed.data.clientId || null,
          status: parsed.data.status || "lead",
          projectType: parsed.data.projectType || "one_time",
          assigneeId: parsed.data.assigneeId || null,
          startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
          dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
          actualFinishDate: parsed.data.actualFinishDate ? new Date(parsed.data.actualFinishDate) : null,
          comments: parsed.data.comments || null,
          budgetedHours: parsed.data.budgetedHours ?? null,
          actualHours: parsed.data.actualHours ?? null,
          documentationEnabled: parsed.data.documentationEnabled ? 1 : 0,
          isDocumentationOnly: parsed.data.isDocumentationOnly ? 1 : 0,
        }
      );

      // Add extra members provided at creation time (creator is already added by createCrmProjectWithBase)
      if (parsed.data.memberIds && parsed.data.memberIds.length > 0) {
        for (const memberId of parsed.data.memberIds) {
          if (memberId !== userId) {
            await storage.addProjectMember(crmProject.id, memberId);
          }
        }
      }

      res.status(201).json({ project, crmProject });
    } catch (error) {
      console.error("Error creating CRM project:", error);
      res.status(500).json({ message: "Failed to create CRM project" });
    }
  });

  // Clone a CRM project
  app.post("/api/crm/projects/:id/clone", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const sourceProject = await storage.getCrmProject(req.params.id);
      
      if (!sourceProject) {
        return res.status(404).json({ message: "Source project not found" });
      }
      
      // Create a new project with same settings but new name
      const newName = `${sourceProject.project?.name || "Project"} (Copy)`;
      
      const { project, crmProject } = await storage.createCrmProjectWithBase(
        {
          name: newName,
          description: sourceProject.project?.description || null,
          icon: sourceProject.project?.icon || "folder",
          ownerId: userId,
        },
        {
          clientId: sourceProject.clientId || null,
          status: "lead", // Reset to initial status
          projectType: sourceProject.projectType || "one_time",
          assigneeId: sourceProject.assigneeId || null,
          startDate: null, // Reset dates
          dueDate: null,
          actualFinishDate: null,
          comments: sourceProject.comments || null,
          budgetedHours: sourceProject.budgetedHours ?? null,
          actualHours: null, // Reset actual hours
          documentationEnabled: sourceProject.documentationEnabled || 0,
          isDocumentationOnly: sourceProject.isDocumentationOnly || 0,
        }
      );
      
      // Copy custom field values if they exist
      const customFieldValues = await storage.getCrmProjectCustomFields(req.params.id);
      if (customFieldValues && customFieldValues.length > 0) {
        for (const fieldValue of customFieldValues) {
          await storage.setCrmProjectCustomField(
            crmProject.id,
            fieldValue.fieldId,
            fieldValue.value
          );
        }
      }
      
      res.status(201).json({ project, crmProject });
    } catch (error) {
      console.error("Error cloning CRM project:", error);
      res.status(500).json({ message: "Failed to clone CRM project" });
    }
  });

  // Toggle documentation enabled for a CRM project
  app.patch("/api/crm/projects/:id/documentation", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const crmProject = await storage.getCrmProject(req.params.id);
      
      if (!crmProject) {
        return res.status(404).json({ message: "CRM Project not found" });
      }
      
      // Company-wide access - all authenticated users can toggle documentation
      const toggleSchema = z.object({
        enabled: z.boolean(),
      });
      
      const parsed = toggleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      const updated = await storage.toggleDocumentation(req.params.id, parsed.data.enabled);
      res.json(updated);
    } catch (error) {
      console.error("Error toggling documentation:", error);
      res.status(500).json({ message: "Failed to toggle documentation" });
    }
  });

  // Update CRM project
  app.patch("/api/crm/projects/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const crmProject = await storage.getCrmProject(req.params.id);
      
      if (!crmProject) {
        return res.status(404).json({ message: "CRM Project not found" });
      }
      
      // Company-wide access - all authenticated users can update CRM projects
      const updateSchema = z.object({
        projectName: z.string().optional(),
        clientId: z.string().nullable().optional(),
        status: z.string().optional(),
        projectType: z.string().optional(),
        assigneeId: z.string().nullable().optional(),
        startDate: z.string().nullable().optional(),
        dueDate: z.string().nullable().optional(),
        actualFinishDate: z.string().nullable().optional(),
        comments: z.string().nullable().optional(),
        budgetedHours: z.number().nullable().optional(),
        actualHours: z.number().nullable().optional(),
        projectDescription: z.string().nullable().optional(),
      }).partial();
      
      const parsed = updateSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      // Update base project name and/or description if provided
      if (crmProject.projectId) {
        const projectUpdates: { name?: string; description?: string | null } = {};
        if (parsed.data.projectName !== undefined) {
          projectUpdates.name = parsed.data.projectName;
        }
        if (parsed.data.projectDescription !== undefined) {
          projectUpdates.description = parsed.data.projectDescription;
        }
        if (Object.keys(projectUpdates).length > 0) {
          await storage.updateProject(crmProject.projectId, projectUpdates);
        }
      }
      
      // Convert date strings to Date objects (exclude projectName/projectDescription from CRM update)
      const { projectName, projectDescription, ...crmFields } = parsed.data;
      const updateData: any = { ...crmFields };
      if (parsed.data.startDate !== undefined) {
        updateData.startDate = parsed.data.startDate ? new Date(parsed.data.startDate) : null;
      }
      if (parsed.data.dueDate !== undefined) {
        updateData.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
      }
      if (parsed.data.actualFinishDate !== undefined) {
        updateData.actualFinishDate = parsed.data.actualFinishDate ? new Date(parsed.data.actualFinishDate) : null;
      }
      
      // Check if assignee is changing to a new person
      const oldAssigneeId = crmProject.assigneeId;
      const newAssigneeId = parsed.data.assigneeId;
      const isNewAssignment = newAssigneeId && newAssigneeId !== oldAssigneeId && newAssigneeId !== userId;
      
      // Check if status is changing for stage history
      const oldStatus = crmProject.status;
      const newStatus = parsed.data.status;
      const isStatusChange = newStatus !== undefined && newStatus !== oldStatus;
      
      // Handle review time tracking - pause/resume timeline when entering/exiting review status
      const isReviewStatus = (status: string) => status.toLowerCase().includes('review');
      const wasInReview = isReviewStatus(oldStatus);
      const isNowInReview = newStatus ? isReviewStatus(newStatus) : wasInReview;
      
      if (isStatusChange) {
        if (!wasInReview && isNowInReview) {
          // Entering review status - start tracking review time
          updateData.reviewStartedAt = new Date();
        } else if (wasInReview && !isNowInReview && crmProject.reviewStartedAt) {
          // Exiting review status - calculate time spent in review and extend due date
          const reviewStartTime = new Date(crmProject.reviewStartedAt).getTime();
          const reviewEndTime = Date.now();
          const reviewDurationMs = reviewEndTime - reviewStartTime;
          const currentTotalReviewMs = crmProject.totalReviewMs || 0;
          
          updateData.totalReviewMs = currentTotalReviewMs + reviewDurationMs;
          updateData.reviewStartedAt = null;
          
          // Extend due date by the review duration if there's a due date
          if (crmProject.dueDate) {
            const currentDueDate = new Date(crmProject.dueDate);
            const newDueDate = new Date(currentDueDate.getTime() + reviewDurationMs);
            updateData.dueDate = newDueDate;
          }
        }
      }
      
      const updated = await storage.updateCrmProject(req.params.id, updateData);
      
      // Record stage history if status changed
      if (isStatusChange && updated) {
        try {
          await storage.createCrmProjectStageHistory({
            crmProjectId: req.params.id,
            fromStatus: oldStatus,
            toStatus: newStatus,
            changedById: userId,
          });
        } catch (historyError) {
          console.error("Error recording stage history:", historyError);
          // Don't fail the update if history recording fails
        }
      }
      
      // Send notification and email if assignee changed
      if (isNewAssignment && updated) {
        try {
          // Get assignee and assigner info
          const assignee = await storage.getUser(newAssigneeId);
          const assigner = await storage.getUser(userId);
          const projectName = crmProject.project?.name || "Untitled Project";
          
          if (assignee && assigner) {
            // Create in-app notification
            await storage.createNotification({
              userId: newAssigneeId,
              type: "assignment",
              crmProjectId: req.params.id,
              fromUserId: userId,
              message: `${assigner.firstName || 'Someone'} assigned you to "${projectName}"`,
            });
            
            // Send email notification
            const appUrl = `${req.protocol}://${req.get('host')}`;
            await sendProjectAssignmentEmail(
              assignee.email,
              assignee.firstName || 'Team Member',
              projectName,
              `${assigner.firstName || ''} ${assigner.lastName || ''}`.trim() || 'A team member',
              appUrl,
              req.params.id
            );
          }
        } catch (notifError) {
          console.error("Error sending assignment notification:", notifError);
          // Don't fail the update if notification fails
        }
      }
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating CRM project:", error);
      res.status(500).json({ message: "Failed to update CRM project" });
    }
  });

  // Get CRM project by documentation project ID
  // NOTE: This route MUST come before /api/crm/projects/:id to avoid matching "by-project" as :id
  app.get("/api/crm/projects/by-project/:projectId", isAuthenticated, async (req: any, res) => {
    try {
      const crmProject = await storage.getCrmProjectByProjectId(req.params.projectId);
      
      if (!crmProject) {
        return res.status(404).json({ message: "Project not found in CRM" });
      }
      
      res.json(crmProject);
    } catch (error) {
      console.error("Error fetching CRM project by project ID:", error);
      res.status(500).json({ message: "Failed to fetch project" });
    }
  });

  // Delete CRM project by project ID (for Documentation page)
  // NOTE: This route MUST come before /api/crm/projects/:id to avoid matching "by-project" as :id
  app.delete("/api/crm/projects/by-project/:projectId", isAuthenticated, async (req: any, res) => {
    try {
      const crmProject = await storage.getCrmProjectByProjectId(req.params.projectId);
      
      if (!crmProject) {
        return res.status(404).json({ message: "Project not found in CRM" });
      }
      
      // Company-wide access - all authenticated users can delete CRM projects
      await storage.deleteCrmProject(crmProject.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting CRM project by project ID:", error);
      res.status(500).json({ message: "Failed to delete project" });
    }
  });

  // Delete CRM project by CRM project ID
  app.delete("/api/crm/projects/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const crmProject = await storage.getCrmProject(req.params.id);
      
      if (!crmProject) {
        return res.status(404).json({ message: "CRM Project not found" });
      }
      
      // Company-wide access - all authenticated users can delete CRM projects
      await storage.deleteCrmProject(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting CRM project:", error);
      res.status(500).json({ message: "Failed to delete CRM project" });
    }
  });

  // ==================== CRM Tags ====================

  // Get all tags
  app.get("/api/crm/tags", isAuthenticated, async (req: any, res) => {
    try {
      const tags = await storage.getAllCrmTags();
      res.json(tags);
    } catch (error) {
      console.error("Error fetching CRM tags:", error);
      res.status(500).json({ message: "Failed to fetch tags" });
    }
  });

  // Create a new tag
  app.post("/api/crm/tags", isAuthenticated, async (req: any, res) => {
    try {
      const createSchema = z.object({
        name: z.string().min(1, "Tag name is required"),
        color: z.string().optional(),
      });
      
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      const tag = await storage.createCrmTag(parsed.data);
      res.status(201).json(tag);
    } catch (error) {
      console.error("Error creating CRM tag:", error);
      res.status(500).json({ message: "Failed to create tag" });
    }
  });

  // Update a tag
  app.patch("/api/crm/tags/:id", isAuthenticated, async (req: any, res) => {
    try {
      const updateSchema = z.object({
        name: z.string().min(1).optional(),
        color: z.string().optional(),
      });
      
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      const tag = await storage.updateCrmTag(req.params.id, parsed.data);
      if (!tag) {
        return res.status(404).json({ message: "Tag not found" });
      }
      res.json(tag);
    } catch (error) {
      console.error("Error updating CRM tag:", error);
      res.status(500).json({ message: "Failed to update tag" });
    }
  });

  // Delete a tag
  app.delete("/api/crm/tags/:id", isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteCrmTag(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting CRM tag:", error);
      res.status(500).json({ message: "Failed to delete tag" });
    }
  });

  // Get tags for a specific project
  app.get("/api/crm/projects/:id/tags", isAuthenticated, async (req: any, res) => {
    try {
      const tags = await storage.getCrmProjectTags(req.params.id);
      res.json(tags);
    } catch (error) {
      console.error("Error fetching project tags:", error);
      res.status(500).json({ message: "Failed to fetch project tags" });
    }
  });

  // Add tag to project
  app.post("/api/crm/projects/:id/tags/:tagId", isAuthenticated, async (req: any, res) => {
    try {
      const projectTag = await storage.addTagToProject(req.params.id, req.params.tagId);
      res.status(201).json(projectTag);
    } catch (error) {
      console.error("Error adding tag to project:", error);
      res.status(500).json({ message: "Failed to add tag to project" });
    }
  });

  // Remove tag from project
  app.delete("/api/crm/projects/:id/tags/:tagId", isAuthenticated, async (req: any, res) => {
    try {
      await storage.removeTagFromProject(req.params.id, req.params.tagId);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing tag from project:", error);
      res.status(500).json({ message: "Failed to remove tag from project" });
    }
  });

  // ==================== CRM Project Stage History ====================

  // Get stage history for a CRM project
  app.get("/api/crm/projects/:id/stage-history", isAuthenticated, async (req: any, res) => {
    try {
      const history = await storage.getCrmProjectStageHistory(req.params.id);
      res.json(history);
    } catch (error) {
      console.error("Error fetching CRM project stage history:", error);
      res.status(500).json({ message: "Failed to fetch stage history" });
    }
  });

  // ==================== CRM Project Notes ====================

  // Get notes for a CRM project
  app.get("/api/crm/projects/:id/notes", isAuthenticated, async (req: any, res) => {
    try {
      const notes = await storage.getCrmProjectNotes(req.params.id);
      res.json(notes);
    } catch (error) {
      console.error("Error fetching CRM project notes:", error);
      res.status(500).json({ message: "Failed to fetch notes" });
    }
  });

  // Create a note for a CRM project
  app.post("/api/crm/projects/:id/notes", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const createSchema = z.object({
        content: z.string().min(1, "Note content is required"),
        mentionedUserIds: z.array(z.string()).optional(),
        audioUrl: z.string().optional(),
        audioRecordingId: z.string().optional(),
        transcriptStatus: z.string().optional(),
        attachments: z.array(z.object({
          url: z.string(),
          filename: z.string(),
          filesize: z.number(),
          filetype: z.string(),
        })).optional(),
      });
      
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      const note = await storage.createCrmProjectNote({
        crmProjectId: req.params.id,
        content: parsed.data.content,
        createdById: userId,
        mentionedUserIds: parsed.data.mentionedUserIds || null,
        audioUrl: parsed.data.audioUrl || null,
        audioRecordingId: parsed.data.audioRecordingId || null,
        transcriptStatus: parsed.data.transcriptStatus || null,
        attachments: parsed.data.attachments ? JSON.stringify(parsed.data.attachments) : null,
      });
      
      // Create notifications for mentioned users (excluding the note author)
      const mentionedUserIds = parsed.data.mentionedUserIds || [];
      for (const mentionedUserId of mentionedUserIds) {
        if (mentionedUserId !== userId) {
          await storage.createNotification({
            userId: mentionedUserId,
            type: "mention",
            noteId: note.id,
            crmProjectId: req.params.id,
            fromUserId: userId,
          });
        }
      }
      
      res.status(201).json(note);
    } catch (error) {
      console.error("Error creating CRM project note:", error);
      res.status(500).json({ message: "Failed to create note" });
    }
  });

  // Update a note
  app.patch("/api/crm/projects/:projectId/notes/:noteId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const updateSchema = z.object({
        content: z.string().min(1, "Note content is required").optional(),
        mentionedUserIds: z.array(z.string()).optional().nullable(),
        attachments: z.array(z.object({
          url: z.string(),
          filename: z.string(),
          filesize: z.number(),
          filetype: z.string(),
        })).optional().nullable(),
      });
      
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      // Get existing note to compare mentions
      const existingNotes = await storage.getCrmProjectNotes(req.params.projectId);
      const existingNote = existingNotes.find(n => n.id === req.params.noteId);
      const oldMentions = existingNote?.mentionedUserIds || [];
      
      const updateData: { content?: string; mentionedUserIds?: string[] | null; attachments?: string | null } = {};
      if (parsed.data.content !== undefined) {
        updateData.content = parsed.data.content;
      }
      if (parsed.data.mentionedUserIds !== undefined) {
        updateData.mentionedUserIds = parsed.data.mentionedUserIds;
      }
      if (parsed.data.attachments !== undefined) {
        updateData.attachments = parsed.data.attachments ? JSON.stringify(parsed.data.attachments) : null;
      }
      const note = await storage.updateCrmProjectNote(req.params.noteId, updateData);
      if (!note) {
        return res.status(404).json({ message: "Note not found" });
      }
      
      // Create notifications only for newly mentioned users
      if (parsed.data.mentionedUserIds) {
        const newMentions = parsed.data.mentionedUserIds.filter(id => !oldMentions.includes(id));
        for (const mentionedUserId of newMentions) {
          if (mentionedUserId !== userId) {
            await storage.createNotification({
              userId: mentionedUserId,
              type: "mention",
              noteId: note.id,
              crmProjectId: req.params.projectId,
              fromUserId: userId,
            });
          }
        }
      }
      
      res.json(note);
    } catch (error) {
      console.error("Error updating CRM project note:", error);
      res.status(500).json({ message: "Failed to update note" });
    }
  });

  // Delete a note
  app.delete("/api/crm/projects/:projectId/notes/:noteId", isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteCrmProjectNote(req.params.noteId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting CRM project note:", error);
      res.status(500).json({ message: "Failed to delete note" });
    }
  });

  // Get all users for assignee dropdown / screenshots filter
  app.get("/api/users", isAuthenticated, async (req: any, res) => {
    try {
      const requestingUserId = getUserId(req)!;
      const requestingUser = await storage.getUser(requestingUserId);
      const includeArchived = requestingUser?.role === "admin" && req.query.includeArchived === "true";
      const users = await storage.getAllUsers({ includeArchived });
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // ==================== Company Document Folders ====================
  
  // List all folders
  app.get("/api/company-document-folders", isAuthenticated, async (req: any, res) => {
    try {
      const folders = await storage.getCompanyDocumentFolders();
      res.json(folders);
    } catch (error) {
      console.error("Error fetching company document folders:", error);
      res.status(500).json({ message: "Failed to fetch folders" });
    }
  });

  // Get single folder
  app.get("/api/company-document-folders/:id", isAuthenticated, async (req: any, res) => {
    try {
      const folder = await storage.getCompanyDocumentFolder(req.params.id);
      if (!folder) {
        return res.status(404).json({ message: "Folder not found" });
      }
      res.json(folder);
    } catch (error) {
      console.error("Error fetching folder:", error);
      res.status(500).json({ message: "Failed to fetch folder" });
    }
  });

  // Create folder
  app.post("/api/company-document-folders", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const createSchema = z.object({
        name: z.string().min(1, "Folder name is required"),
        description: z.string().optional(),
      });
      
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      const folder = await storage.createCompanyDocumentFolder({
        name: parsed.data.name,
        description: parsed.data.description || null,
        createdById: userId,
      });
      
      res.status(201).json(folder);
    } catch (error) {
      console.error("Error creating folder:", error);
      res.status(500).json({ message: "Failed to create folder" });
    }
  });

  // Update folder (rename/update)
  app.patch("/api/company-document-folders/:id", isAuthenticated, async (req: any, res) => {
    try {
      const updateSchema = z.object({
        name: z.string().min(1, "Folder name is required").optional(),
        description: z.string().optional().nullable(),
      });
      
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      const folder = await storage.updateCompanyDocumentFolder(req.params.id, parsed.data);
      if (!folder) {
        return res.status(404).json({ message: "Folder not found" });
      }
      
      res.json(folder);
    } catch (error) {
      console.error("Error updating folder:", error);
      res.status(500).json({ message: "Failed to update folder" });
    }
  });

  // Delete folder
  app.delete("/api/company-document-folders/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const user = await storage.getUser(userId);
      
      // Only admins can delete folders
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Only admins can delete folders" });
      }
      
      const folder = await storage.deleteCompanyDocumentFolder(req.params.id);
      if (!folder) {
        return res.status(404).json({ message: "Folder not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting folder:", error);
      res.status(500).json({ message: "Failed to delete folder" });
    }
  });

  // ==================== Company Documents ====================
  
  // List company documents (optionally by folder)
  app.get("/api/company-documents", isAuthenticated, async (req: any, res) => {
    try {
      const folderId = req.query.folderId as string | undefined;
      const documents = await storage.getCompanyDocuments(folderId);
      res.json(documents);
    } catch (error) {
      console.error("Error fetching company documents:", error);
      res.status(500).json({ message: "Failed to fetch company documents" });
    }
  });
  
  // Search company documents and folders
  app.get("/api/company-documents/search", isAuthenticated, async (req: any, res) => {
    try {
      const query = req.query.q as string;
      if (!query || query.trim().length === 0) {
        return res.json({ documents: [], folders: [] });
      }
      const documents = await storage.searchCompanyDocuments(query);
      const folders = await storage.searchCompanyDocumentFolders(query);
      res.json({ documents, folders });
    } catch (error) {
      console.error("Error searching company documents:", error);
      res.status(500).json({ message: "Failed to search documents" });
    }
  });

  // Get upload URL for company document
  app.post("/api/company-documents/upload-url", isAuthenticated, async (req: any, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ message: "Failed to get upload URL" });
    }
  });

  // Get single company document
  app.get("/api/company-documents/:id", isAuthenticated, async (req: any, res) => {
    try {
      const document = await storage.getCompanyDocument(req.params.id);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      res.json(document);
    } catch (error) {
      console.error("Error fetching company document:", error);
      res.status(500).json({ message: "Failed to fetch document" });
    }
  });

  // Create company document record after upload (or create a text document)
  app.post("/api/company-documents", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      
      const createSchema = z.object({
        name: z.string().min(1, "Name is required"),
        description: z.string().optional(),
        content: z.any().optional(),
        fileName: z.string().optional(),
        fileSize: z.number().optional(),
        mimeType: z.string().optional(),
        storagePath: z.string().optional(),
        folderId: z.string().optional(),
      });
      
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      // If it's an uploaded file, set ACL policy
      if (parsed.data.storagePath) {
        const objectStorageService = new ObjectStorageService();
        await objectStorageService.trySetObjectEntityAclPolicy(
          parsed.data.storagePath,
          {
            owner: userId,
            visibility: "private",
          }
        );
      }
      
      const document = await storage.createCompanyDocument({
        name: parsed.data.name,
        description: parsed.data.description || null,
        content: parsed.data.content || null,
        fileName: parsed.data.fileName || null,
        fileSize: parsed.data.fileSize || null,
        mimeType: parsed.data.mimeType || null,
        storagePath: parsed.data.storagePath || null,
        folderId: parsed.data.folderId || null,
        uploadedById: userId,
      });
      
      // Generate embeddings asynchronously (don't block response)
      const generateEmbeddingsAsync = async () => {
        try {
          const folder = parsed.data.folderId 
            ? await storage.getCompanyDocumentFolder(parsed.data.folderId)
            : null;
          const folderName = folder?.name || "Root";
          
          let textContent: string | null = null;
          
          // For text documents with TipTap content
          if (parsed.data.content) {
            textContent = JSON.stringify(parsed.data.content);
          }
          // For uploaded files, extract text content
          else if (parsed.data.storagePath && parsed.data.mimeType && parsed.data.fileName) {
            if (isSupportedForExtraction(parsed.data.mimeType, parsed.data.fileName)) {
              console.log(`[Embeddings] Extracting text from uploaded file: ${parsed.data.fileName}`);
              const extraction = await extractTextFromFile(
                parsed.data.storagePath,
                parsed.data.mimeType,
                parsed.data.fileName
              );
              
              if (extraction.success && extraction.text) {
                textContent = extraction.text;
                console.log(`[Embeddings] Extracted ${textContent.length} characters from ${parsed.data.fileName}`);
              } else if (extraction.error) {
                console.log(`[Embeddings] Extraction warning for ${parsed.data.fileName}: ${extraction.error}`);
              }
            } else if (isVideoFile(parsed.data.mimeType, parsed.data.fileName)) {
              console.log(`[Embeddings] Video file detected: ${parsed.data.fileName} - transcript extraction not yet implemented for direct uploads`);
            } else {
              console.log(`[Embeddings] Unsupported file type for extraction: ${parsed.data.mimeType}`);
            }
          }
          
          // Generate embeddings if we have content
          if (textContent) {
            await updateCompanyDocumentEmbeddings(
              document.id,
              parsed.data.folderId || null,
              parsed.data.name,
              { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: textContent }] }] },
              folderName,
              parsed.data.mimeType
            );
            console.log(`[Embeddings] Successfully generated embeddings for document: ${document.id}`);
          }
        } catch (embeddingError) {
          console.error("Failed to generate company document embeddings:", embeddingError);
        }
      };
      
      // Run async without blocking
      generateEmbeddingsAsync();
      
      res.status(201).json(document);
    } catch (error) {
      console.error("Error creating company document:", error);
      res.status(500).json({ message: "Failed to create company document" });
    }
  });

  // Update company document
  app.patch("/api/company-documents/:id", isAuthenticated, async (req: any, res) => {
    try {
      const updateSchema = z.object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        content: z.any().optional(),
      });
      
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      const document = await storage.updateCompanyDocument(req.params.id, parsed.data);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      // Update embeddings when content changes
      if (parsed.data.content || parsed.data.name) {
        try {
          const folder = document.folderId 
            ? await storage.getCompanyDocumentFolder(document.folderId)
            : null;
          await updateCompanyDocumentEmbeddings(
            document.id,
            document.folderId || null,
            document.name,
            document.content,
            folder?.name || "Root",
            document.mimeType || undefined
          );
        } catch (embeddingError) {
          console.error("Failed to update company document embeddings:", embeddingError);
        }
      }
      
      res.json(document);
    } catch (error) {
      console.error("Error updating company document:", error);
      res.status(500).json({ message: "Failed to update document" });
    }
  });

  // Stream company document (for inline viewing)
  app.get("/api/company-documents/:id/stream", isAuthenticated, async (req: any, res) => {
    try {
      const document = await storage.getCompanyDocument(req.params.id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      if (!document.storagePath || !document.fileName || !document.mimeType) {
        return res.status(400).json({ message: "This document is not a streamable file" });
      }
      
      const objectStorageService = new ObjectStorageService();
      
      try {
        const normalizedPath = objectStorageService.normalizeObjectEntityPath(document.storagePath);
        const objectFile = await objectStorageService.getObjectEntityFile(normalizedPath);
        
        // Set content disposition for inline viewing (not download)
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.fileName)}"`);
        res.setHeader('Content-Type', document.mimeType);
        
        objectStorageService.downloadObject(objectFile, res);
      } catch (error) {
        if (error instanceof ObjectNotFoundError) {
          return res.status(404).json({ message: "File not found in storage" });
        }
        throw error;
      }
    } catch (error) {
      console.error("Error streaming company document:", error);
      res.status(500).json({ message: "Failed to stream document" });
    }
  });

  // Convert Word document to HTML for preview
  app.get("/api/company-documents/:id/word-html", isAuthenticated, async (req: any, res) => {
    try {
      const document = await storage.getCompanyDocument(req.params.id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      if (!document.storagePath || !document.fileName || !document.mimeType) {
        return res.status(400).json({ message: "This document is not a file" });
      }
      
      // Check if it's a Word document
      const isWordDoc = document.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                        document.mimeType === 'application/msword' ||
                        document.fileName?.endsWith('.docx') ||
                        document.fileName?.endsWith('.doc');
      
      if (!isWordDoc) {
        return res.status(400).json({ message: "Not a Word document" });
      }
      
      const objectStorageService = new ObjectStorageService();
      
      try {
        const normalizedPath = objectStorageService.normalizeObjectEntityPath(document.storagePath);
        const objectFile = await objectStorageService.getObjectEntityFile(normalizedPath);
        
        // Download file to buffer
        const chunks: Buffer[] = [];
        const stream = objectFile.createReadStream();
        
        for await (const chunk of stream) {
          chunks.push(Buffer.from(chunk));
        }
        
        const buffer = Buffer.concat(chunks);
        
        // Convert to HTML using mammoth
        const result = await mammoth.convertToHtml({ buffer });
        
        res.json({ 
          html: result.value,
          messages: result.messages 
        });
      } catch (error) {
        if (error instanceof ObjectNotFoundError) {
          return res.status(404).json({ message: "File not found in storage" });
        }
        throw error;
      }
    } catch (error) {
      console.error("Error converting Word document:", error);
      res.status(500).json({ message: "Failed to convert document" });
    }
  });

  // Download company document
  app.get("/api/company-documents/:id/download", isAuthenticated, async (req: any, res) => {
    try {
      const document = await storage.getCompanyDocument(req.params.id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      // Only uploaded files (not text documents) have storage paths
      if (!document.storagePath || !document.fileName || !document.mimeType) {
        return res.status(400).json({ message: "This document is not a downloadable file" });
      }
      
      const objectStorageService = new ObjectStorageService();
      
      try {
        // Normalize the storage path (converts full GCS URL to /objects/ path)
        const normalizedPath = objectStorageService.normalizeObjectEntityPath(document.storagePath);
        const objectFile = await objectStorageService.getObjectEntityFile(normalizedPath);
        
        // Set content disposition for download with original filename
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(document.fileName)}"`);
        res.setHeader('Content-Type', document.mimeType);
        
        objectStorageService.downloadObject(objectFile, res);
      } catch (error) {
        if (error instanceof ObjectNotFoundError) {
          return res.status(404).json({ message: "File not found in storage" });
        }
        throw error;
      }
    } catch (error) {
      console.error("Error downloading company document:", error);
      res.status(500).json({ message: "Failed to download document" });
    }
  });

  // Delete company document
  app.delete("/api/company-documents/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const user = await storage.getUser(userId);
      
      // Only admins can delete company documents
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Only admins can delete company documents" });
      }
      
      const document = await storage.getCompanyDocument(req.params.id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      // Delete embeddings first
      try {
        await deleteCompanyDocumentEmbeddings(req.params.id);
      } catch (embeddingError) {
        console.error("Failed to delete company document embeddings:", embeddingError);
      }
      
      // Note: File remains in object storage but database record is deleted
      // Object storage files can be cleaned up separately if needed
      await storage.deleteCompanyDocument(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting company document:", error);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  // ==================== Teams ====================
  
  // Get all teams for current user
  app.get("/api/teams", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const userTeams = await storage.getTeams(userId);
      res.json(userTeams);
    } catch (error) {
      console.error("Error fetching teams:", error);
      res.status(500).json({ message: "Failed to fetch teams" });
    }
  });

  // Get single team
  app.get("/api/teams/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const team = await storage.getTeam(req.params.id);
      
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      
      // Check if user is a member
      const isMember = await storage.isTeamMember(team.id, userId);
      if (!isMember && team.ownerId !== userId) {
        return res.status(403).json({ message: "Not authorized to view this team" });
      }
      
      res.json(team);
    } catch (error) {
      console.error("Error fetching team:", error);
      res.status(500).json({ message: "Failed to fetch team" });
    }
  });

  // Create team
  app.post("/api/teams", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      
      const createSchema = z.object({
        name: z.string().min(1, "Name is required"),
        description: z.string().optional(),
      });
      
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      const team = await storage.createTeam({
        ...parsed.data,
        ownerId: userId,
      });
      
      res.status(201).json(team);
    } catch (error) {
      console.error("Error creating team:", error);
      res.status(500).json({ message: "Failed to create team" });
    }
  });

  // Update team
  app.patch("/api/teams/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const team = await storage.getTeam(req.params.id);
      
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      
      // Only owner can update team
      if (team.ownerId !== userId) {
        return res.status(403).json({ message: "Only team owner can update the team" });
      }
      
      const updateSchema = z.object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
      });
      
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      const updated = await storage.updateTeam(req.params.id, parsed.data);
      res.json(updated);
    } catch (error) {
      console.error("Error updating team:", error);
      res.status(500).json({ message: "Failed to update team" });
    }
  });

  // Delete team
  app.delete("/api/teams/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const team = await storage.getTeam(req.params.id);
      
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      
      // Only owner can delete team
      if (team.ownerId !== userId) {
        return res.status(403).json({ message: "Only team owner can delete the team" });
      }
      
      await storage.deleteTeam(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting team:", error);
      res.status(500).json({ message: "Failed to delete team" });
    }
  });

  // Get team members
  app.get("/api/teams/:id/members", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const team = await storage.getTeam(req.params.id);
      
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      
      // Check if user is a member
      const isMember = await storage.isTeamMember(team.id, userId);
      if (!isMember && team.ownerId !== userId) {
        return res.status(403).json({ message: "Not authorized to view team members" });
      }
      
      const members = await storage.getTeamMembers(req.params.id);
      res.json(members);
    } catch (error) {
      console.error("Error fetching team members:", error);
      res.status(500).json({ message: "Failed to fetch team members" });
    }
  });

  // Remove team member
  app.delete("/api/teams/:teamId/members/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = getUserId(req)!;
      const { teamId, userId: targetUserId } = req.params;
      
      const team = await storage.getTeam(teamId);
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      
      // Only owner or the member themselves can remove
      const isOwner = team.ownerId === currentUserId;
      const isSelf = currentUserId === targetUserId;
      
      if (!isOwner && !isSelf) {
        return res.status(403).json({ message: "Not authorized to remove this member" });
      }
      
      // Owner cannot remove themselves
      if (team.ownerId === targetUserId) {
        return res.status(400).json({ message: "Team owner cannot be removed" });
      }
      
      await storage.removeTeamMember(teamId, targetUserId);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing team member:", error);
      res.status(500).json({ message: "Failed to remove team member" });
    }
  });

  // Update member role
  app.patch("/api/teams/:teamId/members/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = getUserId(req)!;
      const { teamId, userId: targetUserId } = req.params;
      
      const team = await storage.getTeam(teamId);
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      
      // Only owner can change roles
      if (team.ownerId !== currentUserId) {
        return res.status(403).json({ message: "Only team owner can change member roles" });
      }
      
      const updateSchema = z.object({
        role: z.enum(["admin", "member"]),
      });
      
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid role" });
      }
      
      const updated = await storage.updateTeamMemberRole(teamId, targetUserId, parsed.data.role);
      res.json(updated);
    } catch (error) {
      console.error("Error updating member role:", error);
      res.status(500).json({ message: "Failed to update member role" });
    }
  });

  // ==================== Team Invites ====================
  
  // Get team invites
  app.get("/api/teams/:id/invites", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const team = await storage.getTeam(req.params.id);
      
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      
      // Only owner or admin can view invites
      if (team.ownerId !== userId) {
        const member = team.members?.find(m => m.userId === userId);
        if (!member || member.role === "member") {
          return res.status(403).json({ message: "Not authorized to view invites" });
        }
      }
      
      const invites = await storage.getTeamInvites(req.params.id);
      res.json(invites);
    } catch (error) {
      console.error("Error fetching team invites:", error);
      res.status(500).json({ message: "Failed to fetch invites" });
    }
  });

  // Create invite link
  app.post("/api/teams/:id/invites", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const team = await storage.getTeam(req.params.id);
      
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      
      // Only owner or admin can create invites
      if (team.ownerId !== userId) {
        const member = team.members?.find(m => m.userId === userId);
        if (!member || member.role === "member") {
          return res.status(403).json({ message: "Not authorized to create invites" });
        }
      }
      
      const createSchema = z.object({
        expiresAt: z.string().datetime().optional(),
        maxUses: z.number().positive().optional(),
      });
      
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      
      // Generate unique invite code
      const code = randomBytes(16).toString("hex");
      
      const invite = await storage.createTeamInvite({
        teamId: req.params.id,
        code,
        createdById: userId,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
        maxUses: parsed.data.maxUses || null,
        isActive: "true",
      });
      
      res.status(201).json(invite);
    } catch (error) {
      console.error("Error creating invite:", error);
      res.status(500).json({ message: "Failed to create invite" });
    }
  });

  // Deactivate invite
  app.delete("/api/teams/:teamId/invites/:inviteId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const team = await storage.getTeam(req.params.teamId);
      
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      
      // Only owner can deactivate invites
      if (team.ownerId !== userId) {
        return res.status(403).json({ message: "Only team owner can deactivate invites" });
      }
      
      await storage.deactivateTeamInvite(req.params.inviteId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deactivating invite:", error);
      res.status(500).json({ message: "Failed to deactivate invite" });
    }
  });

  // Get invite info by code (public endpoint for invite link preview)
  // Returns minimal information to prevent enumeration attacks
  app.get("/api/invite/:code", async (req, res) => {
    try {
      const invite = await storage.getTeamInviteByCode(req.params.code);
      
      // Use generic error message to prevent enumeration
      const invalidMessage = "This invitation is no longer valid";
      
      if (!invite || invite.isActive !== "true") {
        return res.status(404).json({ message: invalidMessage });
      }
      
      if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
        return res.status(404).json({ message: invalidMessage });
      }
      
      if (invite.maxUses && invite.useCount >= invite.maxUses) {
        return res.status(404).json({ message: invalidMessage });
      }
      
      // Return only team name for minimal information exposure
      res.json({
        teamName: invite.team?.name || "Unknown Team",
      });
    } catch (error) {
      console.error("Error fetching invite:", error);
      res.status(500).json({ message: "Failed to fetch invite" });
    }
  });

  // Join team via invite code
  app.post("/api/invite/:code/join", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const result = await storage.useTeamInvite(req.params.code, userId);
      
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }
      
      res.json({ message: "Successfully joined team", team: result.team });
    } catch (error) {
      console.error("Error joining team:", error);
      res.status(500).json({ message: "Failed to join team" });
    }
  });

  // ==================== Admin Routes ====================
  const isAdmin = async (req: any, res: any, next: any) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUser(userId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };

  // Org settings — screenshot policy + timezone allow-list
  app.get("/api/admin/org-settings", isAuthenticated, isAdmin, async (_req, res) => {
    try {
      const [screenshotPolicy, allowedTimezones, helpCenterScreenshots] = await Promise.all([
        storage.getScreenshotPolicy(),
        storage.getAllowedTimezones(),
        storage.getHelpCenterScreenshots(),
      ]);
      res.json({ screenshotPolicy, allowedTimezones, helpCenterScreenshots });
    } catch (error) {
      console.error("Error fetching org settings:", error);
      res.status(500).json({ message: "Failed to fetch org settings" });
    }
  });

  app.patch("/api/admin/org-settings", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { screenshotPolicy, allowedTimezones, helpCenterScreenshots } = req.body;
      const ops: Promise<void>[] = [];
      if (screenshotPolicy && typeof screenshotPolicy === "object") {
        const p = screenshotPolicy;
        // ── Screenshot interval validation ──────────────────────────────────
        if (typeof p.captureIntervalMinMin === "number") {
          if (p.captureIntervalMinMin < 3)
            return res.status(400).json({ message: "Minimum capture interval must be at least 3 minutes (1 minute is not allowed)" });
          if (p.captureIntervalMaxMin !== undefined && p.captureIntervalMaxMin > 15)
            return res.status(400).json({ message: "Maximum capture interval cannot exceed 15 minutes" });
          if (p.captureIntervalMaxMin !== undefined && p.captureIntervalMinMin > p.captureIntervalMaxMin)
            return res.status(400).json({ message: "Min capture interval cannot exceed max" });
        }
        // ── Idle policy validation ───────────────────────────────────────────
        if (typeof p.idleTimeoutMinutes === "number") {
          if (p.idleTimeoutMinutes < 1 || p.idleTimeoutMinutes > 60)
            return res.status(400).json({ message: "Idle timeout must be between 1 and 60 minutes" });
        }
        if (typeof p.idleCountdownSeconds === "number") {
          if (p.idleCountdownSeconds < 15 || p.idleCountdownSeconds > 120)
            return res.status(400).json({ message: "Idle countdown must be between 15 and 120 seconds" });
        }
        ops.push(storage.upsertScreenshotPolicy(screenshotPolicy));
      }
      if (Array.isArray(allowedTimezones)) {
        // Each entry must be a non-empty string (IANA tz validation happens client-side)
        const valid = allowedTimezones.every((t) => typeof t === "string" && t.length > 0);
        if (!valid) return res.status(400).json({ message: "allowedTimezones must be an array of non-empty strings" });
        ops.push(storage.upsertAllowedTimezones(allowedTimezones));
      }
      if (helpCenterScreenshots && typeof helpCenterScreenshots === "object" && !Array.isArray(helpCenterScreenshots)) {
        const partial: Record<string, string | null> = {};
        const pathOk = (p: string) => /^\/public-objects\/[a-zA-Z0-9_\/.-]+$/.test(p);
        for (const [k, v] of Object.entries(helpCenterScreenshots as Record<string, unknown>)) {
          if (!isHelpScreenshotSlotId(k)) {
            return res.status(400).json({ message: `Invalid help screenshot slot: ${k}` });
          }
          if (v === null) {
            partial[k] = null;
          } else if (typeof v === "string" && pathOk(v)) {
            partial[k] = v;
          } else {
            return res.status(400).json({ message: `Invalid public object path for slot ${k}` });
          }
        }
        if (Object.keys(partial).length === 0) {
          return res.status(400).json({ message: "helpCenterScreenshots must contain at least one slot" });
        }
        ops.push(storage.mergeHelpCenterScreenshots(partial));
      }
      if (ops.length === 0) return res.status(400).json({ message: "Nothing to update" });
      await Promise.all(ops);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error updating org settings:", error);
      res.status(500).json({ message: "Failed to update org settings" });
    }
  });

  // Public (any authenticated user) — Screencasts page reads this to populate timezone dropdown
  app.get("/api/screencasts/timezones", isAuthenticated, async (_req, res) => {
    try {
      const allowedTimezones = await storage.getAllowedTimezones();
      res.json({ allowedTimezones });
    } catch (error) {
      console.error("Error fetching timezone options:", error);
      res.status(500).json({ message: "Failed to fetch timezone options" });
    }
  });

  /** Help Center article images — allowlisted slot ids → `/public-objects/…` path or null. */
  app.get("/api/help-center/screenshot-map", isAuthenticated, async (_req, res) => {
    try {
      const stored = await storage.getHelpCenterScreenshots();
      const out: Record<string, string | null> = {};
      for (const id of HELP_SCREENSHOT_SLOT_IDS) {
        const v = stored[id];
        out[id] = typeof v === "string" && v.length > 0 ? v : null;
      }
      res.json(out);
    } catch (error) {
      console.error("Error fetching help screenshot map:", error);
      res.status(500).json({ message: "Failed to fetch help screenshots" });
    }
  });

  // Get all users (admin only)
  app.get("/api/admin/users", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Get single user details (admin only) - includes password info for admin viewing
  app.get("/api/admin/users/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const user = await storage.getAdminUserDetails(req.params.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Block non-SuperAdmins from viewing SuperAdmin details
      const requesterId = getUserId(req);
      const requester = await storage.getUser(requesterId!);
      if (user.isMainAdmin && !requester?.isMainAdmin) {
        return res.status(403).json({ message: "Cannot view SuperAdmin details" });
      }
      
      // Return user without the hashed password but with the last generated password
      const { password, ...userWithoutHash } = user;
      res.json(userWithoutHash);
    } catch (error) {
      console.error("Error fetching user details:", error);
      res.status(500).json({ message: "Failed to fetch user details" });
    }
  });

  // Update user role (admin only)
  app.patch("/api/admin/users/:id/role", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      // Check if target user is SuperAdmin
      const targetUser = await storage.getUser(req.params.id);
      if (targetUser?.isMainAdmin && targetUser.id !== getUserId(req)) {
        return res.status(403).json({ message: "Cannot modify the SuperAdmin" });
      }
      
      const roleSchema = z.object({
        role: z.enum(["user", "admin"]),
      });
      
      const parsed = roleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid role", errors: parsed.error.errors });
      }
      
      const user = await storage.updateUserRole(req.params.id, parsed.data.role);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(user);
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });

  // Create new user (admin only)
  app.post("/api/admin/users", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const createUserSchema = z.object({
        email: z.string().email(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        role: z.enum(["user", "admin"]).default("user"),
      });
      
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid user data", errors: parsed.error.errors });
      }
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(parsed.data.email);
      if (existingUser) {
        return res.status(409).json({ message: "User with this email already exists" });
      }
      
      // Generate random password
      const generatedPassword = randomBytes(8).toString('hex');
      const hashedPassword = await hashPassword(generatedPassword);
      
      // Create user with generated password stored for admin viewing
      const newUser = await storage.createUser({
        email: parsed.data.email,
        password: hashedPassword,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        lastGeneratedPassword: generatedPassword,
      });
      
      // Update role if not default
      if (parsed.data.role !== "user") {
        await storage.updateUserRole(newUser.id, parsed.data.role);
      }
      
      // Get app URL for email
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || 'localhost:5000';
      const appUrl = `${protocol}://${host}`;
      
      // Send welcome email
      const emailResult = await sendWelcomeEmail(
        parsed.data.email,
        parsed.data.firstName,
        generatedPassword,
        appUrl
      );
      
      res.status(201).json({ 
        user: { ...newUser, password: undefined },
        generatedPassword,
        emailSent: emailResult.success,
        emailError: emailResult.error
      });
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Update user info (admin only)
  // Archive / unarchive a user (soft delete — data is preserved)
  app.patch("/api/admin/users/:id/archive", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const targetUser = await storage.getUser(req.params.id);
      if (!targetUser) return res.status(404).json({ message: "User not found" });
      if (targetUser.isMainAdmin) return res.status(403).json({ message: "Cannot archive the SuperAdmin" });
      if (targetUser.id === getUserId(req)) return res.status(400).json({ message: "Cannot archive yourself" });

      const { isArchived } = z.object({ isArchived: z.boolean() }).parse(req.body);
      const updated = await storage.archiveUser(req.params.id, isArchived);
      res.json(updated);
    } catch (error) {
      console.error("Error archiving user:", error);
      res.status(500).json({ message: "Failed to archive user" });
    }
  });

  app.patch("/api/admin/users/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      // Check if target user is SuperAdmin
      const targetUser = await storage.getUser(req.params.id);
      if (targetUser?.isMainAdmin && targetUser.id !== getUserId(req)) {
        return res.status(403).json({ message: "Cannot modify the SuperAdmin" });
      }

      const updateUserSchema = z.object({
        email: z.string().email().optional(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        hoursPerDay: z.number().min(1).max(24).optional(),
      });
      
      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid user data", errors: parsed.error.errors });
      }
      
      // If email is being changed, check it's not taken
      if (parsed.data.email) {
        const existingUser = await storage.getUserByEmail(parsed.data.email);
        if (existingUser && existingUser.id !== req.params.id) {
          return res.status(409).json({ message: "Email is already in use" });
        }
      }
      
      const user = await storage.updateUser(req.params.id, parsed.data);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(user);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Reset user password (admin only)
  app.post("/api/admin/users/:id/reset-password", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const user = await storage.getUserWithPassword(req.params.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Check if target user is SuperAdmin
      if (user.isMainAdmin && user.id !== getUserId(req)) {
        return res.status(403).json({ message: "Cannot modify the SuperAdmin" });
      }
      
      // Generate new random password
      const newPassword = randomBytes(8).toString('hex');
      const hashedPassword = await hashPassword(newPassword);
      
      // Update password and store the generated password for admin viewing
      await storage.updateUserPassword(req.params.id, hashedPassword, newPassword);
      
      // Get app URL for email
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || 'localhost:5000';
      const appUrl = `${protocol}://${host}`;
      
      // Send password update email
      const emailResult = await sendPasswordUpdateEmail(
        user.email,
        user.firstName || 'User',
        newPassword,
        appUrl
      );
      
      res.json({ 
        success: true, 
        newPassword,
        emailSent: emailResult.success,
        emailError: emailResult.error
      });
    } catch (error) {
      console.error("Error resetting password:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Delete user (admin only)
  app.delete("/api/admin/users/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const userId = req.params.id;
      
      // Don't allow deleting yourself
      if (userId === getUserId(req)) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Don't allow deleting the SuperAdmin
      if (user.isMainAdmin) {
        return res.status(403).json({ message: "Cannot delete the SuperAdmin" });
      }
      
      await storage.deleteUser(userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // ==================== Public Module Fields (for frontend consumption) ====================
  
  // Get module fields by slug (public endpoint for authenticated users)
  app.get("/api/modules/:slug/fields", isAuthenticated, async (req: any, res) => {
    try {
      const modules = await storage.getCrmModules();
      const mod = modules.find(m => m.slug === req.params.slug);
      if (!mod) {
        return res.status(404).json({ message: "Module not found" });
      }
      res.json(mod.fields || []);
    } catch (error) {
      console.error("Error fetching module fields:", error);
      res.status(500).json({ message: "Failed to fetch module fields" });
    }
  });

  // ==================== Admin Modules & Fields ====================

  // Get all CRM modules with their fields
  app.get("/api/admin/modules", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const modules = await storage.getCrmModules();
      res.json(modules);
    } catch (error) {
      console.error("Error fetching modules:", error);
      res.status(500).json({ message: "Failed to fetch modules" });
    }
  });

  // Get a single module with fields
  app.get("/api/admin/modules/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const mod = await storage.getCrmModule(req.params.id);
      if (!mod) {
        return res.status(404).json({ message: "Module not found" });
      }
      res.json(mod);
    } catch (error) {
      console.error("Error fetching module:", error);
      res.status(500).json({ message: "Failed to fetch module" });
    }
  });

  // Create a new module
  const createModuleSchema = z.object({
    name: z.string().min(1, "Name is required"),
    slug: z.string().min(1, "Slug is required"),
    description: z.string().optional(),
    icon: z.string().optional(),
    isEnabled: z.number().optional(),
    displayOrder: z.number().optional(),
  });

  app.post("/api/admin/modules", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const parsed = createModuleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      
      const newModule = await storage.createCrmModule({
        ...parsed.data,
        isSystem: 0,
      });
      res.status(201).json(newModule);
    } catch (error) {
      console.error("Error creating module:", error);
      res.status(500).json({ message: "Failed to create module" });
    }
  });

  // Update a module
  app.patch("/api/admin/modules/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const mod = await storage.getCrmModule(req.params.id);
      if (!mod) {
        return res.status(404).json({ message: "Module not found" });
      }
      
      const updated = await storage.updateCrmModule(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating module:", error);
      res.status(500).json({ message: "Failed to update module" });
    }
  });

  // Delete a module
  app.delete("/api/admin/modules/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const mod = await storage.getCrmModule(req.params.id);
      if (!mod) {
        return res.status(404).json({ message: "Module not found" });
      }
      
      if (mod.isSystem === 1) {
        return res.status(403).json({ message: "Cannot delete system module" });
      }
      
      await storage.deleteCrmModule(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting module:", error);
      res.status(500).json({ message: "Failed to delete module" });
    }
  });

  // Get fields for a module
  app.get("/api/admin/modules/:moduleId/fields", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const fields = await storage.getCrmModuleFields(req.params.moduleId);
      res.json(fields);
    } catch (error) {
      console.error("Error fetching fields:", error);
      res.status(500).json({ message: "Failed to fetch fields" });
    }
  });

  // Create a field for a module
  const createFieldSchema = z.object({
    name: z.string().min(1, "Name is required"),
    slug: z.string().min(1, "Slug is required"),
    fieldType: z.string().default("text"),
    description: z.string().optional(),
    placeholder: z.string().optional(),
    defaultValue: z.string().optional(),
    options: z.array(z.string()).optional(),
    isRequired: z.number().optional(),
    isEnabled: z.number().optional(),
    displayOrder: z.number().optional(),
  });

  app.post("/api/admin/modules/:moduleId/fields", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const parsed = createFieldSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      
      const newField = await storage.createCrmModuleField({
        ...parsed.data,
        moduleId: req.params.moduleId,
        isSystem: 0,
      });
      res.status(201).json(newField);
    } catch (error) {
      console.error("Error creating field:", error);
      res.status(500).json({ message: "Failed to create field" });
    }
  });

  // Update a field
  app.patch("/api/admin/fields/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const field = await storage.getCrmModuleField(req.params.id);
      if (!field) {
        return res.status(404).json({ message: "Field not found" });
      }
      
      // Get the module to check if it's projects or contacts
      const module = await storage.getCrmModule(field.moduleId);
      
      // Helper to extract label from option (handles both JSON format and plain strings)
      const getOptionLabel = (opt: string): string => {
        try {
          const parsed = JSON.parse(opt);
          return parsed.label || opt;
        } catch {
          return opt;
        }
      };
      
      // Helper to convert label to slug (same logic as frontend)
      const labelToSlug = (label: string): string => {
        return label.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
      };
      
      // Check if options are being updated for select/multiselect fields
      const oldOptions = field.options || [];
      const newOptions = req.body.options || [];
      
      console.log("[Field Update] Field slug:", field.slug, "isSystem:", field.isSystem, "module:", module?.slug);
      console.log("[Field Update] Old options count:", oldOptions.length, "New options count:", newOptions.length);
      
      if (newOptions.length > 0 && oldOptions.length > 0 && 
          (field.fieldType === "select" || field.fieldType === "multiselect")) {
        // Create a mapping of old slugs to new slugs by position
        // This handles the case where a user renames an option in place
        const optionRenames: { oldSlug: string; newSlug: string }[] = [];
        
        for (let i = 0; i < Math.min(oldOptions.length, newOptions.length); i++) {
          const oldLabel = getOptionLabel(oldOptions[i]);
          const newLabel = getOptionLabel(newOptions[i]);
          const oldSlug = labelToSlug(oldLabel);
          const newSlug = labelToSlug(newLabel);
          
          console.log(`[Field Update] Position ${i}: oldLabel="${oldLabel}" -> newLabel="${newLabel}", oldSlug="${oldSlug}" -> newSlug="${newSlug}"`);
          
          if (oldSlug !== newSlug) {
            optionRenames.push({ oldSlug, newSlug });
            console.log(`[Field Update] Detected rename: "${oldSlug}" -> "${newSlug}"`);
          }
        }
        
        console.log("[Field Update] Total renames to process:", optionRenames.length);
        
        // Update field values based on where they're stored
        for (const rename of optionRenames) {
          console.log(`[Field Update] Processing rename: "${rename.oldSlug}" -> "${rename.newSlug}"`);
          
          // For system fields in the projects module, update the crmProjects table directly
          if (module?.slug === "projects" && field.isSystem === 1) {
            if (field.slug === "status") {
              console.log(`[Field Update] Updating crmProjects.status: "${rename.oldSlug}" -> "${rename.newSlug}"`);
              await storage.updateCrmProjectsColumnOnOptionRename("status", rename.oldSlug, rename.newSlug);
            } else if (field.slug === "project_type") {
              console.log(`[Field Update] Updating crmProjects.projectType: "${rename.oldSlug}" -> "${rename.newSlug}"`);
              await storage.updateCrmProjectsColumnOnOptionRename("projectType", rename.oldSlug, rename.newSlug);
            }
          }
          
          // For system fields in the contacts module, update the crmClients table directly
          if (module?.slug === "contacts" && field.isSystem === 1) {
            if (field.slug === "status") {
              console.log(`[Field Update] Updating crmClients.status: "${rename.oldSlug}" -> "${rename.newSlug}"`);
              await storage.updateCrmClientsColumnOnOptionRename("status", rename.oldSlug, rename.newSlug);
            }
          }
          
          // Also update crmCustomFieldValues for custom fields
          await storage.updateCrmFieldValuesOnOptionRename(
            req.params.id,
            rename.oldSlug,
            rename.newSlug
          );
        }
      }
      
      const updated = await storage.updateCrmModuleField(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating field:", error);
      res.status(500).json({ message: "Failed to update field" });
    }
  });

  // Delete a field
  app.delete("/api/admin/fields/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const field = await storage.getCrmModuleField(req.params.id);
      if (!field) {
        return res.status(404).json({ message: "Field not found" });
      }
      
      if (field.isSystem === 1) {
        return res.status(403).json({ message: "Cannot delete system field" });
      }
      
      await storage.deleteCrmModuleField(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting field:", error);
      res.status(500).json({ message: "Failed to delete field" });
    }
  });

  // ─── Admin: Analytics ───

  const parseDateRange = (query: any): { start: Date; end: Date } => {
    const end = query.end ? new Date(query.end as string) : new Date();
    const start = query.start
      ? new Date(query.start as string)
      : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { start, end };
  };

  app.get("/api/admin/analytics/overview", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { start, end } = parseDateRange(req.query);
      const data = await storage.getAdminOverview({ startDate: start, endDate: end });
      res.json(data);
    } catch (error) {
      console.error("Error fetching admin overview:", error);
      res.status(500).json({ message: "Failed to fetch overview" });
    }
  });

  app.get("/api/admin/analytics/productivity", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { start, end } = parseDateRange(req.query);
      const data = await storage.getAdminProductivity({
        startDate: start,
        endDate: end,
        userId: (req.query.userId as string) || undefined,
        crmProjectId: (req.query.crmProjectId as string) || undefined,
      });
      res.json(data);
    } catch (error) {
      console.error("Error fetching admin productivity:", error);
      res.status(500).json({ message: "Failed to fetch productivity data" });
    }
  });

  app.get("/api/admin/analytics/activity", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { start, end } = parseDateRange(req.query);
      const data = await storage.getAdminActivityStats({
        startDate: start,
        endDate: end,
        userId: (req.query.userId as string) || undefined,
      });
      res.json(data);
    } catch (error) {
      console.error("Error fetching admin activity:", error);
      res.status(500).json({ message: "Failed to fetch activity data" });
    }
  });

  app.get("/api/admin/analytics/screenshots", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { start, end } = parseDateRange(req.query);
      const data = await storage.getAdminScreenshotStats({
        startDate: start,
        endDate: end,
        userId: (req.query.userId as string) || undefined,
      });
      res.json(data);
    } catch (error) {
      console.error("Error fetching admin screenshots:", error);
      res.status(500).json({ message: "Failed to fetch screenshots data" });
    }
  });

  app.get("/api/admin/analytics/alerts", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { start, end } = parseDateRange(req.query);
      const data = await storage.getAdminAlerts({ startDate: start, endDate: end });
      res.json(data);
    } catch (error) {
      console.error("Error fetching admin alerts:", error);
      res.status(500).json({ message: "Failed to fetch alerts" });
    }
  });

  // Data quality report — evidence completeness flags, never redefines tracked time
  app.get("/api/admin/analytics/data-quality", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { start, end } = parseDateRange(req.query);
      const data = await storage.getDataQualityReport({
        startDate: start,
        endDate: end,
        userId: (req.query.userId as string) || undefined,
      });
      res.json(data);
    } catch (error) {
      console.error("Error fetching data quality report:", error);
      res.status(500).json({ message: "Failed to fetch data quality report" });
    }
  });

  // Screenshot coverage report — evidence completeness vs tracked time
  // Coverage is purely observational. Tracked time is never modified by this endpoint.
  app.get("/api/admin/analytics/coverage", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { start, end } = parseDateRange(req.query);
      const data = await storage.getScreenshotCoverageReport({
        startDate: start,
        endDate: end,
        userId: (req.query.userId as string) || undefined,
        crmProjectId: (req.query.crmProjectId as string) || undefined,
      });
      res.json(data);
    } catch (error) {
      console.error("Error fetching coverage report:", error);
      res.status(500).json({ message: "Failed to fetch coverage report" });
    }
  });

  // Evidence quality score — per-user composite score (0–100).
  // NEVER modifies or replaces tracked time; purely observational.
  app.get("/api/admin/analytics/evidence-quality", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { start, end } = parseDateRange(req.query);
      const data = await storage.getEvidenceQualityReport({
        startDate: start,
        endDate: end,
        userId: (req.query.userId as string) || undefined,
      });
      res.json(data);
    } catch (error) {
      console.error("Error fetching evidence quality report:", error);
      res.status(500).json({ message: "Failed to fetch evidence quality report" });
    }
  });

  app.get("/api/admin/analytics/devices", isAuthenticated, isAdmin, async (_req, res) => {
    try {
      const data = await storage.getAdminAllDevices();
      res.json(data);
    } catch (error) {
      console.error("Error fetching admin devices:", error);
      res.status(500).json({ message: "Failed to fetch devices" });
    }
  });

  app.get("/api/admin/analytics/export", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { start, end } = parseDateRange(req.query);
      const entries = await storage.getTimeEntries({
        startDate: start,
        endDate: end,
        userId: (req.query.userId as string) || undefined,
        crmProjectId: (req.query.crmProjectId as string) || undefined,
        status: "stopped",
      });

      // Batch-fetch task names
      const taskIdsSet = new Set(entries.map(e => e.taskId).filter(Boolean) as string[]);
      const tasksMap = new Map<string, string>();
      for (const tid of taskIdsSet) {
        const task = await storage.getTask(tid);
        if (task) tasksMap.set(tid, task.name);
      }

      const escape = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
      const rows = [
        ["Date", "User", "Project", "Task", "Description", "Duration (h)", "Idle (h)"].join(","),
        ...entries.map(e => [
          new Date(e.startTime).toISOString().slice(0, 10),
          escape(e.user ? (`${e.user.firstName || ""} ${e.user.lastName || ""}`.trim() || e.user.email) : ""),
          escape(e.crmProject?.project?.name || ""),
          escape((e.taskId && tasksMap.get(e.taskId)) || ""),
          escape(e.description || ""),
          (e.duration ? (e.duration / 3600).toFixed(2) : "0.00"),
          (e.idleTime ? (e.idleTime / 3600).toFixed(2) : "0.00"),
        ].join(","))
      ];

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="docuflow-export-${start.toISOString().slice(0, 10)}.csv"`);
      res.send(rows.join("\n"));
    } catch (error) {
      console.error("Error exporting:", error);
      res.status(500).json({ message: "Failed to export" });
    }
  });

  // ==================== Notifications ====================
  
  app.get("/api/notifications", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const notifications = await storage.getUserNotifications(userId);
      res.json(notifications);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.get("/api/notifications/unread-count", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const count = await storage.getUnreadNotificationCount(userId);
      res.json({ count });
    } catch (error) {
      console.error("Error fetching unread count:", error);
      res.status(500).json({ message: "Failed to fetch unread count" });
    }
  });

  app.patch("/api/notifications/:id/read", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      await storage.markNotificationRead(req.params.id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking notification read:", error);
      res.status(500).json({ message: "Failed to mark notification read" });
    }
  });

  app.patch("/api/notifications/mark-all-read", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      await storage.markAllNotificationsRead(userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking all notifications read:", error);
      res.status(500).json({ message: "Failed to mark all notifications read" });
    }
  });

  // ========== TASKS ROUTES ==========

  app.get("/api/tasks", isAuthenticated, async (req: any, res) => {
    if (!isTasksEnabled()) return res.json({ data: [] });
    try {
      const { crmProjectId, includeArchived } = req.query;
      if (!crmProjectId) return res.status(400).json({ message: "crmProjectId is required" });
      const taskList = await storage.getTasks({
        crmProjectId: crmProjectId as string,
        includeArchived: includeArchived === "true",
      });
      res.json({ data: taskList });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.post("/api/tasks", isAuthenticated, async (req: any, res) => {
    if (!isTasksEnabled()) return res.status(503).json({ message: "Tasks feature not available yet — migration pending" });
    try {
      const userId = getUserId(req)!;
      const { crmProjectId, name, description } = req.body;
      if (!crmProjectId || !name?.trim()) {
        return res.status(400).json({ message: "crmProjectId and name are required" });
      }
      // Enforce unique task name within the same project (excluding archived)
      const existingTasks = await storage.getTasks({ crmProjectId });
      const taskNameConflict = existingTasks.some(
        (t) => t.name.trim().toLowerCase() === name.trim().toLowerCase()
      );
      if (taskNameConflict) {
        return res.status(409).json({ message: `A task named "${name}" already exists in this project` });
      }

      const task = await storage.createTask({
        crmProjectId,
        name: name.trim(),
        description: description?.trim() || null,
        status: "open",
      });
      logInfo("task.created", { taskId: task.id, crmProjectId, userId });
      res.json(task);
    } catch (error) {
      res.status(500).json({ message: "Failed to create task" });
    }
  });

  app.patch("/api/tasks/:id", isAuthenticated, async (req: any, res) => {
    if (!isTasksEnabled()) return res.status(503).json({ message: "Tasks feature not available yet — migration pending" });
    try {
      const task = await storage.getTask(req.params.id);
      if (!task) return res.status(404).json({ message: "Task not found" });
      const { name, description, status } = req.body;
      const updated = await storage.updateTask(req.params.id, {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(status !== undefined && { status }),
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  app.delete("/api/tasks/:id", isAuthenticated, async (req: any, res) => {
    if (!isTasksEnabled()) return res.status(503).json({ message: "Tasks feature not available yet — migration pending" });
    try {
      const task = await storage.getTask(req.params.id);
      if (!task) return res.status(404).json({ message: "Task not found" });
      await storage.deleteTask(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete task" });
    }
  });

  // ========== PROJECT MEMBERS ROUTES (self-managed) ==========

  app.get("/api/crm/projects/:id/members", isAuthenticated, async (req: any, res) => {
    try {
      const crmProject = await storage.getCrmProject(req.params.id);
      if (!crmProject) return res.status(404).json({ message: "Project not found" });
      const members = await storage.getProjectMembers(req.params.id);
      res.json(members);
    } catch (error) {
      console.error("Error fetching project members:", error);
      res.status(500).json({ message: "Failed to fetch project members" });
    }
  });

  // Add member: owner/admin can add any user, others add themselves
  app.post("/api/crm/projects/:id/members", isAuthenticated, async (req: any, res) => {
    try {
      const callerId = getUserId(req)!;
      const crmProject = await storage.getCrmProject(req.params.id);
      if (!crmProject) return res.status(404).json({ message: "Project not found" });

      const targetUserId: string = req.body?.userId || callerId;

      // If adding someone other than themselves, caller must be owner or admin
      if (targetUserId !== callerId) {
        const caller = await storage.getUser(callerId);
        const isOwner = crmProject.project?.ownerId === callerId;
        const isAdmin = caller?.role === "admin";
        if (!isOwner && !isAdmin) {
          return res.status(403).json({ message: "Only project owner or admin can add other members" });
        }
      }

      const member = await storage.addProjectMember(req.params.id, targetUserId);
      res.status(201).json(member);
    } catch (error) {
      console.error("Error adding project member:", error);
      res.status(500).json({ message: "Failed to add project member" });
    }
  });

  // Leave: a user can only remove themselves
  app.delete("/api/crm/projects/:id/members/me", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      await storage.removeProjectMember(req.params.id, userId);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error leaving project:", error);
      res.status(500).json({ message: "Failed to leave project" });
    }
  });

  // Remove a specific member: owner/admin can remove anyone, member can remove themselves
  app.delete("/api/crm/projects/:id/members/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const callerId = getUserId(req)!;
      const { id: projectId, userId: targetUserId } = req.params;

      if (targetUserId !== callerId) {
        const crmProject = await storage.getCrmProject(projectId);
        if (!crmProject) return res.status(404).json({ message: "Project not found" });
        const caller = await storage.getUser(callerId);
        const isOwner = crmProject.project?.ownerId === callerId;
        const isAdmin = caller?.role === "admin";
        if (!isOwner && !isAdmin) {
          return res.status(403).json({ message: "Only project owner or admin can remove other members" });
        }
      }

      await storage.removeProjectMember(projectId, targetUserId);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error removing project member:", error);
      res.status(500).json({ message: "Failed to remove project member" });
    }
  });

  // ========== REMINDERS ROUTES (self only) ==========

  app.get("/api/crm/projects/:id/reminders", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const list = await storage.getUserRemindersForProject(userId, req.params.id);
      res.json(list);
    } catch (error) {
      console.error("Error fetching reminders:", error);
      res.status(500).json({ message: "Failed to fetch reminders" });
    }
  });

  app.post("/api/crm/projects/:id/reminders", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const crmProject = await storage.getCrmProject(req.params.id);
      if (!crmProject) return res.status(404).json({ message: "Project not found" });

      // userId and crmProjectId come from the session/route, never the client body.
      const bodySchema = insertReminderSchema.omit({ userId: true, crmProjectId: true }).extend({
        title: z.string().min(1, "Title is required"),
        note: z.string().nullable().optional(),
        dueAt: z.coerce.date({ invalid_type_error: "Invalid due date" }),
        taskId: z.string().nullable().optional(),
        status: z.enum(["upcoming", "due", "done"]).optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }

      // A linked task must belong to this same project.
      if (parsed.data.taskId) {
        const task = await storage.getTask(parsed.data.taskId);
        if (!task || task.crmProjectId !== req.params.id) {
          return res.status(400).json({ message: "Task does not belong to this project" });
        }
      }

      const reminder = await storage.createReminder({
        userId,
        crmProjectId: req.params.id,
        taskId: parsed.data.taskId || null,
        title: parsed.data.title.trim(),
        note: parsed.data.note?.trim() || null,
        dueAt: parsed.data.dueAt,
        status: parsed.data.status || "upcoming",
      });
      res.status(201).json(reminder);
    } catch (error) {
      console.error("Error creating reminder:", error);
      res.status(500).json({ message: "Failed to create reminder" });
    }
  });

  app.patch("/api/reminders/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const reminder = await storage.getReminder(req.params.id);
      if (!reminder) return res.status(404).json({ message: "Reminder not found" });
      if (reminder.userId !== userId) return res.status(403).json({ message: "Not authorized" });

      const { title, note, dueAt, status, taskId } = req.body;
      const updates: any = {};
      if (title !== undefined) updates.title = String(title).trim();
      if (note !== undefined) updates.note = note ? String(note).trim() : null;
      if (taskId !== undefined) {
        if (taskId) {
          // A linked task must belong to this reminder's project.
          const task = await storage.getTask(taskId);
          if (!task || task.crmProjectId !== reminder.crmProjectId) {
            return res.status(400).json({ message: "Task does not belong to this project" });
          }
        }
        updates.taskId = taskId || null;
      }
      if (status !== undefined) {
        const allowed = ["upcoming", "due", "done"];
        if (!allowed.includes(status)) return res.status(400).json({ message: "Invalid status" });
        updates.status = status;
      }
      if (dueAt !== undefined) {
        const d = new Date(dueAt);
        if (isNaN(d.getTime())) return res.status(400).json({ message: "Invalid due date" });
        updates.dueAt = d;
      }

      const updated = await storage.updateReminder(req.params.id, updates);
      res.json(updated);
    } catch (error) {
      console.error("Error updating reminder:", error);
      res.status(500).json({ message: "Failed to update reminder" });
    }
  });

  app.delete("/api/reminders/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const reminder = await storage.getReminder(req.params.id);
      if (!reminder) return res.status(404).json({ message: "Reminder not found" });
      if (reminder.userId !== userId) return res.status(403).json({ message: "Not authorized" });
      await storage.deleteReminder(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting reminder:", error);
      res.status(500).json({ message: "Failed to delete reminder" });
    }
  });

  // ========== TIME TRACKING ROUTES ==========
  
  // Get time entries with filters
  app.get("/api/time-tracking/entries", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const user = await storage.getUser(userId);
      
      // Parse query params
      const filters: {
        userId?: string;
        crmProjectId?: string;
        startDate?: Date;
        endDate?: Date;
        status?: string;
      } = {};
      
      // Non-admins can only see their own entries
      if (user?.role !== "admin") {
        filters.userId = userId;
      } else if (req.query.userId) {
        filters.userId = req.query.userId as string;
      }
      
      if (req.query.crmProjectId) {
        filters.crmProjectId = req.query.crmProjectId as string;
      }
      if (req.query.startDate) {
        filters.startDate = new Date(req.query.startDate as string);
      }
      if (req.query.endDate) {
        filters.endDate = new Date(req.query.endDate as string);
      }
      if (req.query.status) {
        filters.status = req.query.status as string;
      }
      
      const entries = await storage.getTimeEntries(filters);
      res.json({ data: entries });
    } catch (error) {
      console.error("Error fetching time entries:", error);
      res.status(500).json({ message: "Failed to fetch time entries" });
    }
  });
  
  // Get time stats/summary
  app.get("/api/time-tracking/stats", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const user = await storage.getUser(userId);
      
      const filters: {
        userId?: string;
        crmProjectId?: string;
        startDate?: Date;
        endDate?: Date;
      } = {};
      
      // Non-admins can only see their own stats
      if (user?.role !== "admin") {
        filters.userId = userId;
      } else if (req.query.userId) {
        filters.userId = req.query.userId as string;
      }
      
      if (req.query.crmProjectId) {
        filters.crmProjectId = req.query.crmProjectId as string;
      }
      if (req.query.startDate) {
        filters.startDate = new Date(req.query.startDate as string);
      }
      if (req.query.endDate) {
        filters.endDate = new Date(req.query.endDate as string);
      }
      
      const stats = await storage.getTimeStats(filters);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching time stats:", error);
      res.status(500).json({ message: "Failed to fetch time stats" });
    }
  });
  
  // Get active time entry for current user
  app.get("/api/time-tracking/active", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const entry = await storage.getActiveTimeEntry(userId);
      res.json(entry || null);
    } catch (error) {
      console.error("Error fetching active time entry:", error);
      res.status(500).json({ message: "Failed to fetch active time entry" });
    }
  });

  /** Whether the client must supply a task when starting the timer (tasks migration applied). */
  app.get("/api/time-tracking/capabilities", isAuthenticated, async (_req: any, res) => {
    res.json({ requiresTask: isTasksEnabled() });
  });
  
  // Start time tracking
  app.post("/api/time-tracking/start", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const { crmProjectId, description } = req.body;
      // Strip taskId if migration 002 hasn't been applied yet
      const taskId = isTasksEnabled() ? (req.body.taskId || null) : null;
      
      if (!crmProjectId) {
        return res.status(400).json({ message: "Project is required" });
      }

      if (isTasksEnabled()) {
        if (!taskId || typeof taskId !== "string") {
          return res.status(400).json({ message: "taskId is required" });
        }
        const task = await storage.getTask(taskId);
        if (!task || task.crmProjectId !== crmProjectId) {
          return res.status(400).json({ message: "Invalid task for this project" });
        }
        if (task.status === "archived") {
          return res.status(400).json({ message: "Cannot start timer on an archived task" });
        }
      }
      
      // Auto-stop any existing active entry before starting a new one
      const activeEntry = await storage.getActiveTimeEntry(userId);
      if (activeEntry) {
        const now = new Date();
        let finalDuration = activeEntry.duration || 0;
        if (activeEntry.status === "running" && activeEntry.lastActivityAt) {
          const elapsedSeconds = Math.floor((now.getTime() - new Date(activeEntry.lastActivityAt).getTime()) / 1000);
          finalDuration += elapsedSeconds;
        }
        await storage.updateTimeEntry(activeEntry.id, {
          status: "stopped",
          endTime: now,
          duration: finalDuration,
        });
      }
      
      const entry = await storage.createTimeEntry({
        userId,
        crmProjectId,
        taskId: taskId || null,
        description: description || null,
        startTime: new Date(),
        status: "running",
        lastActivityAt: new Date(),
        duration: 0,
        idleTime: 0,
      });

      logTimeEvent("start", entry.id, userId, { crmProjectId, taskId: taskId || null });
      res.json(entry);
    } catch (error) {
      logError("time-tracking.start.failed", error, { userId: getUserId(req) });
      res.status(500).json({ message: "Failed to start time tracking" });
    }
  });
  
  // Pause time tracking
  app.post("/api/time-tracking/:id/pause", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const entry = await storage.getTimeEntry(req.params.id);
      
      if (!entry) {
        return res.status(404).json({ message: "Time entry not found" });
      }
      
      if (entry.userId !== userId) {
        return res.status(403).json({ message: "Not authorized" });
      }
      
      if (entry.status !== "running") {
        return res.status(400).json({ message: "Entry is not running" });
      }
      
      // Calculate elapsed time since last activity
      const now = new Date();
      const lastActivity = entry.lastActivityAt || entry.startTime;
      const elapsedSeconds = Math.floor((now.getTime() - new Date(lastActivity).getTime()) / 1000);
      
      const updated = await storage.updateTimeEntry(entry.id, {
        status: "paused",
        duration: (entry.duration || 0) + elapsedSeconds,
        lastActivityAt: now,
      });
      
      logTimeEvent("pause", entry.id, userId);
      res.json(updated);
    } catch (error) {
      logError("time-tracking.pause.failed", error, { entryId: req.params.id });
      res.status(500).json({ message: "Failed to pause time tracking" });
    }
  });

  // Resume time tracking
  app.post("/api/time-tracking/:id/resume", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const { discardIdleTime } = req.body;
      const entry = await storage.getTimeEntry(req.params.id);
      
      if (!entry) {
        return res.status(404).json({ message: "Time entry not found" });
      }
      
      if (entry.userId !== userId) {
        return res.status(403).json({ message: "Not authorized" });
      }
      
      if (entry.status !== "paused") {
        return res.status(400).json({ message: "Entry is not paused" });
      }
      
      const now = new Date();
      let idleTimeToAdd = 0;
      
      // If not discarding idle time, track it
      if (!discardIdleTime && entry.lastActivityAt) {
        const pauseDuration = Math.floor((now.getTime() - new Date(entry.lastActivityAt).getTime()) / 1000);
        idleTimeToAdd = pauseDuration;
      }
      
      const updated = await storage.updateTimeEntry(entry.id, {
        status: "running",
        idleTime: (entry.idleTime || 0) + idleTimeToAdd,
        lastActivityAt: now,
      });
      
      logTimeEvent("resume", entry.id, userId, { discardIdleTime: !!discardIdleTime });
      res.json(updated);
    } catch (error) {
      logError("time-tracking.resume.failed", error, { entryId: req.params.id });
      res.status(500).json({ message: "Failed to resume time tracking" });
    }
  });

  // Stop time tracking
  app.post("/api/time-tracking/:id/stop", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const entry = await storage.getTimeEntry(req.params.id);
      
      if (!entry) {
        return res.status(404).json({ message: "Time entry not found" });
      }
      
      if (entry.userId !== userId) {
        return res.status(403).json({ message: "Not authorized" });
      }
      
      if (entry.status === "stopped") {
        return res.status(400).json({ message: "Entry is already stopped" });
      }
      
      const now = new Date();
      let finalDuration = entry.duration || 0;
      
      // If was running, add the remaining time
      if (entry.status === "running" && entry.lastActivityAt) {
        const elapsedSeconds = Math.floor((now.getTime() - new Date(entry.lastActivityAt).getTime()) / 1000);
        finalDuration += elapsedSeconds;
      }
      
      const updated = await storage.updateTimeEntry(entry.id, {
        status: "stopped",
        endTime: now,
        duration: finalDuration,
      });

      logTimeEvent("stop", entry.id, userId, { finalDuration });
      res.json(updated);
    } catch (error) {
      logError("time-tracking.stop.failed", error, { entryId: req.params.id });
      res.status(500).json({ message: "Failed to stop time tracking" });
    }
  });

  // Update activity (heartbeat) - for idle detection
  app.post("/api/time-tracking/:id/activity", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const entry = await storage.getTimeEntry(req.params.id);
      
      if (!entry) {
        return res.status(404).json({ message: "Time entry not found" });
      }
      
      if (entry.userId !== userId) {
        return res.status(403).json({ message: "Not authorized" });
      }
      
      if (entry.status !== "running") {
        return res.json(entry); // Just return current state if not running
      }
      
      // Update duration and last activity
      const now = new Date();
      const lastActivity = entry.lastActivityAt || entry.startTime;
      const elapsedSeconds = Math.floor((now.getTime() - new Date(lastActivity).getTime()) / 1000);
      
      const updated = await storage.updateTimeEntry(entry.id, {
        duration: (entry.duration || 0) + elapsedSeconds,
        lastActivityAt: now,
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating activity:", error);
      res.status(500).json({ message: "Failed to update activity" });
    }
  });
  
  // ─── Server-side stale session detection (agent-ready) ───
  // Periodically flag running entries with no heartbeat for > STALE_THRESHOLD_MINUTES.
  // TODO [PLACEHOLDER]: Policy — currently flag_only. Change to auto_pause or auto_stop
  //   when Desktop Agent requirements are finalized.
  const STALE_THRESHOLD_MINUTES = 10;
  const STALE_CHECK_INTERVAL_MS = 2 * 60 * 1000; // check every 2 minutes

  setInterval(async () => {
    try {
      const threshold = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000);
      const staleEntries = await storage.getStaleRunningEntries(threshold);

      for (const entry of staleEntries) {
        // flag_only: log the stale entry but don't auto-stop
        logStaleSession(entry.id, entry.userId, entry.lastActivityAt?.toISOString() ?? null);
        // TODO [PLACEHOLDER]: Uncomment to auto-stop stale entries:
        // const now = new Date();
        // const lastActivity = entry.lastActivityAt || entry.startTime;
        // const elapsed = Math.floor((now.getTime() - new Date(lastActivity).getTime()) / 1000);
        // await storage.updateTimeEntry(entry.id, {
        //   status: "stopped",
        //   endTime: now,
        //   duration: (entry.duration || 0) + elapsed,
        // });
        // console.log(`[StaleSession] Auto-stopped entry ${entry.id}`);
      }
    } catch (error) {
      console.error("[StaleSession] Error checking stale entries:", error);
    }
  }, STALE_CHECK_INTERVAL_MS);

  // ─── Due-reminder dispatcher ───
  // Periodically deliver due reminders via in-app notification + email, exactly once.
  const REMINDER_CHECK_INTERVAL_MS = 60 * 1000; // every minute
  let reminderDispatchRunning = false;

  const getAppBaseUrl = (): string => {
    const domains = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
    if (domains) return `https://${domains}`;
    if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
    return "http://localhost:5000";
  };

  setInterval(async () => {
    if (reminderDispatchRunning) return;
    reminderDispatchRunning = true;
    try {
      // Reminders that are due and not done, with at least one channel still pending.
      // Each channel is marked only after it succeeds, so a transient failure on one
      // channel is retried next run without re-sending the channel that already succeeded.
      const due = await storage.getPendingDueReminders(new Date());
      if (due.length === 0) return;
      const appUrl = getAppBaseUrl();

      for (const reminder of due) {
        try {
          const crmProject = await storage.getCrmProject(reminder.crmProjectId);
          const projectName = crmProject?.project?.name || "your project";

          let inAppDone = reminder.notifiedInApp === 1;
          let emailDone = reminder.emailSent === 1;

          // In-app notification (reuse existing notifications bell) — once only.
          if (!inAppDone) {
            await storage.createNotification({
              userId: reminder.userId,
              type: "reminder",
              crmProjectId: reminder.crmProjectId,
              message: `Reminder: ${reminder.title} (${projectName})`,
            });
            await storage.updateReminder(reminder.id, { notifiedInApp: 1 });
            inAppDone = true;
          }

          // Email notification — once only, and only marked sent when delivery succeeds.
          if (!emailDone) {
            const user = await storage.getUser(reminder.userId);
            if (user?.email) {
              const recipientName = user.firstName || user.email;
              const emailResult = await sendReminderDueEmail(
                user.email,
                recipientName,
                reminder.title,
                reminder.note,
                projectName,
                appUrl,
                reminder.crmProjectId,
              );
              if (emailResult?.success) {
                await storage.updateReminder(reminder.id, { emailSent: 1 });
                emailDone = true;
              } else {
                console.error("[ReminderDispatcher] Email failed, will retry", reminder.id, emailResult?.error);
              }
            } else {
              // No email address to send to — nothing to retry.
              await storage.updateReminder(reminder.id, { emailSent: 1 });
              emailDone = true;
            }
          }

          // Flag overall notified + due status only once both channels are complete.
          if (inAppDone && emailDone && reminder.notified === 0) {
            await storage.updateReminder(reminder.id, { notified: 1, status: "due" });
          }
        } catch (innerErr) {
          console.error("[ReminderDispatcher] Failed to dispatch reminder", reminder.id, innerErr);
        }
      }
    } catch (error) {
      console.error("[ReminderDispatcher] Error checking due reminders:", error);
    } finally {
      reminderDispatchRunning = false;
    }
  }, REMINDER_CHECK_INTERVAL_MS);

  // Update time entry (description, etc.)
  app.patch("/api/time-tracking/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const entry = await storage.getTimeEntry(req.params.id);
      
      if (!entry) {
        return res.status(404).json({ message: "Time entry not found" });
      }
      
      if (entry.userId !== userId) {
        return res.status(403).json({ message: "Not authorized" });
      }
      
      const { description } = req.body;
      
      const updated = await storage.updateTimeEntry(entry.id, {
        description: description !== undefined ? description : entry.description,
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating time entry:", error);
      res.status(500).json({ message: "Failed to update time entry" });
    }
  });
  
  // Delete time entry
  app.delete("/api/time-tracking/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const user = await storage.getUser(userId);
      const entry = await storage.getTimeEntry(req.params.id);
      
      if (!entry) {
        return res.status(404).json({ message: "Time entry not found" });
      }
      
      // Only owner or admin can delete
      if (entry.userId !== userId && user?.role !== "admin") {
        return res.status(403).json({ message: "Not authorized" });
      }
      
      await storage.deleteTimeEntry(entry.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting time entry:", error);
      res.status(500).json({ message: "Failed to delete time entry" });
    }
  });
  
  // Get time entries for a specific CRM project (for project page)
  app.get("/api/time-tracking/project/:crmProjectId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const user = await storage.getUser(userId);
      
      const filters: {
        crmProjectId: string;
        userId?: string;
      } = {
        crmProjectId: req.params.crmProjectId,
      };
      
      // Non-admins can only see their own entries
      if (user?.role !== "admin") {
        filters.userId = userId;
      }
      
      const entries = await storage.getTimeEntries(filters);
      res.json({ data: entries });
    } catch (error) {
      console.error("Error fetching project time entries:", error);
      res.status(500).json({ message: "Failed to fetch project time entries" });
    }
  });

  // Time Tracking Screenshots
  app.post("/api/time-tracking/screenshots/upload-url", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const { timeEntryId } = req.body;

      if (!timeEntryId) {
        return res.status(400).json({ message: "timeEntryId is required" });
      }

      const entry = await storage.getTimeEntry(timeEntryId);
      if (!entry) {
        return res.status(404).json({ message: "Time entry not found" });
      }
      if (entry.userId !== userId) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting screenshot upload URL:", error);
      res.status(500).json({ message: "Failed to get upload URL" });
    }
  });

  app.post("/api/time-tracking/screenshots", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const { timeEntryId, crmProjectId, storageKey, capturedAt } = req.body;

      if (!timeEntryId || !crmProjectId || !storageKey) {
        return res.status(400).json({ message: "timeEntryId, crmProjectId, and storageKey are required" });
      }

      const entry = await storage.getTimeEntry(timeEntryId);
      if (!entry) {
        return res.status(404).json({ message: "Time entry not found" });
      }
      if (entry.userId !== userId) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const objectStorageService = new ObjectStorageService();
      let normalizedPath: string;
      try {
        normalizedPath = objectStorageService.normalizeObjectEntityPath(storageKey);
      } catch {
        return res.status(400).json({ message: "Invalid storageKey" });
      }

      const screenshot = await storage.createTimeEntryScreenshot({
        timeEntryId,
        userId,
        crmProjectId,
        storageKey: normalizedPath,
        capturedAt: capturedAt ? new Date(capturedAt) : new Date(),
      });

      res.json(screenshot);
    } catch (error) {
      console.error("Error saving screenshot:", error);
      res.status(500).json({ message: "Failed to save screenshot" });
    }
  });

  app.get("/api/time-tracking/screenshots", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const user = await storage.getUser(userId);

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const filters: {
        timeEntryId?: string;
        userId?: string;
        crmProjectId?: string;
        startDate?: Date;
        endDate?: Date;
        limit: number;
        offset: number;
      } = { limit, offset };

      if (req.query.timeEntryId) filters.timeEntryId = req.query.timeEntryId;
      if (req.query.crmProjectId) filters.crmProjectId = req.query.crmProjectId;
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);

      if (user?.role !== "admin") {
        filters.userId = userId;
      } else if (req.query.userId) {
        filters.userId = req.query.userId;
      }

      const { data, total } = await storage.getTimeEntryScreenshots(filters);

      // Enrich each screenshot with its time entry's duration/idleTime for activity filtering
      const uniqueEntryIds = [...new Set(data.map((s) => s.timeEntryId))];
      const entryRows = await storage.getTimeEntriesByIds(uniqueEntryIds);
      const entryMap: Record<string, { duration: number; idleTime: number }> = {};
      for (const e of entryRows) entryMap[e.id] = { duration: e.duration, idleTime: e.idleTime };

      const enriched = data.map((s) => ({
        ...s,
        entryDuration: entryMap[s.timeEntryId]?.duration ?? null,
        entryIdleTime: entryMap[s.timeEntryId]?.idleTime ?? null,
      }));

      res.json({ data: enriched, total, limit, offset });
    } catch (error) {
      console.error("Error fetching screenshots:", error);
      res.status(500).json({ message: "Failed to fetch screenshots" });
    }
  });

  app.get("/api/time-tracking/screenshots/:id/image", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const user = await storage.getUser(userId);

      const screenshot = await storage.getTimeEntryScreenshotById(req.params.id);

      if (!screenshot) {
        return res.status(404).json({ message: "Screenshot not found" });
      }

      if (user?.role !== "admin" && screenshot.userId !== userId) {
        return res.status(403).json({ message: "Not authorized" });
      }

      // Tombstoned screenshots — evidence has been removed by an admin
      if (screenshot.deletedAt !== null) {
        return res.status(410).json({ message: "Screenshot has been removed", deletedAt: screenshot.deletedAt });
      }

      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(screenshot.storageKey);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error serving screenshot:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ message: "Screenshot file not found" });
      }
      res.status(500).json({ message: "Failed to serve screenshot" });
    }
  });

  // Admin: soft-delete (tombstone) a screenshot
  // DELETE /api/time-tracking/screenshots/:id
  // Body: { reason?: string }
  app.delete("/api/time-tracking/screenshots/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const user = await storage.getUser(userId);
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin only" });
      }

      const { reason } = req.body ?? {};
      const tombstone = await storage.softDeleteTimeEntryScreenshot(
        req.params.id,
        userId,
        typeof reason === "string" ? reason.slice(0, 500) : undefined,
      );

      if (!tombstone) {
        // Either not found or already tombstoned
        const existing = await storage.getTimeEntryScreenshotById(req.params.id);
        if (!existing) return res.status(404).json({ message: "Screenshot not found" });
        return res.status(409).json({ message: "Screenshot already deleted", deletedAt: existing.deletedAt });
      }

      return res.json({
        id: tombstone.id,
        deletedAt: tombstone.deletedAt,
        deletedBy: tombstone.deletedBy,
        deleteReason: tombstone.deleteReason,
      });
    } catch (error) {
      console.error("Error soft-deleting screenshot:", error);
      res.status(500).json({ message: "Failed to delete screenshot" });
    }
  });

  return httpServer;
}
