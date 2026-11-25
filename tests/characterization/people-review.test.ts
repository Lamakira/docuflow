import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  auditEvents,
  invitations,
  membershipCapabilities,
  memberships,
  PARALLEL_WORKSPACE_ID,
  SEEDED_WORKSPACE_ID,
  users,
  workspaceBilling,
  workspaceEntitlementOverrides,
  workspaces,
} from "../../shared/schema";
import { issueClerkSession, plantClerkUser } from "../fakes/clerk";
import { emailsTo, failNextSend, resetEmails } from "../fakes/resend";
import { makeApp } from "../helpers/app";
import {
  newAgent,
  registerPlatformStaff,
  registerUser,
  setWorkspaceRole,
  signUpAtProvider,
  uniqueEmail,
  type TestUser,
} from "../helpers/auth";
import { getOwnerPool, ownerDb, resetDb } from "../helpers/db";
import { addWorkspaceMembership, plantParallelWorkspace } from "../helpers/workspace";

/**
 * The People review (F84-F90). Seam: HTTP `/api/workspace/memberships`,
 * `/api/workspace/invitations` and `/api/invitations`. The server runs as
 * `docuflow_app`, so Workspace isolation here is row-level security.
 */

type App = Awaited<ReturnType<typeof makeApp>>;

const NUL_ID = "/api/workspace/memberships/%00";
const LONG_ID = "x".repeat(5000);

const tokenOf = (email: string): string => {
  const token = emailsTo(email).at(-1)?.html.match(/\/invitations\/([a-f0-9]+)/i)?.[1];
  if (!token) throw new Error(`No Invitation email to ${email}`);
  return token;
};

async function owned(app: App): Promise<TestUser> {
  const owner = await registerUser(app, { firstName: "Olga", lastName: "Reyes" });
  await setWorkspaceRole(owner.id, "owner");
  return owner;
}

async function administrator(app: App): Promise<TestUser> {
  const admin = await registerUser(app, { firstName: "Adam" });
  await setWorkspaceRole(admin.id, "administrator");
  return admin;
}

async function membershipOf(userId: string, workspaceId: string = SEEDED_WORKSPACE_ID) {
  const [row] = await ownerDb
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)));
  return row;
}

async function path(userId: string, action = ""): Promise<string> {
  return `/api/workspace/memberships/${(await membershipOf(userId)).id}${action}`;
}

async function liveMembers(workspaceId: string = SEEDED_WORKSPACE_ID): Promise<number> {
  const rows = await ownerDb.select().from(memberships).where(eq(memberships.workspaceId, workspaceId));
  return rows.filter((row) => row.archivedAt === null).length;
}

async function limitSeats(seatCapacity: number): Promise<void> {
  await ownerDb
    .insert(workspaceEntitlementOverrides)
    .values({ workspaceId: SEEDED_WORKSPACE_ID, seatCapacity })
    .onConflictDoUpdate({ target: workspaceEntitlementOverrides.workspaceId, set: { seatCapacity } });
}

async function auditOf(action: string) {
  return ownerDb.select().from(auditEvents).where(eq(auditEvents.action, action));
}

const invite = (by: TestUser, email: string, workspaceRole = "MEMBER") =>
  by.agent.post("/api/workspace/invitations").send({ email, workspaceRole });

/** The Invitation's last send, moved out of the minute a resend waits for. */
const ageInvitation = (id: string) =>
  ownerDb
    .update(invitations)
    .set({ updatedAt: new Date(Date.now() - 61_000) })
    .where(eq(invitations.id, id));

const expireInvitation = (id: string) =>
  ownerDb
    .update(invitations)
    .set({ expiresAt: new Date(Date.now() - 1000), updatedAt: new Date(Date.now() - 61_000) })
    .where(eq(invitations.id, id));

const as = (app: App, subject: string) =>
  newAgent(app).set("Authorization", `Bearer ${issueClerkSession(subject)}`);

beforeEach(async () => {
  await resetDb();
  resetEmails();
});

