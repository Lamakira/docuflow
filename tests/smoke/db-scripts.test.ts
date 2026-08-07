import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { backfillCrmLinks } from "../../scripts/backfill-crm-links";
import { openDb } from "../../scripts/lib/db";
import { seedDefaults } from "../../scripts/seed-defaults";
import { crmModuleFields, crmModules, orgSettings, projects, users } from "../../shared/schema";
import { resetDb } from "../helpers/db";
import { resolveTestDatabaseUrl } from "../test-db-url";

/**
 * The two scripts that took over what `server/index.ts` used to do on every boot
 * (#24). Their whole point is that the rows they write are unchanged from what
 * boot wrote, so this suite pins those rows: a diff here is a diff in what every
 * new environment starts with, or in how legacy projects were classified.
 *
 * They run against the database directly rather than over HTTP because that is
 * how an operator runs them — and, for the backfill, because a project with no
 * CRM row is a state no current endpoint can produce. It is legacy data, which
 * is the reason the backfill exists.
 */

const { db, close } = openDb(resolveTestDatabaseUrl());

afterAll(() => close());

beforeEach(async () => {
  await resetDb();
});

describe("db:seed", () => {
  it("seeds the two system modules with their fields", async () => {
    await seedDefaults(db);

    const modules = await db.select().from(crmModules).orderBy(crmModules.displayOrder);
    expect(modules.map((m) => ({ slug: m.slug, name: m.name, icon: m.icon, isSystem: m.isSystem }))).toEqual([
      { slug: "projects", name: "Projects", icon: "folder", isSystem: 1 },
      { slug: "contacts", name: "Contacts", icon: "users", isSystem: 1 },
    ]);

    const fields = await db.select().from(crmModuleFields);
    const bySlug = (moduleId: string) =>
      fields
        .filter((f) => f.moduleId === moduleId)
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((f) => f.slug);

    expect(bySlug(modules[0].id)).toEqual([
      "name",
      "status",
      "project_type",
      "client_id",
      "assignee_id",
      "description",
      "comments",
      "start_date",
      "due_date",
      "actual_finish_date",
      "budgeted_hours",
      "actual_hours",
      "documentation_enabled",
      "is_documentation_only",
    ]);
    expect(bySlug(modules[1].id)).toEqual([
      "first_name",
      "last_name",
      "status",
      "email",
      "phone",
      "company",
      "job_title",
      "address",
      "website",
      "notes",
    ]);
  });

  it("keeps the project stage options and their colours", async () => {
    await seedDefaults(db);

    const [projectsModule] = await db.select().from(crmModules).where(eq(crmModules.slug, "projects"));
    const fields = await db
      .select()
      .from(crmModuleFields)
      .where(eq(crmModuleFields.moduleId, projectsModule.id));
    const status = fields.find((f) => f.slug === "status");

    expect(status?.options).toEqual([
      '{"label":"lead","color":"#64748b"}',
      '{"label":"discovering_call_completed","color":"#8b5cf6"}',
      '{"label":"proposal_sent","color":"#f59e0b"}',
      '{"label":"follow_up","color":"#06b6d4"}',
      '{"label":"in_negotiation","color":"#3b82f6"}',
      '{"label":"won","color":"#22c55e"}',
      '{"label":"won_not_started","color":"#10b981"}',
      '{"label":"won_in_progress","color":"#14b8a6"}',
      '{"label":"won_in_review","color":"#0ea5e9"}',
      '{"label":"won_completed","color":"#84cc16"}',
      '{"label":"lost","color":"#ef4444"}',
      '{"label":"won_cancelled","color":"#f43f5e"}',
    ]);
  });

  it("seeds the single org_settings row with nothing set", async () => {
    await seedDefaults(db);

    const settings = await db.select().from(orgSettings);
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({
      id: "default",
      screenshotPolicy: null,
      allowedTimezones: null,
      helpCenterScreenshots: null,
    });
  });

  it("leaves an already-configured database alone", async () => {
    await seedDefaults(db);
    await db.update(crmModules).set({ name: "Renamed" }).where(eq(crmModules.slug, "projects"));
    await db.delete(crmModules).where(eq(crmModules.slug, "contacts"));

    await seedDefaults(db);

    const modules = await db.select().from(crmModules);
    expect(modules.map((m) => m.name)).toEqual(["Renamed"]);
  });
});

describe("db:backfill:crm-links", () => {
  /** A documentation project from before the CRM existed: no crm_projects row. */
  async function insertOrphanProject(name: string): Promise<string> {
    const [owner] = await db
      .insert(users)
      .values({
        id: randomUUID(),
        email: `${randomUUID()}@example.test`,
        // Never used — nothing here logs in — but the column is NOT NULL.
        password: "not-a-real-hash",
        role: "user",
      })
      .returning({ id: users.id });
    const [project] = await db
      .insert(projects)
      .values({ name, ownerId: owner.id })
      .returning({ id: projects.id });
    return project.id;
  }

  it("links every orphan as a documented, documentation-enabled project", async () => {
    await insertOrphanProject("Legacy handbook");
    await insertOrphanProject("Legacy runbook");

    const result = await backfillCrmLinks(db);

    expect(result).toEqual({ linkedCount: 2, failedCount: 0, remainingOrphans: 0 });

    const linked = await db.query.crmProjects.findMany();
    expect(linked).toHaveLength(2);
    for (const row of linked) {
      expect(row).toMatchObject({
        status: "documented",
        documentationEnabled: 1,
        clientId: null,
        assigneeId: null,
        startDate: null,
        dueDate: null,
        actualFinishDate: null,
        comments: "Auto-migrated from standalone documentation project",
      });
    }
  });

  it("is a no-op on a second run", async () => {
    await insertOrphanProject("Legacy handbook");
    await backfillCrmLinks(db);

    const second = await backfillCrmLinks(db);

    expect(second).toEqual({ linkedCount: 0, failedCount: 0, remainingOrphans: 0 });
    expect(await db.query.crmProjects.findMany()).toHaveLength(1);
  });

  it("links every orphan past the first batch", async () => {
    // The backfill reads 200 rows at a time, and a legacy database has more
    // than that. This pins that the loop clears all of them — the property the
    // id paging exists to give it. (What the paging additionally protects, and
    // what no test here forces, is a run where an insert fails: the failing
    // project stays an orphan, and only ordering keeps the loop from handing
    // back the same page forever or stopping with the rest untouched.)
    const count = 250;
    const owners = await db
      .insert(users)
      .values(
        Array.from({ length: count }, () => ({
          id: randomUUID(),
          email: `${randomUUID()}@example.test`,
          password: "not-a-real-hash",
          role: "user",
        }))
      )
      .returning({ id: users.id });
    await db
      .insert(projects)
      .values(owners.map((owner, at) => ({ name: `Legacy ${at}`, ownerId: owner.id })));

    const result = await backfillCrmLinks(db);

    expect(result).toEqual({ linkedCount: count, failedCount: 0, remainingOrphans: 0 });
  }, 60_000);

  it("counts without writing under --dry-run", async () => {
    await insertOrphanProject("Legacy handbook");

    const result = await backfillCrmLinks(db, { dryRun: true });

    expect(result).toEqual({ linkedCount: 0, failedCount: 0, remainingOrphans: 1 });
    expect(await db.query.crmProjects.findMany()).toHaveLength(0);
  });
});
