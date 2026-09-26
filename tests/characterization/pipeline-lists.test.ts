import { describe, it, expect, beforeEach } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerAdmin, registerUser } from "../helpers/auth";
import { createClient } from "../helpers/fixtures";

/**
 * The built-in option lists Pipeline & lists edits: `projects.status`,
 * `projects.project_type` and `contacts.source`.
 *
 *  - `POST /api/admin/system-lists/ensure` creates the modules and fields a
 *    Workspace lacks, marks them system and fills an empty list with the
 *    defaults. Repeating it changes nothing.
 *  - Options carry stable ids. Moving, adding or removing an option rewrites no
 *    record; renaming one (same id, new value) rewrites every record holding the
 *    old value, in the same transaction as the list.
 *  - Values the code reads by name cannot be renamed or removed.
 */

type Field = { id: string; slug: string; isSystem: number; options: string[] | null };
type Module = { id: string; slug: string; isSystem: number; fields: Field[] };
type Option = { id?: string; label: string; color?: string };

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

function parsed(field: Field): Option[] {
  return (field.options ?? []).map((raw) => JSON.parse(raw));
}

function send(options: Option[]): string[] {
  return options.map((option) => JSON.stringify(option));
}

async function db() {
  const { pool } = await import("../../server/db");
  return pool;
}

async function projectWithStatus(agent: any, status: string): Promise<string> {
  const res = await agent.post("/api/crm/projects").send({ name: `P ${status}`, status });
  expect(res.status).toBe(201);
  return res.body.crmProject.id;
}

async function projectRow(id: string): Promise<{ status: string; project_type: string }> {
  const { rows } = await (await db()).query(`SELECT status, project_type FROM crm_projects WHERE id = $1`, [id]);
  return rows[0];
}

async function stageOf(crmProjectId: string): Promise<string | undefined> {
  const { rows } = await (await db()).query(`SELECT stage FROM opportunities WHERE crm_project_id = $1`, [crmProjectId]);
  return rows[0]?.stage;
}

async function sourceOf(clientId: string): Promise<string | null> {
  const { rows } = await (await db()).query(`SELECT source FROM crm_clients WHERE id = $1`, [clientId]);
  return rows[0].source;
}

