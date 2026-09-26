import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import {
  clientSourceChoices,
  clientSourceOptions,
  CLIENT_SOURCE_OPTIONS,
  clientWriteRefusal,
  composeClientRecord,
  composeClientRegister,
  type ClientRegisterInput,
} from "../../client/src/v2/clients";
import { Handshake } from "lucide-react";
import { SiFiverr, SiZoho } from "react-icons/si";
import { sourceIcon } from "../../client/src/v2/sourceIcons";

/**
 * Clients live register and Client record (#186).
 * Seams: matchV2Route (flagged app chrome) and compose helpers over existing `/api/*`.
 * Do not assert hex values or the prototype DOM. No new BFF routes.
 */

describe("the Client record's two forms match every other v2 form (#280)", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Clients.tsx"),
    "utf8",
  );

  it("edits the Client in a dialog, not an inline form", () => {
    expect(source).toContain('testId="v2-client-edit"');
    expect(source).toContain('submitLabel="Save Client"');
    expect(source).not.toContain('<form className="df-admin-form');
    expect(source).not.toContain("setEditing((open) => !open)");
  });

  it("chooses the source with the shared v2 select", () => {
    expect(source).not.toContain('from "@/components/ui/select"');
    expect(source).toContain("options={withSourceMarks(clientSourceChoices(draft.source, sourceOptions))}");
    expect(rule(".df-form-dialog-body > .df-daily-field .df-select-trigger")).toMatch(
      /justify-content:\s*space-between/,
    );
  });

  it("keeps a stored source outside the set as a choice, so the field is never blank", () => {
    const ids = (current: string | null) => clientSourceChoices(current).map((option) => option.value);
    expect(ids(null)).toEqual(["fiverr", "zoho", "direct", "none"]);
    expect(ids("direct")).toEqual(["fiverr", "zoho", "direct", "none"]);
    expect(clientSourceChoices("referral").at(-1)).toEqual({ value: "referral", label: "REFERRAL" });
    expect(clientSourceChoices("word_of_mouth").at(-1)?.label).toBe("WORD OF MOUTH");
  });

  it("offers the Workspace's saved Source list, falling back to the defaults", () => {
    const saved = [
      { slug: "first_name", options: null },
      {
        slug: "source",
        options: ['{"id":"direct","label":"Direct","color":"#3b82f6"}', '{"id":"referral","label":"Referral","color":"#22c55e"}', "Fiverr"],
      },
    ];
    const options = clientSourceOptions(saved);
    expect(options).toEqual([
      { value: "direct", label: "DIRECT" },
      { value: "referral", label: "REFERRAL" },
      { value: "fiverr", label: "FIVERR" },
      { value: "none", label: "NONE" },
    ]);
    expect(clientSourceOptions([{ slug: "source", options: [] }])).toEqual(CLIENT_SOURCE_OPTIONS);
    expect(clientSourceOptions(undefined)).toEqual(CLIENT_SOURCE_OPTIONS);
    // A stored source the saved list dropped still reads back.
    expect(clientSourceChoices("zoho", options).map((option) => option.value)).toEqual(["direct", "referral", "fiverr", "none", "zoho"]);
    expect(clientSourceChoices("referral", options)).toBe(options);
    expect(source).toContain('queryKey: ["/api/modules/contacts/fields"]');
  });

  it("gives both forms the same field shape: a label above a typed input", () => {
    for (const fields of ["CONTACT_FIELDS", "DETAIL_FIELDS"]) {
      expect(source).toContain(`${fields}.map((field, index) => (`);
    }
    expect(source).toMatch(/id: "email", label: "EMAIL", type: "email"/);
    expect(source).toMatch(/id: "phone", label: "PHONE", type: "tel"/);
  });
});

