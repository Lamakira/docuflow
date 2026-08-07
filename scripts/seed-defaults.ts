/**
 * seed-defaults.ts — the reference rows a fresh database needs before the app
 * is useful: the two system CRM modules with their fields, and the single
 * `org_settings` row every settings read expects to find.
 *
 *   npm run db:seed
 *
 * Both used to happen on every server boot — `storage.seedDefaultCrmModules()`
 * from `server/index.ts`, and an `INSERT` inside what was migration 005. #24
 * takes data out of boot and out of schema migrations (ADR-0017); this is where
 * it went. Run it once after `npm run db:migrate` on a new database.
 *
 * The rows are frozen exactly as boot produced them — same slugs, same display
 * order, same select options and colours. This is not the place to redesign the
 * default CRM configuration; changing a value here changes what every new
 * environment starts with, and diverges it from production.
 *
 * Idempotent, and by the same rule boot used: if `crm_modules` has any row, the
 * whole seed is skipped rather than merged. An environment that has edited its
 * modules through the admin UI is never overwritten.
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { crmModuleFields, crmModules, orgSettings } from "../shared/schema";
import { openDb, type ScriptDb } from "./lib/db";

/** The `org_settings` primary key the settings endpoints read and write. */
const ORG_SETTINGS_ROW_ID = "default";

export async function seedCrmDefaults(
  db: ScriptDb,
  report: (message: string) => void = () => {}
): Promise<{ seeded: boolean }> {
  const existingModules = await db.select().from(crmModules);
  if (existingModules.length > 0) {
    report(`crm modules: ${existingModules.length} already present, skipping`);
    return { seeded: false };
  }

  // Two top-level modules: Projects and Contacts
  const defaultModules = [
    {
      id: randomUUID(),
      name: "Projects",
      slug: "projects",
      description: "Project management and tracking",
      icon: "folder",
      displayOrder: 1,
      isEnabled: 1,
      isSystem: 1,
    },
    {
      id: randomUUID(),
      name: "Contacts",
      slug: "contacts",
      description: "Client and contact management",
      icon: "users",
      displayOrder: 2,
      isEnabled: 1,
      isSystem: 1,
    },
  ];

  for (const mod of defaultModules) {
    await db.insert(crmModules).values(mod);
  }

  const projectsModule = defaultModules[0];
  const contactsModule = defaultModules[1];

  const defaultFields = [
    // Projects fields
    { moduleId: projectsModule.id, name: "Project Name", slug: "name", fieldType: "text" as const, displayOrder: 1, isRequired: 1, isEnabled: 1, isSystem: 1 },
    { moduleId: projectsModule.id, name: "Status", slug: "status", fieldType: "select" as const, options: [
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
      '{"label":"won_cancelled","color":"#f43f5e"}'
    ], displayOrder: 2, isRequired: 1, isEnabled: 1, isSystem: 1 },
    { moduleId: projectsModule.id, name: "Project Type", slug: "project_type", fieldType: "select" as const, options: ["one_time", "monthly", "hourly_budget", "internal"], displayOrder: 3, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: projectsModule.id, name: "Client", slug: "client_id", fieldType: "select" as const, description: "Associated client", displayOrder: 4, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: projectsModule.id, name: "Assignee", slug: "assignee_id", fieldType: "select" as const, description: "Team member responsible", displayOrder: 5, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: projectsModule.id, name: "Description", slug: "description", fieldType: "textarea" as const, displayOrder: 6, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: projectsModule.id, name: "Comments", slug: "comments", fieldType: "textarea" as const, displayOrder: 7, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: projectsModule.id, name: "Start Date", slug: "start_date", fieldType: "date" as const, displayOrder: 8, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: projectsModule.id, name: "Due Date", slug: "due_date", fieldType: "date" as const, displayOrder: 9, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: projectsModule.id, name: "Actual Finish Date", slug: "actual_finish_date", fieldType: "date" as const, displayOrder: 10, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: projectsModule.id, name: "Budgeted Hours", slug: "budgeted_hours", fieldType: "number" as const, displayOrder: 11, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: projectsModule.id, name: "Actual Hours", slug: "actual_hours", fieldType: "number" as const, displayOrder: 12, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: projectsModule.id, name: "Documentation Enabled", slug: "documentation_enabled", fieldType: "checkbox" as const, displayOrder: 13, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: projectsModule.id, name: "Documentation Only", slug: "is_documentation_only", fieldType: "checkbox" as const, displayOrder: 14, isRequired: 0, isEnabled: 1, isSystem: 1 },

    // Contacts fields
    { moduleId: contactsModule.id, name: "First Name", slug: "first_name", fieldType: "text" as const, displayOrder: 1, isRequired: 1, isEnabled: 1, isSystem: 1 },
    { moduleId: contactsModule.id, name: "Last Name", slug: "last_name", fieldType: "text" as const, displayOrder: 2, isRequired: 1, isEnabled: 1, isSystem: 1 },
    { moduleId: contactsModule.id, name: "Status", slug: "status", fieldType: "select" as const, options: [
      '{"label":"lead","color":"#64748b"}',
      '{"label":"prospect","color":"#8b5cf6"}',
      '{"label":"client","color":"#22c55e"}',
      '{"label":"client_recurrent","color":"#14b8a6"}'
    ], displayOrder: 3, isRequired: 1, isEnabled: 1, isSystem: 1 },
    { moduleId: contactsModule.id, name: "Email", slug: "email", fieldType: "email" as const, displayOrder: 4, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: contactsModule.id, name: "Phone", slug: "phone", fieldType: "phone" as const, displayOrder: 5, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: contactsModule.id, name: "Company", slug: "company", fieldType: "text" as const, displayOrder: 6, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: contactsModule.id, name: "Job Title", slug: "job_title", fieldType: "text" as const, displayOrder: 7, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: contactsModule.id, name: "Address", slug: "address", fieldType: "textarea" as const, displayOrder: 8, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: contactsModule.id, name: "Website", slug: "website", fieldType: "url" as const, displayOrder: 9, isRequired: 0, isEnabled: 1, isSystem: 1 },
    { moduleId: contactsModule.id, name: "Notes", slug: "notes", fieldType: "textarea" as const, displayOrder: 10, isRequired: 0, isEnabled: 1, isSystem: 1 },
  ];

  for (const field of defaultFields) {
    await db.insert(crmModuleFields).values({
      id: randomUUID(),
      ...field,
    });
  }

  report(`crm modules: seeded ${defaultModules.length} modules, ${defaultFields.length} fields`);
  return { seeded: true };
}

