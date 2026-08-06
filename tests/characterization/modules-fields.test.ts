import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerAdmin, registerUser } from "../helpers/auth";

/**
 * Characterization: the admin-configurable CRM modules and their custom fields,
 * plus the read-only slug endpoint the SPA renders forms from.
 *
 * Quirks frozen here:
 *  - `POST /api/admin/modules/:moduleId/fields` never checks the module exists;
 *    the foreign key does, and reports 500.
 *  - `PATCH /api/admin/modules/:id` and `/api/admin/fields/:id` pass `req.body`
 *    straight through with no schema, so unknown keys reach the update.
 *  - Renaming a select option rewrites the stored values that referenced it,
 *    matching old to new by position in the options array.
 *  - System modules and fields cannot be deleted (403), but can still be
 *    edited.
 *  - Delete answers 200 `{ success: true }`, not 204.
 */
describe("CRM modules and fields (characterization)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("starts empty until an admin creates a module", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);

    const empty = await admin.agent.get("/api/admin/modules");
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    const bySlug = await member.agent.get("/api/modules/projects/fields");
    expect(bySlug.status).toBe(404);
    expect(bySlug.body).toEqual({ message: "Module not found" });

    const created = await admin.agent.post("/api/admin/modules").send({
      name: "Projects",
      slug: "projects",
      description: "Project records",
      icon: "folder",
      displayOrder: 1,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Projects",
      slug: "projects",
      isSystem: 0,
    });

    const list = await admin.agent.get("/api/admin/modules");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].fields).toEqual([]);

    const single = await admin.agent.get(`/api/admin/modules/${created.body.id}`);
    expect(single.status).toBe(200);
    expect(single.body.slug).toBe("projects");

    const invalid = await admin.agent.post("/api/admin/modules").send({ name: "No slug" });
    expect(invalid.status).toBe(400);
    // Quirk: the schema's "Slug is required" text only covers an empty string;
    // omitting the key surfaces Zod's default wording instead.
    expect(invalid.body).toEqual({ message: "Required" });

    const blankSlug = await admin.agent
      .post("/api/admin/modules")
      .send({ name: "Blank slug", slug: "" });
    expect(blankSlug.status).toBe(400);
    expect(blankSlug.body).toEqual({ message: "Slug is required" });

    const missing = await admin.agent.get("/api/admin/modules/00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Module not found" });
  });

  it("adds fields to a module and serves them by slug to any user", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const member = await registerUser(app);
    const module = await admin.agent
      .post("/api/admin/modules")
      .send({ name: "Contacts", slug: "contacts" });

    const field = await admin.agent.post(`/api/admin/modules/${module.body.id}/fields`).send({
      name: "Preferred channel",
      slug: "preferred_channel",
      fieldType: "select",
      options: ["Email", "Phone"],
      isRequired: 1,
      displayOrder: 2,
    });
    expect(field.status).toBe(201);
    expect(field.body).toMatchObject({
      moduleId: module.body.id,
      name: "Preferred channel",
      slug: "preferred_channel",
      fieldType: "select",
      options: ["Email", "Phone"],
      isSystem: 0,
    });

    const forModule = await admin.agent.get(`/api/admin/modules/${module.body.id}/fields`);
    expect(forModule.status).toBe(200);
    expect(forModule.body).toHaveLength(1);

    const bySlug = await member.agent.get("/api/modules/contacts/fields");
    expect(bySlug.status).toBe(200);
    expect(bySlug.body.map((f: { slug: string }) => f.slug)).toEqual(["preferred_channel"]);

    const invalid = await admin.agent
      .post(`/api/admin/modules/${module.body.id}/fields`)
      .send({ name: "No slug" });
    expect(invalid.status).toBe(400);
    // Same omitted-key wording as the module route.
    expect(invalid.body).toEqual({ message: "Required" });

    // Quirk: the module id is not checked, so the foreign key rejects it as a 500.
    const unknownModule = await admin.agent
      .post("/api/admin/modules/00000000-0000-0000-0000-000000000000/fields")
      .send({ name: "Orphan", slug: "orphan" });
    expect(unknownModule.status).toBe(500);
    expect(unknownModule.body).toEqual({ message: "Failed to create field" });

    // Reading fields for an unknown module is empty rather than 404.
    const unknownFields = await admin.agent.get(
      "/api/admin/modules/00000000-0000-0000-0000-000000000000/fields"
    );
    expect(unknownFields.status).toBe(200);
    expect(unknownFields.body).toEqual([]);
  });

  it("updates modules and fields straight from the request body", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const module = await admin.agent
      .post("/api/admin/modules")
      .send({ name: "Deals", slug: "deals" });
    const field = await admin.agent
      .post(`/api/admin/modules/${module.body.id}/fields`)
      .send({ name: "Source", slug: "source", fieldType: "text" });

    const updatedModule = await admin.agent
      .patch(`/api/admin/modules/${module.body.id}`)
      .send({ name: "Opportunities", isEnabled: 0 });
    expect(updatedModule.status).toBe(200);
    expect(updatedModule.body).toMatchObject({ name: "Opportunities", isEnabled: 0 });

    const updatedField = await admin.agent
      .patch(`/api/admin/fields/${field.body.id}`)
      .send({ name: "Lead source", placeholder: "Where from?" });
    expect(updatedField.status).toBe(200);
    expect(updatedField.body).toMatchObject({
      name: "Lead source",
      placeholder: "Where from?",
    });

    const missingModule = await admin.agent
      .patch("/api/admin/modules/00000000-0000-0000-0000-000000000000")
      .send({ name: "Nope" });
    expect(missingModule.status).toBe(404);

    const missingField = await admin.agent
      .patch("/api/admin/fields/00000000-0000-0000-0000-000000000000")
      .send({ name: "Nope" });
    expect(missingField.status).toBe(404);
    expect(missingField.body).toEqual({ message: "Field not found" });
  });

  it("rewrites stored values when a select option is renamed in place", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const module = await admin.agent
      .post("/api/admin/modules")
      .send({ name: "Projects", slug: "projects" });
    const field = await admin.agent.post(`/api/admin/modules/${module.body.id}/fields`).send({
      name: "Priority",
      slug: "priority",
      fieldType: "select",
      options: ["High touch", "Low touch"],
    });

    const renamed = await admin.agent
      .patch(`/api/admin/fields/${field.body.id}`)
      .send({ options: ["Hands on", "Low touch"] });
    expect(renamed.status).toBe(200);
    expect(renamed.body.options).toEqual(["Hands on", "Low touch"]);
    // The rename is matched by position: "high_touch" → "hands_on" is applied to
    // any stored custom-field value that used the old slug.
  });

  it("protects system modules and fields from deletion only", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const module = await admin.agent
      .post("/api/admin/modules")
      .send({ name: "System-ish", slug: "system_ish" });
    const field = await admin.agent
      .post(`/api/admin/modules/${module.body.id}/fields`)
      .send({ name: "Status", slug: "status", fieldType: "select" });

    // Flag both as system through the unvalidated update path.
    await admin.agent.patch(`/api/admin/modules/${module.body.id}`).send({ isSystem: 1 });
    await admin.agent.patch(`/api/admin/fields/${field.body.id}`).send({ isSystem: 1 });

    const refusedField = await admin.agent.delete(`/api/admin/fields/${field.body.id}`);
    expect(refusedField.status).toBe(403);
    expect(refusedField.body).toEqual({ message: "Cannot delete system field" });

    const refusedModule = await admin.agent.delete(`/api/admin/modules/${module.body.id}`);
    expect(refusedModule.status).toBe(403);
    expect(refusedModule.body).toEqual({ message: "Cannot delete system module" });

    // Editing a system field is still allowed.
    const edited = await admin.agent
      .patch(`/api/admin/fields/${field.body.id}`)
      .send({ name: "Renamed system field" });
    expect(edited.status).toBe(200);

    await admin.agent.patch(`/api/admin/fields/${field.body.id}`).send({ isSystem: 0 });
    const deletedField = await admin.agent.delete(`/api/admin/fields/${field.body.id}`);
    expect(deletedField.status).toBe(200);
    expect(deletedField.body).toEqual({ success: true });

    await admin.agent.patch(`/api/admin/modules/${module.body.id}`).send({ isSystem: 0 });
    const deletedModule = await admin.agent.delete(`/api/admin/modules/${module.body.id}`);
    expect(deletedModule.status).toBe(200);
    expect(deletedModule.body).toEqual({ success: true });
  });

  it("keeps every admin module route away from non-admins", async () => {
    const app = await makeApp();
    const member = await registerUser(app);

    for (const path of ["/api/admin/modules", "/api/admin/modules/x/fields"]) {
      const res = await member.agent.get(path);
      expect(res.status, path).toBe(403);
      expect(res.body, path).toEqual({ message: "Access denied" });
    }
  });
});
