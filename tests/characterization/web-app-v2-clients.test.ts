import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import {
  clientWriteRefusal,
  composeClientRecord,
  composeClientRegister,
  type ClientRegisterInput,
} from "../../client/src/v2/clients";

/**
 * Clients live register and Client record (#186).
 * Seams: matchV2Route (flagged app chrome) and compose helpers over existing `/api/*`.
 * Do not assert hex values or the prototype DOM. No new BFF routes.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

function emptyRegister(overrides: Partial<ClientRegisterInput> = {}): ClientRegisterInput {
  return {
    workspaceName: "Harbor Co",
    clients: [],
    filterQuery: "",
    selectedId: null,
    ...overrides,
  };
}

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2AuthenticatedApp.tsx"),
  "utf8",
);

describe("Clients routing (#186)", () => {
  it("shows a live register on the rail Clients destination", () => {
    const match = matchV2Route("/clients");
    expect(match.kind).toBe("clients");
    expect(navIdForPath("/clients")).toBe("clients");
    expect(breadcrumbFor("/clients", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "CLIENTS",
    ]);
    expect(appSource).toContain("V2ClientsPage");
    expect(appSource).toMatch(/path="\/clients"/);
    expect(appSource).not.toContain("ClientDetailPage");
  });

  it("rewrites v1 /crm/client URLs into this destination or the matching Client record", () => {
    expect(matchV2Route("/crm/client/new")).toMatchObject({ kind: "clients", href: "/clients" });
    expect(matchV2Route("/crm/client/cli-1")).toMatchObject({
      kind: "client-record",
      clientId: "cli-1",
      href: "/clients",
    });
    expect(matchV2Route("/clients/cli-1")).toMatchObject({
      kind: "client-record",
      clientId: "cli-1",
      href: "/clients",
    });
    expect(navIdForPath("/clients/cli-1")).toBe("clients");
    expect(breadcrumbFor("/clients/cli-1", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "CLIENTS",
      "RECORD",
    ]);
    expect(appSource).toContain("V2ClientRecordPage");
    expect(appSource).toMatch(/path="\/clients\/:id"/);
    expect(appSource).toMatch(/path="\/crm\/client\/:id"/);
  });
});

describe("Clients register from live Client rows (#186)", () => {
  it("empty Workspace uses empty geometry and never shows sample names", () => {
    const register = composeClientRegister(emptyRegister());
    const blob = JSON.stringify(register);

    expect(register.empty).toBe(true);
    expect(register.rows).toEqual([]);
    expect(register.emptyCopy.toLowerCase()).toContain("client");
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("fills the register from Client reads and opens a row on the Client record", () => {
    const register = composeClientRegister(
      emptyRegister({
        clients: [
          {
            id: "cli-live",
            name: "Harbour Shipping",
            company: "Harbour Shipping Ltd",
            status: "client",
            source: "direct",
            projectCount: 2,
          },
        ],
        selectedId: "cli-live",
      }),
    );

    expect(register.empty).toBe(false);
    expect(register.rows).toHaveLength(1);
    expect(register.rows[0]).toMatchObject({
      id: "cli-live",
      name: "Harbour Shipping",
      company: "Harbour Shipping Ltd",
      status: "CLIENT",
      source: "DIRECT",
      projectCount: 2,
      selected: true,
      href: "/clients/cli-live",
    });
    expect(matchV2Route(register.rows[0].href).kind).toBe("client-record");
    expect(JSON.stringify(register)).not.toContain("Keystone");
  });

  it("filters by name without inventing rows", () => {
    const register = composeClientRegister(
      emptyRegister({
        filterQuery: "pier",
        clients: [
          {
            id: "cli-1",
            name: "Pier Surveyors",
            company: null,
            status: "lead",
            source: null,
            projectCount: 0,
          },
          {
            id: "cli-2",
            name: "Harbour Shipping",
            company: "Harbour Shipping Ltd",
            status: "client",
            source: "direct",
            projectCount: 1,
          },
        ],
      }),
    );

    expect(register.rows.map((row) => row.id)).toEqual(["cli-1"]);
    expect(register.empty).toBe(false);
    expect(register.emptyCopy).toBe("");
  });
});

describe("Client record from live Client reads (#186)", () => {
  it("composes a dossier-style identity from the Client, not a v1 page", () => {
    const record = composeClientRecord({
      client: {
        id: "cli-live",
        name: "Harbour Shipping",
        company: "Harbour Shipping Ltd",
        email: "ops@harbour.test",
        status: "client",
        source: "direct",
        notes: "Pier contract.",
        contacts: [
          { id: "ct-1", name: "Sam Lee", role: "Ops" },
          { id: "ct-2", name: "Pat Ng", role: null },
        ],
      },
      projects: [
        { id: "prj-live", name: "Harbour rebuild", projectStatus: "active" },
        { id: "prj-other", name: "Other dock", projectStatus: "planned" },
      ],
    });

    expect(record.missing).toBe(false);
    expect(record.identity).toMatchObject({
      title: "Harbour Shipping",
      kindLabel: "CLIENT",
      status: "CLIENT",
      company: "Harbour Shipping Ltd",
      email: "ops@harbour.test",
      source: "DIRECT",
    });
    expect(record.contacts.map((row) => row.name)).toEqual(["Sam Lee", "Pat Ng"]);
    expect(record.projects).toEqual([
      { id: "prj-live", name: "Harbour rebuild", status: "ACTIVE", href: "/projects/prj-live" },
      { id: "prj-other", name: "Other dock", status: "PLANNED", href: "/projects/prj-other" },
    ]);
    expect(record.notes).toBe("Pier contract.");
    expect(JSON.stringify(record)).not.toContain("Keystone");
    expect(JSON.stringify(record)).not.toContain("v1");
  });

  it("empty and missing records are honest", () => {
    const missing = composeClientRecord({ client: null, projects: [] });
    expect(missing.missing).toBe(true);
    expect(missing.unavailable).toBe(false);
    expect(missing.identity).toBeNull();
    expect(missing.emptyCopy.toLowerCase()).toContain("client");
    expect(JSON.stringify(missing)).not.toContain("Keystone");

    const empty = composeClientRecord({
      client: {
        id: "cli-empty",
        name: "Harbour Shipping",
        company: null,
        email: null,
        status: "lead",
        source: null,
        notes: null,
        contacts: [],
      },
      projects: [],
    });
    expect(empty.missing).toBe(false);
    expect(empty.unavailable).toBe(false);
    expect(empty.contactsEmptyCopy.toLowerCase()).not.toContain("contact");
    expect(empty.contactsEmptyCopy.toLowerCase()).toContain("client");
    expect(empty.projectsEmptyCopy.toLowerCase()).toContain("project");
  });

  it("keeps register identity while the record body is still loading", () => {
    const pending = composeClientRecord({
      client: null,
      pending: true,
      seed: {
        name: "Harbour Shipping",
        company: "Harbour Shipping Ltd",
        status: "client",
        source: "direct",
        email: null,
      },
      projects: [],
    });

    expect(pending.missing).toBe(false);
    expect(pending.unavailable).toBe(false);
    expect(pending.identity).toMatchObject({
      title: "Harbour Shipping",
      kindLabel: "CLIENT",
      status: "CLIENT",
      company: "Harbour Shipping Ltd",
    });
    expect(pending.contacts).toEqual([]);
    expect(pending.notes).toBeNull();
  });

  it("treats a failed Client read as a load failure, not a missing Client", () => {
    const failed = composeClientRecord({
      client: null,
      loadFailed: true,
      seed: {
        name: "Harbour Shipping",
        company: "Harbour Shipping Ltd",
        status: "client",
        source: "direct",
      },
      projects: [],
    });

    expect(failed.missing).toBe(false);
    expect(failed.unavailable).toBe(true);
    expect(failed.emptyCopy.toLowerCase()).toContain("could not be loaded");
    expect(failed.emptyCopy.toLowerCase()).not.toContain("not in this workspace");
    expect(failed.identity?.title).toBe("Harbour Shipping");
  });
});

describe("Client write refusals (#186)", () => {
  it("names the Workspace condition or Create Clients Capability, never a generic permission denied", () => {
    expect(
      clientWriteRefusal({
        readOnly: true,
        workspaceName: "Harbor Co",
      }),
    ).toBe("Harbor Co is read-only. Viewing, export, and recovery stay available.");

    expect(
      clientWriteRefusal({
        readOnly: false,
        workspaceName: "Harbor Co",
        errorMessage: "permission denied",
        ownerName: "Sam Lee",
      }),
    ).toBe("You do not have the Create Clients Capability. Sam Lee (Owner) can grant it.");

    expect(
      clientWriteRefusal({
        readOnly: false,
        workspaceName: "Harbor Co",
        errorMessage: "Workspace is read-only",
      }).toLowerCase(),
    ).toContain("read-only");

    expect(
      clientWriteRefusal({
        readOnly: false,
        workspaceName: "Harbor Co",
        errorMessage: "permission denied",
      }).toLowerCase(),
    ).not.toContain("permission denied");
  });
});

describe("Clients register → record motion (#186)", () => {
  it("settles identity and fades the record body; reduced-motion is opacity only", () => {
    const motion = motionForSurface("client-register-record");
    expect(motion.enterExit).toBe("standard");
    expect(motion.keepOpacity).toBe(true);

    const reduced = motionForSurface("client-register-record", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);
    expect(reduced.enterExit).toBe("standard");

    expect(rule(".df-client-identity")).toMatch(/transition:\s*none/);
    expect(rule(".df-client-record-body[data-motion=\"standard\"]")).toMatch(/opacity/);
    expect(css).toMatch(/@starting-style[\s\S]*\.df-client-record-body/);
    expect(reducedMotionCss()).toMatch(/\.df-client-record-body[^{]*\{[^}]*transform:\s*none/);
    expect(reducedMotionCss()).not.toMatch(/opacity:\s*0/);
  });

  it("does not animate client-list filtering or row hover beyond existing press", () => {
    expect(rule(".df-clients-register .df-register-row")).toMatch(/transition:\s*none/);
    expect(rule(".df-clients-register .df-register-row")).toMatch(/animation:\s*none/);
    expect(rule(".df-clients-filter")).toMatch(/transition:\s*none/);
    expect(rule(".df-clients-filter")).toMatch(/animation:\s*none/);
  });
});

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

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
