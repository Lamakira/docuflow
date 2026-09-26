import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import {
  DEFAULT_SCREENSHOT_POLICY,
  crmProjectStatusValues,
  crmProjectTypeValues,
  type CrmModuleWithFields,
  type ScreenshotPolicy,
} from "@shared/schema";
import {
  FALLBACK_OPEN_STAGES,
  composeOpportunityStages,
  stageOptionsFromFieldOptions,
} from "../../client/src/v2/opportunities";
import {
  PIPELINE_LISTS,
  PIPELINE_LIST_QUERY_KEYS,
  addPipelineOption,
  composePipelineLists,
  movePipelineOption,
  optionValue,
  recolourPipelineOption,
  removePipelineOption,
  renamePipelineOption,
  savePipelineList,
  type PipelineListModel,
} from "../../client/src/v2/pipelineLists";
import { diffFieldOptions, builtInList, serializeFieldOption } from "@shared/pipelineLists";
import {
  addAllowedTimezone,
  analyticsActivityPath,
  analyticsAlertsPath,
  analyticsCoveragePath,
  analyticsDevicesPath,
  analyticsEvidenceQualityPath,
  analyticsExportPath,
  analyticsOverviewPath,
  analyticsProductivityPath,
  analyticsScreenshotsPath,
  analyticsRange,
  billingCancelPath,
  billingCheckoutPath,
  billingPaymentMethodPath,
  billingSeatsPath,
  billingSubscriptionPath,
  composeAdministration,
  composeAnalytics,
  composeTrackingPolicyEditor,
  hostedBillingSession,
  workspaceSettingsPath,
  removeAllowedTimezone,
  rotateServiceAccountPath,
  rotateWebhookEndpointPath,
  revokeServiceAccountPath,
  serviceAccountsPath,
  webhookDisablePath,
  webhookEnablePath,
  webhookEndpointsPath,
  administrationWriteRefusal,
  trackingPolicyIssue,
  type AdministrationInput,
  type AnalyticsInput,
  type BillingInput,
  type TrackingPolicyInput,
} from "../../client/src/v2/administration";

/**
 * Administration from existing Workspace operator routes (#193).
 * Seams: matchV2Route (flagged app chrome) and composeAdministration over `/api/*`.
 * HTTP `/api/*` stays characterized elsewhere. Do not assert hex.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2AuthenticatedApp.tsx"),
  "utf8",
);

const pageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Administration.tsx"),
  "utf8",
);

const analyticsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Analytics.tsx"),
  "utf8",
);

const selectSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Select.tsx"),
  "utf8",
);

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function emptyAdmin(overrides: Partial<AdministrationInput> = {}): AdministrationInput {
  return {
    workspaceName: "Harbor Co",
    ownerName: "Sam Lee",
    workspaceRole: "OWNER",
    condition: null,
    serviceAccounts: [],
    webhookEndpoints: [],
    billing: null,
    revealedSecret: null,
    ...overrides,
  };
}

describe("Administration routing (#193)", () => {
  it("shows a live Administration destination on /administration, not a placeholder", () => {
    const match = matchV2Route("/administration");
    expect(match.kind).toBe("administration");
    expect(navIdForPath("/administration")).toBe("administration");
    expect(breadcrumbFor("/administration", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "ADMINISTRATION",
    ]);
    expect(appSource).toContain("V2AdministrationPage");
    expect(appSource).toMatch(/path="\/administration\/:tab\?"/);
    expect(appSource).not.toContain('data-testid="v2-placeholder"');
  });

  it("rewrites v1 /admin here under the v2 flag", () => {
    expect(matchV2Route("/admin")).toMatchObject({ kind: "administration", href: "/administration" });
    expect(matchV2Route("/admin/create")).toMatchObject({ kind: "administration", href: "/administration" });
    // v1 Analytics is its own destination now (#281), not a section of this one.
    expect(matchV2Route("/admin/analytics")).toMatchObject({ kind: "analytics", href: "/analytics" });
    expect(appSource).toMatch(/path="\/admin"/);
  });
});

/** The rows `scripts/seed-defaults.ts` writes into the demo Workspace. */
const SEEDED_STATUS = [
  '{"label":"lead","color":"#ec4899"}',
  '{"label":"discovering_call_completed","color":"#8b5cf6"}',
  '{"label":"proposal_sent","color":"#f59e0b"}',
  '{"label":"follow_up","color":"#06b6d4"}',
  '{"label":"in_negotiation","color":"#3b82f6"}',
  '{"label":"won","color":"#22c55e"}',
  '{"label":"won_not_started","color":"#6366f1"}',
  '{"label":"won_in_progress","color":"#14b8a6"}',
  '{"label":"won_in_review","color":"#0ea5e9"}',
  '{"label":"won_completed","color":"#84cc16"}',
  '{"label":"lost","color":"#ef4444"}',
  '{"label":"won_cancelled","color":"#f43f5e"}',
];

function seededModules(): CrmModuleWithFields[] {
  return [
    {
      id: "mod-projects",
      slug: "projects",
      isSystem: 1,
      fields: [
        { id: "fld-status", slug: "status", fieldType: "select", isSystem: 1, options: SEEDED_STATUS },
        { id: "fld-type", slug: "project_type", fieldType: "select", isSystem: 1, options: ["one_time", "monthly", "hourly_budget", "internal"] },
        { id: "fld-name", slug: "name", fieldType: "text", isSystem: 1, options: null },
      ],
    },
    { id: "mod-contacts", slug: "contacts", isSystem: 1, fields: [{ id: "fld-first", slug: "first_name", fieldType: "text", isSystem: 1, options: null }] },
  ] as unknown as CrmModuleWithFields[];
}

function listOf(modules: CrmModuleWithFields[], id: PipelineListModel["id"]): PipelineListModel {
  const list = composePipelineLists(modules).find((candidate) => candidate.id === id);
  if (!list) throw new Error(`missing list ${id}`);
  return list;
}

function values(options: string[]): string[] {
  return options.map((raw) => {
    try {
      return optionValue(JSON.parse(raw).label);
    } catch {
      return optionValue(raw);
    }
  });
}