describe("a Client Source wears one mark everywhere v2 shows it", () => {
  const clientsSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Clients.tsx"),
    "utf8",
  );
  const adminSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Administration.tsx"),
    "utf8",
  );
  const selectSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Select.tsx"),
    "utf8",
  );

  it("draws Fiverr and Zoho with their brand marks and Direct with a neutral lucide one", () => {
    expect(sourceIcon("fiverr")).toEqual({ Icon: SiFiverr, hue: "#1dbf73" });
    expect(sourceIcon("zoho")).toEqual({ Icon: SiZoho, hue: "#e42527" });
    expect(sourceIcon(" Direct ")).toEqual({ Icon: Handshake, hue: null });
    // A Source an Administrator added keeps its colour dot.
    expect(sourceIcon("referral")).toBeNull();
    expect(sourceIcon("none")).toBeNull();
    expect(sourceIcon(null)).toBeNull();
  });

  it("carries the stored value to the register row and the record", () => {
    const register = composeClientRegister({
      workspaceName: "Harbor Co",
      clients: [
        { id: "c-1", name: "Harbor", company: null, status: "client", source: "fiverr", projectCount: 0 },
        { id: "c-2", name: "Pier", company: null, status: "lead", source: null, projectCount: 0 },
      ],
      filterQuery: "",
      selectedId: null,
    } as ClientRegisterInput);
    expect(register.rows.map((row) => [row.source, row.sourceValue])).toEqual([
      ["FIVERR", "fiverr"],
      ["—", null],
    ]);
  });

  it("uses the shared SourceMark on the register, the record, the details and both Source selects", () => {
    expect(clientsSource).toContain("<SourceMark value={row.original.sourceValue} />");
    expect(clientsSource).toContain("<SourceMark value={record.identity.sourceValue} />");
    expect(clientsSource).toContain("<SourceMark value={record.identity?.sourceValue} />");
    expect(clientsSource).toContain('options={withSourceMarks([{ value: "all", label: "ALL" }, ...sourceOptions])}');
    expect(selectSource).toContain("icon?: ReactNode;");
    expect(selectSource).toContain("<OptionText option={option} />");
    // Pipeline & lists: a marked Source has no colour picker; any other keeps one.
    expect(adminSource).toMatch(/list\.id === "source" && sourceIcon\(row\.value\) \?\s*\(\s*<span className="df-pipeline-mark"/);
    expect(adminSource).toContain("<SourceMark value={row.value} />");
  });

  it("colours a brand mark with the contrast-checked swatch ink on either ground", () => {
    expect(rule(".df-source-icon")).toMatch(/color:\s*var\(--df-archive-slate\)/);
    expect(rule(".df-source-icon[data-brand]")).toMatch(/color:\s*var\(--df-swatch-ink\)/);
    expect(rule(".dark .df-source-icon[data-brand]")).toMatch(/color:\s*var\(--df-swatch-ink-dark\)/);
    for (const selector of [".df-source-icon", ".df-source-icon[data-brand]", ".dark .df-source-icon[data-brand]", ".df-pipeline-mark"]) {
      expect(rule(selector)).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    }
    expect(rule(".df-pipeline-mark")).toMatch(/width:\s*var\(--df-control-h\)/);
  });
});

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
const pageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Clients.tsx"),
  "utf8",
);

