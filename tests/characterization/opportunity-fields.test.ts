import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerAdmin, registerUser } from "../helpers/auth";
import { createClient } from "../helpers/fixtures";

/**
 * An Opportunity carries more than a name and a Client (#276). The row behind
 * it is `crm_projects`, written through `POST` and `PATCH /api/crm/projects`:
 *
 *  - The Opportunity Owner is `opportunityOwnerId`, apart from the Project
 *    Manager (`assigneeId`). Expected close date is `dueDate`, Source is a
 *    value of the Pipeline & lists Source list, and the Estimated value is
 *    money in minor units with its currency. It is never the hours budget.
 *  - v2 marks an Opportunity Lost through `POST /api/crm/projects/:id/lost`,
 *    which needs a Lost reason from the Workspace's Lost reasons list, with an
 *    optional detail. v1's `PATCH` still moves a row to Lost without one.
 *    Leaving Lost clears both.
 *  - Winning keeps ADR-0001: the same row becomes the Client Project, taking
 *    the Project type, the budget in hours and the Project Manager it is given.
 *    The Opportunity keeps its Owner.
 *  - Notes are the `crm_project_notes` thread the Dossier already writes.
 */

type Field = { id: string; slug: string; options: string[] | null };
type Module = { slug: string; fields: Field[] };

async function ensure(agent: any): Promise<Module[]> {
  const res = await agent.post("/api/admin/system-lists/ensure");
  expect(res.status).toBe(200);
  return res.body;
}

function fieldOf(modules: Module[], moduleSlug: string, fieldSlug: string): Field {
  const field = modules.find((m) => m.slug === moduleSlug)?.fields.find((f) => f.slug === fieldSlug);
  if (!field) throw new Error(`missing ${moduleSlug}.${fieldSlug}`);
  return field;
}

