import { beforeEach, describe, expect, it } from "vitest";
import {
  SEEDED_WORKSPACE_ID,
  memberships,
  workspaceRoles,
  workspaces,
} from "../../shared/schema";
import { resetDb } from "../helpers/db";
import { makeApp } from "../helpers/app";
import { registerUser } from "../helpers/auth";

/**
 * Phase 4 ticket #95: every HTTP and Worker transaction establishes a
 * WorkspaceContext from the Membership (HTTP) or the Job's Workspace (Worker)
 * and fails closed when that context is missing. Repositories read and write
 * through it. A second Workspace exists only in this harness.
 *
 * HTTP characterization stays on its own suites. This file is the scoping seam:
 * storage, auth into the Workspace, and the Worker runner.
 */

const OTHER_WORKSPACE_ID = "other";

async function plantOtherWorkspace() {
  const { db } = await import("../../server/db");
  await db.insert(workspaces).values({ id: OTHER_WORKSPACE_ID, name: "Other" });
  await db.insert(workspaceRoles).values({
    id: "other-member",
    workspaceId: OTHER_WORKSPACE_ID,
    slug: "member",
    name: "Member",
  });
}

describe("WorkspaceContext", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("fails closed when a Workspace-owned read or write has no context", async () => {
    const { storage } = await import("../../server/storage");
    const { MissingWorkspaceContextError } = await import("../../server/workspaceContext");

    const user = await storage.createUser({
      email: "ada@test.invalid",
      password: "not-a-real-hash",
      firstName: "Ada",
    });

    await expect(storage.getProjects()).rejects.toThrow(MissingWorkspaceContextError);
    await expect(storage.createProject({ name: "Atlas", ownerId: user.id })).rejects.toThrow(
      MissingWorkspaceContextError
    );
  });

  it("stamps writes from the context and ignores a caller-supplied Workspace id", async () => {
    const { storage } = await import("../../server/storage");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");

    const user = await storage.createUser({
      email: "ada@test.invalid",
      password: "not-a-real-hash",
      firstName: "Ada",
    });

    const created = await runWithWorkspaceContext({ workspaceId: SEEDED_WORKSPACE_ID }, () =>
      storage.createProject({
        name: "Atlas",
        ownerId: user.id,
        workspaceId: OTHER_WORKSPACE_ID,
      } as Parameters<typeof storage.createProject>[0] & { workspaceId: string })
    );

    expect(created.workspaceId).toBe(SEEDED_WORKSPACE_ID);
  });

  it("does not let a Membership in Workspace A read Workspace B's rows through storage", async () => {
    const { storage } = await import("../../server/storage");
    const { db } = await import("../../server/db");
    const { contextFromUser, runWithWorkspaceContext } = await import(
      "../../server/workspaceContext"
    );
    const { eq } = await import("drizzle-orm");

    await plantOtherWorkspace();

    const ada = await storage.createUser({
      email: "ada@test.invalid",
      password: "not-a-real-hash",
      firstName: "Ada",
    });
    const other = await storage.createUser({
      email: "other@test.invalid",
      password: "not-a-real-hash",
      firstName: "Other",
    });
    await db.delete(memberships).where(eq(memberships.userId, other.id));
    await db.insert(memberships).values({
      workspaceId: OTHER_WORKSPACE_ID,
      userId: other.id,
      workspaceRoleId: "other-member",
    });

    const ctxA = await contextFromUser(ada.id);
    const ctxB = await contextFromUser(other.id);
    expect(ctxA.workspaceId).toBe(SEEDED_WORKSPACE_ID);
    expect(ctxB.workspaceId).toBe(OTHER_WORKSPACE_ID);

    const inA = await runWithWorkspaceContext(ctxA, () =>
      storage.createProject({ name: "Ours", ownerId: ada.id })
    );
    const inB = await runWithWorkspaceContext(ctxB, () =>
      storage.createProject({ name: "Theirs", ownerId: other.id })
    );

    const visible = await runWithWorkspaceContext(ctxA, async () => ({
      listed: await storage.getProjects(),
      ours: await storage.getProject(inA.id),
      theirs: await storage.getProject(inB.id),
    }));

    expect(visible.listed.map((row) => row.id)).toEqual([inA.id]);
    expect(visible.ours).toMatchObject({ id: inA.id, name: "Ours" });
    expect(visible.theirs).toBeUndefined();
  });

  it("establishes HTTP scope from the Membership and rejects an Archived Membership", async () => {
    const app = await makeApp();
    const member = await registerUser(app);
    const { storage } = await import("../../server/storage");
    const { db } = await import("../../server/db");
    const { eq } = await import("drizzle-orm");

    const created = await member.agent.post("/api/crm/projects").send({
      name: "Atlas",
      workspaceId: OTHER_WORKSPACE_ID,
    });
    expect(created.status).toBe(201);
    expect(created.body.project.workspaceId).toBe(SEEDED_WORKSPACE_ID);

    const listed = await member.agent.get("/api/projects");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([expect.objectContaining({ id: created.body.project.id })]);

    await storage.archiveUser(member.id, true);

    const afterArchive = await member.agent.get("/api/projects");
    expect(afterArchive.status).toBe(401);

    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, member.id));
    expect(membership.archivedAt).not.toBeNull();
  });

  it("does not let a Membership in Workspace A fetch Workspace B's project over HTTP", async () => {
    const app = await makeApp();
    const member = await registerUser(app);
    const { storage } = await import("../../server/storage");
    const { runWithWorkspaceContext } = await import("../../server/workspaceContext");

    await plantOtherWorkspace();
    const stranger = await storage.createUser({
      email: "other@test.invalid",
      password: "not-a-real-hash",
      firstName: "Other",
    });
    const theirs = await runWithWorkspaceContext({ workspaceId: OTHER_WORKSPACE_ID }, () =>
      storage.createProject({ name: "Secret", ownerId: stranger.id })
    );

    const res = await member.agent.get(`/api/projects/${theirs.id}`);
    expect(res.status).toBe(404);
  });

  it("runs a Worker Job inside the Job's Workspace and fails closed when the Job has none", async () => {
    const { db } = await import("../../server/db");
    const { createJobsPort } = await import("../../server/jobs");
    const { createJobRunner } = await import("../../server/worker");
    const { requireWorkspaceContext } = await import("../../server/workspaceContext");

    const WORK = "test.work";
    const jobs = createJobsPort({
      db,
      types: {
        [WORK]: {
          attempts: 1,
          backoffMs: 1_000,
          timeoutMs: 1_000,
          concurrencyClass: "derived-processing",
        },
      },
    });

    let seen: string | undefined;
    const worker = createJobRunner({
      role: "worker",
      jobs,
      handlers: {
        [WORK]: async () => {
          seen = requireWorkspaceContext().workspaceId;
        },
      },
      claimerId: "worker-1",
    });

    await jobs.enqueue({ type: WORK, workspaceId: SEEDED_WORKSPACE_ID });
    expect(await worker.runOne()).toMatchObject({
      type: WORK,
      claimedBy: "worker-1",
    });
    expect(seen).toBe(SEEDED_WORKSPACE_ID);

    seen = undefined;
    const bare = await jobs.enqueue({ type: WORK });
    expect(bare.workspaceId).toBeNull();
    expect(await worker.runOne()).toMatchObject({ id: bare.id, claimedBy: "worker-1" });
    expect(seen).toBeUndefined();
    expect(await jobs.deadLetterFor(bare.id)).toMatchObject({
      jobId: bare.id,
      lastError: "WorkspaceContext is required",
    });
  });
});
