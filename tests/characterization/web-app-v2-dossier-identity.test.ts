import { describe, expect, it } from "vitest";
import { composeDossier, type DossierInput } from "../../client/src/v2/dossier";

/**
 * F39: a Client Project can change its Client and type from Settings; an Internal
 * Project stays Internal. Internal is read from the type alone.
 */

const CLIENTS = [
  { id: "c2", name: "Zed Ltd" },
  { id: "c1", name: "Acme" },
];

function input(project: Partial<NonNullable<DossierInput["project"]>>): DossierInput {
  return {
    now: new Date(2026, 8, 8, 12, 41, 0),
    currentUserId: "user-1",
    tab: "settings",
    project: {
      id: "prj-1",
      projectStatus: "active",
      projectType: "one_time",
      budgetedHours: null,
      trackedSeconds: null,
      project: { id: "p", name: "Ledger" },
      client: { id: "c1", name: "Acme" },
      ...project,
    },
    tasks: [],
    documents: [],
    dailyUpdate: null,
    dailyUpdateCapabilityMiss: false,
    ownerName: "Sam Lee",
    monthSeconds: 0,
    screenshots: [],
    users: [],
    trackingTaskId: null,
    clientActiveProjectCount: 0,
    timeEntries: [],
    dailyUpdates: [],
    files: [],
    reminders: [],
    notes: [],
    stageHistory: [],
    tags: [],
    workspaceTags: [],
    clients: CLIENTS,
  };
}

const TYPES = [
  { value: "one_time", label: "One-time" },
  { value: "monthly", label: "Monthly" },
  { value: "hourly_budget", label: "Hourly" },
];

describe("Dossier Settings identity (F39)", () => {
  it("a one_time Project with no Client is a Client Project that can get a Client", () => {
    const dossier = composeDossier(input({ client: null }));
    expect(dossier.identity?.kindLabel).toBe("CLIENT PROJECT");
    expect(dossier.settings.identity).toEqual([
      {
        label: "Client",
        value: "",
        picker: {
          field: "clientId",
          value: "",
          placeholder: "Choose a Client",
          options: [
            { value: "c1", label: "Acme" },
            { value: "c2", label: "Zed Ltd" },
          ],
        },
      },
      { label: "Type", value: "One-time", picker: { field: "projectType", value: "one_time", options: TYPES } },
    ]);
  });

  it("a Client Project with a Client presets the picker to it, with no 'No Client' choice", () => {
    const dossier = composeDossier(input({ projectType: "monthly" }));
    const client = dossier.settings.identity[0].picker;
    expect(client?.value).toBe("c1");
    expect(client?.options.map((o) => o.label)).toEqual(["Acme", "Zed Ltd"]);
    expect(dossier.settings.identity[1].picker?.value).toBe("monthly");
    expect(dossier.settings.identity[1].picker?.options.map((o) => o.value)).not.toContain("internal");
  });

  it("an internal Project reads INTERNAL with no pickers", () => {
    const dossier = composeDossier(input({ projectType: "internal", client: null }));
    expect(dossier.identity?.kindLabel).toBe("INTERNAL");
    expect(dossier.settings.identity).toEqual([
      { label: "Client", value: "None - Internal Project" },
      { label: "Kind", value: "INTERNAL", chip: true },
    ]);
  });

  it("reads the kind from the type alone", () => {
    expect(composeDossier(input({ projectType: "monthly", client: null })).identity?.kindLabel).toBe("MONTHLY");
    expect(composeDossier(input({ projectType: "hourly_budget" })).identity?.kindLabel).toBe("HOURLY");
    expect(composeDossier(input({ projectType: "internal" })).identity?.kindLabel).toBe("INTERNAL");
  });
});