async function opportunity(agent: any, body: Record<string, unknown> = {}): Promise<string> {
  const res = await agent.post("/api/crm/projects").send({ name: `Opportunity ${Math.random()}`, status: "lead", ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.crmProject.id;
}

async function read(agent: any, id: string) {
  const res = await agent.get(`/api/crm/projects/${id}`);
  expect(res.status).toBe(200);
  return res.body;
}

describe("Opportunity fields (#276)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sets every agreed field at creation and keeps the Estimated value apart from the hours budget", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const owner = await registerUser(app, { firstName: "Ama" });
    const client = await createClient(admin.agent);
    const id = await opportunity(admin.agent, {
      clientId: client.id,
      status: "proposal_sent",
      opportunityOwnerId: owner.id,
      dueDate: "2026-11-30T00:00:00.000Z",
      source: "direct",
      estimatedValueMinor: 450_000,
      estimatedValueCurrency: "EUR",
    });

    const row = await read(admin.agent, id);
    expect(row).toMatchObject({
      clientId: client.id,
      status: "proposal_sent",
      opportunityOwnerId: owner.id,
      assigneeId: null,
      source: "direct",
      estimatedValueMinor: 450_000,
      estimatedValueCurrency: "EUR",
      budgetedHours: null,
      lostReason: null,
    });
    expect(new Date(row.dueDate).toISOString()).toBe("2026-11-30T00:00:00.000Z");
  });

  it("edits the fields and ignores keys an edit may not send", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const id = await opportunity(admin.agent);
    const res = await admin.agent.patch(`/api/crm/projects/${id}`).send({
      projectName: "Harbour survey",
      source: "zoho",
      estimatedValueMinor: 120_000,
      estimatedValueCurrency: "USD",
      dueDate: "2026-12-15T00:00:00.000Z",
      projectStatus: "archived",
      workspaceId: "elsewhere",
      totalReviewMs: 99,
    });
    expect(res.status).toBe(200);
    const row = await read(admin.agent, id);
    expect(row).toMatchObject({
      source: "zoho",
      estimatedValueMinor: 120_000,
      estimatedValueCurrency: "USD",
      projectStatus: "planned",
      totalReviewMs: 0,
    });
    expect(row.project.name).toBe("Harbour survey");
    expect(row.workspaceId).not.toBe("elsewhere");

    const cleared = await admin.agent
      .patch(`/api/crm/projects/${id}`)
      .send({ estimatedValueMinor: null, estimatedValueCurrency: null, source: "" });
    expect(cleared.status).toBe(200);
    expect(await read(admin.agent, id)).toMatchObject({ estimatedValueMinor: null, estimatedValueCurrency: null, source: null });
  });

  it("refuses an Estimated value that is not an amount with a currency", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const id = await opportunity(admin.agent);
    const patch = (body: Record<string, unknown>) => admin.agent.patch(`/api/crm/projects/${id}`).send(body);

    const alone = await patch({ estimatedValueMinor: 5000 });
    expect(alone.status).toBe(400);
    expect(alone.body.message).toBe("An Estimated value needs both an amount and a currency.");
    expect((await patch({ estimatedValueMinor: -1, estimatedValueCurrency: "EUR" })).status).toBe(400);
    expect((await patch({ estimatedValueMinor: 10.5, estimatedValueCurrency: "EUR" })).status).toBe(400);
    expect((await patch({ estimatedValueMinor: 100, estimatedValueCurrency: "XYZ" })).status).toBe(400);
    expect((await patch({ estimatedValueMinor: "100", estimatedValueCurrency: "EUR" })).status).toBe(400);
    const create = await admin.agent
      .post("/api/crm/projects")
      .send({ name: "No currency", estimatedValueMinor: 100 });
    expect(create.status).toBe(400);
    expect((await read(admin.agent, id)).estimatedValueMinor).toBeNull();
  });

  it("takes a Source from the Workspace's Source list, and keeps a legacy one already held", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const id = await opportunity(admin.agent);
    const unknown = await admin.agent.patch(`/api/crm/projects/${id}`).send({ source: "referral" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toBe("“referral” is not in this Workspace's Source list.");

    const source = fieldOf(await ensure(admin.agent), "contacts", "source");
    const added = await admin.agent
      .patch(`/api/admin/fields/${source.id}`)
      .send({ options: [...(source.options ?? []), JSON.stringify({ label: "Referral" })] });
    expect(added.status).toBe(200);
    expect((await admin.agent.patch(`/api/crm/projects/${id}`).send({ source: "referral" })).status).toBe(200);

    // Removing it from the list leaves the Opportunity's value, and resending it is fine.
    const removed = await admin.agent.patch(`/api/admin/fields/${source.id}`).send({ options: source.options });
    expect(removed.status).toBe(200);
    expect((await read(admin.agent, id)).source).toBe("referral");
    expect((await admin.agent.patch(`/api/crm/projects/${id}`).send({ source: "referral", projectName: "Kept" })).status).toBe(200);
  });

  it("marks an Opportunity Lost from v2 only with a Lost reason, and clears it when it leaves Lost", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const id = await opportunity(admin.agent, { status: "in_negotiation" });
    const markLost = (body: Record<string, unknown>) => admin.agent.post(`/api/crm/projects/${id}/lost`).send(body);
    const patch = (body: Record<string, unknown>) => admin.agent.patch(`/api/crm/projects/${id}`).send(body);

    for (const bare of [{}, { lostReason: "" }, { lostReason: null, lostReasonDetail: "No reason given" }]) {
      const refused = await markLost(bare);
      expect(refused.status).toBe(400);
      expect(refused.body.message).toBe("Choose a Lost reason to mark this Opportunity Lost.");
    }
    expect((await read(admin.agent, id)).status).toBe("in_negotiation");

    const unknown = await markLost({ lostReason: "weather" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toBe("“weather” is not in this Workspace's Lost reasons.");

    const early = await patch({ lostReason: "price" });
    expect(early.status).toBe(400);
    expect(early.body.message).toBe("A Lost reason is kept only on a Lost Opportunity.");

    const lost = await markLost({ lostReason: "chose_a_competitor", lostReasonDetail: "  Went with Acme.  " });
    expect(lost.status).toBe(200);
    expect(await read(admin.agent, id)).toMatchObject({
      status: "lost",
      projectStatus: "archived",
      lostReason: "chose_a_competitor",
      lostReasonDetail: "Went with Acme.",
    });
    const history = await admin.agent.get(`/api/crm/projects/${id}/stage-history`);
    expect(history.body.map((row: any) => [row.fromStatus, row.toStatus])).toEqual([["in_negotiation", "lost"]]);

    // Once Lost, v2 changes the reason without a second Stage change, and never empties it.
    expect((await markLost({ lostReason: "timing" })).status).toBe(200);
    expect((await markLost({ lostReason: null })).status).toBe(400);
    expect(await read(admin.agent, id)).toMatchObject({ status: "lost", lostReason: "timing", lostReasonDetail: null });
    expect((await admin.agent.get(`/api/crm/projects/${id}/stage-history`)).body).toHaveLength(1);

    const reopened = await patch({ status: "follow_up" });
    expect(reopened.status).toBe(200);
    expect(await read(admin.agent, id)).toMatchObject({ status: "follow_up", lostReason: null, lostReasonDetail: null });
  });

  it("still lets v1 move an Opportunity to Lost without a reason", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const id = await opportunity(admin.agent, { status: "proposal_sent" });
    const v1 = await admin.agent.patch(`/api/crm/projects/${id}`).send({ status: "lost" });
    expect(v1.status).toBe(200);
    expect(await read(admin.agent, id)).toMatchObject({ status: "lost", projectStatus: "archived", lostReason: null });
    const history = await admin.agent.get(`/api/crm/projects/${id}/stage-history`);
    expect(history.body.map((row: any) => [row.fromStatus, row.toStatus])).toEqual([["proposal_sent", "lost"]]);

    // v2 then asks for the reason v1 did not give.
    expect((await admin.agent.post(`/api/crm/projects/${id}/lost`).send({})).status).toBe(400);
    expect((await admin.agent.post(`/api/crm/projects/${id}/lost`).send({ lostReason: "price" })).status).toBe(200);
  });

  it("marks only an open Opportunity Lost from v2", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const documented = await opportunity(admin.agent, { isDocumentationOnly: true });
    const noOpportunity = await admin.agent.post(`/api/crm/projects/${documented}/lost`).send({ lostReason: "price" });
    expect(noOpportunity.status).toBe(400);
    expect(noOpportunity.body.message).toBe("Only an Opportunity can be marked Lost.");
    // v1 still moves a row without an Opportunity as it always did.
    expect((await admin.agent.patch(`/api/crm/projects/${documented}`).send({ status: "lost" })).status).toBe(200);

    const won = await opportunity(admin.agent, { status: "won" });
    const refused = await admin.agent.post(`/api/crm/projects/${won}/lost`).send({ lostReason: "price" });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe("A won Opportunity cannot be marked Lost.");
    expect((await admin.agent.post("/api/crm/projects/missing/lost").send({ lostReason: "price" })).status).toBe(404);
  });

  it("names a v1 Opportunity's assignee its Owner, and keeps the two apart afterwards", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const seller = await registerUser(app);
    const other = await registerUser(app);
    const v1 = await opportunity(admin.agent, { assigneeId: seller.id });
    expect(await read(admin.agent, v1)).toMatchObject({ assigneeId: seller.id, opportunityOwnerId: seller.id });

    expect((await admin.agent.patch(`/api/crm/projects/${v1}`).send({ assigneeId: other.id })).status).toBe(200);
    expect(await read(admin.agent, v1)).toMatchObject({ assigneeId: other.id, opportunityOwnerId: seller.id });
    expect((await admin.agent.patch(`/api/crm/projects/${v1}`).send({ opportunityOwnerId: other.id })).status).toBe(200);
    expect(await read(admin.agent, v1)).toMatchObject({ assigneeId: other.id, opportunityOwnerId: other.id });

    const internal = await opportunity(admin.agent, { projectType: "internal", assigneeId: seller.id });
    expect((await read(admin.agent, internal)).opportunityOwnerId).toBeNull();
  });

  it("wins into the Client Project it gives a Project type, an hours budget and a Project Manager, keeping the Owner", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const manager = await registerUser(app);
    const client = await createClient(admin.agent);
    const id = await opportunity(admin.agent, {
      clientId: client.id,
      opportunityOwnerId: owner.id,
      estimatedValueMinor: 900_000,
      estimatedValueCurrency: "EUR",
    });

    const internal = await admin.agent.patch(`/api/crm/projects/${id}`).send({ status: "won", projectType: "internal" });
    expect(internal.status).toBe(400);
    expect(internal.body.message).toBe("Winning creates a Client Project, so its Project type cannot be Internal.");

    const won = await admin.agent.patch(`/api/crm/projects/${id}`).send({
      status: "won",
      projectType: "monthly",
      budgetedHours: 40,
      budgetedMinutes: 30,
      assigneeId: manager.id,
    });
    expect(won.status).toBe(200);
    expect(await read(admin.agent, id)).toMatchObject({
      status: "won",
      projectStatus: "planned",
      projectType: "monthly",
      budgetedHours: 40,
      budgetedMinutes: 30,
      assigneeId: manager.id,
      opportunityOwnerId: owner.id,
      estimatedValueMinor: 900_000,
      estimatedValueCurrency: "EUR",
    });
    const members = await admin.agent.get(`/api/crm/projects/${id}/members`);
    expect(members.body.map((row: any) => row.userId)).toContain(manager.id);

    // Delivery moves after the win are not an Opportunity changing its Project type.
    expect((await admin.agent.patch(`/api/crm/projects/${id}`).send({ status: "won_in_progress" })).status).toBe(200);
  });

  it("keeps a Lost reasons list in Pipeline & lists, and a rename moves every Opportunity holding it", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const reasons = fieldOf(await ensure(admin.agent), "projects", "lost_reason");
    expect((reasons.options ?? []).map((raw) => JSON.parse(raw).id)).toEqual([
      "price",
      "timing",
      "chose_a_competitor",
      "no_response",
      "other",
    ]);

    const id = await opportunity(admin.agent);
    expect((await admin.agent.post(`/api/crm/projects/${id}/lost`).send({ lostReason: "price" })).status).toBe(200);
    const renamed = (reasons.options ?? []).map((raw) => {
      const option = JSON.parse(raw);
      return JSON.stringify(option.id === "price" ? { ...option, label: "Budget" } : option);
    });
    expect((await admin.agent.patch(`/api/admin/fields/${reasons.id}`).send({ options: renamed })).status).toBe(200);
    expect((await read(admin.agent, id)).lostReason).toBe("budget");
  });

  it("renames an Opportunity's Source with the Clients recorded from it", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const source = fieldOf(await ensure(admin.agent), "contacts", "source");
    const id = await opportunity(admin.agent, { source: "zoho" });
    const renamed = (source.options ?? []).map((raw) => {
      const option = JSON.parse(raw);
      return JSON.stringify(option.id === "zoho" ? { ...option, label: "Zoho CRM" } : option);
    });
    expect((await admin.agent.patch(`/api/admin/fields/${source.id}`).send({ options: renamed })).status).toBe(200);
    expect((await read(admin.agent, id)).source).toBe("zoho_crm");
  });

  it("keeps Notes as the dated thread the Dossier writes: add, edit, delete", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const id = await opportunity(admin.agent);
    const created = await admin.agent.post(`/api/crm/projects/${id}/notes`).send({ content: "Called the buyer." });
    expect(created.status).toBe(201);
    const edited = await admin.agent
      .patch(`/api/crm/projects/${id}/notes/${created.body.id}`)
      .send({ content: "Called the buyer; proposal on Friday." });
    expect(edited.status).toBe(200);
    const notes = await admin.agent.get(`/api/crm/projects/${id}/notes`);
    expect(notes.body.map((note: any) => note.content)).toEqual(["Called the buyer; proposal on Friday."]);
    expect(notes.body[0].createdAt).toBeTruthy();
    expect((await admin.agent.delete(`/api/crm/projects/${id}/notes/${created.body.id}`)).status).toBe(204);
    expect((await admin.agent.get(`/api/crm/projects/${id}/notes`)).body).toEqual([]);
  });
});
