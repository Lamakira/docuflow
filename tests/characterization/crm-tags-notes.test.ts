import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerUser } from "../helpers/auth";
import { createCrmProject } from "../helpers/fixtures";

/**
 * Characterization: CRM tags and project notes.
 *
 * Quirks frozen here:
 *  - Tag and note deletes answer 204 whether or not the row existed — no 404.
 *  - Tag names are not unique and not checked, so duplicates are allowed.
 *  - Attaching a tag to a non-existent project fails the foreign key and
 *    surfaces as a 500.
 *  - Note creation never verifies the project exists, for the same reason.
 *  - Mention notifications skip the author, and an update only notifies the
 *    mentions that are new.
 *  - Note attachments go in as an array and come back as a JSON string.
 */
describe("CRM tags and notes (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates, lists, renames and deletes tags without enforcing uniqueness", async () => {
    const app = await makeApp();
    const user = await registerUser(app);

    const created = await user.agent.post("/api/crm/tags").send({ name: "Urgent", color: "#ff0000" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Urgent", color: "#ff0000" });

    // Quirk: nothing stops a second tag with the same name.
    const duplicate = await user.agent.post("/api/crm/tags").send({ name: "Urgent" });
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.id).not.toBe(created.body.id);

    const list = await user.agent.get("/api/crm/tags");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);

    const renamed = await user.agent
      .patch(`/api/crm/tags/${created.body.id}`)
      .send({ name: "Critical" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Critical");

    const missing = await user.agent
      .patch("/api/crm/tags/00000000-0000-0000-0000-000000000000")
      .send({ name: "Nope" });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Tag not found" });

    const invalid = await user.agent.post("/api/crm/tags").send({ color: "#fff" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toBe("Invalid data");

    const removed = await user.agent.delete(`/api/crm/tags/${created.body.id}`);
    expect(removed.status).toBe(204);
    // Quirk: deleting a tag that was never there is also a 204.
    const removedAgain = await user.agent.delete(`/api/crm/tags/${created.body.id}`);
    expect(removedAgain.status).toBe(204);
  });

  it("attaches and detaches project tags, failing loudly on an unknown project", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    const tag = await user.agent.post("/api/crm/tags").send({ name: "Retainer" });

    const attached = await user.agent.post(
      `/api/crm/projects/${crmProject.id}/tags/${tag.body.id}`
    );
    expect(attached.status).toBe(201);
    expect(attached.body).toMatchObject({ crmProjectId: crmProject.id, tagId: tag.body.id });

    const tags = await user.agent.get(`/api/crm/projects/${crmProject.id}/tags`);
    expect(tags.status).toBe(200);
    expect(tags.body.map((t: { id: string }) => t.id)).toEqual([tag.body.id]);

    const detached = await user.agent.delete(
      `/api/crm/projects/${crmProject.id}/tags/${tag.body.id}`
    );
    expect(detached.status).toBe(204);
    expect((await user.agent.get(`/api/crm/projects/${crmProject.id}/tags`)).body).toEqual([]);

    // Quirk: no existence check, so the foreign key rejects it and the generic
    // catch turns that into a 500.
    const unknownProject = await user.agent.post(
      `/api/crm/projects/00000000-0000-0000-0000-000000000000/tags/${tag.body.id}`
    );
    expect(unknownProject.status).toBe(500);
    expect(unknownProject.body).toEqual({ message: "Failed to add tag to project" });

    // Reading tags for an unknown project is simply empty.
    const unknownTags = await user.agent.get(
      "/api/crm/projects/00000000-0000-0000-0000-000000000000/tags"
    );
    expect(unknownTags.status).toBe(200);
    expect(unknownTags.body).toEqual([]);
  });

  it("creates a note with its author inlined and attachments stringified", async () => {
    const app = await makeApp();
    const user = await registerUser(app, { firstName: "Nora" });
    const { crmProject } = await createCrmProject(user.agent);

    const created = await user.agent.post(`/api/crm/projects/${crmProject.id}/notes`).send({
      content: "Kickoff call done",
      attachments: [
        { url: "/objects/uploads/deck", filename: "deck.pdf", filesize: 12, filetype: "application/pdf" },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      crmProjectId: crmProject.id,
      content: "Kickoff call done",
      createdById: user.id,
      mentionedUserIds: null,
    });
    // Quirk: attachments are stored as a JSON string, so clients parse what they
    // sent as an array back out of a string.
    expect(typeof created.body.attachments).toBe("string");
    expect(JSON.parse(created.body.attachments)[0].filename).toBe("deck.pdf");

    const list = await user.agent.get(`/api/crm/projects/${crmProject.id}/notes`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].createdBy).toMatchObject({ id: user.id, firstName: "Nora" });

    const invalid = await user.agent
      .post(`/api/crm/projects/${crmProject.id}/notes`)
      .send({ content: "" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toBe("Invalid data");

    // Quirk: an unknown project is only caught by the foreign key.
    const unknownProject = await user.agent
      .post("/api/crm/projects/00000000-0000-0000-0000-000000000000/notes")
      .send({ content: "Orphan note" });
    expect(unknownProject.status).toBe(500);
    expect(unknownProject.body).toEqual({ message: "Failed to create note" });
  });

  it("notifies mentioned users on create, and only new mentions on update", async () => {
    const app = await makeApp();
    const author = await registerUser(app, { firstName: "Ann" });
    const first = await registerUser(app);
    const second = await registerUser(app);
    const { crmProject } = await createCrmProject(author.agent);

    const created = await author.agent.post(`/api/crm/projects/${crmProject.id}/notes`).send({
      content: "cc @first and myself",
      mentionedUserIds: [first.id, author.id],
    });
    expect(created.status).toBe(201);

    const firstInbox = await first.agent.get("/api/notifications");
    expect(firstInbox.body).toHaveLength(1);
    expect(firstInbox.body[0]).toMatchObject({
      type: "mention",
      noteId: created.body.id,
      crmProjectId: crmProject.id,
      fromUserId: author.id,
      message: null,
    });
    // Quirk: the author is skipped even when they mention themselves.
    expect((await author.agent.get("/api/notifications")).body).toEqual([]);

    const updated = await author.agent
      .patch(`/api/crm/projects/${crmProject.id}/notes/${created.body.id}`)
      .send({ content: "cc both", mentionedUserIds: [first.id, second.id] });
    expect(updated.status).toBe(200);
    expect(updated.body.content).toBe("cc both");

    // The already-mentioned user is not notified twice; the new one is.
    expect((await first.agent.get("/api/notifications")).body).toHaveLength(1);
    expect((await second.agent.get("/api/notifications")).body).toHaveLength(1);

    const missingNote = await author.agent
      .patch(`/api/crm/projects/${crmProject.id}/notes/00000000-0000-0000-0000-000000000000`)
      .send({ content: "Nope" });
    expect(missingNote.status).toBe(404);
    expect(missingNote.body).toEqual({ message: "Note not found" });
  });

  it("deletes a note, and reports success for one that was never there", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const { crmProject } = await createCrmProject(user.agent);
    const note = await user.agent
      .post(`/api/crm/projects/${crmProject.id}/notes`)
      .send({ content: "Temporary" });

    const removed = await user.agent.delete(
      `/api/crm/projects/${crmProject.id}/notes/${note.body.id}`
    );
    expect(removed.status).toBe(204);
    expect((await user.agent.get(`/api/crm/projects/${crmProject.id}/notes`)).body).toEqual([]);

    // Quirk: no existence check on delete.
    const again = await user.agent.delete(
      `/api/crm/projects/${crmProject.id}/notes/${note.body.id}`
    );
    expect(again.status).toBe(204);
  });
});