describe("archiving a Membership (F84)", () => {
  it("lets the Owner archive and restore one Membership, and leaves the account and other Workspaces alone", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const member = await registerUser(app);
    await addWorkspaceMembership(member.id, PARALLEL_WORKSPACE_ID, "owner");
    const id = (await membershipOf(member.id)).id;

    const archived = await owner.agent.post(await path(member.id, "/archive"));
    expect(archived.status).toBe(200);
    expect(archived.body).toEqual({ membershipId: id, archived: true });
    const stamp = (await membershipOf(member.id)).archivedAt;
    expect(stamp).not.toBeNull();
    expect((await membershipOf(member.id, PARALLEL_WORKSPACE_ID)).archivedAt).toBeNull();
    const [account] = await ownerDb.select().from(users).where(eq(users.id, member.id));
    expect(account.isArchived).toBe(false);

    const again = await owner.agent.post(await path(member.id, "/archive"));
    expect(again.status).toBe(200);
    expect((await membershipOf(member.id)).archivedAt).toEqual(stamp);

    const patch = await owner.agent.patch(await path(member.id)).send({ workspaceRole: "ADMINISTRATOR" });
    expect(patch.status).toBe(404);
    expect(patch.body).toEqual({ message: "Membership not found" });

    const restored = await owner.agent.post(await path(member.id, "/restore"));
    expect(restored.status).toBe(200);
    expect(restored.body).toEqual({ membershipId: id, archived: false });
    expect((await owner.agent.post(await path(member.id, "/restore"))).status).toBe(200);
    expect((await membershipOf(member.id)).archivedAt).toBeNull();

    for (const action of ["membership.archived", "membership.restored"]) {
      const events = await auditOf(action);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorKind: "user",
        actorId: owner.id,
        resourceType: "memberships",
        resourceId: id,
        workspaceId: SEEDED_WORKSPACE_ID,
      });
    }
  });

  it("holds one rule for archive, restore, PATCH and manageable", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const admin = await administrator(app);
    const peer = await administrator(app);
    const member = await registerUser(app);
    const other = await registerUser(app);

    const cases: Array<[TestUser, TestUser, string | null]> = [
      [member, other, "Access denied"],
      [admin, owner, "The Owner's Membership cannot be changed here"],
      [admin, peer, "Only the Owner can manage an Administrator"],
      [admin, admin, "You cannot change your own Membership"],
      [owner, owner, "You cannot change your own Membership"],
    ];
    for (const [actor, target, message] of cases) {
      for (const response of [
        await actor.agent.post(await path(target.id, "/archive")),
        await actor.agent.post(await path(target.id, "/restore")),
        await actor.agent.patch(await path(target.id)).send({ canViewDailyUpdates: 1 }),
      ]) {
        expect(response.status).toBe(403);
        expect(response.body).toEqual({ message });
      }
      expect((await membershipOf(target.id)).archivedAt).toBeNull();
    }

    const manageable = async (reader: TestUser) => {
      const list = await reader.agent.get("/api/workspace/memberships");
      return list.body.memberships
        .filter((row: { manageable: boolean }) => row.manageable)
        .map((row: { userId: string }) => row.userId)
        .sort();
    };
    expect(await manageable(owner)).toEqual([admin.id, peer.id, member.id, other.id].sort());
    expect(await manageable(admin)).toEqual([member.id, other.id].sort());
    expect(await manageable(member)).toEqual([]);

    expect((await admin.agent.post(await path(member.id, "/archive"))).status).toBe(200);
    expect((await owner.agent.post(await path(admin.id, "/archive"))).status).toBe(200);
  });

  it("answers 404 for another Workspace's Membership, an unknown, over-long or NUL id", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const outsider = await registerUser(app);
    await addWorkspaceMembership(outsider.id, PARALLEL_WORKSPACE_ID);
    const foreign = (await membershipOf(outsider.id, PARALLEL_WORKSPACE_ID)).id;

    for (const id of [foreign, "nope", LONG_ID, "%00"]) {
      const base = `/api/workspace/memberships/${id}`;
      for (const response of [
        await owner.agent.post(`${base}/archive`),
        await owner.agent.post(`${base}/restore`),
        await owner.agent.patch(base).send({ canViewDailyUpdates: 1 }),
      ]) {
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ message: "Membership not found" });
      }
    }
    expect((await membershipOf(outsider.id, PARALLEL_WORKSPACE_ID)).archivedAt).toBeNull();
  });

  it("refuses every write in a Read-only Workspace", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const member = await registerUser(app);
    await ownerDb
      .update(workspaceBilling)
      .set({ billingState: "ReadOnly" })
      .where(eq(workspaceBilling.workspaceId, SEEDED_WORKSPACE_ID));

    for (const response of [
      await owner.agent.post(await path(member.id, "/archive")),
      await owner.agent.post(await path(member.id, "/restore")),
      await owner.agent.patch(await path(member.id)).send({ canViewDailyUpdates: 1 }),
      await owner.agent.post("/api/workspace/invitations/nope/resend"),
    ]) {
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ message: "Workspace is read-only" });
    }
  });

  it("decides on the actor's role as it stands, a demotion arriving at the same moment included", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const admin = await administrator(app);
    const member = await registerUser(app);
    const memberPath = await path(member.id, "/archive");
    const adminPath = await path(admin.id);

    const [demoted, archived] = await Promise.all([
      owner.agent.patch(adminPath).send({ workspaceRole: "MEMBER" }),
      admin.agent.post(memberPath),
    ]);
    expect(demoted.status).toBe(200);
    expect([200, 403]).toContain(archived.status);
    expect((await membershipOf(member.id)).archivedAt !== null).toBe(archived.status === 200);
    expect((await admin.agent.post(memberPath)).status).toBe(403);
  });

  it("never leaves a Workspace with an archived Owner when ownership moves at the same moment", async () => {
    const app = await makeApp();
    for (let round = 0; round < 5; round += 1) {
      await resetDb();
      const owner = await owned(app);
      const successor = await registerUser(app);
      const archivePath = await path(successor.id, "/archive");
      const responses = await Promise.all([
        owner.agent.post(`/api/workspaces/${SEEDED_WORKSPACE_ID}/owner`).send({ userId: successor.id }),
        owner.agent.post(archivePath),
      ]);
      expect(responses.map((response) => response.status).filter((status) => status >= 500)).toEqual([]);
      const rows = await ownerDb.select().from(memberships).where(eq(memberships.workspaceId, SEEDED_WORKSPACE_ID));
      const owners = rows.filter((row) => row.workspaceRoleId === "seeded-owner");
      expect(owners).toHaveLength(1);
      expect(owners[0].archivedAt).toBeNull();
    }
  });

  it("takes a seat on restore, and refuses an archived account", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const member = await registerUser(app);
    await owner.agent.post(await path(member.id, "/archive"));
    await limitSeats(1);

    const full = await owner.agent.post(await path(member.id, "/restore"));
    expect(full.status).toBe(409);
    expect(full.body).toEqual({ message: "Billable Seat capacity is exhausted" });
    expect((await membershipOf(member.id)).archivedAt).not.toBeNull();

    await limitSeats(2);
    await ownerDb.update(users).set({ isArchived: true }).where(eq(users.id, member.id));
    const gone = await owner.agent.post(await path(member.id, "/restore"));
    expect(gone.status).toBe(409);
    expect(gone.body).toEqual({ message: "This account is archived. Contact DocuFlow support to restore it." });
    expect((await membershipOf(member.id)).archivedAt).not.toBeNull();
  });

  it("gives the last seat to one of two restores at once", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const people = [await registerUser(app), await registerUser(app)];
    for (const person of people) await owner.agent.post(await path(person.id, "/archive"));
    await limitSeats(2);
    const paths = await Promise.all(people.map((person) => path(person.id, "/restore")));

    const responses = await Promise.all(paths.map((restorePath) => owner.agent.post(restorePath)));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await liveMembers()).toBe(2);
  });

  it("restores with the account only what the account archive took", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const staff = await registerPlatformStaff(app);
    const member = await registerUser(app);
    await addWorkspaceMembership(member.id, PARALLEL_WORKSPACE_ID);
    const setAccount = (isArchived: boolean) =>
      staff.agent.patch(`/api/admin/users/${member.id}/archive`).send({ isArchived });

    // Moments before the account: the Workspace's own decision all the same.
    await owner.agent.post(await path(member.id, "/archive"));
    await setAccount(true);
    expect((await membershipOf(member.id, PARALLEL_WORKSPACE_ID)).archivedAt).not.toBeNull();
    expect((await setAccount(false)).status).toBe(200);
    expect((await membershipOf(member.id, PARALLEL_WORKSPACE_ID)).archivedAt).toBeNull();
    expect((await membershipOf(member.id)).archivedAt).not.toBeNull();

    // Restoring an account that is not archived brings nothing back.
    expect((await setAccount(false)).status).toBe(200);
    expect((await membershipOf(member.id)).archivedAt).not.toBeNull();

    // Both with the account: one stamp.
    await owner.agent.post(await path(member.id, "/restore"));
    await setAccount(true);
    expect((await membershipOf(member.id)).archivedAt).toEqual(
      (await membershipOf(member.id, PARALLEL_WORKSPACE_ID)).archivedAt,
    );
    await setAccount(false);
    expect((await membershipOf(member.id)).archivedAt).toBeNull();
    expect((await membershipOf(member.id, PARALLEL_WORKSPACE_ID)).archivedAt).toBeNull();
  });

  it("restores Memberships an older account archive stamped a few ms apart, and not a much older one", async () => {
    const app = await makeApp();
    const staff = await registerPlatformStaff(app);
    const member = await registerUser(app);
    await addWorkspaceMembership(member.id, PARALLEL_WORKSPACE_ID);
    const stamp = (workspaceId: string, at: number) =>
      ownerDb
        .update(memberships)
        .set({ archivedAt: new Date(at) })
        .where(and(eq(memberships.userId, member.id), eq(memberships.workspaceId, workspaceId)));
    const now = Date.now();
    const restore = async () => {
      await ownerDb.update(users).set({ isArchived: true }).where(eq(users.id, member.id));
      await staff.agent.patch(`/api/admin/users/${member.id}/archive`).send({ isArchived: false });
    };

    await stamp(SEEDED_WORKSPACE_ID, now - 60_000);
    await stamp(PARALLEL_WORKSPACE_ID, now);
    await restore();
    expect((await membershipOf(member.id, PARALLEL_WORKSPACE_ID)).archivedAt).toBeNull();
    expect((await membershipOf(member.id)).archivedAt).not.toBeNull();

    await stamp(SEEDED_WORKSPACE_ID, now - 40);
    await stamp(PARALLEL_WORKSPACE_ID, now);
    await restore();
    expect((await membershipOf(member.id)).archivedAt).toBeNull();
  });
});

