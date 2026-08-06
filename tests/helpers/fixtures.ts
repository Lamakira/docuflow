import type { Agent } from "./auth";

/**
 * Fixture builders that go through the same HTTP contract the SPA uses. Suites
 * assert against endpoints, never against storage internals, so setup runs the
 * same way — a fixture that stops working is itself a contract change.
 */

let sequence = 0;

function nextName(prefix: string): string {
  sequence += 1;
  return `${prefix} ${sequence}`;
}

export interface CrmProjectFixture {
  /** Documentation-side project row. */
  project: { id: string; name: string; ownerId: string };
  /** CRM-side row; `crmProject.id` is what the CRM routes take as `:id`. */
  crmProject: { id: string; projectId: string; status: string };
}

export async function createCrmProject(
  agent: Agent,
  body: Record<string, unknown> = {}
): Promise<CrmProjectFixture> {
  const res = await agent
    .post("/api/crm/projects")
    .send({ name: nextName("Project"), ...body });
  if (res.status !== 201) {
    throw new Error(`createCrmProject failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function createClient(
  agent: Agent,
  body: Record<string, unknown> = {}
): Promise<{ id: string; name: string; status: string }> {
  const res = await agent.post("/api/crm/clients").send({ name: nextName("Client"), ...body });
  if (res.status !== 201) {
    throw new Error(`createClient failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function createTask(
  agent: Agent,
  crmProjectId: string,
  name = nextName("Task")
): Promise<{ id: string; name: string; status: string }> {
  const res = await agent.post("/api/tasks").send({ crmProjectId, name });
  if (res.status !== 200) {
    throw new Error(`createTask failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function createDocument(
  agent: Agent,
  projectId: string,
  body: Record<string, unknown> = {}
): Promise<{ id: string; title: string; parentId: string | null; position: number }> {
  const res = await agent
    .post(`/api/projects/${projectId}/documents`)
    .send({ title: nextName("Page"), ...body });
  if (res.status !== 201) {
    throw new Error(`createDocument failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function createFolder(
  agent: Agent,
  body: Record<string, unknown> = {}
): Promise<{ id: string; name: string }> {
  const res = await agent
    .post("/api/company-document-folders")
    .send({ name: nextName("Folder"), ...body });
  if (res.status !== 201) {
    throw new Error(`createFolder failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/** A minimal TipTap document — the shape the editor posts as `content`. */
export function tiptap(...paragraphs: string[]): unknown {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
}

/** Start the timer, creating the task the current contract requires. */
export async function startTimer(
  agent: Agent,
  crmProjectId: string,
  taskId: string,
  description?: string
): Promise<{ id: string; status: string; duration: number; idleTime: number }> {
  const res = await agent
    .post("/api/time-tracking/start")
    .send({ crmProjectId, taskId, description });
  if (res.status !== 200) {
    throw new Error(`startTimer failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}
