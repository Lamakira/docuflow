import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  PARALLEL_WORKSPACE_ID,
  SEEDED_WORKSPACE_ID,
  companyDocuments,
  memberships,
} from "../../shared/schema";
import { db } from "../../server/db";
import { runWithWorkspaceContext, stampWorkspace } from "../../server/workspaceContext";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { newAgent, registerUser, type TestUser } from "../helpers/auth";
import { loginDevice, PNG_1X1 } from "../helpers/agent";
import { createCrmProject, createDocument, createTask, startTimer, tiptap } from "../helpers/fixtures";
import { completeUpload, objectPathFor } from "../helpers/objects";
import {
  addWorkspaceMembership,
  createSeededMember,
  inSeededWorkspace,
  removeAllMemberships,
} from "../helpers/workspace";
import { objectMetadata, putObject } from "../fakes/gcs";
import { chatCalls } from "../fakes/openai";

/**
 * #297: two Workspaces, A (seeded) and B (Harbour View). A Member of A reads
 * nothing of B's through the register, search, Ask (prompt and citations), or
 * Files (download routes and object key). Query scoping carries this on its
 * own: the test database connects as its owner, so row-level security is off.
 */

const SECRET = "zebra quantum ledger";

async function memberOfB(app: Awaited<ReturnType<typeof makeApp>>): Promise<TestUser> {
  const user = await registerUser(app, { firstName: "Bea" });
  await removeAllMemberships(user.id);
  await addWorkspaceMembership(user.id, PARALLEL_WORKSPACE_ID, "member");
  return user;
}

async function workspaceB(app: Awaited<ReturnType<typeof makeApp>>) {
  const b = await memberOfB(app);
  const { project } = await createCrmProject(b.agent, { name: "Zebra account" });
  const page = await createDocument(b.agent, project.id, {
    title: "Zebra runbook",
    content: tiptap(`Their ${SECRET} runbook`),
  });
  const policy = await b.agent
    .post("/api/company-documents")
    .send({ name: "Zebra policy", content: tiptap(`Their ${SECRET} policy`) });
  expect(policy.status).toBe(201);

  const issued = await b.agent.post("/api/company-documents/upload-url");
  const storagePath = completeUpload(issued.body.uploadURL, "zebra invoice bytes", "application/pdf");
  const file = await b.agent.post("/api/company-documents").send({
    name: "Zebra invoice",
    fileName: "zebra.pdf",
    mimeType: "application/pdf",
    storagePath,
  });
  expect(file.status).toBe(201);

  const rebuilt = await b.agent.post("/api/embeddings/rebuild");
  expect(rebuilt.status).toBe(200);
  return { b, project, page, policy: policy.body, file: file.body, storagePath };
}

