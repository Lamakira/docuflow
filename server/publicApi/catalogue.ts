import type { RequestHandler, Response, Router } from "express";
import { z } from "zod";
import {
  CLIENTS_READ_CAPABILITY_ID,
  CLIENTS_WRITE_CAPABILITY_ID,
  PROJECTS_READ_CAPABILITY_ID,
  TIME_ENTRIES_READ_CAPABILITY_ID,
  type CrmClient,
  type CrmProjectWithDetails,
  type TimeEntry,
} from "@shared/schema";
import { workspaceOwnerUserId } from "../modules/workspace";
import { storage } from "../storage";
import { requireCapability } from "./capabilities";
import { cursorPage, decodeCursor, rfc3339Utc } from "./cursor";
import { sendProblem, BAD_REQUEST, NOT_FOUND } from "./problem";
import { requestIdOf } from "./trace";
import type { PublicApiRequest } from "./types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const CRM_PROJECT_PAGE = 500;

const createClientBody = z.object({
  name: z.string().min(1),
  company: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  status: z.string().nullish(),
});

function requestId(req: PublicApiRequest): string {
  return req.publicApiRequestId ?? requestIdOf(req);
}

function run(fn: (req: PublicApiRequest, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req as PublicApiRequest, res).catch(next);
  };
}

function queryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function pageLimit(raw: unknown): number | "bad" {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return "bad";
  return Math.min(n, MAX_LIMIT);
}

function afterCursor<T extends { id: string }>(
  rows: T[],
  cursor: string | undefined
): T[] | "bad" {
  if (!cursor) return rows;
  const decoded = decodeCursor(cursor);
  const id = decoded && typeof decoded.id === "string" ? decoded.id : null;
  if (!id) return "bad";
  const idx = rows.findIndex((row) => row.id === id);
  if (idx === -1) return [];
  return rows.slice(idx + 1);
}

function sendList<T extends { id: string }, U extends { id: string }>(
  req: PublicApiRequest,
  res: Response,
  rows: T[],
  present: (row: T) => U
): void {
  const limit = pageLimit(req.query.limit);
  if (limit === "bad") {
    sendProblem(res, BAD_REQUEST, requestId(req));
    return;
  }
  const remaining = afterCursor(rows, queryString(req.query.cursor));
  if (remaining === "bad") {
    sendProblem(res, BAD_REQUEST, requestId(req));
    return;
  }
  res.json(cursorPage(remaining.slice(0, limit + 1).map(present), limit));
}

async function listCrmProjects(): Promise<CrmProjectWithDetails[]> {
  const out: CrmProjectWithDetails[] = [];
  let page = 1;
  for (;;) {
    const { data, total } = await storage.getCrmProjects("", {
      page,
      pageSize: CRM_PROJECT_PAGE,
    });
    out.push(...data);
    if (out.length >= Number(total) || data.length === 0) break;
    page += 1;
  }
  return out;
}

function publicClient(row: CrmClient) {
  return {
    id: row.id,
    name: row.name,
    company: row.company ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    status: row.status,
    createdAt: row.createdAt ? rfc3339Utc(row.createdAt) : null,
    updatedAt: row.updatedAt ? rfc3339Utc(row.updatedAt) : null,
  };
}

function publicProject(row: CrmProjectWithDetails) {
  return {
    id: row.id,
    name: row.project?.name ?? "",
    clientId: row.clientId ?? null,
    status: row.projectStatus,
    createdAt: row.createdAt ? rfc3339Utc(row.createdAt) : null,
    updatedAt: row.updatedAt ? rfc3339Utc(row.updatedAt) : null,
  };
}

function publicTimeEntry(row: TimeEntry) {
  return {
    id: row.id,
    projectId: row.crmProjectId,
    taskId: row.taskId ?? null,
    userId: row.userId,
    description: row.description ?? null,
    startTime: rfc3339Utc(row.startTime),
    endTime: row.endTime ? rfc3339Utc(row.endTime) : null,
    status: row.status,
    duration: row.duration ?? 0,
  };
}

/**
 * First public resource catalogue (#127). Thin adapter over Phase 6 Clients,
 * Projects, and Time module interfaces. Capability-gated. Cursor-only lists.
 */
export function registerPublicApiV1Catalogue(router: Router): void {
  router.get(
    "/clients",
    requireCapability(CLIENTS_READ_CAPABILITY_ID),
    run(async (req, res) => {
      sendList(req, res, await storage.getCrmClients(""), publicClient);
    })
  );

  router.post(
    "/clients",
    requireCapability(CLIENTS_WRITE_CAPABILITY_ID),
    run(async (req, res) => {
      const parsed = createClientBody.safeParse(req.body);
      if (!parsed.success) {
        sendProblem(res, BAD_REQUEST, requestId(req));
        return;
      }
      const client = await storage.createCrmClient({
        name: parsed.data.name,
        company: parsed.data.company ?? undefined,
        email: parsed.data.email ?? undefined,
        phone: parsed.data.phone ?? undefined,
        status: parsed.data.status ?? undefined,
        ownerId: await workspaceOwnerUserId(),
      });
      res.status(201).json(publicClient(client));
    })
  );

  router.get(
    "/clients/:id",
    requireCapability(CLIENTS_READ_CAPABILITY_ID),
    run(async (req, res) => {
      const client = await storage.getCrmClient(req.params.id);
      if (!client) {
        sendProblem(res, NOT_FOUND, requestId(req));
        return;
      }
      res.json(publicClient(client));
    })
  );

  router.get(
    "/projects",
    requireCapability(PROJECTS_READ_CAPABILITY_ID),
    run(async (req, res) => {
      sendList(req, res, await listCrmProjects(), publicProject);
    })
  );

  router.get(
    "/projects/:id",
    requireCapability(PROJECTS_READ_CAPABILITY_ID),
    run(async (req, res) => {
      const project = await storage.getCrmProject(req.params.id);
      if (!project || project.isDocumentationOnly) {
        sendProblem(res, NOT_FOUND, requestId(req));
        return;
      }
      res.json(publicProject(project));
    })
  );

  router.get(
    "/time-entries",
    requireCapability(TIME_ENTRIES_READ_CAPABILITY_ID),
    run(async (req, res) => {
      sendList(req, res, await storage.getTimeEntries({}), publicTimeEntry);
    })
  );

  router.get(
    "/time-entries/:id",
    requireCapability(TIME_ENTRIES_READ_CAPABILITY_ID),
    run(async (req, res) => {
      const entry = await storage.getTimeEntry(req.params.id);
      if (!entry) {
        sendProblem(res, NOT_FOUND, requestId(req));
        return;
      }
      res.json(publicTimeEntry(entry));
    })
  );
}
