import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeApp } from "../helpers/app";
import { ownerDb, resetDb } from "../helpers/db";
import { registerUser } from "../helpers/auth";
import { createClient } from "../helpers/fixtures";
import { CRM_PHONE_HTML_PATTERN, CRM_PHONE_PATTERN, crmClients, crmContacts } from "@shared/schema";

/**
 * Client and Contact writes check their content, not just its type: a name has
 * a character, a status is one of the four, an email looks like one, a phone is
 * digits and punctuation, and a Source is one the Workspace's list offers (or
 * the one the Client already holds). Unknown keys are still dropped silently.
 */
describe("CRM Client and Contact validation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  const badClients: Array<[string, Record<string, unknown>]> = [
    ["a blank name", { name: "" }],
    ["a whitespace name", { name: "   " }],
    ["status hacked", { status: "hacked" }],
    ["an email that is not one", { email: "not-an-email" }],
    ["a phone with letters", { phone: "abc<script>" }],
    ["notes over 10,000 characters", { notes: "x".repeat(10_001) }],
    ["a phone format outside the list", { phoneFormat: "xx" }],
  ];

  it.each(badClients)("refuses to create a Client with %s", async (_label, body) => {
    const app = await makeApp();
    const user = await registerUser(app);
    const res = await user.agent.post("/api/crm/clients").send({ name: "Valid", ...body });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid data");
  });

  it.each(badClients)("refuses to edit a Client with %s", async (_label, body) => {
    const app = await makeApp();
    const user = await registerUser(app);
    const client = await createClient(user.agent, { name: "Before" });
    const res = await user.agent.patch(`/api/crm/clients/${client.id}`).send(body);
    expect(res.status).toBe(400);
    const after = await user.agent.get(`/api/crm/clients/${client.id}`);
    expect(after.body.name).toBe("Before");
  });

  it("trims and normalises what it accepts", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const res = await user.agent.post("/api/crm/clients").send({
      name: "  Acme  ",
      email: "",
      phone: "+1 (415) 999-4863",
      company: "   ",
      notes: "",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Acme",
      email: null,
      phone: "+1 (415) 999-4863",
      company: null,
      notes: null,
    });
    const plain = await user.agent.post("/api/crm/clients").send({ name: "Plain", phone: "+17272377698" });
    expect(plain.status).toBe(201);
  });

  it("takes a Source from the Workspace's Source list and keeps a legacy one already held", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const direct = await user.agent.post("/api/crm/clients").send({ name: "Direct", source: "direct" });
    expect(direct.status).toBe(201);
    expect(direct.body.source).toBe("direct");

    const refused = await user.agent.post("/api/crm/clients").send({ name: "Referred", source: "referral" });
    expect(refused.status).toBe(400);
    expect(refused.body).toEqual({ message: "“referral” is not in this Workspace's Source list." });

    const client = await createClient(user.agent, { name: "Legacy" });
    await ownerDb.update(crmClients).set({ source: "referral" }).where(eq(crmClients.id, client.id));

    const otherField = await user.agent.patch(`/api/crm/clients/${client.id}`).send({ notes: "still fine" });
    expect(otherField.status).toBe(200);
    expect(otherField.body.source).toBe("referral");
    const resent = await user.agent.patch(`/api/crm/clients/${client.id}`).send({ source: "referral", name: "Legacy 2" });
    expect(resent.status).toBe(200);
    const changed = await user.agent.patch(`/api/crm/clients/${client.id}`).send({ source: "conference" });
    expect(changed.status).toBe(400);
    expect(changed.body.message).toBe("“conference” is not in this Workspace's Source list.");
    const cleared = await user.agent.patch(`/api/crm/clients/${client.id}`).send({ source: "" });
    expect(cleared.status).toBe(200);
    expect(cleared.body.source).toBeNull();
  });

  it("still ignores ownerId and workspaceId from the body", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const res = await user.agent
      .post("/api/crm/clients")
      .send({ name: "Owned", ownerId: "someone-else", workspaceId: "elsewhere", id: "fixed" });
    expect(res.status).toBe(201);
    expect(res.body.ownerId).toBe(user.id);
    expect(res.body.workspaceId).not.toBe("elsewhere");
    expect(res.body.id).not.toBe("fixed");
    const patched = await user.agent
      .patch(`/api/crm/clients/${res.body.id}`)
      .send({ notes: "n", ownerId: "someone-else", workspaceId: "elsewhere" });
    expect(patched.status).toBe(200);
    expect(patched.body.ownerId).toBe(user.id);
    expect(patched.body.workspaceId).toBe(res.body.workspaceId);
  });

  it("refuses bad Contact content and stores isPrimary as 0 or 1", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const client = await createClient(user.agent);
    const url = `/api/crm/clients/${client.id}/contacts`;

    for (const body of [{ name: "  " }, { name: "" }, { name: "Jo", email: "nope" }, { name: "Jo", isPrimary: 7 }, { name: "Jo", isPrimary: "yes" }, { name: "Jo", phone: "abc" }]) {
      const res = await user.agent.post(url).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.message).toBe("Invalid data");
    }

    const yes = await user.agent.post(url).send({ name: "  Primary  ", isPrimary: true, email: "", role: " " });
    expect(yes.status).toBe(201);
    expect(yes.body).toMatchObject({ name: "Primary", isPrimary: 1, email: null, role: null });
    const no = await user.agent.post(url).send({ name: "Second", isPrimary: false });
    expect(no.status).toBe(201);
    expect(no.body.isPrimary).toBe(0);
    const [row] = await ownerDb.select().from(crmContacts).where(eq(crmContacts.id, yes.body.id));
    expect(row.isPrimary).toBe(1);

    const bad = await user.agent.patch(`/api/crm/contacts/${no.body.id}`).send({ email: "nope" });
    expect(bad.status).toBe(400);
    const flip = await user.agent.patch(`/api/crm/contacts/${no.body.id}`).send({ isPrimary: true });
    expect(flip.status).toBe(200);
    expect(flip.body.isPrimary).toBe(1);
  });

  it("gives the form's phone pattern the server's rule", () => {
    // Browsers compile `pattern` anchored, with the `v` flag.
    const html = new RegExp(`^(?:${CRM_PHONE_HTML_PATTERN})$`, "v");
    for (const phone of ["+17272377698", "+1 (415) 999-4863", "06.12.34.56.78", "+33 6 12 34 56 78", "1/2", "abc<script>", "+", "()", "12a", "++1"]) {
      expect(html.test(phone), phone).toBe(CRM_PHONE_PATTERN.test(phone));
    }
  });
});
