import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { memberships, SEEDED_WORKSPACE_ID, users } from "../../shared/schema";
import { db } from "../../server/db";
import { makeApp } from "../helpers/app";
import {
  createUnlinkedUser,
  newAgent,
  registerAdmin,
  registerUser,
  signIn,
  signUpAtProvider,
  uniqueEmail,
} from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { addWorkspaceMembership, plantParallelWorkspace, removeAllMemberships } from "../helpers/workspace";

/**
 * Self-service registration (#230, Flow 1 steps 1–2).
 * Seam: `POST /api/auth/user` — the return from Clerk's sign-up, where
 * DocuFlow links or creates its own User and takes over. Everything after it
 * is #217's and is characterized in `workspace-lifecycle.test.ts`.
 *
 * The visitor arrives holding a provider session for a subject no `users` row
 * names. Before #230 that was a dead end by design (#110); #217 built the room
 * behind the door, and this route opens it.
 */

async function membershipCount(userId: string): Promise<number> {
  const rows = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, userId));
  return rows.length;
}

describe("a visitor with no account becomes a User (#230, Flow 1)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates the User behind a provider session that names none, and joins no Workspace", async () => {
    const app = await makeApp();
    const visitor = await signUpAtProvider(app, { firstName: "Sam", lastName: "Reyes" });

    // The dead end #110 recorded: Clerk vouches for the subject, DocuFlow does not.
    expect((await visitor.agent.get("/api/auth/user")).body).toBeNull();

    const created = await visitor.agent.post("/api/auth/user").send({});
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      email: visitor.email,
      firstName: "Sam",
      lastName: "Reyes",
      role: "user",
    });
    // The link is server-side identity, never served (#108).
    expect(created.body).not.toHaveProperty("identityProviderSubjectId");

    const me = await visitor.agent.get("/api/auth/user");
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(created.body.id);

    // Flow 1 step 3 comes next, and it cannot if registration dropped them into
    // somebody else's Workspace on the way past.
    expect(await membershipCount(created.body.id)).toBe(0);
    const listed = await visitor.agent.get("/api/memberships");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({
      activeWorkspaceId: null,
      preferredWorkspaceId: null,
      memberships: [],
      hasArchivedMemberships: false,
    });
  });

  it("reaches the first Workspace, an Owner Membership, and a Trial without an Administrator", async () => {
    const app = await makeApp();
    const visitor = await signUpAtProvider(app, { firstName: "Sam" });

    await visitor.agent.post("/api/auth/user").send({});
    const workspace = await visitor.agent.post("/api/workspaces").send({ name: "Keystone Studio" });

    expect(workspace.status).toBe(201);
    expect(workspace.body).toMatchObject({
      workspaceName: "Keystone Studio",
      workspaceRole: "OWNER",
      condition: "Trial",
    });
    expect(workspace.body.trialEndsAt).toBeTruthy();
    expect(workspace.body.workspaceId).not.toBe(SEEDED_WORKSPACE_ID);

    // And the Workspace is genuinely entered: a Workspace-scoped read answers.
    const projects = await visitor.agent.get("/api/projects");
    expect(projects.status).toBe(200);
  });

  it("is idempotent — a second return from Clerk finds the User it already made", async () => {
    const app = await makeApp();
    const visitor = await signUpAtProvider(app);

    const first = await visitor.agent.post("/api/auth/user").send({});
    const second = await visitor.agent.post("/api/auth/user").send({});

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, visitor.email));
    expect(rows).toHaveLength(1);
  });

  it("refuses a caller with no provider session, and mints nothing", async () => {
    const app = await makeApp();
    const anonymous = newAgent(app);
    const forged = uniqueEmail("forged");
    const before = await db.select({ id: users.id }).from(users);

    const noSession = await anonymous.post("/api/auth/user").send({ email: forged });
    expect(noSession.status).toBe(401);
    expect(noSession.body).toEqual({ message: "Unauthorized" });

    const badToken = await newAgent(app)
      .post("/api/auth/user")
      .set("Authorization", "Bearer not-a-session")
      .send({ email: forged });
    expect(badToken.status).toBe(401);
    expect(badToken.body).toEqual({ message: "Unauthorized" });

    expect(await db.select({ id: users.id }).from(users)).toHaveLength(before.length);
  });

  it("takes the address from the provider and never from the request body", async () => {
    const app = await makeApp();
    const visitor = await signUpAtProvider(app, { firstName: "Sam" });
    const someoneElse = uniqueEmail("victim");

    const created = await visitor.agent
      .post("/api/auth/user")
      .send({ email: someoneElse, firstName: "Not Sam", role: "admin" });

    expect(created.status).toBe(201);
    expect(created.body.email).toBe(visitor.email);
    expect(created.body.firstName).toBe("Sam");
    expect(created.body.role).toBe("user");
  });

  it("refuses an address this DocuFlow already holds, linked or not, and adopts nothing", async () => {
    const app = await makeApp();
    // Unlinked is the dangerous one: it is the shape a legacy account the #108
    // import never reached is in, and adopting it on a matching address would
    // hand a stranger that User — its Memberships and its role with it. The
    // provider reports an address this side never challenged, so a match is
    // not proof of control the way an Invitation token is.
    const unlinked = await createUnlinkedUser({ firstName: "Ada" });
    const { storage } = await import("../../server/storage");
    const linked = await createUnlinkedUser({ firstName: "Grace" });
    await storage.linkUserToIdentityProvider(linked.id, "user_someone_else");

    for (const existing of [unlinked, linked]) {
      const visitor = await signUpAtProvider(app, { email: existing.email });
      const res = await visitor.agent.post("/api/auth/user").send({});

      expect(res.status, existing.email).toBe(409);
      expect(res.body.message).toMatch(/already exists/i);
      // Refused means refused: the session is still nobody, and the row it
      // collided with is untouched.
      expect((await visitor.agent.get("/api/auth/user")).body).toBeNull();
      const rows = await db
        .select({ id: users.id, subject: users.identityProviderSubjectId })
        .from(users)
        .where(eq(users.email, existing.email));
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(existing.id);
      expect(rows[0].subject).not.toBe(visitor.providerSubjectId);
    }
  });

  it("answers one row when the same session arrives twice at once", async () => {
    const app = await makeApp();
    const visitor = await signUpAtProvider(app);

    // The second tab the route is documented to be idempotent for, racing the
    // first: both miss the select, and only one insert may land.
    const { issueClerkSession } = await import("../fakes/clerk");
    const secondTab = newAgent(app).set(
      "Authorization",
      `Bearer ${issueClerkSession(visitor.providerSubjectId)}`,
    );
    const [first, second] = await Promise.all([
      visitor.agent.post("/api/auth/user").send({}),
      secondTab.post("/api/auth/user").send({}),
    ]);

    expect([first.status, second.status].every((status) => status === 200 || status === 201)).toBe(
      true,
    );
    expect(first.body.id).toBe(second.body.id);
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, visitor.email));
    expect(rows).toHaveLength(1);
  });

  it("does not give a registrant a role, a seat, or anybody else's data", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const visitor = await signUpAtProvider(app);

    const created = await visitor.agent.post("/api/auth/user").send({});
    expect(created.body.role).toBe("user");
    expect(created.body.isMainAdmin).toBe(0);

    // No Membership means no Workspace to read from — not the seeded one either.
    expect((await visitor.agent.get("/api/projects")).status).toBe(401);
    expect((await visitor.agent.get("/api/admin/users")).status).toBe(401);

    // And the seeded Workspace gained nobody.
    const seeded = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.workspaceId, SEEDED_WORKSPACE_ID));
    expect(seeded.map((row) => row.userId)).not.toContain(created.body.id);
    expect(seeded.map((row) => row.userId)).toContain(admin.id);
  });
});