describe("Workspace isolation (#297)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("keeps Workspace B out of A's register and search", async () => {
    const app = await makeApp();
    const a = await registerUser(app);
    await createCrmProject(a.agent, { name: "Our account" });
    const theirs = await workspaceB(app);

    for (const path of [
      "/api/projects",
      "/api/crm/projects",
      "/api/company-documents",
      "/api/search?q=Zebra",
      "/api/company-documents/search?q=Zebra",
    ]) {
      const res = await a.agent.get(path);
      expect(res.status, path).toBe(200);
      expect(JSON.stringify(res.body), path).not.toMatch(/zebra/i);
    }

    expect((await a.agent.get(`/api/projects/${theirs.project.id}`)).status).toBe(404);
    expect((await a.agent.get(`/api/documents/${theirs.page.id}`)).status).toBe(404);
    expect((await a.agent.get(`/api/company-documents/${theirs.policy.id}`)).status).toBe(404);
  });

  it("keeps Workspace B out of A's Ask prompt and citations", async () => {
    const app = await makeApp();
    const a = await registerUser(app);
    const { project } = await createCrmProject(a.agent, { name: "Our account" });
    await createDocument(a.agent, project.id, {
      title: "Our runbook",
      content: tiptap("Our quantum ledger runbook"),
    });
    await a.agent.post("/api/embeddings/rebuild");
    const theirs = await workspaceB(app);

    const res = await a.agent.post("/api/chat").send({ message: SECRET, mode: "both" });
    expect(res.status).toBe(200);
    expect(res.body.usedFallback).toBe(false);

    const prompt = chatCalls().at(-1)!.messages[0].content;
    expect(prompt).toContain("Our runbook");
    expect(prompt).not.toMatch(/zebra/i);
    const cited = (res.body.citations as Array<{ id: string; title: string }>).map((c) => c.id);
    expect(cited).not.toContain(theirs.page.id);
    expect(cited).not.toContain(theirs.policy.id);
    expect(cited).not.toContain(theirs.file.id);
  });

  it("does not retrieve B's chunks in A even when handed B's Project ids", async () => {
    const app = await makeApp();
    await registerUser(app);
    const theirs = await workspaceB(app);
    const { hasEmbeddings, searchSimilarChunks } = await import("../../server/embeddings");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");

    const inB = await runWithWorkspaceContext({ workspaceId: PARALLEL_WORKSPACE_ID }, () =>
      searchSimilarChunks([theirs.project.id], SECRET)
    );
    expect(inB.map((row) => row.documentId)).toContain(theirs.page.id);

    await expect(inSeededWorkspace(() => searchSimilarChunks([theirs.project.id], SECRET))).resolves.toEqual([]);
    await expect(inSeededWorkspace(() => hasEmbeddings([theirs.project.id]))).resolves.toBe(false);
    await expect(
      runWithWorkspaceContext({ workspaceId: PARALLEL_WORKSPACE_ID }, () => hasEmbeddings([theirs.project.id]))
    ).resolves.toBe(true);
  });

  it("keeps B's Files out of A by id and by object key", async () => {
    const app = await makeApp();
    const a = await registerUser(app);
    const theirs = await workspaceB(app);
    const key = objectPathFor(theirs.storagePath);
    expect(key).toMatch(new RegExp(`^/objects/ws/${PARALLEL_WORKSPACE_ID}/files/`));

    for (const route of ["stream", "download"]) {
      const res = await a.agent.get(`/api/company-documents/${theirs.file.id}/${route}`);
      expect(res.status, route).toBe(404);
    }
    expect((await a.agent.get(key)).status).toBe(404);
    expect((await theirs.b.agent.get(key)).status).toBe(200);

    // Knowing the key is not enough to attach B's object to a File in A.
    const claimed = await a.agent.post("/api/company-documents").send({
      name: "Claimed",
      fileName: "zebra.pdf",
      mimeType: "application/pdf",
      storagePath: theirs.storagePath,
    });
    expect(claimed.status).not.toBe(201);
    const { pathname } = new URL(theirs.storagePath);
    expect(JSON.parse(objectMetadata(pathname.slice(1))!["custom:aclPolicy"])).toEqual({
      owner: theirs.b.id,
      visibility: "private",
    });
    expect(JSON.stringify((await a.agent.get("/api/company-documents")).body)).not.toContain("Claimed");

    const { createKnowledgeObjectStorage, ObjectNotUploadedError } = await import(
      "../../server/modules/knowledge/objectStorage"
    );
    await expect(
      inSeededWorkspace(() =>
        createKnowledgeObjectStorage().finalizeUpload({
          objectPath: key,
          name: "Claimed",
          fileName: "zebra.pdf",
          mimeType: "application/pdf",
          uploadedById: a.id,
        })
      )
    ).rejects.toBeInstanceOf(ObjectNotUploadedError);
  });

  it("serves a legacy private object only in the Workspace whose row references it", async () => {
    const app = await makeApp();
    const a = await registerUser(app);
    const b = await memberOfB(app);
    const theirs = legacyPrivateObject(b.id);
    const ours = legacyPrivateObject(a.id);
    await runWithWorkspaceContext({ workspaceId: PARALLEL_WORKSPACE_ID }, () =>
      db.insert(companyDocuments).values(
        stampWorkspace({ name: "Zebra legacy", uploadedById: b.id, storagePath: theirs })
      )
    );

    expect((await b.agent.get(theirs)).status).toBe(200);
    expect((await a.agent.get(theirs)).status).toBe(404);
    expect((await newAgent(app).get(theirs)).status).toBe(401);
    // Nothing in A references this one, so its owner cannot reach it either.
    expect((await a.agent.get(ours)).status).toBe(404);
  });
});