describe("Pipeline & lists replaces the CRM field builder", () => {
  it("shows exactly the three lists records read, on the real module and field slugs", () => {
    expect(PIPELINE_LISTS.map((list) => [list.id, list.title, list.builtIn.module.slug, list.builtIn.field.slug])).toEqual([
      ["opportunity-stages", "Opportunity stages", "projects", "status"],
      ["project-type", "Project type", "projects", "project_type"],
      ["source", "Source", "contacts", "source"],
    ]);
    expect(composePipelineLists(seededModules()).map((list) => list.id)).toEqual([
      "opportunity-stages",
      "project-type",
      "source",
    ]);
  });

  it("offers a Workspace with no modules the values each consumer falls back to", () => {
    const [stages, types, sources] = composePipelineLists([]);
    for (const list of [stages, types, sources]) {
      expect(list.saved).toBe(false);
      expect(list.unsavedNote).toContain("The first change saves the list.");
      expect(list.fieldId).toBeNull();
      // A default's id is its value, as the server stores the defaults.
      expect(list.entries.every((entry) => entry.id === entry.value)).toBe(true);
    }
    // The same values the seed, the schema and v1's fallbacks store.
    expect(stages.entries.map((entry) => entry.value)).toEqual([...crmProjectStatusValues]);
    expect(types.entries.map((entry) => entry.value)).toEqual([...crmProjectTypeValues]);
    expect(sources.entries.map((entry) => entry.value)).toEqual(["fiverr", "zoho", "direct"]);
    // Saved, the defaults draw the board Opportunities already falls back to.
    const board = composeOpportunityStages(stageOptionsFromFieldOptions(stages.entries.map(serializeFieldOption)));
    expect(board.filter((stage) => !stage.terminal).map((stage) => stage.id)).toEqual(
      FALLBACK_OPEN_STAGES.map((stage) => stage.id),
    );
    expect(board.filter((stage) => stage.terminal).map((stage) => stage.id)).toEqual(["won", "lost"]);
  });

  it("lists open stages as editable, Lead as built in, and Won and Lost as fixed outcomes", () => {
    const stages = listOf(seededModules(), "opportunity-stages");
    expect(stages.saved).toBe(true);
    expect(stages.fieldId).toBe("fld-status");
    expect(stages.rows.map((row) => [row.value, row.outcome, row.builtIn])).toEqual([
      ["lead", false, true],
      ["discovering_call_completed", false, false],
      ["proposal_sent", false, false],
      ["follow_up", false, false],
      ["in_negotiation", false, false],
      ["won", true, true],
      ["lost", true, true],
    ]);
    const lead = stages.rows[0];
    expect(lead).toMatchObject({ canMoveUp: false, canMoveDown: true, canRemove: false, color: "#ec4899" });
    expect(renamePipelineOption(stages, lead.index, "Prospect")).toEqual({ ok: false, reason: "“lead” is built in and keeps its name." });
    expect(removePipelineOption(stages, lead.index)).toEqual({ ok: false, reason: "“lead” is built in and cannot be removed." });
    expect(movePipelineOption(stages, lead.index, 1).ok).toBe(true);
    expect(stages.rows[1].canRemove).toBe(true);
    expect(stages.rows[4].canMoveDown).toBe(false);
    const won = stages.rows[5];
    expect(won).toMatchObject({ canMoveUp: false, canMoveDown: false, canRemove: false });
    expect(renamePipelineOption(stages, won.index, "Closed")).toEqual({ ok: false, reason: "Won and Lost keep their names." });
    expect(removePipelineOption(stages, won.index).ok).toBe(false);
    // Only a colour changes on an outcome; its id travels with it.
    const recoloured = recolourPipelineOption(stages, won.index, "#14b8a6");
    expect(recoloured.ok && JSON.parse(recoloured.options[won.index])).toEqual({ id: "won", label: "won", color: "#14b8a6" });
  });

  it("locks every Project type and Fiverr, which the code reads by name", () => {
    const types = listOf(seededModules(), "project-type");
    expect(types.rows.every((row) => row.builtIn && !row.canRemove)).toBe(true);
    expect(types.rows.every((row) => row.canMoveUp || row.canMoveDown)).toBe(true);
    const sources = listOf([], "source");
    expect(sources.rows.map((row) => [row.value, row.builtIn, row.canRemove])).toEqual([
      ["fiverr", true, false],
      ["zoho", false, true],
      ["direct", false, true],
    ]);
  });

  it("adds a stage ahead of Won and refuses a duplicate or a terminal name", () => {
    const stages = listOf(seededModules(), "opportunity-stages");
    const added = addPipelineOption(stages, "  Contract review ");
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(values(added.options).slice(4, 7)).toEqual(["in_negotiation", "contract_review", "won"]);
    expect(added.options).toHaveLength(SEEDED_STATUS.length + 1);
    // A new option has no id yet; the server gives it one.
    expect(JSON.parse(added.options[5])).toEqual({ label: "Contract review", color: expect.any(String) });
    expect(addPipelineOption(stages, "Follow-up")).toEqual({ ok: false, reason: "“Follow-up” is already in this list." });
    expect(addPipelineOption(stages, "Won")).toEqual({ ok: false, reason: "Won and Lost are fixed outcomes. Name an open stage." });
    expect(addPipelineOption(stages, "Won - Paid").ok).toBe(true);
    expect(addPipelineOption(stages, "Won - In progress").ok).toBe(false);
    expect(addPipelineOption(stages, "   ")).toEqual({ ok: false, reason: "Name the stage." });
    expect(addPipelineOption(stages, "!!!")).toEqual({ ok: false, reason: "Use at least one letter or number." });

    const types = listOf(seededModules(), "project-type");
    const retainer = addPipelineOption(types, "Retainer");
    expect(retainer.ok && values(retainer.options)).toEqual(["one_time", "monthly", "hourly_budget", "internal", "retainer"]);
  });

  it("renames, moves and removes an option in place, keeping each id and at least one option", () => {
    const stages = listOf(seededModules(), "opportunity-stages");
    const renamed = renamePipelineOption(stages, 2, "Proposal out");
    expect(renamed.ok && JSON.parse(renamed.options[2])).toEqual({ id: "proposal_sent", label: "Proposal out", color: "#f59e0b" });
    expect(renamePipelineOption(stages, 2, "Follow up").ok).toBe(false);

    const moved = movePipelineOption(stages, 2, -1);
    expect(moved.ok && values(moved.options).slice(0, 4)).toEqual(["lead", "proposal_sent", "discovering_call_completed", "follow_up"]);
    expect(movePipelineOption(stages, 0, -1).ok).toBe(false);

    const removed = removePipelineOption(stages, 2);
    expect(removed.ok && values(removed.options).slice(0, 4)).toEqual(["lead", "discovering_call_completed", "follow_up", "in_negotiation"]);

    const lone = listOf(
      [{ id: "mod-projects", slug: "projects", fields: [{ id: "fld-type", slug: "project_type", isSystem: 1, options: ['{"label":"Solo","color":"#3b82f6"}'] }] }] as unknown as CrmModuleWithFields[],
      "project-type",
    );
    expect(lone.rows[0].canRemove).toBe(false);
    expect(removePipelineOption(lone, 0)).toEqual({ ok: false, reason: "Keep at least one type." });
  });

  it("reads only a kept id with a new value as a rename, whatever moved around it", () => {
    const stages = listOf(seededModules(), "opportunity-stages");
    const list = builtInList("projects", "status");
    const rename = renamePipelineOption(stages, 2, "Proposal out");
    const move = movePipelineOption(stages, 2, 1);
    const remove = removePipelineOption(stages, 1);
    const insert = addPipelineOption(stages, "Qualified");
    if (!rename.ok || !move.ok || !remove.ok || !insert.ok) throw new Error("edit refused");

    const read = (next: string[]) => diffFieldOptions(SEEDED_STATUS, next, list);
    expect(read(rename.options)).toMatchObject({ ok: true, renames: [{ from: "proposal_sent", to: "proposal_out" }] });
    for (const next of [move.options, remove.options, insert.options]) {
      expect(read(next)).toMatchObject({ ok: true, renames: [] });
    }
  });

  it("asks the server for the built-in lists on a Workspace's first save, then sends one PATCH", async () => {
    const calls: Array<[string, string, Record<string, unknown>]> = [];
    const send = async (method: "POST" | "PATCH", path: string, body: Record<string, unknown>) => {
      calls.push([method, path, body]);
      if (method === "POST") {
        return [{ id: "mod-new", slug: "projects", fields: [{ id: "fld-new", slug: "status" }] }];
      }
      return {};
    };
    const stages = listOf([], "opportunity-stages");
    const renamed = renamePipelineOption(stages, 2, "Proposal out");
    if (!renamed.ok) throw new Error("edit refused");
    await savePipelineList(stages, renamed, send);

    expect(calls).toEqual([
      ["POST", "/api/admin/system-lists/ensure", {}],
      ["PATCH", "/api/admin/fields/fld-new", { options: renamed.options }],
    ]);
    expect(JSON.stringify(calls)).not.toContain("isSystem");
  });

  it("writes a saved list with one PATCH, and refuses when the server made no list", async () => {
    const calls: Array<[string, string, Record<string, unknown>]> = [];
    const send = async (method: "POST" | "PATCH", path: string, body: Record<string, unknown>) => {
      calls.push([method, path, body]);
      return method === "POST" ? [] : {};
    };
    const stages = listOf(seededModules(), "opportunity-stages");
    const moved = movePipelineOption(stages, 1, 1);
    if (!moved.ok) throw new Error("edit refused");
    await savePipelineList(stages, moved, send);
    expect(calls).toEqual([["PATCH", "/api/admin/fields/fld-status", { options: moved.options }]]);

    const sources = listOf(seededModules(), "source");
    const added = addPipelineOption(sources, "Referral");
    if (!added.ok) throw new Error("edit refused");
    await expect(savePipelineList(sources, added, send)).rejects.toThrow("The list could not be created.");
  });

  it("says honestly what a rename and a removal do to records", () => {
    const [stages, types, sources] = composePipelineLists(seededModules());
    expect(stages.renameNote).toBe(
      "Renaming a stage moves every Opportunity already at it. Built-in stages keep their names and cannot be removed.",
    );
    expect(types.renameNote).toBe(
      "Renaming a type updates every Project that already has it. Built-in types keep their names and cannot be removed.",
    );
    expect(sources.renameNote).toBe(
      "Renaming a source updates every Client already recorded with it. Fiverr is built in: it keeps its name and cannot be removed.",
    );

    expect(stages.rows[2].removeConsequence).toBe(
      "No Opportunity is changed. Opportunities already at “proposal_sent” stay there and still show on the board, but no Opportunity can be moved to it. Adding “proposal_sent” back restores it.",
    );
    expect(types.rows[0].removeConsequence).toContain("No Project is changed.");
    expect(sources.rows[0].removeConsequence).toContain("No Client is changed.");
    for (const list of [stages, types, sources]) {
      for (const row of list.rows) expect(row.removeConsequence).not.toMatch(/removed from|cannot be undone/i);
    }
  });

  it("refreshes every screen that reads the lists after a save", () => {
    expect(PIPELINE_LIST_QUERY_KEYS).toEqual([
      ["/api/admin/modules"],
      ["/api/modules/projects/fields"],
      ["/api/modules/contacts/fields"],
    ]);
    // The same keys Opportunities and the v1 Project and Client pages read.
    const opportunitiesSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Opportunities.tsx"),
      "utf8",
    );
    expect(opportunitiesSource).toContain('queryKey: ["/api/modules/projects/fields"]');
    expect(pageSource).toContain("for (const queryKey of PIPELINE_LIST_QUERY_KEYS) queryClient.invalidateQueries({ queryKey });");
  });

  it("drops the module builder, the field-type select, the Enable toggle and the old copy", () => {
    const start = pageSource.indexOf('<TabsContent value="pipeline-lists"');
    const panel = pageSource.slice(start, pageSource.indexOf("</TabsContent>", start));
    expect(panel).toContain("{PIPELINE_LISTS_INTRO}");
    expect(pageSource).not.toContain("Add module");
    expect(pageSource).not.toContain("Add field");
    expect(pageSource).not.toContain("CRM_FIELD_TYPES");
    expect(pageSource).not.toContain('ariaLabel="CRM field type"');
    expect(pageSource).not.toContain("isEnabled ? 0 : 1");
    expect(pageSource).not.toContain("removed from Clients and Projects");
    expect(pageSource).not.toContain('apiRequest("DELETE", `/api/admin/modules/');
    expect(pageSource).not.toContain('apiRequest("DELETE", `/api/admin/fields/');
    // shadcn controls, not bare ones.
    expect(pageSource).toContain('import { Input } from "@/components/ui/input";');
    const card = pageSource.slice(pageSource.indexOf("function PipelineListCard("));
    expect(card).not.toMatch(/<input\b/);
    expect(card).not.toMatch(/<textarea\b/);
    expect(card).toContain("<ColourPicker");
    expect(card).toContain("<PopoverContent");
    expect(card).toContain("BUILT IN");
  });

  it("styles the rows in tokens that hold in the dark palette", () => {
    for (const selector of [".df-pipeline-option", ".df-v2 .df-pipeline-label", ".df-pipeline-builtin", ".df-pipeline-swatch", ".dark .df-pipeline-swatch"]) {
      expect(rule(selector)).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    }
    expect(rule(".df-pipeline-option")).toMatch(/gap:\s*var\(--df-space-3\)/);
    expect(rule(".df-pipeline-option")).toMatch(/padding:\s*var\(--df-space-2\) var\(--df-space-3\)/);
    expect(rule(".dark .df-pipeline-swatch")).toMatch(/var\(--df-swatch-line-dark\)/);
  });
});

