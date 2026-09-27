/**
 * Knowledge routes added with #278: Manage access on a Workspace Document,
 * File, or Folder, and Files added to a Project.
 */

import type { Express, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { crmProjects, files, projectMembers } from "@shared/schema";
import { ACCESS_LEVELS, type AccessLevel } from "@shared/documentAccess";
import { isAuthenticated, getUserId } from "../../auth";
import { db } from "../../db";
import { storage } from "../../storage";
import { ObjectNotFoundError, ObjectStorageService } from "../../objectStorage";
import { canManageAdministration } from "../../workspaceRole";
import { inWorkspace } from "../../workspaceContext";
import {
  AccessChangeError,
  accessViewer,
  canSeeDocument,
  canSeeFolder,
  changeAccess,
  documentAccessState,
  folderAccessState,
  loadAccessGraph,
  type AccessState,
} from "./documentAccess";
import { createKnowledgeObjectStorage } from "./objectStorage";

const accessChangeSchema = z.object({
  level: z.enum(ACCESS_LEVELS as [AccessLevel, ...AccessLevel[]]),
  memberIds: z.array(z.string().min(1)).max(500).default([]),
});

const projectFileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  fileName: z.string().min(1),
  fileSize: z.number().optional(),
  mimeType: z.string().optional(),
  storagePath: z.string().min(1),
});

async function readDocumentAccess(userId: string, id: string): Promise<AccessState | null> {
  const document = await storage.getCompanyDocument(id);
  if (!document) return null;
  const [viewer, graph] = await Promise.all([accessViewer(userId), loadAccessGraph()]);
  if (!canSeeDocument(graph, viewer, document)) return null;
  return documentAccessState(graph, viewer, document);
}

async function readFolderAccess(userId: string, id: string): Promise<AccessState | null> {
  const [viewer, graph] = await Promise.all([accessViewer(userId), loadAccessGraph()]);
  if (!canSeeFolder(graph, viewer, id)) return null;
  return folderAccessState(graph, viewer, id);
}

async function saveAccess(req: any, res: Response, state: AccessState | null, notFound: string) {
  if (!state) return res.status(404).json({ message: notFound });
  const parsed = accessChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
  }
  try {
    await changeAccess(state, await accessViewer(getUserId(req)!), parsed.data);
  } catch (error) {
    if (error instanceof AccessChangeError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    throw error;
  }
  return null;
}

/**
 * Who may reach a Project's Files: the Owner and Administrators, and Members
 * with a Project Assignment — or the Project Manager when nobody is assigned,
 * as the Project Documentation register already scopes its page.
 */
async function canReachProject(projectId: string, userId: string): Promise<boolean> {
  const project = await storage.getProject(projectId);
  if (!project) return false;
  if (await canManageAdministration()) return true;
  const [row] = await db
    .select({ id: crmProjects.id })
    .from(crmProjects)
    .where(
      and(
        eq(crmProjects.projectId, projectId),
        inWorkspace(crmProjects),
        sql`(
          exists (select 1 from ${projectMembers} where ${projectMembers.crmProjectId} = ${crmProjects.id} and ${projectMembers.userId} = ${userId})
          or (${crmProjects.assigneeId} = ${userId}
              and not exists (select 1 from ${projectMembers} where ${projectMembers.crmProjectId} = ${crmProjects.id}))
        )`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function projectFile(projectId: string, fileId: string) {
  const [file] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.projectId, projectId), inWorkspace(files)));
  return file;
}

export function registerKnowledgeRoutes(app: Express): void {
  app.get("/api/company-documents/:id/access", isAuthenticated, async (req: any, res) => {
    try {
      const state = await readDocumentAccess(getUserId(req)!, req.params.id);
      if (!state) return res.status(404).json({ message: "Document not found" });
      res.json(state);
    } catch (error) {
      console.error("Error reading Document Access:", error);
      res.status(500).json({ message: "Failed to read access" });
    }
  });

  app.put("/api/company-documents/:id/access", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const refused = await saveAccess(req, res, await readDocumentAccess(userId, req.params.id), "Document not found");
      if (refused) return;
      res.json(await readDocumentAccess(userId, req.params.id));
    } catch (error) {
      console.error("Error changing Document Access:", error);
      res.status(500).json({ message: "Failed to change access" });
    }
  });

  app.get("/api/company-document-folders/:id/access", isAuthenticated, async (req: any, res) => {
    try {
      const state = await readFolderAccess(getUserId(req)!, req.params.id);
      if (!state) return res.status(404).json({ message: "Folder not found" });
      res.json(state);
    } catch (error) {
      console.error("Error reading Folder access:", error);
      res.status(500).json({ message: "Failed to read access" });
    }
  });

  app.put("/api/company-document-folders/:id/access", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      const refused = await saveAccess(req, res, await readFolderAccess(userId, req.params.id), "Folder not found");
      if (refused) return;
      res.json(await readFolderAccess(userId, req.params.id));
    } catch (error) {
      console.error("Error changing Folder access:", error);
      res.status(500).json({ message: "Failed to change access" });
    }
  });

  app.get("/api/projects/:projectId/files", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await canReachProject(req.params.projectId, getUserId(req)!))) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(await storage.getProjectFiles([req.params.projectId]));
    } catch (error) {
      console.error("Error listing Project Files:", error);
      res.status(500).json({ message: "Failed to fetch Project Files" });
    }
  });

  // The bytes arrive through POST /api/company-documents/upload-url first, as
  // every other upload does; this lands the File on the Project.
  app.post("/api/projects/:projectId/files", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req)!;
      if (!(await canReachProject(req.params.projectId, userId))) {
        return res.status(404).json({ message: "Project not found" });
      }
      const parsed = projectFileSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }
      const objects = new ObjectStorageService();
      await objects.trySetObjectEntityAclPolicy(parsed.data.storagePath, { owner: userId, visibility: "private" });
      const port = createKnowledgeObjectStorage();
      const file = await port.finalizeUpload({
        objectPath: objects.normalizeObjectEntityPath(parsed.data.storagePath),
        name: parsed.data.name,
        fileName: parsed.data.fileName,
        mimeType: parsed.data.mimeType || "application/octet-stream",
        fileSize: parsed.data.fileSize,
        uploadedById: userId,
        projectId: req.params.projectId,
      });
      const scanned = await port.scan(file.id);
      res.status(201).json(scanned);
    } catch (error) {
      console.error("Error adding a Project File:", error);
      res.status(500).json({ message: "Failed to add File" });
    }
  });

  for (const disposition of ["stream", "download"] as const) {
    app.get(`/api/projects/:projectId/files/:fileId/${disposition}`, isAuthenticated, async (req: any, res) => {
      try {
        if (!(await canReachProject(req.params.projectId, getUserId(req)!))) {
          return res.status(404).json({ message: "File not found" });
        }
        const file = await projectFile(req.params.projectId, req.params.fileId);
        if (!file || file.scanStatus !== "available") {
          return res.status(404).json({ message: "File not found" });
        }
        const objects = new ObjectStorageService();
        const object = await objects.getObjectEntityFile(objects.normalizeObjectEntityPath(file.storagePath));
        const name = encodeURIComponent(file.fileName || file.name);
        res.setHeader(
          "Content-Disposition",
          `${disposition === "stream" ? "inline" : "attachment"}; filename="${name}"`,
        );
        res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
        objects.downloadObject(object, res);
      } catch (error) {
        if (error instanceof ObjectNotFoundError) {
          return res.status(404).json({ message: "File not found in storage" });
        }
        console.error("Error reading a Project File:", error);
        res.status(500).json({ message: "Failed to read File" });
      }
    });
  }
}