describe("an Invitation still takes precedence over creation (#230, Flow 6 step 4)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("gives a registered invitee the Membership they were invited to, and no Workspace of their own", async () => {
    const app = await makeApp();
    // A Workspace with seats to spare: the Trial carries one, and Flow 6 blocks
    // the inviter rather than the invitee when capacity is gone.
    const workspaceId = await plantParallelWorkspace();
    const owner = await registerUser(app);
    await removeAllMemberships(owner.id);
    await addWorkspaceMembership(owner.id, workspaceId, "owner");
    const ownerAgent = await signIn(app, owner.id);

    const inviteeEmail = uniqueEmail("invitee");
    const invitation = await ownerAgent
      .post("/api/workspace/invitations")
      .send({ email: inviteeEmail, workspaceRole: "MEMBER" });
    expect(invitation.status).toBe(201);

    const invitee = await signUpAtProvider(app, { email: inviteeEmail });
    const registered = await invitee.agent.post("/api/auth/user").send({});
    expect(registered.status).toBe(201);

    // The waiting Invitation is what the shell offers — never first-run
    // creation. Reading it cannot need a Membership: the invitee has none yet,
    // and this list is by address across Workspaces, not a Workspace-scoped read.
    const pending = await invitee.agent.get("/api/invitations");
    expect(pending.status).toBe(200);
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0]).toMatchObject({ workspaceId, workspaceRole: "MEMBER" });

    const accepted = await invitee.agent
      .post("/api/invitations/accept")
      .send({ token: pending.body[0].token });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ workspaceId, workspaceRole: "MEMBER" });

    const listed = await invitee.agent.get("/api/memberships");
    expect(listed.body.memberships).toHaveLength(1);
    expect(listed.body.memberships[0].workspaceId).toBe(workspaceId);
  });

  it("states the mismatch when a registrant opens a link sent to another address", async () => {
    const app = await makeApp();
    const workspaceId = await plantParallelWorkspace();
    const owner = await registerUser(app);
    await removeAllMemberships(owner.id);
    await addWorkspaceMembership(owner.id, workspaceId, "owner");
    const ownerAgent = await signIn(app, owner.id);

    const invitedAddress = uniqueEmail("invited-address");
    await ownerAgent
      .post("/api/workspace/invitations")
      .send({ email: invitedAddress, workspaceRole: "MEMBER" });

    // Signed up under their own address first, then opened the link that was
    // sent somewhere else. `resolveInvitee` has always refused a subject whose
    // address is not the invited one; #230 makes a registrant reach that rule
    // more often, because they now hold a `users` row before accepting.
    // DocuFlow holds one address per User, so this stays a stated condition
    // rather than becoming a match — Flow 6 already has the message for it.
    const registrant = await signUpAtProvider(app);
    expect((await registrant.agent.post("/api/auth/user").send({})).status).toBe(201);

    const { invitations } = await import("../../shared/schema");
    const [row] = await db
      .select({ token: invitations.token })
      .from(invitations)
      .where(eq(invitations.email, invitedAddress));
    const refused = await registrant.agent.post("/api/invitations/accept").send({ token: row.token });

    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/different email/i);
    // And nothing was half-done: no Membership, and the Invitation still stands.
    expect((await registrant.agent.get("/api/memberships")).body.memberships).toEqual([]);
  });

  it("accepts for an invitee who never called registration at all", async () => {
    const app = await makeApp();
    const workspaceId = await plantParallelWorkspace();
    const owner = await registerUser(app);
    await removeAllMemberships(owner.id);
    await addWorkspaceMembership(owner.id, workspaceId, "owner");
    const ownerAgent = await signIn(app, owner.id);

    const inviteeEmail = uniqueEmail("invitee");
    await ownerAgent
      .post("/api/workspace/invitations")
      .send({ email: inviteeEmail, workspaceRole: "MEMBER" });
    const invitee = await signUpAtProvider(app, { email: inviteeEmail });

    const { invitations } = await import("../../shared/schema");
    const [row] = await db
      .select({ token: invitations.token })
      .from(invitations)
      .where(eq(invitations.email, inviteeEmail));

    const accepted = await invitee.agent.post("/api/invitations/accept").send({ token: row.token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.workspaceId).toBe(workspaceId);
  });
});