describe("Administration from operator routes (#193)", () => {
  it("refuses Members by naming the Workspace Role, never permission denied", () => {
    const page = composeAdministration(
      emptyAdmin({
        workspaceRole: "MEMBER",
      }),
    );

    expect(page.kind).toBe("refusal");
    if (page.kind !== "refusal") return;
    expect(page.refusal).toBe("Administration is open to the Owner and Administrators. Your Workspace Role is Member. Sam Lee (Owner) can change it.");
    expect(page.refusal.toLowerCase()).not.toContain("permission denied");
    // No Capability is named, because none exists to grant (#238).
    expect(page.refusal).not.toContain("Capability");
  });

  it("never sends the Owner to ask the Owner (#238)", () => {
    const page = composeAdministration(
      emptyAdmin({ workspaceRole: "OWNER", ownerName: "User Test" }),
    );
    // The Owner is not refused at all — that was the whole of D5.
    expect(page.kind).toBe("ready");

    // And where an Owner is refused for some other reason, the copy does not
    // offer them a grant only they could make.
    const refused = composeAnalytics(
      emptyAnalytics({ workspaceRole: "OWNER", ownerName: "User Test", refused: true }),
    );
    expect(refused.kind).toBe("refusal");
    if (refused.kind !== "refusal") return;
    expect(refused.refusal).toBe("Analytics could not be opened for your Membership in this Workspace.");
    expect(refused.refusal).not.toContain("User Test");
    expect(refused.refusal).not.toContain("Capability");
  });

  it("empty operator lists use empty geometry and never show sample names", () => {
    const page = composeAdministration(emptyAdmin());
    const blob = JSON.stringify(page);

    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.serviceAccounts.empty).toBe(true);
    expect(page.serviceAccounts.rows).toEqual([]);
    expect(page.serviceAccounts.emptyCopy.toLowerCase()).toContain("service account");
    expect(page.webhookEndpoints.empty).toBe(true);
    expect(page.webhookEndpoints.rows).toEqual([]);
    expect(page.webhookEndpoints.emptyCopy.toLowerCase()).toContain("webhook");
    expect(page.secretOnce).toBeNull();
    expect(page.pagePrimary).toBe("case-ink");
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("lists Service Accounts and Webhook Endpoints without plaintext secrets", () => {
    const page = composeAdministration(
      emptyAdmin({
        serviceAccounts: [
          {
            id: "sa-1",
            name: "Invoices",
            capabilityIds: ["clients_read", "webhook_endpoints_manage"],
            revokedAt: null,
          },
          {
            id: "sa-2",
            name: "Retired",
            capabilityIds: [],
            revokedAt: "2026-09-01T00:00:00.000Z",
          },
        ],
        webhookEndpoints: [
          {
            id: "wh-1",
            url: "https://hooks.example.test/crm",
            eventTypes: ["client.created"],
            disabledAt: null,
          },
          {
            id: "wh-2",
            url: "https://hooks.example.test/idle",
            eventTypes: ["time_entry.stopped"],
            disabledAt: "2026-09-02T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.serviceAccounts.rows).toEqual([
      {
        id: "sa-1",
        name: "Invoices",
        capabilities: "Read Clients · Manage Webhook Endpoints",
        status: "ACTIVE",
        rotate: true,
        revoke: true,
      },
      {
        id: "sa-2",
        name: "Retired",
        capabilities: "—",
        status: "REVOKED",
        rotate: false,
        revoke: false,
      },
    ]);
    expect(page.webhookEndpoints.rows).toEqual([
      {
        id: "wh-1",
        url: "https://hooks.example.test/crm",
        eventTypes: "client.created",
        status: "ACTIVE",
        rotate: true,
        disable: true,
        enable: false,
      },
      {
        id: "wh-2",
        url: "https://hooks.example.test/idle",
        eventTypes: "time_entry.stopped",
        status: "DISABLED",
        rotate: true,
        disable: false,
        enable: true,
      },
    ]);
    expect(JSON.stringify(page.serviceAccounts)).not.toMatch(/plaintext/i);
    expect(JSON.stringify(page.webhookEndpoints)).not.toMatch(/plaintext/i);
    expect(JSON.stringify(page.serviceAccounts)).not.toContain("dfsa_");
    expect(JSON.stringify(page.webhookEndpoints)).not.toContain("dfwh_");
  });

  it("shows a newly created or rotated secret once, then gone from the list", () => {
    const listed = composeAdministration(
      emptyAdmin({
        serviceAccounts: [
          {
            id: "sa-1",
            name: "Invoices",
            capabilityIds: [],
            revokedAt: null,
            plaintextKey: "dfsa_should_never_list",
          },
        ],
        webhookEndpoints: [
          {
            id: "wh-1",
            url: "https://hooks.example.test/crm",
            eventTypes: ["client.created"],
            disabledAt: null,
            plaintextSecret: "dfwh_should_never_list",
          },
        ],
      }),
    );
    expect(listed.kind).toBe("ready");
    if (listed.kind !== "ready") return;
    expect(listed.secretOnce).toBeNull();
    expect(JSON.stringify(listed.serviceAccounts.rows)).not.toContain("dfsa_");
    expect(JSON.stringify(listed.webhookEndpoints.rows)).not.toContain("dfwh_");

    const shown = composeAdministration(
      emptyAdmin({
        serviceAccounts: [
          {
            id: "sa-1",
            name: "Invoices",
            capabilityIds: [],
            revokedAt: null,
          },
        ],
        revealedSecret: {
          kind: "service-account",
          id: "sa-1",
          label: "Invoices",
          plaintext: "dfsa_shown_once",
        },
      }),
    );
    expect(shown.kind).toBe("ready");
    if (shown.kind !== "ready") return;
    expect(shown.secretOnce).toEqual({
      kind: "service-account",
      id: "sa-1",
      label: "Invoices",
      plaintext: "dfsa_shown_once",
      confirmation: "Copy this now. It will not be shown again.",
    });
    expect(JSON.stringify(shown.serviceAccounts.rows)).not.toContain("dfsa_shown_once");
  });

  it("reads billing projection and offers Plan or seat decisions, never a card form", () => {
    const trial = composeAdministration(
      emptyAdmin({
        billing: {
          planKey: "trial",
          billingState: "Trialing",
          purchasedSeatCapacity: 1,
          consumedSeatCount: 1,
          trialEndsAt: "2026-09-20T00:00:00.000Z",
          periodEndsAt: null,
          cancelAtPeriodEnd: false,
          stripeCustomerId: null,
        },
      }),
    );
    expect(trial.kind).toBe("ready");
    if (trial.kind !== "ready") return;
    expect(trial.billing.plan).toBe("Trial");
    expect(trial.billing.condition).toBe("Trial");
    expect(trial.billing.seats).toBe("1 of 1 Billable Seats consumed.");
    expect(trial.billing.figures).toContainEqual({ label: "WRITES", value: "Allowed" });
    expect(trial.billing.entitlementNote).toBeNull();
    expect(trial.billing.actions.map((action) => action.id)).toEqual(["checkout"]);
    expect(trial.billing.checkout).toBe("redirect");
    expect(pageSource).not.toMatch(/card number|cvc|cardholder/i);
    expect(pageSource).not.toMatch(/password|clerk/i);

    const active = composeAdministration(
      emptyAdmin({
        billing: {
          planKey: "pro",
          billingState: "Active",
          purchasedSeatCapacity: 8,
          consumedSeatCount: 3,
          trialEndsAt: null,
          periodEndsAt: "2026-10-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          stripeCustomerId: "cus_123",
        },
      }),
    );
    expect(active.kind).toBe("ready");
    if (active.kind !== "ready") return;
    expect(active.billing.plan).toBe("Pro");
    expect(active.billing.condition).toBe("Active");
    expect(active.billing.seats).toBe("3 of 8 Billable Seats consumed.");
    expect(active.billing.actions.map((action) => action.id)).toEqual([
      "seats",
      "payment-method",
      "cancel",
    ]);

    expect(hostedBillingSession({ url: "https://checkout.stripe.com/c/cs_test" })).toEqual({
      kind: "redirect",
      url: "https://checkout.stripe.com/c/cs_test",
    });
  });

  it("keeps payment-method recovery in Read-only and names the Workspace condition on writes", () => {
    const page = composeAdministration(
      emptyAdmin({
        condition: "Read-only",
        billing: {
          planKey: "pro",
          billingState: "ReadOnly",
          purchasedSeatCapacity: 8,
          consumedSeatCount: 3,
          trialEndsAt: null,
          periodEndsAt: null,
          cancelAtPeriodEnd: true,
          stripeCustomerId: "cus_123",
        },
      }),
    );
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.billing.condition).toBe("Read-only");
    expect(page.billing.figures).toContainEqual({ label: "WRITES", value: "Blocked" });
    expect(page.billing.entitlementNote).toContain("Writes blocked");
    expect(page.billing.actions.map((action) => action.id)).toEqual(["payment-method"]);
    expect(page.serviceAccounts.createAllowed).toBe(false);
    expect(page.webhookEndpoints.createAllowed).toBe(false);
    expect(page.writeRefusal).toBe(
      "Harbor Co is read-only. Viewing, export, and recovery stay available.",
    );

    const expiredTrial = composeAdministration(
      emptyAdmin({
        condition: "Read-only",
        billing: {
          planKey: "trial",
          billingState: "ReadOnly",
          purchasedSeatCapacity: 1,
          consumedSeatCount: 1,
          trialEndsAt: null,
          periodEndsAt: null,
          cancelAtPeriodEnd: false,
          stripeCustomerId: null,
        },
      }),
    );
    expect(expiredTrial.kind).toBe("ready");
    if (expiredTrial.kind !== "ready") return;
    expect(expiredTrial.billing.actions.map((action) => action.id)).toEqual(["checkout"]);
    expect(expiredTrial.billing.checkout).toBe("redirect");
  });

  it("asks the BFF for operator routes and does not wire a card form", () => {
    expect(serviceAccountsPath()).toBe("/api/service-accounts");
    expect(revokeServiceAccountPath("sa-1")).toBe("/api/service-accounts/sa-1/revoke");
    expect(rotateServiceAccountPath("sa-1")).toBe("/api/service-accounts/sa-1/rotate");
    expect(webhookEndpointsPath()).toBe("/api/webhook-endpoints");
    expect(webhookDisablePath("wh-1")).toBe("/api/webhook-endpoints/wh-1/disable");
    expect(webhookEnablePath("wh-1")).toBe("/api/webhook-endpoints/wh-1/enable");
    expect(rotateWebhookEndpointPath("wh-1")).toBe("/api/webhook-endpoints/wh-1/rotate");
    expect(billingSubscriptionPath()).toBe("/api/billing/subscription");
    expect(billingCheckoutPath()).toBe("/api/billing/checkout");
    expect(billingSeatsPath()).toBe("/api/billing/seats");
    expect(billingPaymentMethodPath()).toBe("/api/billing/payment-method");
    expect(billingCancelPath()).toBe("/api/billing/cancel-at-period-end");

    expect(
      administrationWriteRefusal({
        kind: "error",
        workspaceName: "Harbor Co",
        workspaceRole: "MEMBER",
        ownerName: "Sam Lee",
        errorMessage: "Access denied",
      }),
    ).toBe("Administration is open to the Owner and Administrators. Your Workspace Role is Member. Sam Lee (Owner) can change it.");
    expect(pageSource).toContain("window.location");
    expect(pageSource).toContain("df-project-mobile");
    expect(pageSource).not.toContain("input type=\"password\"");
    expect(pageSource).not.toMatch(/stripe-card|CardElement|cardNumber/i);
  });
});

describe("Administration secret confirmation motion (#193)", () => {
  it("marks the shown-once secret as rare state indication and keeps reduced motion on opacity", () => {
    const open = motionForSurface("secret-once");
    expect(open.enterExit).toBe("standard");
    expect(open.movement).toBe("allowed");

    const reduced = motionForSurface("secret-once", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);

    expect(rule('.df-secret-once[data-motion="standard"]')).toMatch(/var\(--ease-out\)/);
    expect(rule('.df-secret-once[data-motion="standard"]')).not.toMatch(/transition\s*:\s*all\b/);
    expect(rule(".df-admin-form input")).toMatch(/animation:\s*none/);
    expect(rule(".df-admin-billing-figure")).toMatch(/animation:\s*none/);
    expect(reducedMotionCss()).toMatch(
      /\.df-secret-once\[data-motion="standard"\][^{]*\{[^}]*transform:\s*none/,
    );
  });
});

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing rule ${selector}`);
  return match[1];
}

function reducedMotionCss(): string {
  return [...css.matchAll(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/g)]
    .map((match) => match[1])
    .join("\n");
}

/**
 * Administration deepened with analytics, Tracking Policy, and the remaining
 * billing actions (#212). Seams stay the pure composers over existing
 * `/api/admin/analytics*` and `/api/admin/org-settings`. HTTP stays
 * characterized in admin-analytics.test.ts and notifications-org-settings.test.ts.
 */

const NOW = new Date("2026-09-14T12:00:00.000Z");
const RANGE = analyticsRange("7d", NOW);

function emptyAnalytics(overrides: Partial<AnalyticsInput> = {}): AnalyticsInput {
  return {
    now: NOW,
    workspaceRole: "OWNER",
    ownerName: "Sam Lee",
    range: RANGE,
    overview: null,
    activity: null,
    coverage: null,
    devices: [],
    ...overrides,
  };
}

function policyDraft(overrides: Partial<ScreenshotPolicy> = {}): ScreenshotPolicy {
  return { ...DEFAULT_SCREENSHOT_POLICY, ...overrides };
}

function editorInput(overrides: Partial<TrackingPolicyInput> = {}): TrackingPolicyInput {
  return {
    workspaceName: "Harbor Co",
    workspaceRole: "OWNER",
    ownerName: "Sam Lee",
    condition: null,
    saved: policyDraft(),
    draft: policyDraft(),
    savedTimezones: [],
    draftTimezones: [],
    justSaved: false,
    ...overrides,
  };
}

describe("Administration analytics (#212)", () => {
  it("asks the existing analytics routes for the chosen range", () => {
    expect(RANGE.end).toEqual(NOW);
    expect(RANGE.start).toEqual(new Date("2026-09-07T12:00:00.000Z"));
    expect(analyticsRange("30d", NOW).start).toEqual(new Date("2026-08-15T12:00:00.000Z"));
    expect(analyticsRange("90d", NOW).start).toEqual(new Date("2026-06-16T12:00:00.000Z"));

    const query = "start=2026-09-07T12%3A00%3A00.000Z&end=2026-09-14T12%3A00%3A00.000Z";
    expect(analyticsOverviewPath(RANGE)).toBe(`/api/admin/analytics/overview?${query}`);
    expect(analyticsActivityPath(RANGE)).toBe(`/api/admin/analytics/activity?${query}`);
    expect(analyticsCoveragePath(RANGE)).toBe(`/api/admin/analytics/coverage?${query}`);
    expect(analyticsDevicesPath()).toBe("/api/admin/analytics/devices");
    expect(analyticsExportPath(RANGE)).toBe(`/api/admin/analytics/export?${query}`);
    expect(analyticsAlertsPath(RANGE)).toBe(`/api/admin/analytics/alerts?${query}`);
    expect(analyticsEvidenceQualityPath(RANGE)).toBe(`/api/admin/analytics/evidence-quality?${query}`);
    expect(analyticsProductivityPath(RANGE)).toBe(`/api/admin/analytics/productivity?${query}`);
    expect(analyticsScreenshotsPath(RANGE)).toBe(`/api/admin/analytics/screenshots?${query}`);
    expect(workspaceSettingsPath()).toBe("/api/admin/org-settings");
  });

  it("refuses a Member from the analytics control by naming the Workspace Role", () => {
    const page = composeAnalytics(emptyAnalytics({ workspaceRole: "MEMBER" }));

    expect(page.kind).toBe("refusal");
    if (page.kind !== "refusal") return;
    // Analytics is its own destination (#281), so the refusal names it.
    expect(page.refusal).toBe("Analytics is open to the Owner and Administrators. Your Workspace Role is Member. Sam Lee (Owner) can change it.");
    expect(page.refusal.toLowerCase()).not.toContain("permission denied");
    expect(page.refusal.toLowerCase()).not.toContain("403");
  });

  it("names the refusal when the BFF refuses the read, instead of drawing an empty range", () => {
    const analytics = composeAnalytics(emptyAnalytics({ refused: true }));
    expect(analytics.kind).toBe("refusal");
    if (analytics.kind !== "refusal") return;
    expect(analytics.refusal).toBe("Analytics could not be opened for your Membership in this Workspace.");

    const policy = composeTrackingPolicyEditor(editorInput({ refused: true }));
    expect(policy.kind).toBe("refusal");
  });

  it("says a failed read failed, rather than reporting an outage as an empty Workspace", () => {
    const analytics = composeAnalytics(emptyAnalytics({ readFailed: true }));
    expect(analytics.kind).toBe("unreadable");
    if (analytics.kind !== "unreadable") return;
    expect(analytics.note.toLowerCase()).toContain("could not be read");
    expect(analytics.note.toLowerCase()).not.toContain("no tracked time");
  });

  it("refuses to edit an unread Tracking Policy so a save cannot overwrite it with defaults", () => {
    const policy = composeTrackingPolicyEditor(editorInput({ saved: null }));
    expect(policy.kind).toBe("unreadable");
    if (policy.kind !== "unreadable") return;
    expect(policy.note.toLowerCase()).toContain("could not be read");
    expect(JSON.stringify(policy)).not.toContain("canSave");
  });

  it("reads overview, activity, coverage, devices, and export for an Owner", () => {
    const page = composeAnalytics(
      emptyAnalytics({
        overview: {
          totalTrackedSeconds: 45000,
          totalIdleSeconds: 5400,
          entriesCount: 12,
          runningNow: 1,
          activeUsersToday: 3,
          screenshotsInWindow: 40,
          lowActivityEntries: 2,
          revokedDevices: 1,
        },
        activity: {
          byUser: [
            {
              userId: "u-1",
              userName: "Ada Byron",
              totalSeconds: 36000,
              idleSeconds: 3600,
              idleEventCount: 4,
            },
          ],
        },
        coverage: {
          summary: {
            totalTrackedSeconds: 45000,
            totalScreenshots: 40,
            expectedScreenshots: 50,
            coveragePercent: 80,
            totalEntries: 12,
            entriesWithoutScreenshots: 2,
            lowCoverageEntries: 3,
            deletedScreenshots: 1,
          },
          byUser: [
            {
              userId: "u-1",
              userName: "Ada Byron",
              trackedSeconds: 36000,
              entriesCount: 9,
              entriesWithoutScreenshots: 1,
              screenshotCount: 32,
              expectedScreenshots: 40,
              coveragePct: 80,
            },
          ],
        },
        devices: [
          {
            id: "dev-1",
            userId: "u-1",
            userName: "Ada Byron",
            name: "Ada MacBook",
            os: "macOS",
            clientVersion: "1.4.0",
            lastSeenAt: "2026-09-14T11:30:00.000Z",
            revokedAt: null,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
          {
            id: "dev-2",
            userId: "u-2",
            userName: "Grace Hopper",
            name: "Retired ThinkPad",
            os: "Windows",
            clientVersion: null,
            lastSeenAt: null,
            revokedAt: "2026-09-10T00:00:00.000Z",
            createdAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.rangeLabel).toBe("7 SEP – 14 SEP");
    expect(page.overview).toEqual([
      { label: "TRACKED", value: "12.5 h" },
      { label: "IDLE", value: "1.5 h" },
      { label: "TIME ENTRIES", value: "12" },
      { label: "RUNNING NOW", value: "1" },
      { label: "ACTIVE TODAY", value: "3" },
      { label: "EVIDENCE", value: "40" },
      { label: "LOW ACTIVITY", value: "2" },
      { label: "REVOKED DEVICES", value: "1" },
    ]);
    expect(page.activity.rows).toEqual([
      {
        userId: "u-1",
        who: "Ada Byron",
        tracked: "10.0 h",
        idle: "1.0 h",
        idleEvents: "4",
      },
    ]);
    expect(page.activity.footnote).toBe(
      "Recorded totals with provenance. DocuFlow does not score or rank Members.",
    );
    expect(page.coverage.summary).toEqual([
      { label: "COVERAGE", value: "80%" },
      { label: "EVIDENCE", value: "40 of 50" },
      { label: "ENTRIES WITHOUT EVIDENCE", value: "2" },
      { label: "TOMBSTONED", value: "1" },
    ]);
    expect(page.coverage.rows).toEqual([
      {
        userId: "u-1",
        who: "Ada Byron",
        tracked: "10.0 h",
        entries: "9",
        evidence: "32 of 40",
        coverage: "80%",
      },
    ]);
    expect(page.devices.rows).toEqual([
      {
        id: "dev-1",
        name: "Ada MacBook",
        who: "Ada Byron",
        platform: "macOS · 1.4.0",
        lastSeen: "30m ago",
        status: "ACTIVE",
      },
      {
        id: "dev-2",
        name: "Retired ThinkPad",
        who: "Grace Hopper",
        platform: "Windows",
        lastSeen: "Never",
        status: "REVOKED",
      },
    ]);
    expect(page.export).toEqual({
      href: analyticsExportPath(RANGE),
      label: "Export CSV",
      filename: "docuflow-export-2026-09-07.csv",
    });
  });

  it("names a stalled Device and the other warnings alerts already records", () => {
    const page = composeAnalytics(
      emptyAnalytics({
        alerts: {
          highIdleUsers: [
            { userId: "u-1", userName: "Ada Byron", idleRatio: 62, totalSeconds: 36000 },
          ],
          stalledDevices: [
            {
              deviceId: "dev-quiet",
              deviceName: "Quiet Mac",
              userId: "u-2",
              userName: "Grace Hopper",
              lastSeenAt: "2026-09-05T12:00:00.000Z",
              daysSinceLastSeen: 9,
            },
          ],
          runningWithoutScreenshots: [
            {
              userId: "u-1",
              userName: "Ada Byron",
              entryId: "entry-1",
              startedAt: "2026-09-14T09:15:00.000Z",
            },
          ],
        },
      }),
    );

    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.alerts.empty).toBe(false);
    expect(page.alerts.stalledDevices).toEqual([
      {
        id: "dev-quiet",
        name: "Quiet Mac",
        who: "Grace Hopper",
        lastSeen: "9d ago",
      },
    ]);
    expect(page.alerts.highIdle).toEqual([
      { id: "u-1", who: "Ada Byron", tracked: "10.0 h", idle: "62%" },
    ]);
    expect(page.alerts.runningWithoutEvidence).toEqual([
      { id: "entry-1", who: "Ada Byron", started: "2h ago" },
    ]);
  });

  it("reads productivity, screenshots, and evidence quality as recorded totals", () => {
    const page = composeAnalytics(
      emptyAnalytics({
        productivity: {
          byUser: [
            { userId: "u-1", userName: "Ada Byron", totalSeconds: 36000, idleSeconds: 3600, entriesCount: 4 },
          ],
          byProject: [
            { crmProjectId: "prj-1", projectName: "Harbor", totalSeconds: 36000, entriesCount: 4 },
          ],
          byTask: [{ taskId: "task-1", taskName: "Survey", totalSeconds: 7200 }],
          dailyTrend: [{ date: "2026-09-10", totalSeconds: 36000 }],
        },
        screenshots: {
          totalCount: 12,
          byUser: [{ userId: "u-1", userName: "Ada Byron", count: 12 }],
          hourlyDistribution: [{ hour: 9, count: 3 }],
          duplicates: [{ contentHash: "abc123def456", count: 2 }],
          deletedCount: 1,
        },
        evidenceQuality: {
          gradeDistribution: { strong: 0, moderate: 1, weak: 0, insufficient: 0 },
          byUser: [
            {
              userId: "u-1",
              userName: "Ada Byron",
              grade: "moderate",
              screenshotCount: 8,
              expectedScreenshots: 10,
              hasEvents: true,
            },
          ],
        },
      }),
    );

    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.recordedTime.rows).toEqual([
      { id: "u-1", who: "Ada Byron", tracked: "10.0 h", idle: "1.0 h", entries: "4" },
    ]);
    expect(page.recordedTime.projects).toEqual([
      { id: "prj-1", name: "Harbor", tracked: "10.0 h", entries: "4" },
    ]);
    expect(page.recordedTime.tasks).toEqual([{ id: "task-1", name: "Survey", tracked: "2.0 h" }]);
    // The day bucket reads as the calendar day it names (#281).
    expect(page.recordedTime.days).toEqual([{ id: "2026-09-10", day: "THU 10 SEP", tracked: "10.0 h" }]);
    expect(page.recordedTime.measures.toLowerCase()).not.toContain("rank");
    expect(JSON.stringify(page.recordedTime)).not.toContain("score");

    expect(page.screenshots.summary).toEqual([
      { label: "EVIDENCE", value: "12" },
      { label: "TOMBSTONED", value: "1" },
      { label: "DUPLICATE GROUPS", value: "1" },
    ]);
    expect(page.screenshots.byMember).toEqual([{ id: "u-1", who: "Ada Byron", evidence: "12" }]);
    expect(page.screenshots.hours).toEqual([{ id: "9", hour: "09:00", evidence: "3" }]);

    expect(page.evidenceQuality.footnote.toLowerCase()).toContain("does not");
    expect(page.evidenceQuality.rows).toEqual([
      { id: "u-1", who: "Ada Byron", grade: "MODERATE", evidence: "8 of 10", events: "RECORDED" },
    ]);
    expect(JSON.stringify(page.evidenceQuality.rows)).not.toContain("55");
  });

  it("keeps empty analytics honest and never shows sample names", () => {
    const page = composeAnalytics(emptyAnalytics());
    const blob = JSON.stringify(page);

    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.overview).toEqual([]);
    expect(page.activity.empty).toBe(true);
    expect(page.activity.rows).toEqual([]);
    expect(page.activity.emptyCopy.toLowerCase()).toContain("no tracked time");
    expect(page.coverage.empty).toBe(true);
    expect(page.coverage.summary).toEqual([]);
    expect(page.coverage.emptyCopy.toLowerCase()).toContain("evidence");
    expect(page.devices.empty).toBe(true);
    expect(page.devices.emptyCopy.toLowerCase()).toContain("device");
    expect(page.alerts.empty).toBe(true);
    expect(page.alerts.stalledDevices).toEqual([]);
    expect(page.alerts.emptyCopy.toLowerCase()).toContain("warning");
    expect(page.recordedTime.empty).toBe(true);
    expect(page.screenshots.empty).toBe(true);
    expect(page.evidenceQuality.empty).toBe(true);
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("reports a missing coverage percentage as unknown, never as zero", () => {
    const page = composeAnalytics(
      emptyAnalytics({
        coverage: {
          summary: {
            totalTrackedSeconds: 0,
            totalScreenshots: 0,
            expectedScreenshots: 0,
            coveragePercent: null,
            totalEntries: 0,
            entriesWithoutScreenshots: 0,
            lowCoverageEntries: 0,
            deletedScreenshots: 0,
          },
          byUser: [
            {
              userId: "u-1",
              userName: "Ada Byron",
              trackedSeconds: 0,
              entriesCount: 0,
              entriesWithoutScreenshots: 0,
              screenshotCount: 0,
              expectedScreenshots: 0,
              coveragePct: null,
            },
          ],
        },
      }),
    );

    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.coverage.summary[0]).toEqual({ label: "COVERAGE", value: "—" });
    expect(page.coverage.rows[0].coverage).toBe("—");
  });

  it("reports recorded Activity Evidence totals, never a score or a Member ranking", () => {
    const page = composeAnalytics(
      emptyAnalytics({
        activity: {
          byUser: [
            {
              userId: "u-1",
              userName: "Ada Byron",
              totalSeconds: 36000,
              idleSeconds: 18000,
              idleEventCount: 4,
            },
          ],
        },
      }),
    );

    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    // CONTEXT.md Activity Evidence: no productivity scores or member rankings.
    expect(JSON.stringify(page.activity.rows)).not.toContain("50%");
    expect(Object.keys(page.activity.rows[0])).toEqual([
      "userId",
      "who",
      "tracked",
      "idle",
      "idleEvents",
    ]);
    expect(pageSource).not.toMatch(/IDLE SHARE|idleShare|score|ranking/i);
    expect(analyticsSource).not.toMatch(/IDLE SHARE|idleShare|score|ranking/i);
  });

  it("does not decorate analytics with animated charts or counting figures", () => {
    expect(pageSource).not.toMatch(/recharts|chart\.js|ResponsiveContainer/i);
    expect(analyticsSource).not.toMatch(/recharts|chart\.js|ResponsiveContainer/i);
    expect(rule(".df-analytics-figure")).toMatch(/animation:\s*none/);
    expect(rule(".df-analytics-figure")).toMatch(/transition:\s*none/);
  });
});

describe("Tracking Policy editing (#212)", () => {
  it("mirrors the server bounds before a save is attempted", () => {
    expect(trackingPolicyIssue(policyDraft())).toBeNull();
    expect(trackingPolicyIssue(policyDraft({ captureIntervalMinMin: 1 }))).toBe(
      "Minimum capture interval must be at least 3 minutes.",
    );
    expect(
      trackingPolicyIssue(policyDraft({ captureIntervalMinMin: 3, captureIntervalMaxMin: 20 })),
    ).toBe("Maximum capture interval cannot exceed 15 minutes.");
    expect(
      trackingPolicyIssue(policyDraft({ captureIntervalMinMin: 10, captureIntervalMaxMin: 5 })),
    ).toBe("Minimum capture interval cannot exceed the maximum.");
    expect(trackingPolicyIssue(policyDraft({ idleTimeoutMinutes: 90 }))).toBe(
      "Idle timeout must be between 1 and 60 minutes.",
    );
    expect(trackingPolicyIssue(policyDraft({ idleCountdownSeconds: 5 }))).toBe(
      "Idle countdown must be between 15 and 120 seconds.",
    );
  });

  it("refuses a Member and names the Workspace condition for a read-only Workspace", () => {
    const member = composeTrackingPolicyEditor(editorInput({ workspaceRole: "MEMBER" }));
    expect(member.kind).toBe("refusal");
    if (member.kind !== "refusal") return;
    expect(member.refusal).toBe("Administration is open to the Owner and Administrators. Your Workspace Role is Member. Sam Lee (Owner) can change it.");

    const readOnly = composeTrackingPolicyEditor(editorInput({ condition: "Read-only" }));
    expect(readOnly.kind).toBe("ready");
    if (readOnly.kind !== "ready") return;
    expect(readOnly.editable).toBe(false);
    expect(readOnly.writeRefusal).toBe(
      "Harbor Co is read-only. Viewing, export, and recovery stay available.",
    );
    expect(readOnly.canSave).toBe(false);
  });

  it("only offers a save once the draft differs and stays valid", () => {
    const clean = composeTrackingPolicyEditor(editorInput());
    expect(clean.kind).toBe("ready");
    if (clean.kind !== "ready") return;
    expect(clean.dirty).toBe(false);
    expect(clean.canSave).toBe(false);
    expect(clean.issue).toBeNull();
    expect(clean.savedNote).toBeNull();

    const dirty = composeTrackingPolicyEditor(
      editorInput({ draft: policyDraft({ captureIntervalMaxMin: 9 }) }),
    );
    expect(dirty.kind).toBe("ready");
    if (dirty.kind !== "ready") return;
    expect(dirty.dirty).toBe(true);
    expect(dirty.canSave).toBe(true);

    const invalid = composeTrackingPolicyEditor(
      editorInput({ draft: policyDraft({ idleTimeoutMinutes: 0 }) }),
    );
    expect(invalid.kind).toBe("ready");
    if (invalid.kind !== "ready") return;
    expect(invalid.dirty).toBe(true);
    expect(invalid.canSave).toBe(false);
    expect(invalid.issue).toBe("Idle timeout must be between 1 and 60 minutes.");
  });

  it("signs off a saved policy without celebrating it", () => {
    const page = composeTrackingPolicyEditor(editorInput({ justSaved: true }));
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.savedNote).toBe("Policy saved. Devices apply it on their next heartbeat.");
    expect(page.savedNote?.toLowerCase()).not.toMatch(/congratulations|nice work|🎉/);
  });

  it("owns the Screencasts timezone list and validates every entry", () => {
    expect(addAllowedTimezone([], "Europe/Paris")).toEqual({
      ok: true,
      timezones: ["Europe/Paris"],
    });
    expect(addAllowedTimezone(["Europe/Paris"], "  America/New_York  ")).toEqual({
      ok: true,
      timezones: ["Europe/Paris", "America/New_York"],
    });
    expect(addAllowedTimezone(["Europe/Paris"], "Europe/Paris")).toEqual({
      ok: false,
      reason: '"Europe/Paris" is already in the list.',
    });
    expect(addAllowedTimezone([], "Nowhere/Nothing")).toEqual({
      ok: false,
      reason: '"Nowhere/Nothing" is not a valid IANA timezone.',
    });
    expect(addAllowedTimezone([], "   ")).toEqual({
      ok: false,
      reason: "Enter an IANA timezone, for example Europe/Paris.",
    });
    expect(removeAllowedTimezone(["Europe/Paris", "America/New_York"], "Europe/Paris")).toEqual([
      "America/New_York",
    ]);

    const page = composeTrackingPolicyEditor(
      editorInput({ savedTimezones: [], draftTimezones: ["Europe/Paris"] }),
    );
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.timezones.rows).toEqual(["Europe/Paris"]);
    expect(page.timezones.empty).toBe(false);
    expect(page.timezones.dirty).toBe(true);

    const none = composeTrackingPolicyEditor(editorInput());
    expect(none.kind).toBe("ready");
    if (none.kind !== "ready") return;
    expect(none.timezones.empty).toBe(true);
    expect(none.timezones.emptyCopy.toLowerCase()).toContain("browser timezone");
  });

  it("leaves Activity displaying the policy rather than rebuilding it", () => {
    const activitySource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Activity.tsx"),
      "utf8",
    );
    expect(activitySource).toContain("trackingPolicyPath");
    expect(activitySource).toContain("policyLines");
    expect(activitySource).not.toContain("org-settings");
    expect(pageSource).toContain("composeTrackingPolicyEditor");
  });
});

describe("Administration controls (#212)", () => {
  it("uses the shadcn checkbox rather than a bare input, and labels every one", () => {
    expect(pageSource).toContain('from "@/components/ui/checkbox"');
    expect(pageSource).not.toContain('type="checkbox"');
    // Radix renders a button, which a <label> cannot implicitly label.
    expect(pageSource).toContain("htmlFor={id}");
    expect(rule(".df-v2 .df-checkbox")).toMatch(/border-radius/);
    expect(rule('.df-v2 .df-checkbox[data-state="checked"]')).toMatch(/var\(--df-case-ink\)/);
    // The tick must not inherit the ink it sits on.
    expect(rule(".df-v2 .df-checkbox")).toMatch(/color:\s*var\(--df-on-ink\)/);
    // shadcn ships Tailwind state classes at equal weight; ours must outrank
    // them so the control never depends on stylesheet order.
    expect(css).toContain('.df-v2 .df-checkbox[data-state="checked"]');
  });

  it("waits with the destination's real geometry, not an empty box", () => {
    // The skeleton pieces moved to V2Skeleton.tsx so every destination shares them.
    const skeletonSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Skeleton.tsx"),
      "utf8",
    );
    expect(pageSource).toContain('from "./V2Skeleton"');
    expect(skeletonSource).toContain('from "@/components/ui/skeleton"');
    // The old placeholder was a bare card with a hardcoded height.
    expect(pageSource).not.toContain("minHeight: 280");
    // Section titles are known before any fetch, so the wait states them.
    expect(pageSource).toContain('<SkeletonSection title="Workspace"');
    expect(analyticsSource).toContain('from "./V2Skeleton"');
    expect(analyticsSource).toContain('<SkeletonSection title="Analytics"');
    expect(analyticsSource).toContain('<SkeletonSection title="Warnings"');
    // The wait reuses the real bands and rows, so nothing moves on arrival.
    expect(skeletonSource).toContain('className="df-figure-band"');
    expect(skeletonSource).toContain('className="df-register-row"');
    expect(skeletonSource).toContain('aria-busy="true"');
    expect(skeletonSource).toContain('role="status"');
  });

  it("breathes on opacity only and stops entirely under reduced motion", () => {
    const recipe = motionForSurface("skeleton");
    expect(recipe.movement).toBe("none");
    expect(recipe.enterExit).toBe("instant");
    expect(recipe.keepOpacity).toBe(true);

    expect(rule(".df-v2 .df-skeleton")).toMatch(/animation:\s*df-skeleton-breathe/);
    // A breathe that moved anything would fight the geometry it is holding.
    expect(css).toMatch(/@keyframes df-skeleton-breathe[^}]*\{[^}]*opacity/);
    expect(rule(".df-v2 .df-skeleton")).not.toMatch(/transform/);
    expect(reducedMotionCss()).toMatch(
      /\.df-v2 \.df-skeleton[^{]*\{[^}]*animation:\s*none/,
    );
  });

  it("uses the v2 filter select for the range, and no native select anywhere", () => {
    expect(analyticsSource).toContain('from "./V2Select"');
    expect(analyticsSource).toContain("<V2FilterSelect");
    for (const source of [pageSource, analyticsSource]) {
      // Every select goes through V2FilterSelect, never the bare shadcn parts.
      expect(source).not.toContain('from "@/components/ui/select"');
      expect(source).not.toContain("<select");
      expect(source).not.toContain("<option");
    }
    expect(analyticsSource).toContain('ariaLabel="Analytics range"');
    // Radix portals the panel to document.body, outside `.df-v2`, so it must
    // carry the class itself or every --df-* token stops resolving.
    expect(selectSource).toContain('className="df-v2 df-select-content"');
    expect(rule(".df-v2.df-select-content")).toMatch(/var\(--df-card-white\)/);
    // shadcn's own `h-9 w-full border-input` must lose to the chip.
    expect(rule(".df-v2 .df-select-trigger")).toMatch(/width:\s*auto/);
    expect(rule(".df-v2 .df-select-item\[data-highlighted\]")).toMatch(/var\(--df-hover\)/);
  });

  it("gives a field and the button beside it one shared control height", () => {
    expect(css).toMatch(/--df-control-h:\s*\d+px/);
    const shared = css.match(/([^}]*)\{\s*height:\s*var\(--df-control-h\);\s*\}/);
    expect(shared).not.toBeNull();
    const selectors = shared![1];
    for (const control of [
      ".df-toolbar .df-btn",
      ".df-form-actions .df-btn",
      ".df-inline-form .df-btn",
    ]) {
      expect(selectors).toContain(control);
    }
  });

  it("scrolls the chrome without drawing a scrollbar", () => {
    expect(rule(".df-main,\n.df-rail-body")).toMatch(/scrollbar-width:\s*none/);
    expect(css).toMatch(/\.df-main::-webkit-scrollbar[^{]*\{[^}]*display:\s*none/);
  });
});

describe("Tracking Policy save motion (#212)", () => {
  it("treats the save as occasional state indication and keeps reduced motion on opacity", () => {
    const recipe = motionForSurface("tracking-policy-save");
    expect(recipe.enterExit).toBe("standard");
    expect(recipe.keepOpacity).toBe(true);

    const reduced = motionForSurface("tracking-policy-save", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);

    expect(rule('.df-policy-saved[data-motion="standard"]')).toMatch(/var\(--ease-out\)/);
    expect(rule('.df-policy-saved[data-motion="standard"]')).not.toMatch(/transition\s*:\s*all\b/);
    expect(rule(".df-policy-form input")).toMatch(/animation:\s*none/);
    expect(reducedMotionCss()).toMatch(
      /\.df-policy-saved\[data-motion="standard"\][^{]*\{[^}]*transform:\s*none/,
    );
  });
});

describe("The Billing card reads as one card (#245, F1)", () => {
  function activeBilling(overrides: Partial<BillingInput> = {}): AdministrationInput {
    return emptyAdmin({
      billing: {
        planKey: "pro",
        billingState: "Active",
        purchasedSeatCapacity: 8,
        consumedSeatCount: 3,
        trialEndsAt: null,
        periodEndsAt: "2026-10-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
        stripeCustomerId: "cus_123",
        ...overrides,
      },
    });
  }

  it("sets Cancel at period end apart from the routine actions and states what it costs", () => {
    const page = composeAdministration(activeBilling());
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;

    const cancel = page.billing.actions.find((action) => action.id === "cancel");
    const paymentMethod = page.billing.actions.find((action) => action.id === "payment-method");
    expect(cancel).toBeDefined();
    expect(paymentMethod).toBeDefined();
    if (!cancel || !paymentMethod) return;

    // The reflex that reaches Update payment method must not reach this one.
    expect(cancel.tone).toBe("destructive");
    expect(paymentMethod.tone).toBe("neutral");

    // And it says what it ends, and when, before it runs.
    expect(cancel.consequence).toBe(
      "Pro entitlements stay until 1 OCT 2026. On that day writes stop and " +
        "the Workspace becomes read-only. Viewing, export, and recovery stay available.",
    );
    expect(paymentMethod.consequence).toBeNull();
  });

  it("still names the day when the subscription has no period end to name", () => {
    const page = composeAdministration(activeBilling({ periodEndsAt: null }));
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;

    const cancel = page.billing.actions.find((action) => action.id === "cancel");
    expect(cancel?.consequence).toBe(
      "Writes stop at the end of the current period and the Workspace becomes " +
        "read-only. Viewing, export, and recovery stay available.",
    );
  });

  it("gives the seat control the figure it edits, rather than a blank field", () => {
    const page = composeAdministration(activeBilling());
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;

    // The field starts from what the Workspace already bought, so it never
    // contradicts the figure above it.
    expect(page.billing.seatQuantityDefault).toBe("8");
  });

  it("never lets one press end the subscription", () => {
    const pageSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Administration.tsx"),
      "utf8",
    );

    // Opening the dialog is not the press that mutates.
    expect(pageSource).toContain("Keep subscription");
    expect(pageSource).toContain('data-testid="v2-administration-billing-cancel-confirm"');
    expect(pageSource).toContain('from "@/components/ui/alert-dialog"');
    expect(pageSource).not.toMatch(/onClick=\{\(\) => cancelAtPeriodEnd\.mutate\(\)\}/);

    // The write gate still runs on the press that actually cancels.
    const confirmBody = pageSource.slice(pageSource.indexOf("<CancelControl"));
    expect(confirmBody.slice(0, 320)).toContain("if (!guardWrite()) return;");
    expect(confirmBody.slice(0, 320)).toContain("cancelAtPeriodEnd.mutate()");
  });

  it("puts the entitlement status in the figure band, in the domain's words", () => {
    const page = composeAdministration(activeBilling());
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;

    expect(page.billing.figures).toEqual([
      { label: "PLAN", value: "Pro" },
      // CONDITION was neither the domain's word nor distinct from the header chip.
      { label: "BILLING STATE", value: "Active" },
      { label: "WRITES", value: "Allowed" },
      { label: "RENEWS", value: "1 OCT 2026" },
      // Last of five in a four-column band, so it lands on the row above the
      // seat control instead of two figures away from it.
      { label: "BILLABLE SEATS", value: "3 of 8" },
    ]);
    // The sentence is only worth showing when it carries more than the figure.
    expect(page.billing.entitlementNote).toBeNull();
  });

  it("keeps the read-only sentence, which says more than the figure can", () => {
    const page = composeAdministration(activeBilling({ billingState: "ReadOnly" }));
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;

    expect(page.billing.figures[2]).toEqual({ label: "WRITES", value: "Blocked" });
    expect(page.billing.entitlementNote).toBe(
      "Writes blocked. Viewing, export, and recovery stay available.",
    );
  });
});

describe("Administration billing remainder (#212)", () => {
  it("keeps a seeded or legacy Workspace out of Checkout", () => {
    const legacy = composeAdministration(
      emptyAdmin({
        billing: {
          planKey: "legacy",
          billingState: "Active",
          purchasedSeatCapacity: 25,
          consumedSeatCount: 4,
          trialEndsAt: null,
          periodEndsAt: null,
          cancelAtPeriodEnd: false,
          stripeCustomerId: null,
        },
      }),
    );

    expect(legacy.kind).toBe("ready");
    if (legacy.kind !== "ready") return;
    expect(legacy.billing.plan).toBe("Legacy");
    expect(legacy.billing.actions.map((action) => action.id)).toEqual(["cancel"]);
    expect(legacy.billing.actions.map((action) => action.id)).not.toContain("checkout");
    expect(legacy.billing.actions.map((action) => action.id)).not.toContain("seats");
  });

  it("reads the subscription as discrete facts, including the term the BFF already returns", () => {
    const trial = composeAdministration(
      emptyAdmin({
        billing: {
          planKey: "trial",
          billingState: "Trialing",
          purchasedSeatCapacity: 1,
          consumedSeatCount: 1,
          trialEndsAt: "2026-09-20T00:00:00.000Z",
          periodEndsAt: null,
          cancelAtPeriodEnd: false,
          stripeCustomerId: null,
        },
      }),
    );
    expect(trial.kind).toBe("ready");
    if (trial.kind !== "ready") return;
    expect(trial.billing.figures).toEqual([
      { label: "PLAN", value: "Trial" },
      { label: "BILLING STATE", value: "Trial" },
      { label: "WRITES", value: "Allowed" },
      { label: "TRIAL ENDS", value: "20 SEP 2026" },
      { label: "BILLABLE SEATS", value: "1 of 1" },
    ]);

    const cancelling = composeAdministration(
      emptyAdmin({
        billing: {
          planKey: "pro",
          billingState: "Active",
          purchasedSeatCapacity: 8,
          consumedSeatCount: 3,
          trialEndsAt: null,
          periodEndsAt: "2026-10-01T00:00:00.000Z",
          cancelAtPeriodEnd: true,
          stripeCustomerId: "cus_123",
        },
      }),
    );
    expect(cancelling.kind).toBe("ready");
    if (cancelling.kind !== "ready") return;
    expect(cancelling.billing.figures[3]).toEqual({
      label: "ACCESS ENDS",
      value: "1 OCT 2026",
    });

    const renewing = composeAdministration(
      emptyAdmin({
        billing: {
          planKey: "pro",
          billingState: "Active",
          purchasedSeatCapacity: 8,
          consumedSeatCount: 3,
          trialEndsAt: null,
          periodEndsAt: "2026-10-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          stripeCustomerId: "cus_123",
        },
      }),
    );
    expect(renewing.kind).toBe("ready");
    if (renewing.kind !== "ready") return;
    expect(renewing.billing.figures[3]).toEqual({ label: "RENEWS", value: "1 OCT 2026" });

    const none = composeAdministration(emptyAdmin());
    expect(none.kind).toBe("ready");
    if (none.kind !== "ready") return;
    expect(none.billing.available).toBe(false);
    expect(none.billing.figures).toEqual([]);
  });

  it("names the refusal when Checkout is refused for a seeded Workspace", () => {
    expect(
      administrationWriteRefusal({
        kind: "error",
        workspaceName: "Harbor Co",
        ownerName: "Sam Lee",
        errorMessage: "Checkout is not available for this Workspace",
      }),
    ).toBe("Checkout is not available for this Workspace");
  });
});