describe("who may accept an Invitation (F85)", () => {
  it("refuses another identity, and leaves an unlinked account unlinked", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const email = uniqueEmail("imported");
    await ownerDb.insert(users).values({ email, firstName: "Imported" });
    expect((await invite(owner, email)).status).toBe(201);
    const token = tokenOf(email);

    const thief = await signUpAtProvider(app);
    const refused = await thief.agent.post("/api/invitations/accept").send({ token });
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ message: "This Invitation was sent to a different email" });

    const unknown = await as(app, "user_nobody_knows").post("/api/invitations/accept").send({ token });
    expect(unknown.status).toBe(401);

    const unverified = plantClerkUser({ addresses: [{ email, verified: false, primary: true }] });
    const unconfirmed = await as(app, unverified).post("/api/invitations/accept").send({ token });
    expect(unconfirmed.status).toBe(403);
    expect(unconfirmed.body).toEqual({
      message: "Confirm your email address with your sign-in provider, then reload this page",
    });

    // A confirmed secondary address does not stand in for the primary one.
    const secondary = plantClerkUser({
      addresses: [
        { email, verified: true },
        { email: uniqueEmail("primary"), verified: true, primary: true },
      ],
    });
    expect((await as(app, secondary).post("/api/invitations/accept").send({ token })).status).toBe(403);

    const [account] = await ownerDb.select().from(users).where(eq(users.email, email));
    expect(account.identityProviderSubjectId).toBeNull();
    expect(await membershipOf(account.id)).toBeUndefined();
    expect((await thief.agent.get("/api/auth/user")).body).toBeNull();

    const real = as(app, plantClerkUser({ addresses: [{ email, primary: true }] }));
    expect((await real.post("/api/invitations/accept").send({ token })).status).toBe(200);
    expect((await real.get("/api/auth/user")).body.id).toBe(account.id);
  });

  it("takes an identity whose address differs only in case", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const email = uniqueEmail("cased");
    await invite(owner, email);
    const subject = plantClerkUser({ addresses: [{ email: email.toUpperCase(), primary: true }] });
    const accepted = await as(app, subject).post("/api/invitations/accept").send({ token: tokenOf(email) });
    expect(accepted.status).toBe(200);
    const [account] = await ownerDb.select().from(users).where(eq(users.identityProviderSubjectId, subject));
    expect(account).toMatchObject({ email, activeWorkspaceId: SEEDED_WORKSPACE_ID });
  });

  it("compares addresses without their case, for a Member and for an invitee", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const lower = uniqueEmail("mixed");
    const mixed = lower.charAt(0).toUpperCase() + lower.slice(1);
    const member = await registerUser(app);
    await ownerDb.update(users).set({ email: mixed }).where(eq(users.id, member.id));

    const duplicate = await invite(owner, lower);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({ message: "This email already holds a Membership in this Workspace" });

    await owner.agent.post(await path(member.id, "/archive"));
    expect((await invite(owner, lower)).status).toBe(201);
    const mine = await member.agent.get("/api/invitations");
    expect(mine.body).toHaveLength(1);
    const accepted = await member.agent.post("/api/invitations/accept").send({ token: tokenOf(lower) });
    expect(accepted.status).toBe(200);
    expect(await ownerDb.select().from(users).where(inArray(users.email, [lower, mixed]))).toHaveLength(1);
  });

  it("writes nothing when the Invitation cannot be completed", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const email = uniqueEmail("whole");
    await invite(owner, email);
    await limitSeats(1);
    const invitee = await signUpAtProvider(app, { email });

    const refused = await invitee.agent.post("/api/invitations/accept").send({ token: tokenOf(email) });
    expect(refused.status).toBe(409);
    expect(await ownerDb.select().from(users).where(eq(users.email, email))).toEqual([]);
    const [row] = await ownerDb.select().from(invitations).where(eq(invitations.email, email));
    expect(row.status).toBe("pending");
  });

  it("accepts once when the same link is opened twice at once", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const email = uniqueEmail("tabs");
    await invite(owner, email);
    const token = tokenOf(email);
    const invitee = await signUpAtProvider(app, { email });
    const responses = await Promise.all(
      [1, 2].map(() => invitee.agent.post("/api/invitations/accept").send({ token })),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await liveMembers()).toBe(2);
  });

  it("survives registration and acceptance arriving together", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const email = uniqueEmail("together");
    await invite(owner, email);
    const invitee = await signUpAtProvider(app, { email });
    const [registered, accepted] = await Promise.all([
      invitee.agent.post("/api/auth/user").send({}),
      invitee.agent.post("/api/invitations/accept").send({ token: tokenOf(email) }),
    ]);
    expect(registered.status).toBeLessThan(300);
    expect(accepted.status).toBe(200);
  });
});

