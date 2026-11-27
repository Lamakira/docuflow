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
  PIPELINE_STALE_MESSAGE,
  isPipelineStale,
  addPipelineOption,
  composePipelineLists,
  movePipelineOption,
  optionValue,
  recolourPipelineOption,
  removePipelineOption,
  renamePipelineOption,
  savePipelineList,
  PIPELINE_RENAME_HINT,
  PIPELINE_SAVED_MS,
  feedbackFor,
  pipelineFeedback,
  type PipelineListModel,
} from "../../client/src/v2/pipelineLists";
import { diffFieldOptions, builtInList, serializeFieldOption } from "@shared/pipelineLists";
import {
  administrationReadOnlyNote,
  administrationRefusal,
  billingCancelPath,
  billingCheckoutPath,
  billingKeepPath,
  billingPaymentMethodPath,
  billingPricesPath,
  billingSeatsPath,
  billingSubscriptionPath,
  checkoutTotalLine,
  composeBilling,
  composeServiceAccounts,
  composeTrackingPolicyEditor,
  composeWebhookEndpoints,
  composeWorkspaceTimeZone,
  formatMoney,
  normalizeScreenshotPolicy,
  policyPatch,
  pruneEdits,
  secretOnce,
  seatChangeConfirmation,
  seatFloorNote,
  seatPriceLine,
  seatQuantityIssue,
  serviceAccountIssue,
  serviceAccountPath,
  TRACKING_POLICY_SAVED,
  hostedBillingSession,
  planPickerNote,
  workspaceSettingsPath,
  rotateServiceAccountPath,
  rotateWebhookEndpointPath,
  revokeServiceAccountPath,
  serviceAccountsPath,
  webhookDisablePath,
  webhookEnablePath,
  webhookEndpointsPath,
  workspaceTimeZoneChoices,
  administrationWriteRefusal,
  trackingPolicyHints,
  type BillingInput,
  type PolicyEdits,
  type TrackingPolicyInput,
} from "../../client/src/v2/administration";
import { analyticsRefusal } from "../../client/src/v2/analytics";

/**
 * Administration from existing Workspace operator routes (#193).
 * Seams: matchV2Route (flagged app chrome) and the composers in administration.ts over `/api/*`.
 * HTTP `/api/*` stays characterized elsewhere. Do not assert hex.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2AuthenticatedApp.tsx"),
  "utf8",
);

const v2 = (name: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2", name), "utf8");

/** Administration is one shell and a file per tab since the review (F107). */
const ADMIN_FILES = [
  "V2Administration.tsx",
  "V2AdministrationWorkspace.tsx",
  "V2AdministrationBilling.tsx",
  "V2AdministrationTrackingPolicy.tsx",
  "V2AdministrationPipelineLists.tsx",
  "V2AdministrationIntegrations.tsx",
  "V2AdministrationParts.tsx",
  "V2DestructiveConfirm.tsx",
];
const shellSource = v2("V2Administration.tsx");
const billingSource = v2("V2AdministrationBilling.tsx");
const policySource = v2("V2AdministrationTrackingPolicy.tsx");
const pipelineSource = v2("V2AdministrationPipelineLists.tsx");
const integrationsSource = v2("V2AdministrationIntegrations.tsx");
const workspaceSource = v2("V2AdministrationWorkspace.tsx");
const pageSource = ADMIN_FILES.map(v2).join("\n");

const analyticsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Analytics.tsx"),
  "utf8",
);

const chartsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2AnalyticsCharts.tsx"),
  "utf8",
);

const adminModuleSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/administration.ts"),
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

function billingOf(billing: BillingInput | null, condition: "Read-only" | null = null) {
  return composeBilling({ billing, condition });
}