describe("Built-in option lists (Pipeline & lists)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates the built-in lists once, marked system, with ids on every default", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const first = await ensure(admin.agent);
    const second = await ensure(admin.agent);
    expect(second).toEqual(first);

    expect(first.map((m) => [m.slug, m.isSystem])).toEqual([
      ["projects", 1],
      ["contacts", 1],
    ]);
    for (const [moduleSlug, fieldSlug] of [["projects", "status"], ["projects", "project_type"], ["contacts", "source"]]) {
      const field = fieldOf(first, moduleSlug, fieldSlug);
      expect(field.isSystem).toBe(1);
      for (const option of parsed(field)) expect(option.id).toBeTruthy();
    }
    expect(parsed(fieldOf(first, "contacts", "source"))).toEqual([
      { id: "fiverr", label: "Fiverr", color: "#1dbf73" },
      { id: "zoho", label: "Zoho", color: "#e42527" },
      { id: "direct", label: "Direct", color: "#3b82f6" },
    ]);
    expect(parsed(fieldOf(first, "projects", "status")).map((o) => o.id)).toEqual([
      "lead", "discovering_call_completed", "proposal_sent", "follow_up", "in_negotiation", "won",
      "won_not_started", "won_in_progress", "won_in_review", "won_completed", "lost", "won_cancelled",
    ]);
  });

  it("adopts a Workspace's own module and list, keeping what it saved", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const contacts = await admin.agent.post("/api/admin/modules").send({ name: "People", slug: "contacts" });
    const source = await admin.agent
      .post(`/api/admin/modules/${contacts.body.id}/fields`)
      .send({ name: "Channel", slug: "source", fieldType: "select", options: ["Walk-in", "Fiverr"] });
    const projects = await admin.agent.post("/api/admin/modules").send({ name: "Projects", slug: "projects" });
    const status = await admin.agent
      .post(`/api/admin/modules/${projects.body.id}/fields`)
      .send({ name: "Status", slug: "status", fieldType: "select", options: [] });

    const modules = await ensure(admin.agent);
    expect(modules.filter((m) => m.slug === "contacts")).toHaveLength(1);
    const adopted = fieldOf(modules, "contacts", "source");
    expect(adopted).toMatchObject({ id: source.body.id, isSystem: 1, options: ["Walk-in", "Fiverr"] });
    const filled = fieldOf(modules, "projects", "status");
    expect(filled.id).toBe(status.body.id);
    expect(parsed(filled)[0]).toEqual({ id: "lead", label: "Lead", color: "#ec4899" });
    expect(modules.find((m) => m.slug === "contacts")?.isSystem).toBe(1);
  });

  it("keeps the ensure route for Administrators", async () => {
    const app = await makeApp();
    const member = await registerUser(app);
    const res = await member.agent.post("/api/admin/system-lists/ensure");
    expect(res.status).toBe(403);
  });

  it("rewrites no record when options move, disappear or arrive", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const modules = await ensure(admin.agent);
    const status = fieldOf(modules, "projects", "status");
    const source = fieldOf(modules, "contacts", "source");
    const proposal = await projectWithStatus(admin.agent, "proposal_sent");
    const followUp = await projectWithStatus(admin.agent, "follow_up");
    const client = await createClient(admin.agent, { source: "zoho" });
    const stageBefore = await stageOf(proposal);
    expect(stageBefore).toBe("proposal_sent");

    // Swap two stages, drop one, and insert a new one at the front of the open stages.
    const stages = parsed(status);
    const [lead, discovering, proposalSent, follow, ...rest] = stages;
    const reshaped = [lead, { label: "Qualified", color: "#14b8a6" }, follow, proposalSent, ...rest];
    expect(discovering.id).toBe("discovering_call_completed");
    const res = await admin.agent.patch(`/api/admin/fields/${status.id}`).send({ options: send(reshaped) });
    expect(res.status).toBe(200);
    expect(parsed(res.body).map((o) => o.id).slice(0, 4)).toEqual(["lead", "qualified", "follow_up", "proposal_sent"]);
    expect((await projectRow(proposal)).status).toBe("proposal_sent");
    expect((await projectRow(followUp)).status).toBe("follow_up");
    expect(await stageOf(proposal)).toBe(stageBefore);

    // A v1-style list without ids, where Referral now sits where Zoho was.
    const legacy = await admin.agent
      .patch(`/api/admin/fields/${source.id}`)
      .send({ options: ['{"label":"Fiverr"}', '{"label":"Referral"}', '{"label":"Direct"}'] });
    expect(legacy.status).toBe(200);
    expect(parsed(legacy.body).map((o) => o.id)).toEqual(["fiverr", "referral", "direct"]);
    expect(await sourceOf(client.id)).toBe("zoho");
  });

  it("renames by id: every record holding the old value moves with it", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const modules = await ensure(admin.agent);
    const status = fieldOf(modules, "projects", "status");
    const source = fieldOf(modules, "contacts", "source");
    const proposal = await projectWithStatus(admin.agent, "proposal_sent");
    const followUp = await projectWithStatus(admin.agent, "follow_up");
    const negotiation = await projectWithStatus(admin.agent, "in_negotiation");
    const zoho = await createClient(admin.agent, { source: "zoho" });
    const direct = await createClient(admin.agent, { source: "direct" });

    // Rename one stage while moving it, and swap the names of two others.
    const stages = parsed(status).map((option) => {
      if (option.id === "proposal_sent") return { ...option, label: "Proposal out" };
      if (option.id === "follow_up") return { ...option, label: "In negotiation" };
      if (option.id === "in_negotiation") return { ...option, label: "Follow up" };
      return option;
    });
    [stages[1], stages[2]] = [stages[2], stages[1]];
    const res = await admin.agent.patch(`/api/admin/fields/${status.id}`).send({ options: send(stages) });
    expect(res.status).toBe(200);
    expect((await projectRow(proposal)).status).toBe("proposal_out");
    expect((await projectRow(followUp)).status).toBe("in_negotiation");
    expect((await projectRow(negotiation)).status).toBe("follow_up");
    expect(await stageOf(proposal)).toBe("proposal_out");
    expect(await stageOf(negotiation)).toBe("follow_up");

    const sources = parsed(source).map((option) => (option.id === "zoho" ? { ...option, label: "Zoho CRM" } : option));
    const renamed = await admin.agent.patch(`/api/admin/fields/${source.id}`).send({ options: send(sources) });
    expect(renamed.status).toBe(200);
    expect(await sourceOf(zoho.id)).toBe("zoho_crm");
    expect(await sourceOf(direct.id)).toBe("direct");
  });

  it("stores the list and its rewrites together, or neither", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const modules = await ensure(admin.agent);
    const source = fieldOf(modules, "contacts", "source");
    const client = await createClient(admin.agent, { source: "direct" });

    const pool = await db();
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_refuse_client_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'refused'; END $$;
      CREATE TRIGGER test_refuse_client_update BEFORE UPDATE ON crm_clients
        FOR EACH ROW EXECUTE FUNCTION test_refuse_client_update();
    `);
    try {
      const sources = parsed(source).map((option) => (option.id === "direct" ? { ...option, label: "Direct sale" } : option));
      const res = await admin.agent.patch(`/api/admin/fields/${source.id}`).send({ options: send(sources) });
      expect(res.status).toBe(500);
    } finally {
      await pool.query(`
        DROP TRIGGER IF EXISTS test_refuse_client_update ON crm_clients;
        DROP FUNCTION IF EXISTS test_refuse_client_update();
      `);
    }
    const after = fieldOf(await ensure(admin.agent), "contacts", "source");
    expect(after.options).toEqual(source.options);
    expect(await sourceOf(client.id)).toBe("direct");
  });

  it("refuses to rename or remove a value the code reads by name", async () => {
    const app = await makeApp();
    const admin = await registerAdmin(app);
    const modules = await ensure(admin.agent);
    const status = fieldOf(modules, "projects", "status");
    const types = fieldOf(modules, "projects", "project_type");
    const source = fieldOf(modules, "contacts", "source");
    const lead = await projectWithStatus(admin.agent, "lead");
    const patch = (field: Field, options: Option[]) =>
      admin.agent.patch(`/api/admin/fields/${field.id}`).send({ options: send(options) });

    const noWon = await patch(status, parsed(status).filter((o) => o.id !== "won"));
    expect(noWon.status).toBe(400);
    expect(noWon.body).toEqual({ message: "“Won” is built in and cannot be removed." });
    const prospect = await patch(status, parsed(status).map((o) => (o.id === "lead" ? { ...o, label: "Prospect" } : o)));
    expect(prospect.status).toBe(400);
    expect(prospect.body).toEqual({ message: "“Lead” is built in and cannot be renamed." });
    const followOn = await patch(status, parsed(status).filter((o) => o.id !== "won_in_review"));
    expect(followOn.status).toBe(400);
    // Re-adding it under a new id is still a removal of the built-in one.
    const swapped = await patch(status, parsed(status).map((o) => (o.id === "lost" ? { ...o, id: "lost_again" } : o)));
    expect(swapped.status).toBe(400);
    expect(swapped.body).toEqual({ message: "“Lost” is built in and cannot be removed." });

    for (const id of ["one_time", "monthly", "hourly_budget", "internal"]) {
      const res = await patch(types, parsed(types).filter((o) => o.id !== id));
      expect(res.status, id).toBe(400);
    }
    const fiverr = await patch(source, parsed(source).map((o) => (o.id === "fiverr" ? { ...o, label: "Fiverr Pro" } : o)));
    expect(fiverr.status).toBe(400);
    expect(fiverr.body).toEqual({ message: "“Fiverr” is built in and cannot be renamed." });
    expect((await projectRow(lead)).status).toBe("lead");

    // Recolouring, moving and relabelling to the same value are all fine.
    const allowed = parsed(status).map((o) => (o.id === "won" ? { ...o, color: "#14b8a6" } : o.id === "lead" ? { ...o, label: "LEAD" } : o));
    allowed.reverse();
    const ok = await patch(status, allowed);
    expect(ok.status).toBe(200);
    expect(parsed(ok.body).find((o) => o.id === "won")?.color).toBe("#14b8a6");
    // A Zoho or Direct Source is not read by name, so it may go.
    const noZoho = await patch(source, parsed(source).filter((o) => o.id !== "zoho"));
    expect(noZoho.status).toBe(200);
  });
});