describe("the Daily Updates grant (F86)", () => {
  async function grantedElsewhere(app: App) {
    const owner = await owned(app);
    await plantParallelWorkspace();
    const other = await registerUser(app);
    await addWorkspaceMembership(other.id, PARALLEL_WORKSPACE_ID);
    return { owner, other };
  }
  const enter = (user: TestUser, workspaceId: string) =>
    user.agent.put("/api/memberships/active").send({ workspaceId });
  const reads = async (user: TestUser) => (await user.agent.get("/api/admin/daily-updates")).status;
  const told = async (user: TestUser) => (await user.agent.get("/api/auth/user")).body.canViewDailyUpdates;

  it("opens one Workspace's Daily Updates and no other's, and closes them again", async () => {
    const app = await makeApp();
    const { owner, other } = await grantedElsewhere(app);
    await enter(other, PARALLEL_WORKSPACE_ID);
    expect(await reads(other)).toBe(403);

    const granted = await owner.agent.patch(await path(other.id)).send({ canViewDailyUpdates: 1 });
    expect(granted.status).toBe(200);
    expect(granted.body).toEqual({
      membershipId: (await membershipOf(other.id)).id,
      userId: other.id,
      workspaceRole: "MEMBER",
      canViewDailyUpdates: 1,
    });
    expect(await reads(other)).toBe(403);
    expect(await told(other)).toBe(0);

    await enter(other, SEEDED_WORKSPACE_ID);
    expect(await reads(other)).toBe(200);
    expect(await told(other)).toBe(1);

    const [row] = await ownerDb.select().from(membershipCapabilities);
    expect(row).toMatchObject({ workspaceId: SEEDED_WORKSPACE_ID, capabilityId: "view_daily_updates" });
    // Granting again changes nothing, and says nothing.
    await owner.agent.patch(await path(other.id)).send({ canViewDailyUpdates: 1 });
    expect(await auditOf("membership.daily_updates_granted")).toHaveLength(1);

    await owner.agent.patch(await path(other.id)).send({ canViewDailyUpdates: 0 });
    expect(await reads(other)).toBe(403);
    expect(await told(other)).toBe(0);
    expect(await auditOf("membership.daily_updates_revoked")).toHaveLength(1);
  });

  it("writes the grant in the Workspace it was made in", async () => {
    const app = await makeApp();
    const { other } = await grantedElsewhere(app);
    const boss = await registerUser(app);
    await addWorkspaceMembership(boss.id, PARALLEL_WORKSPACE_ID, "owner");
    await enter(boss, PARALLEL_WORKSPACE_ID);
    const target = await membershipOf(other.id, PARALLEL_WORKSPACE_ID);
    const granted = await boss.agent
      .patch(`/api/workspace/memberships/${target.id}`)
      .send({ canViewDailyUpdates: 1 });
    expect(granted.status).toBe(200);
    const [row] = await ownerDb.select().from(membershipCapabilities);
    expect(row).toMatchObject({ workspaceId: PARALLEL_WORKSPACE_ID, membershipId: target.id });
  });

  it("no longer reads the account's flag", async () => {
    const app = await makeApp();
    const member = await registerUser(app);
    await ownerDb.update(users).set({ canViewDailyUpdates: 1 }).where(eq(users.id, member.id));
    expect(await reads(member)).toBe(403);
    expect(await told(member)).toBe(0);
    const registered = await member.agent.post("/api/auth/user").send({});
    expect(registered.body.canViewDailyUpdates).toBe(0);
  });

  it("tells an Administrator yes, and a User in no Workspace no", async () => {
    const app = await makeApp();
    const admin = await administrator(app);
    expect(await told(admin)).toBe(1);
    const loner = await signUpAtProvider(app);
    await loner.agent.post("/api/auth/user").send({});
    const me = await loner.agent.get("/api/auth/user");
    expect(me.body).toMatchObject({ email: loner.email, canViewDailyUpdates: 0 });
  });

  it("follows the platform directory on every Membership, and only when the flag changes", async () => {
    const app = await makeApp();
    const { owner, other } = await grantedElsewhere(app);
    await owner.agent.post(await path(other.id, "/archive"));
    const staff = await registerPlatformStaff(app);
    const set = (body: object) => staff.agent.patch(`/api/admin/users/${other.id}`).send(body);
    const grants = async () =>
      (await ownerDb.select().from(membershipCapabilities)).map((row) => row.workspaceId).sort();

    expect((await set({ canViewDailyUpdates: 1 })).status).toBe(200);
    expect(await grants()).toEqual([PARALLEL_WORKSPACE_ID, SEEDED_WORKSPACE_ID]);

    expect((await set({ canViewDailyUpdates: 0 })).body.canViewDailyUpdates).toBe(0);
    expect(await grants()).toEqual([]);

    // v1's console sends the whole form on a rename: a Workspace's own grant stays.
    await owner.agent.post(await path(other.id, "/restore"));
    await owner.agent.patch(await path(other.id)).send({ canViewDailyUpdates: 1 });
    expect((await set({ firstName: "Renamed", canViewDailyUpdates: 0 })).status).toBe(200);
    expect(await grants()).toEqual([SEEDED_WORKSPACE_ID]);
  });
});

