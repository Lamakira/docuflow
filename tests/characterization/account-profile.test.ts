import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../../shared/schema";
import { db } from "../../server/db";
import { makeApp } from "../helpers/app";
import { newAgent, registerUser, setWorkspaceRole, signIn, uniqueEmail } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { updateClerkUser } from "../fakes/clerk";

/**
 * Account management (#316). Seam: `POST /api/account/profile/sync` — the
 * browser changed a name, photo or primary address in Clerk's `<UserProfile />`
 * and tells DocuFlow to follow. The body is never believed: the server re-reads
 * the User from the IdentityProvider and writes what the provider says.
 */

const TAKEN_MESSAGE =
  "That email address belongs to another DocuFlow account. Make your previous address primary again, or contact support.";
const UNVERIFIED_MESSAGE = "Confirm your new email address before it becomes your DocuFlow address.";

async function rowOf(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}

async function subjectOf(id: string): Promise<string> {
  const subject = (await rowOf(id)).identityProviderSubjectId;
  if (!subject) throw new Error(`no subject for ${id}`);
  return subject;
}

describe("a User's account follows their provider profile (#316)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("re-reads the provider and updates the row", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { firstName: "Old", lastName: "Name" });
    const newEmail = uniqueEmail("renamed");
    updateClerkUser(await subjectOf(user.id), {
      firstName: "Ada",
      lastName: "Lovelace",
      imageUrl: "https://img.clerk.test/ada.png",
      primaryEmail: { email: newEmail },
    });

    const res = await user.agent.post("/api/account/profile/sync").send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: user.id,
      email: newEmail,
      firstName: "Ada",
      lastName: "Lovelace",
      profileImageUrl: "https://img.clerk.test/ada.png",
    });
    expect(res.body).not.toHaveProperty("identityProviderSubjectId");

    const row = await rowOf(user.id);
    expect(row.email).toBe(newEmail);
    expect(row.firstName).toBe("Ada");
    expect(row.lastName).toBe("Lovelace");
    expect(row.profileImageUrl).toBe("https://img.clerk.test/ada.png");
  });

  it("ignores names and email in the body", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { firstName: "Grace", lastName: "Hopper" });

    const res = await user.agent.post("/api/account/profile/sync").send({
      firstName: "Mallory",
      lastName: "X",
      email: uniqueEmail("forged"),
      profileImageUrl: "https://evil.test/x.png",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: user.email, firstName: "Grace", lastName: "Hopper" });

    const row = await rowOf(user.id);
    expect(row.email).toBe(user.email);
    expect(row.firstName).toBe("Grace");
    expect(row.lastName).toBe("Hopper");
    expect(row.profileImageUrl).not.toBe("https://evil.test/x.png");
  });

  it("refuses an address another User holds, and changes nothing", async () => {
    const app = await makeApp();
    const a = await registerUser(app);
    const b = await registerUser(app);
    // A first request stamps `lastLoginAt`; settle that so the snapshot is of
    // what the sync itself could change.
    await a.agent.get("/api/auth/user");
    await b.agent.get("/api/auth/user");
    const aBefore = await rowOf(a.id);
    const bBefore = await rowOf(b.id);
    updateClerkUser(await subjectOf(a.id), {
      firstName: "Taken",
      lastName: "Over",
      primaryEmail: { email: b.email },
    });

    const res = await a.agent.post("/api/account/profile/sync").send({});
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ message: TAKEN_MESSAGE });
    expect(await rowOf(a.id)).toEqual(aBefore);
    expect(await rowOf(b.id)).toEqual(bBefore);
  });

  it("refuses a new primary address the provider has not verified", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    await user.agent.get("/api/auth/user");
    const before = await rowOf(user.id);
    updateClerkUser(await subjectOf(user.id), {
      firstName: "Pending",
      primaryEmail: { email: uniqueEmail("unconfirmed"), verified: false },
    });

    const res = await user.agent.post("/api/account/profile/sync").send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: UNVERIFIED_MESSAGE });
    expect(await rowOf(user.id)).toEqual(before);
  });

  it("answers 401 without a session the provider recognises", async () => {
    const app = await makeApp();
    const anonymous = await newAgent(app).post("/api/account/profile/sync").send({});
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual({ message: "Unauthorized" });

    const forged = await newAgent(app)
      .post("/api/account/profile/sync")
      .set("Authorization", "Bearer not-a-session")
      .send({});
    expect(forged.status).toBe(401);
  });

  it("works in a Workspace that requires a second factor", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    await setWorkspaceRole(owner.id, "owner");
    const verified = await signIn(app, owner.id, { secondFactor: true });
    const required = await verified.patch("/api/admin/two-factor").send({ required: true });
    expect(required.status).toBe(200);

    const member = await registerUser(app);
    const blocked = await member.agent.get("/api/projects");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("setup-mfa");

    const sync = await member.agent.post("/api/account/profile/sync").send({});
    expect(sync.status).toBe(200);
    const deletion = await member.agent.get("/api/account/deletion");
    expect(deletion.status).toBe(200);
  });
});