/**
 * The single settings row, keyed `default`. Every column stays null — the row
 * exists so a settings read returns something before an admin has saved
 * anything, which is exactly what the `INSERT` in migration 005 was for.
 */
export async function seedOrgSettings(
  db: ScriptDb,
  report: (message: string) => void = () => {}
): Promise<{ seeded: boolean }> {
  const inserted = await db
    .insert(orgSettings)
    .values({ id: ORG_SETTINGS_ROW_ID })
    .onConflictDoNothing()
    .returning({ id: orgSettings.id });

  const seeded = inserted.length > 0;
  report(seeded ? `org settings: seeded row "${ORG_SETTINGS_ROW_ID}"` : "org settings: row already present, skipping");
  return { seeded };
}

export async function seedDefaults(
  db: ScriptDb,
  report: (message: string) => void = () => {}
): Promise<void> {
  await seedCrmDefaults(db, report);
  await seedOrgSettings(db, report);
}

const isEntryPoint = process.argv[1]?.endsWith("seed-defaults.ts");

if (isEntryPoint) {
  const { db, close } = openDb();
  // A seed against a database whose schema is not current would half-succeed and
  // leave a confusing partial state; fail with the reason instead.
  db.execute(sql`SELECT 1 FROM crm_modules LIMIT 0`)
    .then(() => seedDefaults(db, (message) => console.log(message)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      console.error("Has `npm run db:migrate` been run against this database?");
      process.exitCode = 1;
    })
    .finally(() => close());
}