describe("migration 0044 (F86)", () => {
  it("gives every Membership of a flagged account its grant, once, where the role does not carry it", async () => {
    const app = await makeApp();
    const flagged = await registerUser(app);
    await addWorkspaceMembership(flagged.id, PARALLEL_WORKSPACE_ID, "member", true);
    const admin = await administrator(app);
    const plain = await registerUser(app);
    await ownerDb
      .update(users)
      .set({ canViewDailyUpdates: 1 })
      .where(inArray(users.id, [flagged.id, admin.id]));

    const sqlText = readFileSync(new URL("../../migrations/0044_daily_updates_grants.sql", import.meta.url), "utf8");
    await getOwnerPool().query(sqlText);
    await getOwnerPool().query(sqlText);

    const rows = await ownerDb.select().from(membershipCapabilities);
    expect(rows.map((row) => [row.membershipId, row.workspaceId, row.capabilityId]).sort()).toEqual(
      [
        [(await membershipOf(flagged.id)).id, SEEDED_WORKSPACE_ID, "view_daily_updates"],
        [(await membershipOf(flagged.id, PARALLEL_WORKSPACE_ID)).id, PARALLEL_WORKSPACE_ID, "view_daily_updates"],
      ].sort(),
    );
    expect(await membershipOf(plain.id)).toBeDefined();
  });
});