describe("Administration routing (#193)", () => {
  it("shows a live Administration destination on /administration, not a placeholder", () => {
    const match = matchV2Route("/administration");
    expect(match.kind).toBe("administration");
    expect(navIdForPath("/administration")).toBe("administration");
    expect(breadcrumbFor("/administration", "Harbor Co").map((crumb) => crumb.label)).toEqual(["Harbor Co"]);
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

describe("Pipeline and lists replaces the CRM field builder", () => {
  it("shows exactly the four lists records read, on the real module and field slugs", () => {
    expect(PIPELINE_LISTS.map((list) => [list.id, list.title, list.builtIn.module.slug, list.builtIn.field.slug])).toEqual([
      ["opportunity-stages", "Opportunity stages", "projects", "status"],
      ["project-type", "Project type", "projects", "project_type"],
      ["source", "Source", "contacts", "source"],
      ["lost-reasons", "Lost reasons", "projects", "lost_reason"],
    ]);
    expect(composePipelineLists(seededModules()).map((list) => list.id)).toEqual([
      "opportunity-stages",
      "project-type",
      "source",
      "lost-reasons",
    ]);
  });

  it("offers a Workspace with no modules the values each consumer falls back to", () => {
    const [stages, types, sources, lostReasons] = composePipelineLists([]);
    for (const list of [stages, types, sources, lostReasons]) {
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
    expect(lostReasons.entries.map((entry) => entry.value)).toEqual([
      "price",
      "timing",
      "chose_a_competitor",
      "no_response",
      "other",
    ]);
    expect(lostReasons.rows.every((row) => !row.builtIn)).toBe(true);
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
    // Two names that store one value: the refusal names the option already there (F106).
    expect(addPipelineOption(stages, "Follow-up")).toEqual({ ok: false, reason: "Too close to “follow_up”, already in this list." });
    expect(addPipelineOption(stages, "follow_up")).toEqual({ ok: false, reason: "“follow_up” is already in this list." });
    expect(addPipelineOption(stages, "Won")).toEqual({ ok: false, reason: "Won and Lost are fixed outcomes. Name an open stage." });
    expect(addPipelineOption(stages, "Won - Paid").ok).toBe(true);
    expect(addPipelineOption(stages, "Won - In progress").ok).toBe(false);
    expect(addPipelineOption(stages, "   ")).toEqual({ ok: false, reason: "Name the stage." });
    expect(addPipelineOption(stages, "!!!")).toEqual({ ok: false, reason: "Use at least one letter from a to z or a number." });

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

  it("sends the version a saved list was read at, so a stale save is refused (F106)", async () => {
    const calls: Array<[string, string, Record<string, unknown>]> = [];
    const send = async (method: "POST" | "PATCH", path: string, body: Record<string, unknown>) => {
      calls.push([method, path, body]);
      return {};
    };
    const modules = seededModules();
    (modules[0].fields![0] as { updatedAt: unknown }).updatedAt = "2026-11-20T09:15:30.123Z";
    const stages = listOf(modules, "opportunity-stages");
    expect(stages.updatedAt).toBe("2026-11-20T09:15:30.123Z");
    const moved = movePipelineOption(stages, 1, 1);
    if (!moved.ok) throw new Error("edit refused");
    await savePipelineList(stages, moved, send);
    expect(calls).toEqual([
      ["PATCH", "/api/admin/fields/fld-status", { options: moved.options, expectedUpdatedAt: "2026-11-20T09:15:30.123Z" }],
    ]);
  });

  it("writes nothing over a list someone saved while this tab showed the defaults", async () => {
    const calls: Array<[string, string, Record<string, unknown>]> = [];
    // The real options of the dev Workspace, saved by someone else meanwhile.
    const theirs = ['{"id":"lead","label":"lead","color":"#ec4899"}', '{"id":"x1","label":"In Negociation","color":"#3b82f6"}'];
    const send = async (method: "POST" | "PATCH", path: string, body: Record<string, unknown>) => {
      calls.push([method, path, body]);
      return method === "POST"
        ? [{ id: "mod-new", slug: "projects", fields: [{ id: "fld-new", slug: "status", options: theirs, updatedAt: "2026-11-25T10:00:00.000Z" }] }]
        : {};
    };
    const stages = listOf([], "opportunity-stages");
    const renamed = renamePipelineOption(stages, 2, "Proposal out");
    if (!renamed.ok) throw new Error("edit refused");
    const refusal = await savePipelineList(stages, renamed, send).catch((error: unknown) => error);
    expect(isPipelineStale(refusal)).toBe(true);
    expect((refusal as Error).message).toBe(PIPELINE_STALE_MESSAGE);
    expect(calls.map(([method]) => method)).toEqual(["POST"]);

    // The defaults the tab showed come back: the edit goes through, at their version.
    const defaults = stages.entries.map(serializeFieldOption);
    const created = async (method: "POST" | "PATCH", path: string, body: Record<string, unknown>) => {
      calls.push([method, path, body]);
      return method === "POST"
        ? [{ id: "mod-new", slug: "projects", fields: [{ id: "fld-new", slug: "status", options: defaults, updatedAt: "2026-11-25T10:00:00.000Z" }] }]
        : {};
    };
    calls.length = 0;
    await savePipelineList(stages, renamed, created);
    expect(calls[1]).toEqual(["PATCH", "/api/admin/fields/fld-new", { options: renamed.options, expectedUpdatedAt: "2026-11-25T10:00:00.000Z" }]);
  });

  it("tells the server's 409 from any other refusal", () => {
    expect(PIPELINE_STALE_MESSAGE).toBe(
      "Someone changed this list since you opened it. It has been reloaded; make your change again.",
    );
    expect(isPipelineStale(Object.assign(new Error("anything"), { status: 409 }))).toBe(true);
    expect(isPipelineStale(new Error(PIPELINE_STALE_MESSAGE))).toBe(true);
    expect(isPipelineStale(Object.assign(new Error("Forbidden"), { status: 403 }))).toBe(false);
    // The tab writes through a send that keeps the status, and shows the 409 beside the list.
    expect(pipelineSource).toContain("throw Object.assign(new Error(message), { status: res.status });");
    expect(pipelineSource).toMatch(/if \(isPipelineStale\(error\)\) \{\s*setPipelineStatus\(pipelineFeedback\(feedback\.id, feedback\.listId, null,/);
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
    const [stages, types, sources, lostReasons] = composePipelineLists(seededModules());
    expect(stages.renameNote).toBe(
      "Renaming a stage moves every Opportunity already at it. Built-in stages keep their names and cannot be removed.",
    );
    expect(types.renameNote).toBe(
      "Renaming a type updates every Project that already has it. Built-in types keep their names and cannot be removed.",
    );
    expect(sources.renameNote).toBe(
      "Renaming a source updates every Client and Opportunity already recorded with it. Fiverr is built in: it keeps its name and cannot be removed.",
    );
    expect(lostReasons.renameNote).toBe("Renaming a reason updates every Lost Opportunity already closed with it.");

    expect(stages.rows[2].removeConsequence).toBe(
      "No Opportunity is changed. Opportunities already at “proposal_sent” stay there and still show on the board, but no Opportunity can be moved to it. Adding “proposal_sent” back restores it.",
    );
    expect(types.rows[0].removeConsequence).toContain("No Project is changed.");
    expect(sources.rows[0].removeConsequence).toContain("No Client or Opportunity is changed.");
    expect(lostReasons.rows[0].removeConsequence).toContain("No Opportunity is changed.");
    for (const list of [stages, types, sources, lostReasons]) {
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
    expect(pipelineSource).toContain("for (const queryKey of PIPELINE_LIST_QUERY_KEYS) queryClient.invalidateQueries({ queryKey });");
  });

  it("drops the module builder, the field-type select, the Enable toggle and the old copy", () => {
    expect(shellSource).toMatch(/<TabsContent value="pipeline-lists"[^>]*>\s*<V2AdministrationPipelineLists context=\{context\} \/>/);
    expect(pipelineSource).toContain("{PIPELINE_LISTS_INTRO}");
    expect(pageSource).not.toContain("Add module");
    expect(pageSource).not.toContain("Add field");
    expect(pageSource).not.toContain("CRM_FIELD_TYPES");
    expect(pageSource).not.toContain('ariaLabel="CRM field type"');
    expect(pageSource).not.toContain("isEnabled ? 0 : 1");
    expect(pageSource).not.toContain("removed from Clients and Projects");
    expect(pageSource).not.toContain('apiRequest("DELETE", `/api/admin/modules/');
    expect(pageSource).not.toContain('apiRequest("DELETE", `/api/admin/fields/');
    // shadcn controls, not bare ones.
    expect(pipelineSource).toContain('import { Input } from "@/components/ui/input";');
    const card = pipelineSource.slice(pipelineSource.indexOf("function PipelineListCard("));
    expect(card).not.toMatch(/<input\b/);
    expect(card).not.toMatch(/<textarea\b/);
    expect(card).toContain("<ColourPicker");
    expect(card).toContain("<PopoverContent");
    // Statuses as the app's pills, in sentence case (F110).
    expect(card).toContain('<span className="df-status-word">Built in</span>');
    expect(card).toContain('<span className="df-status-word">Fixed outcome</span>');
    expect(card).toContain('<span className="df-status-word">Defaults</span>');
    expect(card).not.toMatch(/BUILT IN|FIXED OUTCOME|DEFAULTS/);
  });

  it("moves an option with chevron buttons that keep their names", () => {
    const card = pipelineSource.slice(pipelineSource.indexOf("function PipelineListCard("));
    expect(card).toContain("<ChevronUp strokeWidth={1.6} aria-hidden />");
    expect(card).toContain("<ChevronDown strokeWidth={1.6} aria-hidden />");
    expect(card).toContain("aria-label={`Move ${row.label} up`}");
    expect(card).toContain("aria-label={`Move ${row.label} down`}");
    expect(card).not.toMatch(/>\s*(Up|Down)\s*</);
  });

  it("edits nothing until the lists are read: a skeleton, then a failure with Try again", () => {
    expect(pipelineSource).toContain('read.state === "loading" ? (');
    expect(pipelineSource).toContain("<SkeletonSection key={spec.id} title={spec.title}");
    expect(pipelineSource).toContain('<V2LoadFailed title="The lists could not be loaded" onRetry={read.retry}');
    // A failed read is never composed into the defaults.
    expect(pipelineSource).toContain('read.state === "ready" && read.data ? (');
    expect(pipelineSource).not.toContain("?? []).map");
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

describe("Pipeline and lists says when a change saves", () => {
  const card = pipelineSource.slice(pipelineSource.indexOf("function PipelineListCard("), pipelineSource.indexOf("/** The colours an option may wear"));

  it("tells a focused name which keys rename and cancel, without moving the list", () => {
    expect(PIPELINE_RENAME_HINT).toBe("Press Enter to rename · Esc to cancel");
    expect(card).toContain("aria-describedby={hintId}");
    expect(card).toContain("onFocus={() => setNaming(row.id)}");
    expect(card).toContain("hint={naming === row.id ? PIPELINE_RENAME_HINT : null}");
    // The slot has its own column on every row, so it appearing shifts nothing.
    expect(rule(".df-pipeline-item")).toMatch(/grid-template-columns:\s*minmax\(0, 720px\) minmax\(0, 1fr\)/);
    expect(rule(".df-pipeline-status")).toMatch(/color:\s*var\(--df-archive-slate\)/);
  });

  it("reports each save beside the row it changed, or under the list when the row is new or gone", () => {
    expect(card).toContain("onEdit(renamePipelineOption(list, row.index, next), row.id)");
    expect(card).toContain("onEdit(recolourPipelineOption(list, row.index, color), row.id)");
    expect(card).toContain("onEdit(movePipelineOption(list, row.index, -1), row.id)");
    expect(card).toContain("onEdit(removePipelineOption(list, row.index), null)");
    expect(card).toContain("onEdit(addPipelineOption(list, draft), null)");

    const saving = pipelineFeedback(3, "project-type", "retainer", { phase: "saving" });
    expect(saving).toEqual({ id: 3, listId: "project-type", rowId: "retainer", phase: "saving", message: "Saving…" });
    expect(pipelineFeedback(3, "project-type", "retainer", { phase: "saved" }).message).toBe("Saved");
    expect(pipelineFeedback(4, "source", null, { phase: "failed", reason: "“Zoho” is already in this list." }).message).toBe(
      "“Zoho” is already in this list.",
    );
    expect(feedbackFor(saving, "project-type", "retainer")).toBe(saving);
    expect(feedbackFor(saving, "project-type", "monthly")).toBeNull();
    expect(feedbackFor(saving, "project-type", null)).toBeNull();
    expect(feedbackFor(saving, "source", "retainer")).toBeNull();
  });

  it("confirms a save briefly and politely, then fades unless motion is reduced", () => {
    expect(PIPELINE_SAVED_MS).toBe(2000);
    expect(card).toContain('aria-live="polite"');
    expect(pageSource).toContain('{status?.phase === "saved" ? <CheckIcon /> : null}');
    expect(pageSource).toMatch(/window\.setTimeout\(\s*\(\) => setPipelineStatus\(\(current\) => \(current\?\.id === shown \? null : current\)\),\s*PIPELINE_SAVED_MS,/);
    expect(rule('.df-pipeline-status[data-phase="saved"]')).toMatch(/color:\s*var\(--df-positive-ink\)/);
    expect(rule('.df-pipeline-status[data-phase="saved"]')).toMatch(/animation:\s*df-pipeline-saved/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.df-pipeline-status\[data-phase="saved"\] \{\s*animation: none;/);
    for (const selector of [".df-pipeline-item", ".df-pipeline-status", '.df-pipeline-status[data-phase="saved"]']) {
      expect(rule(selector)).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    }
  });

  it("shows a refused save beside its row and puts the saved name back", () => {
    expect(pageSource).toContain('<p id={hintId} className="df-pipeline-status df-refusal" data-phase="failed" role="alert">');
    expect(card).toContain('key={`${row.label}:${rowStatus?.phase === "failed" ? rowStatus.id : listStatus?.phase === "failed" ? `list-${listStatus.id}` : 0}`}');
    expect(card).toContain("<PipelineStatus status={listStatus} />");
    expect(card).not.toContain("{issue ?");
    // Any other server refusal still reaches the tab's refusal line.
    expect(pipelineSource).toMatch(/onError: \(error: Error, \{ feedback \}\) => \{[\s\S]*?return;\s*\}\s*writes\.refuse\(error\.message\);/);
  });
});

describe("Administration from operator routes (#193)", () => {
  it("refuses Members by naming the Workspace Role, never permission denied", () => {
    const refusal = administrationRefusal({ workspaceRole: "MEMBER", ownerName: "Sam Lee" });
    expect(refusal).toBe("Administration is open to the Owner and Administrators. Your Workspace Role is Member. Sam Lee (Owner) can change it.");
    expect(refusal.toLowerCase()).not.toContain("permission denied");
    // No Capability is named, because none exists to grant (#238).
    expect(refusal).not.toContain("Capability");
    // Drawn as Analytics draws its refusal, not a bare line (F110).
    expect(shellSource).toMatch(/<V2EmptyState\s+icon="access"\s+title="Administration is not open to you"\s+copy=\{administrationRefusal\(\{ workspaceRole, ownerName \}\)\}/);
    expect(shellSource).not.toContain('className="df-refusal" data-testid="v2-administration-refusal"');
  });

  it("never sends the Owner to ask the Owner (#238)", () => {
    // The Owner is not refused at all: that was the whole of D5.
    expect(shellSource).toContain("if (!canManage) {");
    // And where an Owner is refused for some other reason, the copy does not
    // offer them a grant only they could make.
    const refused = analyticsRefusal({ workspaceRole: "Owner", ownerName: "User Test", refused: true });
    expect(refused).toBe("Analytics could not be opened for your Membership in this Workspace.");
    expect(refused).not.toContain("User Test");
    expect(refused).not.toContain("Capability");
  });

  it("empty operator lists use empty geometry and never show sample names", () => {
    const accounts = composeServiceAccounts({ serviceAccounts: [], condition: null, showRevoked: false });
    const endpoints = composeWebhookEndpoints({ webhookEndpoints: [], condition: null });
    const blob = JSON.stringify([accounts, endpoints]);
    expect(accounts.empty).toBe(true);
    expect(accounts.rows).toEqual([]);
    expect(accounts.emptyCopy.toLowerCase()).toContain("service account");
    expect(endpoints.empty).toBe(true);
    expect(endpoints.emptyCopy.toLowerCase()).toContain("webhook");
    // No longer promises a delivery that does not exist on main (F105).
    expect(endpoints.emptyCopy).not.toContain("start receiving");
    expect(secretOnce(null)).toBeNull();
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("lists Service Accounts without plaintext keys, in sentence case, revoked ones behind a box", () => {
    const serviceAccounts = [
      { id: "sa-1", name: "Invoices", capabilityIds: ["clients_read", "webhook_endpoints_manage"], revokedAt: null },
      { id: "sa-2", name: "Retired", capabilityIds: [], revokedAt: "2026-09-01T00:00:00.000Z" },
    ];
    const hidden = composeServiceAccounts({ serviceAccounts, condition: null, showRevoked: false });
    expect(hidden.rows.map((row) => row.id)).toEqual(["sa-1"]);
    expect(hidden.revokedCount).toBe(1);
    const shown = composeServiceAccounts({ serviceAccounts, condition: null, showRevoked: true });
    expect(shown.rows).toEqual([
      {
        id: "sa-1",
        name: "Invoices",
        capabilityIds: ["clients_read", "webhook_endpoints_manage"],
        capabilities: "Read Clients · Manage Webhook Endpoints",
        status: "Active",
        rotate: true,
        revoke: true,
        edit: true,
      },
      {
        id: "sa-2",
        name: "Retired",
        capabilityIds: [],
        capabilities: "-",
        status: "Revoked",
        rotate: false,
        revoke: false,
        edit: false,
      },
    ]);
    // Only revoked ones: the empty state stays behind the box.
    expect(composeServiceAccounts({ serviceAccounts: [serviceAccounts[1]], condition: null, showRevoked: false }).empty).toBe(true);
    expect(integrationsSource).toContain('label="Show revoked"');
    expect(integrationsSource).toContain("<FilterCheck");

    const endpoints = composeWebhookEndpoints({
      webhookEndpoints: [
        { id: "wh-1", url: "https://hooks.example.test/crm", eventTypes: ["client.created"], disabledAt: null },
        { id: "wh-2", url: "https://hooks.example.test/idle", eventTypes: ["time_entry.stopped"], disabledAt: "2026-09-02T00:00:00.000Z" },
      ],
      condition: null,
    });
    expect(endpoints.rows.map((row) => [row.id, row.status, row.disable, row.enable])).toEqual([
      ["wh-1", "Active", true, false],
      ["wh-2", "Disabled", false, true],
    ]);
    // A key the server sent back by mistake never reaches a row.
    const leaked = composeServiceAccounts({
      serviceAccounts: serviceAccounts.map((row) => ({ ...row, plaintextKey: "dfsa_should_never_list" })),
      condition: null,
      showRevoked: true,
    });
    const leakedEndpoints = composeWebhookEndpoints({
      webhookEndpoints: [{ id: "wh-1", url: "https://hooks.example.test/crm", eventTypes: [], disabledAt: null, plaintextSecret: "dfwh_should_never_list" }],
      condition: null,
    });
    expect(JSON.stringify([shown, leaked])).not.toMatch(/plaintext|dfsa_/i);
    expect(JSON.stringify([endpoints, leakedEndpoints])).not.toMatch(/plaintext|dfwh_/i);
  });

  it("asks for a name of 100 characters at most and at least one Capability (F109)", () => {
    expect(serviceAccountIssue("  ", ["clients_read"])).toBe("Name the Service Account.");
    expect(serviceAccountIssue("x".repeat(101), ["clients_read"])).toBe("Keep the name to 100 characters or fewer.");
    expect(serviceAccountIssue("Invoices", [])).toBe("Choose at least one Capability, or the Service Account can do nothing.");
    expect(serviceAccountIssue(" Invoices ", ["clients_read"])).toBeNull();
    expect(serviceAccountPath("sa-1")).toBe("/api/service-accounts/sa-1");
    expect(integrationsSource).toContain('apiRequest("PATCH", serviceAccountPath(id), { name: editDraft.name.trim(), capabilityIds: editDraft.capabilityIds })');
    expect(integrationsSource).toContain('testId="v2-administration-edit-service-account"');
  });

  it("shows a newly created or rotated key once, in a dialog that closes only by its own button", () => {
    expect(secretOnce({ kind: "service-account", id: "sa-1", label: "Invoices", plaintext: "dfsa_shown_once" })).toEqual({
      kind: "service-account",
      id: "sa-1",
      label: "Invoices",
      plaintext: "dfsa_shown_once",
      confirmation: "Copy this now. It will not be shown again.",
    });
    const dialog = integrationsSource.slice(integrationsSource.indexOf("function KeyDialog("));
    expect(dialog).toContain("I copied it");
    expect(dialog).toContain("copyToClipboard(shown.plaintext");
    // Esc, a click outside and the corner cross all ask first; so does leaving the page.
    expect(dialog).toMatch(/onEscapeKeyDown=\{\(event\) => \{\s*event\.preventDefault\(\);\s*setAsking\(true\);/);
    expect(dialog).toMatch(/onPointerDownOutside=\{\(event\) => \{\s*event\.preventDefault\(\);\s*setAsking\(true\);/);
    // Focus leaving is not a way out: it neither closes nor asks.
    expect(dialog).toContain("onInteractOutside={(event) => event.preventDefault()}");
    expect(dialog).toMatch(/onOpenChange=\{\(open\) => \{\s*if \(!open\) setAsking\(true\);/);
    expect(dialog).toContain('window.addEventListener("beforeunload", warn);');
    expect(dialog).toContain("This key is not shown again. Close without copying it?");
  });

  it("asks before a rotation ends the key in use, and is pending while it runs", () => {
    const actions = integrationsSource.slice(integrationsSource.indexOf("function AccountActions("));
    expect(actions).toMatch(/<DestructiveConfirm\s+icon=\{RotateCw\}\s+label=\{rotating \? "Rotating…" : "Rotate"\}/);
    expect(actions).toContain("The current key stops working at once.");
    expect(actions).toContain("pending={rotating}");
    expect(integrationsSource).not.toMatch(/onClick=\{\(\) => onRotate/);
  });

  it("keeps the Webhook Endpoints card out of the page until delivery exists (F105)", () => {
    expect(integrationsSource).toContain("const WEBHOOKS_AVAILABLE = false;");
    expect(integrationsSource).toContain("{WEBHOOKS_AVAILABLE ? <WebhookEndpointsCard");
    // Not even read while it is hidden.
    expect(integrationsSource).toMatch(/useAdministrationRead<WebhookEndpointInput\[\]>\(webhookEndpointsPath\(\), "Webhook Endpoints", "webhooks", \{\s*enabled: WEBHOOKS_AVAILABLE,/);
  });

  it("reads billing projection and offers Plan or seat decisions, never a card form", () => {
    const trial = billingOf({
      planKey: "trial",
      billingState: "Trialing",
      purchasedSeatCapacity: 3,
      consumedSeatCount: 1,
      trialEndsAt: "2026-09-20T00:00:00.000Z",
      periodEndsAt: null,
      cancelAtPeriodEnd: false,
      stripeCustomerId: null,
    });
    expect(trial.plan).toBe("Trial");
    expect(trial.condition).toBe("Trial");
    expect(trial.seats).toBe("1 of 3 Billable Seats consumed.");
    expect(trial.summary?.writes).toEqual({ allowed: true, label: "You can edit" });
    expect(trial.actions.map((action) => action.id)).toEqual(["checkout"]);
    // Checkout starts from the Members, not the Trial's three seats (F103).
    expect(trial.seatFloor).toBe(1);
    expect(trial.checkout).toBe("redirect");
    expect(pageSource).not.toMatch(/card number|cvc|cardholder/i);
    expect(pageSource).not.toMatch(/password|clerk/i);

    const active = billingOf({
      planKey: "pro",
      billingState: "Active",
      purchasedSeatCapacity: 8,
      consumedSeatCount: 3,
      trialEndsAt: null,
      periodEndsAt: "2026-10-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      stripeCustomerId: "cus_123",
      canCancel: true,
      canKeep: false,
    });
    expect(active.plan).toBe("Pro");
    expect(active.condition).toBe("Active");
    expect(active.seats).toBe("3 of 8 Billable Seats consumed.");
    // #299: a live Subscription moves between Plans from the card.
    expect(active.actions.map((action) => action.id)).toEqual(["plan", "seats", "payment-method", "cancel"]);

    expect(hostedBillingSession({ url: "https://checkout.stripe.com/c/cs_test" })).toEqual({
      kind: "redirect",
      url: "https://checkout.stripe.com/c/cs_test",
    });
  });

  it("keeps payment-method recovery in Read-only and names the Workspace condition on writes", () => {
    const page = billingOf(
      {
        planKey: "pro",
        billingState: "ReadOnly",
        purchasedSeatCapacity: 8,
        consumedSeatCount: 3,
        trialEndsAt: null,
        periodEndsAt: null,
        cancelAtPeriodEnd: true,
        stripeCustomerId: "cus_123",
      },
      "Read-only",
    );
    expect(page.condition).toBe("Read-only");
    expect(page.summary?.writes).toEqual({ allowed: false, label: "Read-only" });
    expect(page.summary?.lead).toContain("Writes are blocked");
    // #299: a lapsed Subscription comes back through Checkout.
    expect(page.actions.map((action) => action.id)).toEqual(["checkout", "payment-method"]);
    expect(composeServiceAccounts({ serviceAccounts: [], condition: "Read-only", showRevoked: false }).createAllowed).toBe(false);
    expect(administrationReadOnlyNote("Harbor Co", "Read-only")).toBe(
      "Harbor Co is read-only. Viewing, export, and recovery stay available.",
    );
    expect(administrationReadOnlyNote("Harbor Co", null)).toBeNull();
    expect(shellSource).toContain('{readOnlyNote ? <p className="df-refusal">{readOnlyNote}</p> : null}');
    expect(composeWebhookEndpoints({ webhookEndpoints: [], condition: "Read-only" }).createAllowed).toBe(false);

    const expiredTrial = billingOf(
      {
        planKey: "trial",
        billingState: "ReadOnly",
        purchasedSeatCapacity: 1,
        consumedSeatCount: 1,
        trialEndsAt: null,
        periodEndsAt: null,
        cancelAtPeriodEnd: false,
        stripeCustomerId: null,
      },
      "Read-only",
    );
    expect(expiredTrial.actions.map((action) => action.id)).toEqual(["checkout"]);
    expect(expiredTrial.checkout).toBe("redirect");
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
    expect(billingKeepPath()).toBe("/api/billing/keep-subscription");
    expect(billingPricesPath()).toBe("/api/billing/prices");

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

function policyDraft(overrides: Partial<ScreenshotPolicy> = {}): ScreenshotPolicy {
  return { ...DEFAULT_SCREENSHOT_POLICY, ...overrides };
}

function editorInput(overrides: Partial<TrackingPolicyInput> = {}): TrackingPolicyInput {
  return {
    workspaceName: "Harbor Co",
    workspaceRole: "Owner",
    ownerName: "Sam Lee",
    condition: null,
    saved: policyDraft(),
    edits: {},
    ...overrides,
  };
}

/** What the save would refuse for these edits over the defaults. */
function issueOf(edits: PolicyEdits, saved: ScreenshotPolicy = policyDraft()): string | null {
  return policyPatch(saved, edits).issue;
}

describe("Administration analytics (#212)", () => {
  it("keeps the workspace settings path, and the analytics module owns the rest", () => {
    expect(workspaceSettingsPath()).toBe("/api/admin/org-settings");
    expect(adminModuleSource).not.toMatch(/composeAnalytics|analyticsRange|analyticsOverviewPath/);
  });

  it("refuses a Member from the analytics control by naming the Workspace Role", () => {
    const refusal = analyticsRefusal({ workspaceRole: "MEMBER", ownerName: "Sam Lee", refused: false });
    // Analytics is its own destination (#281), so the refusal names it.
    expect(refusal).toBe(
      "Analytics is open to the Owner and Administrators. Your Workspace Role is Member. Sam Lee (Owner) can change it.",
    );
    expect(refusal?.toLowerCase()).not.toContain("permission denied");
    expect(refusal?.toLowerCase()).not.toContain("403");
  });

  it("names the refusal when the BFF refuses the read, instead of drawing an empty range", () => {
    expect(analyticsRefusal({ workspaceRole: "Owner", ownerName: "Sam Lee", refused: true })).toBe(
      "Analytics could not be opened for your Membership in this Workspace.",
    );
    expect(analyticsRefusal({ workspaceRole: "Owner", ownerName: "Sam Lee", refused: false })).toBeNull();

    const policy = composeTrackingPolicyEditor(editorInput({ refused: true }));
    expect(policy.kind).toBe("refusal");
  });

  it("says a failed read failed, card by card, rather than reporting an outage as an empty Workspace", () => {
    // F97: each card reads and fails alone, with its own Try again.
    expect(analyticsSource).toContain("<V2LoadFailed");
    expect(analyticsSource).not.toContain("df-refusal");
    expect(analyticsSource).toContain("onRetry={read.retry}");
    // F107: so does every Administration card.
    for (const [name, source] of [
      ["Billing", billingSource],
      ["Tracking Policy", policySource],
      ["Pipeline and lists", pipelineSource],
      ["Integrations", integrationsSource],
      ["Workspace", workspaceSource],
    ]) {
      expect(source, name).toContain("<V2LoadFailed");
      expect(source, name).toContain("useAdministrationRead<");
    }
  });

  it("refuses to edit an unread Tracking Policy so a save cannot overwrite it with defaults", () => {
    const policy = composeTrackingPolicyEditor(editorInput({ saved: null }));
    expect(policy.kind).toBe("unreadable");
    if (policy.kind !== "unreadable") return;
    expect(policy.note.toLowerCase()).toContain("could not be read");
    expect(JSON.stringify(policy)).not.toContain("canSave");
  });

  it("never scores or ranks Members, and says captures, not evidence grades", () => {
    // GLOSSARY.md Activity Evidence: no productivity scores or member rankings.
    expect(pageSource).not.toMatch(/IDLE SHARE|idleShare|score|ranking/i);
    expect(analyticsSource).not.toMatch(/IDLE SHARE|idleShare|score|ranking/i);
    expect(analyticsSource).not.toMatch(/tombstone|duplicate group|evidence grade/i);
  });

  it("does not decorate analytics with animated charts or counting figures", () => {
    expect(pageSource).not.toMatch(/recharts|chart\.js|ResponsiveContainer/i);
    expect(analyticsSource).not.toMatch(/recharts|chart\.js|ResponsiveContainer/i);
    // The charts live in their own file, and none of their marks animates.
    const marks = chartsSource.match(/<Bar\b/g) ?? [];
    expect(marks.length).toBeGreaterThan(0);
    expect(chartsSource.match(/isAnimationActive=\{false\}/g)).toHaveLength(marks.length);
    expect(rule(".df-analytics-figure")).toMatch(/animation:\s*none/);
    expect(rule(".df-analytics-figure")).toMatch(/transition:\s*none/);
  });
});

describe("Low-activity threshold and Workspace time zone (#341)", () => {
  it("keeps the threshold in the normalised policy, defaulting to 10, and refuses what the server refuses", () => {
    expect(normalizeScreenshotPolicy(null).lowActivityThresholdPercent).toBe(10);
    expect(normalizeScreenshotPolicy({ lowActivityThresholdPercent: 25 }).lowActivityThresholdPercent).toBe(25);
    expect(issueOf({ lowActivityThresholdPercent: "0" })).toBeNull();
    expect(issueOf({ lowActivityThresholdPercent: "100" })).toBeNull();
    const refusal = "Low-activity threshold must be a whole number from 0 to 100.";
    expect(issueOf({ lowActivityThresholdPercent: "101" })).toBe(refusal);
    expect(issueOf({ lowActivityThresholdPercent: "-1" })).toBe(refusal);
    expect(issueOf({ lowActivityThresholdPercent: "7.5" })).toBe(refusal);
    expect(trackingPolicyHints(policyDraft({ lowActivityThresholdPercent: 15 })).lowActivity).toContain("below 15 %");
  });

  it("saves a changed threshold only", () => {
    const changed = composeTrackingPolicyEditor(editorInput({ edits: { lowActivityThresholdPercent: "20" } }));
    expect(changed).toMatchObject({ kind: "ready", dirty: true, canSave: true, patch: { lowActivityThresholdPercent: 20 } });
  });

  it("composes the Workspace time zone card", () => {
    const saved = composeWorkspaceTimeZone({ saved: "Europe/Paris", draft: "Europe/Paris", editable: true });
    expect(saved).toMatchObject({ current: "Europe/Paris", dirty: false, canSave: false, issue: null });
    expect(saved.copy).toBe("Workday Daily Update reminders go out at 18:00 in this time zone.");

    const changed = composeWorkspaceTimeZone({ saved: "Europe/Paris", draft: "Asia/Tokyo", editable: true });
    expect(changed).toMatchObject({ dirty: true, canSave: true });
    expect(composeWorkspaceTimeZone({ saved: "Europe/Paris", draft: "Asia/Tokyo", editable: false }).canSave).toBe(false);

    const invalid = composeWorkspaceTimeZone({ saved: "Europe/Paris", draft: "Mars/Olympus", editable: true });
    expect(invalid.canSave).toBe(false);
    expect(invalid.issue).toBe('"Mars/Olympus" is not a time zone DocuFlow knows.');

    expect(composeWorkspaceTimeZone({ saved: null, draft: "", editable: true }).current).toBe("Not set");
  });

  it("chooses the zone from the IANA list alone, the saved one included even when the runtime lists it otherwise", () => {
    expect(workspaceTimeZoneChoices(null)).toContain("Africa/Porto-Novo");
    expect(workspaceTimeZoneChoices("Etc/Unknown-Saved")[0]).toBe("Etc/Unknown-Saved");
    expect(workspaceTimeZoneChoices("Europe/Paris").filter((zone) => zone === "Europe/Paris")).toHaveLength(1);
    // The combobox is the only control: no free-text field, no button beside it.
    const card = workspaceSource.slice(workspaceSource.indexOf("function WorkspaceTimeZoneFact("));
    expect(card).toContain("<TimeZoneList");
    expect(card).toContain('<span id="df-workspace-zone-label">Time zone</span>');
    // The list sits in the dialog itself, not in a popover over it: a popover
    // opened over the dialog's title, and the dialog's scroll lock froze its list.
    const list = workspaceSource.slice(workspaceSource.indexOf("function TimeZoneList("));
    expect(list).toContain('<Command\n      className="df-timezone-list"');
    expect(workspaceSource).not.toContain("<Popover");
    expect(card).not.toContain('placeholder="Europe/Paris"');
    expect(workspaceSource).toContain('data-testid="v2-administration-workspace-timezone-change"');
    expect(workspaceSource).toContain('title="Change time zone"');
    expect(workspaceSource).toContain('testId="v2-administration-workspace-timezone-dialog"');
    expect(workspaceSource).not.toContain("No change to save.");
    expect(workspaceSource).not.toContain("function WorkspaceTimeZoneCard(");
    expect(pageSource).not.toContain("Choose from list");
    expect(pageSource).not.toContain("IANA timezone");
  });
});

describe("Tracking Policy editing (#212, F108)", () => {
  it("mirrors the server bounds before a save is attempted, naming the field", () => {
    expect(issueOf({})).toBeNull();
    expect(issueOf({ captureIntervalMinMin: "1" })).toBe("Minimum interval must be a whole number from 3 to 15.");
    expect(issueOf({ captureIntervalMaxMin: "20" })).toBe("Maximum interval must be a whole number from 3 to 15.");
    expect(issueOf({ captureIntervalMinMin: "10", captureIntervalMaxMin: "5" })).toBe(
      "The minimum interval cannot exceed the maximum.",
    );
    expect(issueOf({ idleTimeoutMinutes: "90" })).toBe("Idle timeout must be a whole number from 1 to 60.");
    expect(issueOf({ idleCountdownSeconds: "5" })).toBe("Prompt countdown must be a whole number from 15 to 120.");
    // An empty field stays empty, and the issue says which one (F108).
    expect(issueOf({ idleTimeoutMinutes: "" })).toBe("Enter the idle timeout.");
    expect(composeTrackingPolicyEditor(editorInput({ edits: { idleTimeoutMinutes: "" } }))).toMatchObject({
      kind: "ready",
      form: { idleTimeoutMinutes: "" },
      canSave: false,
    });
  });

  it("sends only what changed, so a stored value out of bounds blocks nothing else", () => {
    // A policy read back with a value the bounds refuse today (seen on the dev Workspace).
    const stored = policyDraft({ captureIntervalMaxMin: 0, idleTimeoutMinutes: 10 });
    expect(policyPatch(stored, { idleTimeoutMinutes: "12" })).toEqual({ patch: { idleTimeoutMinutes: 12 }, issue: null });
    // The pair is checked on the merged policy as soon as one of it is sent.
    expect(policyPatch(stored, { captureIntervalMinMin: "4" }).issue).toBe("The minimum interval cannot exceed the maximum.");
    expect(policyPatch(stored, { captureIntervalMinMin: "4", captureIntervalMaxMin: "9" })).toEqual({
      patch: { captureIntervalMinMin: 4, captureIntervalMaxMin: 9 },
      issue: null,
    });
    // Typed back to what was read, an edit is no edit.
    expect(pruneEdits(stored, { idleTimeoutMinutes: "10", screenshotsEnabled: stored.screenshotsEnabled })).toEqual({});
    expect(policySource).toContain("save.mutate(policy.patch)");
    expect(policySource).toContain('apiRequest("PATCH", workspaceSettingsPath(), { screenshotPolicy: patch })');
  });

  it("holds each number as the text typed, so clearing a field never types 0", () => {
    const ready = composeTrackingPolicyEditor(editorInput({ edits: { captureIntervalMinMin: "" } }));
    expect(ready.kind === "ready" && ready.form.captureIntervalMinMin).toBe("");
    const typing = composeTrackingPolicyEditor(editorInput({ edits: { captureIntervalMinMin: "4" } }));
    expect(typing.kind === "ready" && typing.form.captureIntervalMinMin).toBe("4");
    expect(policySource).toContain('inputMode="numeric"');
    expect(policySource).toContain("onChange={(event) => edit({ [key]: event.target.value })}");
    expect(policySource).not.toContain("policyNumber(");
  });

  it("keeps unsaved edits through another card's save, a refetch and a tab switch, and warns on leaving", () => {
    // The page holds the drafts; a tab's panel unmounts when another opens.
    expect(shellSource).toContain("const [policyEdits, setPolicyEdits] = useState<PolicyEdits>({});");
    expect(shellSource).toContain("edits={policyEdits} onEdits={setPolicyEdits}");
    expect(shellSource).toContain('window.addEventListener("beforeunload", warn);');
    // A switch of Workspace drops them.
    expect(shellSource).toMatch(/editedFor\.current = activeWorkspaceId;\s*setPolicyEdits\(\{\}\);\s*setZoneDraft\(null\);\s*setNameDraft\(null\);/);
    // No read resets the draft any more.
    expect(pageSource).not.toMatch(/useEffect\(\(\) => \{\s*if \(!workspaceSettings\) return;\s*setPolicyDraft/);
    expect(policySource).not.toContain("setPolicyDraft");
  });

  it("refuses active hours that are not HH:mm and accepts an overnight window (#293)", () => {
    expect(issueOf({ activeHoursStart: "22:00", activeHoursEnd: "06:00" })).toBeNull();
    for (const bad of ["", "8:00", "24:00", "07:60"]) {
      expect(issueOf({ activeHoursEnd: bad })).toBe("Active hours must be 24-hour times such as 08:00.");
    }
    // The form refuses before the PATCH, so a cleared time input never reaches the server.
    const cleared = composeTrackingPolicyEditor(editorInput({ edits: { activeHoursEnabled: true, activeHoursStart: "" } }));
    expect(cleared.kind).toBe("ready");
    if (cleared.kind !== "ready") return;
    expect(cleared.canSave).toBe(false);
  });

  it("names the Device clock for active hours and keeps idle pause apart from the prompt (#293)", () => {
    const day = trackingPolicyHints(policyDraft());
    expect(day.activeHours).toBe("Uses each Member's computer clock, not a Workspace time zone.");
    expect(day.idleTimeout).toBe(
      "After 10 min without keyboard or mouse input, the Timer pauses and the idle time is not counted.",
    );
    expect(day.prompt).toBe("The Member is asked first and has 60 s to answer before the Timer pauses.");
    expect(day.countdown).toBe("Shown on the idle prompt. When it reaches zero with no answer, the Timer pauses.");

    const night = trackingPolicyHints(
      policyDraft({ activeHoursStart: "22:00", activeHoursEnd: "06:00", idlePromptEnabled: false }),
    );
    // No en dash in what the app shows (F110).
    expect(night.activeHours).toBe(
      "Uses each Member's computer clock, not a Workspace time zone. From 22:00 to 06:00 runs overnight, into the next morning.",
    );
    expect(night.prompt).toBe("The Timer pauses at the timeout without asking. The Member resumes it.");

    const page = composeTrackingPolicyEditor(editorInput());
    expect(page.kind).toBe("ready");
    if (page.kind !== "ready") return;
    expect(page.hints).toEqual(day);

    // The idle timeout stays editable with the prompt off; only the countdown hides.
    const promptBlock = policySource.slice(policySource.indexOf('id="df-policy-idle"'), policySource.indexOf("Save Tracking Policy"));
    expect(promptBlock).toContain("Prompt countdown (seconds)");
    expect(promptBlock).not.toContain('"Idle timeout"');
    expect(policySource).not.toContain("Auto-stop countdown");
    expect(policySource).toContain("policy.hints.activeHours");
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
    expect(readOnly.writeRefusal).toBe("Harbor Co is read-only. Viewing, export, and recovery stay available.");
    expect(readOnly.canSave).toBe(false);
  });

  it("only offers a save once the draft differs and stays valid", () => {
    const clean = composeTrackingPolicyEditor(editorInput());
    expect(clean.kind).toBe("ready");
    if (clean.kind !== "ready") return;
    expect(clean.dirty).toBe(false);
    expect(clean.canSave).toBe(false);
    expect(clean.issue).toBeNull();

    const dirty = composeTrackingPolicyEditor(editorInput({ edits: { captureIntervalMaxMin: "9" } }));
    expect(dirty).toMatchObject({ kind: "ready", dirty: true, canSave: true, patch: { captureIntervalMaxMin: 9 } });

    const invalid = composeTrackingPolicyEditor(editorInput({ edits: { idleTimeoutMinutes: "0" } }));
    expect(invalid.kind).toBe("ready");
    if (invalid.kind !== "ready") return;
    expect(invalid.dirty).toBe(true);
    expect(invalid.canSave).toBe(false);
    expect(invalid.issue).toBe("Idle timeout must be a whole number from 1 to 60.");
  });

  it("signs off a saved policy in a toast without celebrating it, in plain words", () => {
    // The desktop agent's heartbeat carries the policy every 60 s (HeartbeatWorker).
    expect(TRACKING_POLICY_SAVED).toBe("Policy saved. Devices apply it within a minute.");
    expect(TRACKING_POLICY_SAVED.toLowerCase()).not.toMatch(/congratulations|nice work|🎉|heartbeat/);
    const page = composeTrackingPolicyEditor(editorInput());
    expect(page.kind === "ready" && page.footnote).toBe("Activity shows this policy to every Member. Devices apply it within a minute.");
    expect(policySource).toContain("notify.success(TRACKING_POLICY_SAVED)");
    expect(pageSource).not.toContain("df-policy-saved");
  });

  it("leaves the Screencasts timezone list to v1, which alone reads it (F110)", () => {
    expect(pageSource).not.toContain("Screencasts timezones");
    expect(pageSource).not.toContain("allowedTimezones");
    expect(adminModuleSource).not.toMatch(/addAllowedTimezone|removeAllowedTimezone/);
    const page = composeTrackingPolicyEditor(editorInput());
    expect(page).not.toHaveProperty("timezones");
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

  it("draws a visible tick on every checked v2 checkbox, in light and dark", () => {
    // `.df-v2 button:not(.df-btn) { color: inherit }` (0,4,1 since Clerk's
    // controls and the view switcher are left out, #316) outranks
    // `.df-v2 .df-checkbox` (0,2,0), so a colour on the button itself loses and
    // the tick took the ink of the checked fill. It must sit on the indicator span.
    expect(
      rule('.df-v2 button:not(.df-btn):not(.df-segment-item):not([class*="cl-"]):not(:where(.df-tab, .df-chart-toggle)),\n.df-v2 input:not([class*="cl-"])'),
    ).toMatch(/color:\s*inherit/);
    expect(rule(".df-v2 .df-checkbox > span")).toMatch(/color:\s*var\(--df-on-ink\)/);
    expect(rule(".df-v2 .df-checkbox svg")).not.toMatch(/(^|[^-])color:/);

    // On-ink contrasts with the Case Ink fill in both palettes.
    const token = (block: string, name: string) =>
      css.match(new RegExp(`${block.replace(/[.]/g, "\\.")}\\s*\\{[^}]*?--df-${name}:\\s*([^;]+);`))?.[1].trim();
    for (const block of [".df-v2", ".dark .df-v2"]) {
      const fill = token(block, "case-ink");
      const tick = token(block, "on-ink");
      expect(fill, `${block} --df-case-ink`).toBeTruthy();
      expect(tick, `${block} --df-on-ink`).toBeTruthy();
      expect(tick).not.toBe(fill);
    }

    // Every v2 shadcn Checkbox wears the class the rule targets.
    for (const file of ["V2AdministrationParts.tsx", "V2Clients.tsx", "V2People.tsx"]) {
      const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2", file), "utf8");
      const boxes = source.match(/<Checkbox\b[\s\S]*?\/>/g) ?? [];
      expect(boxes.length, file).toBeGreaterThan(0);
      for (const box of boxes) expect(box, file).toContain('className="df-checkbox"');
    }
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
    expect(shellSource).toContain('<SkeletonSection title="Workspace"');
    // Each card waits with its own title (F107); the shell draws the head and the tabs at once.
    expect(billingSource).toContain('<SkeletonSection title="Billing"');
    expect(policySource).toContain('<SkeletonSection title="Tracking Policy"');
    expect(integrationsSource).toContain('<SkeletonSection title="Service Accounts"');
    expect(shellSource).toMatch(/if \(!memberships\) return <AdministrationSkeleton \/>;/);
    // Analytics draws the head at once and gives each card its own skeleton lines.
    expect(analyticsSource).toContain('from "./V2Skeleton"');
    expect(analyticsSource).toContain("<FigureSkeleton");
    expect(analyticsSource).toContain("<SkeletonRows");
    // The wait reuses the real bands and rows, so nothing moves on arrival.
    // The band, or the console's strip variant of it (#318).
    expect(skeletonSource).toMatch(/"df-figure-band( df-stat-strip)?"/);
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

    expect(rule(".df-policy-form input")).toMatch(/animation:\s*none/);
  });
});

describe("The Billing card reads as one card (#245, F1)", () => {
  function activeBilling(overrides: Partial<BillingInput> = {}) {
    return billingOf({
      planKey: "pro",
      billingState: "Active",
      purchasedSeatCapacity: 8,
      consumedSeatCount: 3,
      trialEndsAt: null,
      periodEndsAt: "2026-10-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      stripeCustomerId: "cus_123",
      canCancel: true,
      canKeep: false,
      ...overrides,
    });
  }

  it("sets Cancel at period end apart from the routine actions and states what it costs", () => {
    const page = activeBilling();
    const cancel = page.actions.find((action) => action.id === "cancel");
    const paymentMethod = page.actions.find((action) => action.id === "payment-method");
    expect(cancel).toBeDefined();
    expect(paymentMethod).toBeDefined();
    if (!cancel || !paymentMethod) return;

    // The reflex that reaches Update payment method must not reach this one.
    expect(cancel.tone).toBe("destructive");
    expect(paymentMethod.tone).toBe("neutral");

    // And it says what it ends, and when, before it runs.
    expect(cancel.consequence).toBe(
      "Pro entitlements stay until 1 Oct 2026. On that day writes stop and " +
        "the Workspace becomes read-only. Viewing, export, and recovery stay available.",
    );
    expect(paymentMethod.consequence).toBeNull();
  });

  it("still names the day when the subscription has no period end to name", () => {
    const cancel = activeBilling({ periodEndsAt: null }).actions.find((action) => action.id === "cancel");
    expect(cancel?.consequence).toBe(
      "Writes stop at the end of the current period and the Workspace becomes " +
        "read-only. Viewing, export, and recovery stay available.",
    );
  });

  it("offers Cancel only on a live Subscription, Past due included, and the undo while it is cancelling (F102)", () => {
    expect(activeBilling({ billingState: "PastDue" }).actions.map((action) => action.id)).toContain("cancel");
    // No live Subscription behind the Plan: nothing to cancel.
    expect(activeBilling({ canCancel: false }).actions.map((action) => action.id)).not.toContain("cancel");
    const cancelling = activeBilling({ cancelAtPeriodEnd: true, canCancel: false, canKeep: true });
    expect(cancelling.actions.map((action) => action.id)).toEqual(["plan", "seats", "payment-method", "keep"]);
    expect(cancelling.actions.find((action) => action.id === "keep")).toEqual({
      id: "keep",
      label: "Keep the Subscription",
      tone: "neutral",
      consequence: "Access ends 1 Oct 2026",
    });
    expect(billingSource).toContain('apiRequest("POST", billingKeepPath(), {})');
    expect(billingSource).toContain('data-testid="v2-administration-billing-keep"');
  });

  it("gives the seat control the figure it edits, its floor beside it, and asks before any change (F104)", () => {
    const page = activeBilling();
    // The field starts from what the Workspace already bought, so it never
    // contradicts the figure above it.
    expect(page.seatQuantityDefault).toBe("8");
    expect(page.seatFloor).toBe(3);
    expect(seatFloorNote(3)).toBe("At least 3: one per Member");
    expect(seatQuantityIssue("2", 3)).toBe("Choose at least 3 seats: one per Member.");
    expect(seatQuantityIssue("", 3)).toBe("Enter a number of seats.");
    expect(seatQuantityIssue("4.5", 3)).toBe("Enter a whole number of seats.");
    expect(seatQuantityIssue("5", 3)).toBeNull();

    expect(seatChangeConfirmation({
      from: 3,
      to: 5,
      periodEndsAt: "2027-01-01T00:00:00.000Z",
      unitAmountMinor: 1200,
      currency: "eur",
      interval: "monthly",
    })).toEqual({
      title: "From 3 to 5 seats",
      consequence:
        "The 2 new seats are charged now, in proportion to the time left until 1 Jan 2027. Then the Subscription costs EUR 60 per month, before tax.",
      confirmLabel: "Add 2 seats",
    });
    expect(seatChangeConfirmation({ from: 5, to: 3, periodEndsAt: "2027-01-01T00:00:00.000Z" })).toEqual({
      title: "From 5 to 3 seats",
      consequence: "The change applies on 1 Jan 2027. Until then the Workspace keeps 5 seats.",
      confirmLabel: "Change to 3 seats",
    });
    // The confirmation is the shared one; nothing is sent on the first click.
    expect(billingSource).toMatch(/<DestructiveConfirm\s+tone="neutral"\s+label=\{changeSeats\.isPending \? "Changing…" : "Change seats"\}/);
    expect(billingSource).not.toMatch(/<form[^>]*onSubmit=\{\(event\) => \{\s*event\.preventDefault\(\);\s*if \(!guardWrite/);
  });

  it("shows a planned decrease with the button that keeps today's seats", () => {
    const planned = activeBilling({ purchasedSeatCapacity: 5, pendingSeatQuantity: 3, periodEndsAt: "2027-01-01T00:00:00.000Z" });
    expect(planned.pendingSeats).toEqual({ label: "3 seats from 1 Jan 2027", keepLabel: "Keep 5 seats", quantity: 5 });
    expect(activeBilling({ pendingSeatQuantity: null }).pendingSeats).toBeNull();
    expect(billingSource).toContain("changeSeats.mutate(billing.pendingSeats!.quantity)");
    // The answer is the subscription itself: it replaces the cached one.
    expect(billingSource).toContain("queryClient.setQueryData([billingSubscriptionPath()], next);");
  });

  it("never lets one press end the subscription", () => {
    // Opening the dialog is not the press that mutates.
    const row = billingSource.slice(billingSource.indexOf('data-testid="v2-administration-billing-cancel-row"'));
    expect(row).toContain('keepLabel="Keep subscription"');
    expect(row).toContain('testId="v2-administration-billing-cancel"');
    expect(v2("V2DestructiveConfirm.tsx")).toContain("data-testid={`${testId}-confirm`}");
    expect(v2("V2DestructiveConfirm.tsx")).toContain('from "@/components/ui/alert-dialog"');
    expect(billingSource).not.toMatch(/onClick=\{\(\) => cancelAtPeriodEnd\.mutate\(\)\}/);

    // The write gate still runs on the press that actually cancels.
    const confirmBody = row.slice(row.indexOf("onConfirm={"));
    expect(confirmBody.slice(0, 160)).toContain("if (!writes.guard()) return;");
    expect(confirmBody.slice(0, 160)).toContain("cancelAtPeriodEnd.mutate()");
  });

  it("summarises the subscription: Plan, seats meter, writes and term", () => {
    expect(activeBilling().summary).toEqual({
      plan: "Pro",
      lead: "Billed for each Billable Seat.",
      seats: { label: "3 of 8", percent: 38, over: false },
      writes: { allowed: true, label: "You can edit" },
      term: { label: "Renews", value: "1 Oct 2026" },
    });
  });

  it("makes the read-only sentence the lead", () => {
    const page = activeBilling({ billingState: "ReadOnly" });
    expect(page.summary?.writes).toEqual({ allowed: false, label: "Read-only" });
    expect(page.summary?.lead).toBe("Writes are blocked. Viewing, export, and recovery stay available.");
  });

  it("clamps the seats meter and flags an overrun", () => {
    expect(activeBilling({ consumedSeatCount: 12 }).summary?.seats).toEqual({ label: "12 of 8", percent: 100, over: true });
    expect(activeBilling({ consumedSeatCount: 8 }).summary?.seats).toEqual({ label: "8 of 8", percent: 100, over: false });
    expect(activeBilling({ purchasedSeatCapacity: 0, consumedSeatCount: 0 }).summary?.seats.percent).toBe(0);
  });

  it("words the lead for each state, first match winning", () => {
    const lead = (overrides: Partial<BillingInput>) => activeBilling(overrides).summary?.lead;
    expect(lead({ billingState: "PastDue" })).toBe("The last payment failed. Update the payment method to keep this Plan.");
    expect(lead({ cancelAtPeriodEnd: true, periodEndsAt: "2026-10-01T00:00:00.000Z" })).toBe("Cancelled. Pro stays until 1 Oct 2026.");
    expect(lead({ planKey: "trial", billingState: "Trialing" })).toBe("Every Business feature, free, until the Trial ends.");
    expect(lead({ planKey: "pro", billingState: "Trialing" })).toBe("Offered by DocuFlow. Nothing is charged until it ends.");
    expect(lead({ planKey: "legacy" })).toBe("Kept from before self-service billing. Nothing renews.");
    expect(lead({ planKey: "enterprise" })).toBe("Agreed with sales.");
    expect(lead({ planKey: "pro" })).toBe("Billed for each Billable Seat.");
    expect(lead({ planKey: "mystery" as BillingInput["planKey"] })).toBeNull();
  });
});

describe("Administration billing remainder (#212)", () => {
  it("keeps a seeded or legacy Workspace out of Checkout, and offers it no Cancel (F102)", () => {
    const legacy = billingOf({
      planKey: "legacy",
      billingState: "Active",
      purchasedSeatCapacity: 25,
      consumedSeatCount: 4,
      trialEndsAt: null,
      periodEndsAt: null,
      cancelAtPeriodEnd: false,
      stripeCustomerId: null,
      canCancel: false,
      canKeep: false,
    });
    expect(legacy.plan).toBe("Legacy");
    expect(legacy.actions.map((action) => action.id)).toEqual([]);
    // Nothing renews, so no term row says "Renews -".
    expect(legacy.summary?.term).toEqual({ label: "Subscription", value: "Nothing renews" });
  });

  it("reads the subscription as discrete facts, including the term the BFF already returns", () => {
    const trial = billingOf({
      planKey: "trial",
      billingState: "Trialing",
      purchasedSeatCapacity: 1,
      consumedSeatCount: 1,
      trialEndsAt: "2026-09-20T00:00:00.000Z",
      periodEndsAt: null,
      cancelAtPeriodEnd: false,
      stripeCustomerId: null,
    });
    expect(trial.summary).toEqual({
      plan: "Trial",
      lead: "Every Business feature, free, until the Trial ends.",
      seats: { label: "1 of 1", percent: 100, over: false },
      writes: { allowed: true, label: "You can edit" },
      term: { label: "Trial ends", value: "20 Sep 2026" },
    });

    const base = {
      planKey: "pro",
      billingState: "Active",
      purchasedSeatCapacity: 8,
      consumedSeatCount: 3,
      trialEndsAt: null,
      periodEndsAt: "2026-10-01T00:00:00.000Z",
      stripeCustomerId: "cus_123",
    };
    expect(billingOf({ ...base, cancelAtPeriodEnd: true }).summary?.term).toEqual({ label: "Access ends", value: "1 Oct 2026" });
    expect(billingOf({ ...base, cancelAtPeriodEnd: false }).summary?.term).toEqual({ label: "Renews", value: "1 Oct 2026" });

    const none = billingOf(null);
    expect(none.available).toBe(false);
    expect(none.summary).toBeNull();
  });

  it("names the refusal when Checkout is refused for a seeded Workspace", () => {
    expect(
      administrationWriteRefusal({
        kind: "error",
        workspaceName: "Harbor Co",
        ownerName: "Sam Lee",
        errorMessage: "Checkout is not available for this Workspace",
      } as Parameters<typeof administrationWriteRefusal>[0]),
    ).toBe("Checkout is not available for this Workspace");
  });
});

describe("A Read-only Workspace recovers through Checkout (#299)", () => {
  const ended = billingOf(
    {
      planKey: "pro",
      billingState: "ReadOnly",
      purchasedSeatCapacity: 3,
      consumedSeatCount: 2,
      trialEndsAt: null,
      periodEndsAt: "2026-10-18T09:51:36.000Z",
      cancelAtPeriodEnd: false,
      stripeCustomerId: "cus_cad",
    },
    "Read-only",
  );

  it("offers Checkout and says the Subscription ended instead of a renewal date", () => {
    expect(ended.actions.map((action) => action.id)).toEqual(["checkout", "payment-method"]);
    expect(ended.summary?.term).toEqual({ label: "Subscription", value: "Ended" });
  });

  it("does not let the Read-only guard stop Checkout", () => {
    const checkout = billingSource.slice(billingSource.indexOf("onCheckout={"), billingSource.indexOf("onChange={() =>"));
    expect(checkout).toContain("startCheckout.mutate()");
    expect(checkout).not.toContain("guard");
  });

  it("names the current Plan apart from the card that is only selected", () => {
    expect(planPickerNote("checkout", "Pro")).toBe(
      "Current Plan: Pro. Select a Plan, then continue to Checkout. The Workspace changes Plan once Checkout completes.",
    );
    expect(planPickerNote("change", "Growth")).toMatch(/^Current Plan: Growth\. .*until you confirm\.$/);
    expect(billingSource).toContain('"Selected"');
    expect(billingSource).not.toContain('"Chosen"');
    expect(billingSource).toContain('<span className="df-status-word" data-tone="active">Current Plan</span>');
    expect(billingSource).not.toContain("CURRENT PLAN");
  });
});

describe("Checkout asks for the seats and shows the price (F103)", () => {
  const price = { planKey: "growth", interval: "monthly", unitAmountMinor: 1200, currency: "eur" };

  it("prices a seat per interval, and the total before tax", () => {
    expect(seatPriceLine(price)).toBe("EUR 12 per seat, per month");
    expect(seatPriceLine({ ...price, interval: "annual", unitAmountMinor: 12950 })).toBe("EUR 129.50 per seat, per year");
    expect(checkoutTotalLine(price, 3)).toBe("3 seats x EUR 12 = EUR 36 per month, before tax");
    // A currency without minor units is not divided by 100.
    expect(formatMoney(1500, "jpy")).toBe("JPY 1,500");
  });

  it("starts the seats from the Members, never from the Trial's three, and sends the number chosen", () => {
    expect(billingSource).toContain("const checkoutSeatText = checkoutSeats ?? String(billing.seatFloor);");
    expect(billingSource).toContain("seatQuantity: Number(checkoutSeatText),");
    expect(billingSource).not.toContain("billing?.purchasedSeatCapacity ?? 1");
    expect(billingSource).toContain('{pending ? "Opening Checkout…" : "Continue to Checkout"}');
    // No price shown is better than a wrong one: the line waits for Stripe's.
    expect(billingSource).toContain("{chosenPrice && seatIssue === null ? (");
  });
});