function legacyPrivateObject(ownerId: string): string {
  const key = `uploads/${randomUUID()}`;
  putObject(`${process.env.PRIVATE_OBJECT_DIR!.slice(1)}/${key}`, "legacy bytes", {
    metadata: { "custom:aclPolicy": JSON.stringify({ owner: ownerId, visibility: "private" }) },
  });
  return `/objects/${key}`;
}

describe("agent screenshots across Workspaces (#297)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function capture(app: Awaited<ReturnType<typeof makeApp>>, user: TestUser) {
    const device = await loginDevice(app, user);
    const { crmProject } = await createCrmProject(user.agent);
    const task = await createTask(user.agent, crmProject.id);
    const entry = await startTimer(user.agent, crmProject.id, task.id);
    const slot = await device.request.post("/api/agent/screenshots/presign").send({
      deviceId: device.deviceId,
      timeEntryId: entry.id,
      capturedAt: new Date().toISOString(),
      clientType: "desktop",
      clientVersion: "0.1.0",
    });
    expect(slot.status).toBe(200);
    const put = await device.request.put(slot.body.uploadURL).set("Content-Type", "image/png").send(PNG_1X1);
    expect(put.status).toBe(200);
    const list = await user.agent.get("/api/time-tracking/screenshots");
    return { id: slot.body.screenshotId as string, storageKey: list.body.data[0].storageKey as string, entry, crmProject };
  }

  it("keys a new screenshot under its Workspace and keeps it there", async () => {
    const app = await makeApp();
    const a = await registerUser(app);
    const b = await memberOfB(app);
    const shot = await capture(app, b);
    expect(shot.storageKey).toBe(`/objects/ws/${PARALLEL_WORKSPACE_ID}/agent-screenshots/${shot.id}.webp`);

    expect((await b.agent.get(`/api/time-tracking/screenshots/${shot.id}/image`)).status).toBe(200);
    expect((await a.agent.get(`/api/time-tracking/screenshots/${shot.id}/image`)).status).toBe(404);
    expect((await a.agent.get(shot.storageKey)).status).toBe(404);

    const { crmProject } = await createCrmProject(a.agent);
    const task = await createTask(a.agent, crmProject.id);
    const entry = await startTimer(a.agent, crmProject.id, task.id);
    const registered = await a.agent.post("/api/time-tracking/screenshots").send({
      timeEntryId: entry.id,
      crmProjectId: crmProject.id,
      storageKey: shot.storageKey,
    });
    expect(registered.status).toBe(400);
  });

  it("still serves a legacy agent-screenshots key", async () => {
    const app = await makeApp();
    const a = await registerUser(app);
    const { crmProject } = await createCrmProject(a.agent);
    const task = await createTask(a.agent, crmProject.id);
    const entry = await startTimer(a.agent, crmProject.id, task.id);
    const key = `agent-screenshots/${randomUUID()}.webp`;
    putObject(`${process.env.PRIVATE_OBJECT_DIR!.slice(1)}/${key}`, PNG_1X1, { contentType: "image/webp" });

    const registered = await a.agent.post("/api/time-tracking/screenshots").send({
      timeEntryId: entry.id,
      crmProjectId: crmProject.id,
      storageKey: `/objects/${key}`,
    });
    expect(registered.status).toBe(200);
    expect((await a.agent.get(`/api/time-tracking/screenshots/${registered.body.id}/image`)).status).toBe(200);
  });
});

