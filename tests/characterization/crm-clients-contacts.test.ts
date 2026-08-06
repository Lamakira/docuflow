import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerUser } from "../helpers/auth";
import { createClient } from "../helpers/fixtures";

/**
 * Characterization: CRM clients (labelled "Contacts" in the UI) and the contact
 * people attached to them.
 *
 * Quirks frozen here:
 *  - Clients are company-wide: any authenticated user can read, edit or delete
 *    any client, whoever owns it.
 *  - `ownerId` is taken from the session and cannot be set by the caller.
 *  - Creating a contact takes `clientId` from the URL; a conflicting `clientId`
 *    in the body is overwritten rather than rejected.
 *  - A contact cannot be moved between clients: `clientId` is omitted from the
 *    update schema, so it is silently dropped.
 *  - Deleting a client cascades to its contacts through the foreign key.
 */
describe("CRM clients and contacts (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a client with defaults and ignores a caller-supplied owner", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const res = await user.agent.post("/api/crm/clients").send({
      name: "Acme Corp",
      company: "Acme",
      email: "hello@acme.test",
      ownerId: "not-this-user",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Acme Corp",
      company: "Acme",
      email: "hello@acme.test",
      status: "lead",
      phoneFormat: "us",
      source: null,
      fiverrUsername: null,
      // Quirk: `ownerId` is omitted from the insert schema, so the body value is
      // dropped and the session's user always wins.
      ownerId: user.id,
    });

    const invalid = await user.agent.post("/api/crm/clients").send({ company: "No name" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toBe("Invalid data");
    expect(Array.isArray(invalid.body.errors)).toBe(true);
  });

  it("shows every client to every user and allows anyone to edit or delete one", async () => {
    const app = await makeApp();
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const client = await createClient(owner.agent, { name: "Shared Client" });

    const list = await stranger.agent.get("/api/crm/clients");
    expect(list.status).toBe(200);
    expect(list.body.map((c: { id: string }) => c.id)).toEqual([client.id]);

    const updated = await stranger.agent
      .patch(`/api/crm/clients/${client.id}`)
      .send({ status: "client", notes: "edited by a stranger" });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ status: "client", notes: "edited by a stranger" });

    const removed = await stranger.agent.delete(`/api/crm/clients/${client.id}`);
    expect(removed.status).toBe(204);
    expect(removed.body).toEqual({});

    const gone = await owner.agent.get(`/api/crm/clients/${client.id}`);
    expect(gone.status).toBe(404);
    expect(gone.body).toEqual({ message: "Client not found" });
  });

  it("returns a client with its contacts inlined", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const client = await createClient(user.agent);

    const contact = await user.agent
      .post(`/api/crm/clients/${client.id}/contacts`)
      .send({ name: "Jane Doe", role: "CTO", email: "jane@acme.test", isPrimary: 1 });
    expect(contact.status).toBe(201);
    expect(contact.body).toMatchObject({
      clientId: client.id,
      name: "Jane Doe",
      role: "CTO",
      isPrimary: 1,
    });

    const res = await user.agent.get(`/api/crm/clients/${client.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(client.id);
    expect(res.body.contacts).toHaveLength(1);
    expect(res.body.contacts[0].id).toBe(contact.body.id);

    // Bare list responses do not carry contacts — only the single-client route does.
    const list = await user.agent.get("/api/crm/clients");
    expect(list.body[0]).not.toHaveProperty("contacts");
  });

  it("takes the contact's client from the URL, not the body", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const target = await createClient(user.agent, { name: "Target" });
    const decoy = await createClient(user.agent, { name: "Decoy" });

    const res = await user.agent
      .post(`/api/crm/clients/${target.id}/contacts`)
      .send({ name: "Routed", clientId: decoy.id });
    expect(res.status).toBe(201);
    // Quirk: the body's clientId is overwritten by the route parameter.
    expect(res.body.clientId).toBe(target.id);

    const missingClient = await user.agent
      .post("/api/crm/clients/00000000-0000-0000-0000-000000000000/contacts")
      .send({ name: "Orphan" });
    expect(missingClient.status).toBe(404);
    expect(missingClient.body).toEqual({ message: "Client not found" });
  });

  it("updates a contact but refuses to move it between clients", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const client = await createClient(user.agent);
    const other = await createClient(user.agent);
    const created = await user.agent
      .post(`/api/crm/clients/${client.id}/contacts`)
      .send({ name: "Movable" });

    const res = await user.agent
      .patch(`/api/crm/contacts/${created.body.id}`)
      .send({ name: "Renamed", clientId: other.id });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed");
    // Quirk: `clientId` is omitted from the update schema, so the move is
    // silently ignored and the caller gets a 200.
    expect(res.body.clientId).toBe(client.id);

    const missing = await user.agent
      .patch("/api/crm/contacts/00000000-0000-0000-0000-000000000000")
      .send({ name: "Nobody" });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Contact not found" });

    const removed = await user.agent.delete(`/api/crm/contacts/${created.body.id}`);
    expect(removed.status).toBe(204);
  });

  it("deletes a client's contacts along with the client", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const client = await createClient(user.agent);
    const contact = await user.agent
      .post(`/api/crm/clients/${client.id}/contacts`)
      .send({ name: "Cascaded" });

    await user.agent.delete(`/api/crm/clients/${client.id}`);

    const orphan = await user.agent
      .patch(`/api/crm/contacts/${contact.body.id}`)
      .send({ name: "Still there?" });
    expect(orphan.status).toBe(404);
  });
});