describe("Billable Seats at acceptance (F87)", () => {
  it("seats as many invitees as there are seats, and refuses the rest", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    await limitSeats((await liveMembers()) + 1);
    const emails = [uniqueEmail("a"), uniqueEmail("b"), uniqueEmail("c")];
    for (const email of emails) expect((await invite(owner, email)).status).toBe(201);

    const statuses: number[] = [];
    for (const email of emails) {
      const invitee = await signUpAtProvider(app, { email });
      const accepted = await invitee.agent.post("/api/invitations/accept").send({ token: tokenOf(email) });
      statuses.push(accepted.status);
      if (accepted.status === 409) {
        expect(accepted.body).toEqual({ message: "Billable Seat capacity is exhausted" });
      }
    }
    expect(statuses).toEqual([200, 409, 409]);
    expect(await liveMembers()).toBe(2);
  });

  it("gives the last seat to one of many acceptances at once", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    // More than the pool holds connections, so a lock holder that needed a second one would hang.
    const emails = Array.from({ length: 14 }, () => uniqueEmail("race"));
    for (const email of emails) await invite(owner, email);
    await limitSeats(2);
    const invitees = await Promise.all(emails.map((email) => signUpAtProvider(app, { email })));
    const responses = await Promise.all(
      invitees.map((invitee) =>
        invitee.agent.post("/api/invitations/accept").send({ token: tokenOf(invitee.email) }),
      ),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, ...Array(13).fill(409)]);
    expect(await liveMembers()).toBe(2);
  });
});

describe("changing a Member's role (F88)", () => {
  it("changes the role, keeps the grant, and records from and to", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const admin = await administrator(app);
    const member = await registerUser(app);
    await admin.agent.patch(await path(member.id)).send({ canViewDailyUpdates: 1 });

    const promoted = await admin.agent.patch(await path(member.id)).send({ workspaceRole: "ADMINISTRATOR" });
    expect(promoted.status).toBe(200);
    expect(promoted.body).toMatchObject({ workspaceRole: "ADMINISTRATOR", canViewDailyUpdates: 1 });
    expect((await member.agent.get("/api/workspace/invitations")).status).toBe(200);

    const mine = await admin.agent.patch(await path(member.id)).send({ workspaceRole: "MEMBER" });
    expect(mine.status).toBe(403);
    const demoted = await owner.agent.patch(await path(member.id)).send({ workspaceRole: "MEMBER" });
    expect(demoted.status).toBe(200);
    await owner.agent.patch(await path(member.id)).send({ workspaceRole: "MEMBER" });

    const events = await auditOf("membership.role_changed");
    expect(events.map((event) => event.payload).sort((a, b) => String(a.from).localeCompare(String(b.from)))).toEqual([
      { from: "ADMINISTRATOR", to: "MEMBER" },
      { from: "MEMBER", to: "ADMINISTRATOR" },
    ]);
  });

  it("refuses a body it does not know, before it looks for the Membership", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const member = await registerUser(app);
    for (const body of [
      {},
      { hoursPerDay: 4 },
      { canViewDailyUpdates: 1, hoursPerDay: 4 },
      { workspaceRole: "OWNER" },
      { workspaceRole: "member" },
      { canViewDailyUpdates: true },
      { canViewDailyUpdates: 2 },
      [],
    ]) {
      const refused = await owner.agent.patch(await path(member.id)).send(body);
      expect(refused.status).toBe(400);
      expect(typeof refused.body.message).toBe("string");
    }
    expect((await owner.agent.patch(NUL_ID).send({})).status).toBe(400);
  });
});

describe("what the people list says", () => {
  it("carries the grant to managers only, and no hours per day", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const member = await registerUser(app);
    await owner.agent.patch(await path(member.id)).send({ canViewDailyUpdates: 1 });
    const rowFor = async (reader: TestUser, userId: string) =>
      (await reader.agent.get("/api/workspace/memberships")).body.memberships.find(
        (row: { userId: string }) => row.userId === userId,
      );

    const seen = await rowFor(owner, member.id);
    expect(seen).toMatchObject({ canViewDailyUpdates: 1, manageable: true });
    expect(seen).not.toHaveProperty("hoursPerDay");
    // The grant row alone: an Owner reads them by role.
    expect(await rowFor(owner, owner.id)).toMatchObject({ canViewDailyUpdates: 0, manageable: false });
    expect(await rowFor(member, member.id)).toMatchObject({ canViewDailyUpdates: 0, manageable: false });
    expect((await rowFor(member, member.id)).capabilities).toEqual([]);
    expect((await rowFor(owner, member.id)).capabilities).toEqual(["View daily updates"]);
  });
});