describe("Client editor shows what it saved (#213)", () => {
  const clientSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Clients.tsx"),
    "utf8",
  );

  it("reads the whole Client back, not only its notes", () => {
    const record = composeClientRecord({
      client: {
        id: "c1",
        name: "Harbor Co",
        company: "TECHMA",
        email: "techma@techma.ca",
        phone: "0101010101",
        phoneFormat: "us",
        status: "lead",
        source: "direct",
        fiverrUsername: null,
        notes: null,
        contacts: [],
      },
      projects: [],
      now: new Date(2026, 8, 14, 12, 0, 0),
    });

    // The editor writes company, email, phone and source, so the card has to
    // show them; before this only `notes` came back and the rest was invisible
    // until the editor was reopened.
    expect(record.details).toEqual([
      { label: "COMPANY", value: "TECHMA" },
      { label: "EMAIL", value: "techma@techma.ca" },
      { label: "PHONE", value: "0101010101" },
      { label: "SOURCE", value: "DIRECT" },
      // Notes join the same block: a separate paragraph below stacked two
      // gutters and left a band of empty card between them.
      { label: "NOTES", value: "—", wide: true },
    ]);
  });

  it("reads a Contact like a person, the way a Membership reads on People", () => {
    const record = composeClientRecord({
      client: {
        id: "c1",
        name: "Harbor Co",
        company: null,
        email: null,
        phone: null,
        phoneFormat: null,
        status: "lead",
        source: null,
        fiverrUsername: null,
        notes: null,
        contacts: [
          { id: "k1", name: "Said Arikama", role: "Directeur", email: "said@harbor.co", phone: "0101", isPrimary: 1 },
          { id: "k2", name: "Ada", role: null, email: null, phone: null, isPrimary: 0 },
        ],
      },
      projects: [],
      now: new Date(2026, 8, 14, 12, 0, 0),
    });

    expect(record.contacts[0]).toMatchObject({ name: "Said Arikama", initials: "SA", primary: true });
    // One word gives two letters rather than one lonely capital.
    expect(record.contacts[1].initials).toBe("AD");

    // Identity, then the reachable detail, then badges — not one joined string.
    expect(clientSource).toContain("df-people-member");
    expect(clientSource).toContain("df-contact-badges");
    // Columns say nothing without a head; the desktop register names each one.
    expect(clientSource).toMatch(/<span>CONTACT<\/span>/);
    expect(clientSource).toMatch(/<span>PHONE<\/span>/);
    expect(clientSource).toMatch(/<span>ROLE<\/span>/);
    // A role is free text, so it is read as text — a status pill would claim it
    // came from a closed set.
    expect(clientSource).toContain("df-contact-role");
    // `.df-contact-row` is the Dossier's flex contact line: reusing that name
    // let its display:flex win and the columns drifted off their own headers.
    expect(clientSource).toContain("df-client-contact-row");
    expect(clientSource).toContain("df-client-contacts");
    // `.df-client-record-body .df-register-row` sets two tracks at the same
    // weight, so this rule only wins by coming after it — a harness without that
    // ancestor renders correctly while the real record wraps its last columns.
    const twoTrack = css.indexOf(".df-client-record-body .df-register-row");
    const fourTrack = css.indexOf(".df-client-record-body .df-client-contact-row");
    expect(twoTrack).toBeGreaterThan(-1);
    expect(fourTrack).toBeGreaterThan(twoTrack);
    expect(clientSource).not.toMatch(/df-status">\{contact\.role\}/);
    // An email is a literal identifier; uppercasing it changes what it looks like.
    expect(clientSource).toContain('data-case="preserve"');
    expect(rule('.df-meta[data-case="preserve"]')).toMatch(/text-transform:\s*none/);
  });

  it("reads record attributes as stacked pairs, not as metric tiles", () => {
    // A boxed tile is for a metric. Forcing record attributes into equal-width
    // tiles truncated the email; after Resend's contact metadata grid and Rox,
    // whose property rows are explicitly not carded individually.
    expect(clientSource).toContain("df-record-fields");
    expect(clientSource).not.toContain("df-analytics-figure");
    // An email is prose, so the value is UI text rather than the mono a figure uses.
    expect(rule(".df-record-field-value")).not.toMatch(/font-family/);
    expect(rule(".df-record-field")).not.toMatch(/border:/);
  });

  it("names the card for what it edits, and signs off the save", () => {
    // The card edits the whole Client; calling it "Notes" described one field.
    expect(clientSource).toContain("Client details");
    expect(clientSource).toContain('showToast("Client saved.")');
  });
});

describe("Client record controls use the shadcn set (#213)", () => {
  const clientSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Clients.tsx"),
    "utf8",
  );

  it("has no bare checkbox or native select left on the record", () => {
    expect(clientSource).not.toContain('type="checkbox"');
    expect(clientSource).not.toContain("<select");
    expect(clientSource).toContain('from "@/components/ui/checkbox"');
    // Every select is V2FilterSelect, the shadcn Select carrying `.df-v2` through its portal (#280).
    expect(clientSource).toContain('from "./V2Select"');
    // Radix renders a button, which a wrapping <label> cannot implicitly label.
    expect(clientSource).toContain('htmlFor="df-contact-primary"');
  });
});

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
      { id: "prj-live", name: "Harbour rebuild", status: "ACTIVE", statusColor: "#14b8a6", href: "/projects/prj-live" },
      { id: "prj-other", name: "Other dock", status: "PLANNED", statusColor: "#6366f1", href: "/projects/prj-other" },
    ]);
    expect(record.notes).toBe("Pier contract.");
    expect(JSON.stringify(record)).not.toContain("Keystone");
    expect(JSON.stringify(record)).not.toContain("v1");
  });

  it("shows the v1 Client fields and related-contact details (#213)", () => {
    const record = composeClientRecord({
      client: {
        id: "cli-1",
        name: "Harbor Co",
        company: "Harbor Co Ltd",
        email: "work@harbor.test",
        phone: "+229 01 02 03 04",
        phoneFormat: "international",
        status: "client",
        source: "fiverr",
        fiverrUsername: "harbor_ops",
        notes: "Prefers written updates.",
        contacts: [{
          id: "contact-1",
          name: "Pat Ng",
          role: "Approver",
          email: "pat@harbor.test",
          phone: "+229 05 06 07 08",
          isPrimary: 1,
        }],
      },
      projects: [],
    });

    expect(record.identity).toMatchObject({
      phone: "+229 01 02 03 04",
      fiverrUsername: "harbor_ops",
    });
    expect(record.contacts[0]).toMatchObject({
      email: "pat@harbor.test",
      phone: "+229 05 06 07 08",
      primary: true,
    });
    expect(pageSource).toContain("/contacts`");
    expect(pageSource).toContain('apiRequest("PATCH", `/api/crm/clients/${clientId}`');
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