describe("platform archive and restore (#297)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function membershipsOf(userId: string) {
    const rows = await db
      .select({ workspaceId: memberships.workspaceId, archivedAt: memberships.archivedAt })
      .from(memberships)
      .where(eq(memberships.userId, userId));
    return Object.fromEntries(rows.map((row) => [row.workspaceId, row.archivedAt !== null]));
  }

  it("archives every Membership and restores them only where a seat is free", async () => {
    const { storage } = await import("../../server/storage");
    const { SeatExhaustedError, countConsumedSeats, setEntitlementOverride } = await import(
      "../../server/modules/billing"
    );
    const inB = <T>(fn: () => T) => runWithWorkspaceContext({ workspaceId: PARALLEL_WORKSPACE_ID }, fn);

    const ada = await createSeededMember({ email: "ada@test.invalid", firstName: "Ada" });
    await addWorkspaceMembership(ada.id, PARALLEL_WORKSPACE_ID, "member");

    await storage.archiveUser(ada.id, true);
    expect(await membershipsOf(ada.id)).toEqual({ [SEEDED_WORKSPACE_ID]: true, [PARALLEL_WORKSPACE_ID]: true });

    const consumed = await inB(() => countConsumedSeats());
    await inB(() => setEntitlementOverride({ seatCapacity: consumed }, { kind: "system" }));
    await expect(storage.archiveUser(ada.id, false)).rejects.toBeInstanceOf(SeatExhaustedError);
    expect(await membershipsOf(ada.id)).toEqual({ [SEEDED_WORKSPACE_ID]: true, [PARALLEL_WORKSPACE_ID]: true });

    await inB(() => setEntitlementOverride({ seatCapacity: consumed + 1 }, { kind: "system" }));
    await storage.archiveUser(ada.id, false);
    expect(await membershipsOf(ada.id)).toEqual({ [SEEDED_WORKSPACE_ID]: false, [PARALLEL_WORKSPACE_ID]: false });
  });
});

describe("Workspace-prefixed object keys (ADR-0012)", () => {
  it("mints new keys under the Active Workspace and refuses to mint without one", async () => {
    const { ObjectStorageService } = await import("../../server/objectStorage");
    const { MissingWorkspaceContextError } = await import("../../server/workspaceContext");
    const objects = new ObjectStorageService();

    const priv = await inSeededWorkspace(() => objects.getObjectEntityUpload());
    expect(priv.objectPath).toMatch(/^\/objects\/ws\/seeded\/files\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    const pub = await inSeededWorkspace(() => objects.getPublicUpload());
    expect(pub.publicPath).toMatch(/^\/public-objects\/ws\/seeded\/files\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);

    await expect(objects.getObjectEntityUpload()).rejects.toBeInstanceOf(MissingWorkspaceContextError);
  });

  it("reads the Workspace off a key and lets legacy keys through", async () => {
    const { ObjectNotFoundError, assertObjectInActiveWorkspace, objectPathWorkspaceId } = await import(
      "../../server/objectStorage"
    );

    expect(objectPathWorkspaceId("/objects/ws/seeded/files/f/v")).toBe(SEEDED_WORKSPACE_ID);
    expect(objectPathWorkspaceId("/public-objects/ws/parallel/files/f/v")).toBe(PARALLEL_WORKSPACE_ID);
    expect(objectPathWorkspaceId("/objects/uploads/legacy-id")).toBeNull();

    expect(() => assertObjectInActiveWorkspace("/objects/uploads/legacy-id")).not.toThrow();
    expect(() => inSeededWorkspace(() => assertObjectInActiveWorkspace("/objects/ws/seeded/files/f/v"))).not.toThrow();
    expect(() => inSeededWorkspace(() => assertObjectInActiveWorkspace("/objects/ws/parallel/files/f/v"))).toThrow(
      ObjectNotFoundError
    );
    expect(() => assertObjectInActiveWorkspace("/objects/ws/seeded/files/f/v")).toThrow(ObjectNotFoundError);
  });
});