describe("Invitations say what happened (F89)", () => {
  it("is read by managers only", async () => {
    const app = await makeApp();
    const member = await registerUser(app);
    const refused = await member.agent.get("/api/workspace/invitations");
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ message: "Access denied" });
    const resend = await member.agent.post("/api/workspace/invitations/nope/resend");
    expect(resend.status).toBe(403);
  });

  it("says whether the email left, and lets a failed one be sent again at once", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const email = uniqueEmail("bounced");
    failNextSend();
    const sent = await invite(owner, email);
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ email, status: "pending", invitedBy: "Olga Reyes", emailSent: false });
    expect(emailsTo(email)).toHaveLength(0);

    const again = await owner.agent.post(`/api/workspace/invitations/${sent.body.id}/resend`);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: sent.body.id, emailSent: true });
    expect(emailsTo(email)).toHaveLength(1);
  });

  it("sends again with a new link and 14 more days, and not twice in a minute", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const email = uniqueEmail("again");
    const sent = await invite(owner, email);
    expect(sent.body.emailSent).toBe(true);
    const oldToken = tokenOf(email);
    const resend = () => owner.agent.post(`/api/workspace/invitations/${sent.body.id}/resend`);

    const early = await resend();
    expect(early.status).toBe(429);
    expect(early.body).toEqual({ message: "This Invitation was just sent. Try again in a minute." });
    expect(emailsTo(email)).toHaveLength(1);

    await expireInvitation(sent.body.id);
    const listed = await owner.agent.get("/api/workspace/invitations");
    expect(listed.body).toEqual([
      expect.objectContaining({
        id: sent.body.id,
        status: "expired",
        invitedBy: "Olga Reyes",
        consumesSeat: false,
        workspaceRole: "MEMBER",
      }),
    ]);

    const resent = await resend();
    expect(resent.status).toBe(200);
    expect(resent.body).toMatchObject({ id: sent.body.id, email, status: "pending", emailSent: true });
    expect(resent.body).not.toHaveProperty("token");
    const days = (new Date(resent.body.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    expect(tokenOf(email)).not.toBe(oldToken);
    expect((await resend()).status).toBe(429);

    const invitee = await signUpAtProvider(app, { email });
    expect((await invitee.agent.post("/api/invitations/accept").send({ token: oldToken })).status).toBe(404);
    expect((await invitee.agent.post("/api/invitations/accept").send({ token: tokenOf(email) })).status).toBe(200);
    expect((await resend()).status).toBe(404);
  });

  it("sends once when two resends arrive together", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const email = uniqueEmail("double");
    const sent = await invite(owner, email);
    await ageInvitation(sent.body.id);
    const responses = await Promise.all(
      [1, 2].map(() => owner.agent.post(`/api/workspace/invitations/${sent.body.id}/resend`)),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 429]);
    expect(emailsTo(email)).toHaveLength(2);
  });

  it("checks seats at resend, and refuses a revoked, foreign, unknown, over-long or NUL Invitation", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const sent = await invite(owner, uniqueEmail("seats"));
    await ageInvitation(sent.body.id);
    await limitSeats(1);
    const full = await owner.agent.post(`/api/workspace/invitations/${sent.body.id}/resend`);
    expect(full.status).toBe(409);
    expect(full.body).toEqual({ message: "Billable Seat capacity is exhausted" });
    await limitSeats(50);

    // An expired row can be revoked, and once revoked leaves the list.
    await expireInvitation(sent.body.id);
    expect((await owner.agent.post(`/api/workspace/invitations/${sent.body.id}/revoke`)).body.status).toBe("revoked");
    expect((await owner.agent.get("/api/workspace/invitations")).body).toEqual([]);

    const boss = await registerUser(app);
    await addWorkspaceMembership(boss.id, PARALLEL_WORKSPACE_ID, "owner");
    await boss.agent.put("/api/memberships/active").send({ workspaceId: PARALLEL_WORKSPACE_ID });
    const foreign = await invite(boss, uniqueEmail("foreign"));
    await ageInvitation(foreign.body.id);

    for (const id of [sent.body.id, foreign.body.id, "nope", LONG_ID, "%00"]) {
      const refused = await owner.agent.post(`/api/workspace/invitations/${id}/resend`);
      expect(refused.status).toBe(404);
      expect(refused.body).toEqual({ message: "Invitation not found" });
    }
    for (const id of ["nope", LONG_ID, "%00"]) {
      expect((await owner.agent.post(`/api/workspace/invitations/${id}/revoke`)).status).toBe(404);
    }
  });

  it("answers two sends at once for a new address with one Invitation", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    for (let round = 0; round < 5; round += 1) {
      const email = uniqueEmail("twice");
      const responses = await Promise.all([invite(owner, email), invite(owner, email)]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      expect(responses.find((response) => response.status === 409)?.body).toEqual({
        message: "An Invitation is already pending for this email",
      });
      expect(emailsTo(email)).toHaveLength(1);
    }
  });

  it("escapes what people typed, and says who invites and until when", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    await ownerDb
      .update(users)
      .set({ firstName: '<img src="x">', lastName: "Reyes" })
      .where(eq(users.id, owner.id));
    await ownerDb
      .update(workspaces)
      .set({ name: 'Acme\r\nBcc: x@y.z <a href="https://evil.test">win</a>' })
      .where(eq(workspaces.id, SEEDED_WORKSPACE_ID));
    const email = uniqueEmail("html");
    const sent = await invite(owner, email);
    const [mail] = emailsTo(email);
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain('<a href="https://evil.test"');
    expect(mail.html).toContain("&lt;img src=&quot;x&quot;&gt; Reyes");
    expect(mail.subject).not.toMatch(/[\r\n]/);
    const until = new Date(sent.body.expiresAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
    expect(mail.html).toContain(until);
  });

  it("does not bring an archived account back by Invitation", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const member = await registerUser(app);
    await ownerDb.update(users).set({ isArchived: true }).where(eq(users.id, member.id));
    await ownerDb.update(memberships).set({ archivedAt: new Date() }).where(eq(memberships.userId, member.id));
    expect((await invite(owner, member.email)).status).toBe(201);

    const refused = await member.agent.post("/api/invitations/accept").send({ token: tokenOf(member.email) });
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ message: "This account is archived. Contact DocuFlow support to restore it." });
    const people = await owner.agent.get("/api/workspace/memberships");
    expect(people.body.memberships.map((row: { userId: string }) => row.userId)).not.toContain(member.id);
  });

  it("refuses odd input with a 400", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    for (const body of [
      { email: `${"a".repeat(9000)}@example.com`, workspaceRole: "MEMBER" },
      { email: "a\u0000b@example.com", workspaceRole: "MEMBER" },
      { email: "a@b", workspaceRole: "MEMBER" },
      { email: uniqueEmail("role"), workspaceRole: "\u0000" },
    ]) {
      expect((await owner.agent.post("/api/workspace/invitations").send(body)).status).toBe(400);
    }
  });

  it("records each Invitation act, without the address or the link", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const email = uniqueEmail("audit");
    const sent = await invite(owner, email, "ADMINISTRATOR");
    await ageInvitation(sent.body.id);
    await owner.agent.post(`/api/workspace/invitations/${sent.body.id}/resend`);
    await owner.agent.post(`/api/workspace/invitations/${sent.body.id}/revoke`);
    await owner.agent.post(`/api/workspace/invitations/${sent.body.id}/revoke`);
    for (const action of ["invitation.sent", "invitation.resent", "invitation.revoked"]) {
      const events = await auditOf(action);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: owner.id,
        resourceType: "invitations",
        resourceId: sent.body.id,
      });
      expect(JSON.stringify(events[0].payload)).not.toContain(email);
      expect(JSON.stringify(events[0].payload)).not.toContain(tokenOf(email));
    }
  });
});

describe("looking an Invitation up from its link (F90)", () => {
  const lookup = (app: App, token: unknown) => newAgent(app).post("/api/invitations/lookup").send({ token });

  it("says to what, as what, by whom, without a session and nothing more", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const email = uniqueEmail("curious");
    const sent = await invite(owner, email, "ADMINISTRATOR");
    const found = await lookup(app, tokenOf(email));
    expect(found.status).toBe(200);
    expect(found.body).toEqual({
      workspaceName: "DocuFlow",
      workspaceRole: "ADMINISTRATOR",
      invitedBy: "Olga Reyes",
      email,
      status: "pending",
      expiresAt: sent.body.expiresAt,
    });

    await ownerDb.update(users).set({ firstName: null, lastName: null }).where(eq(users.id, owner.id));
    expect((await lookup(app, tokenOf(email))).body.invitedBy).toBeNull();
    await expireInvitation(sent.body.id);
    expect((await lookup(app, tokenOf(email))).body.status).toBe("expired");
    await owner.agent.post(`/api/workspace/invitations/${sent.body.id}/revoke`);
    expect((await lookup(app, tokenOf(email))).body.status).toBe("revoked");
  });

  it("says accepted, and not found for a link that names none", async () => {
    const app = await makeApp();
    const owner = await owned(app);
    const email = uniqueEmail("done");
    await invite(owner, email);
    const invitee = await signUpAtProvider(app, { email });
    await invitee.agent.post("/api/invitations/accept").send({ token: tokenOf(email) });
    expect((await lookup(app, tokenOf(email))).body.status).toBe("accepted");

    for (const token of ["f".repeat(64), LONG_ID, "a\u0000b"]) {
      const missing = await lookup(app, token);
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual({ message: "Invitation not found" });
      expect((await invitee.agent.post("/api/invitations/accept").send({ token })).status).toBe(404);
    }
    for (const token of ["", 5, null, { a: 1 }]) expect((await lookup(app, token)).status).toBe(400);
  });
});
