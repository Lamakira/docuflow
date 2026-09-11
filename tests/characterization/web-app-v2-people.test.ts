import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import {
  peopleArchivePath,
  peopleWriteRefusal,
  composePeople,
  workspaceMembershipsPath,
  type PeopleInput,
} from "../../client/src/v2/people";

/**
 * People from Memberships (#192).
 * Seams: matchV2Route (flagged app chrome) and composePeople over `/api/*`.
 * New BFF only for Memberships in the Active Workspace. Do not assert hex.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2AuthenticatedApp.tsx"),
  "utf8",
);

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function emptyPeople(overrides: Partial<PeopleInput> = {}): PeopleInput {
  return {
    workspaceName: "Harbor Co",
    currentUserId: "me",
    ownerName: "Sam Lee",
    condition: null,
    includeArchived: false,
    purchasedSeats: null,
    memberships: [],
    ...overrides,
  };
}

describe("People routing (#192)", () => {
  it("shows a live People destination on /people, not a placeholder", () => {
    const match = matchV2Route("/people");
    expect(match.kind).toBe("people");
    expect(navIdForPath("/people")).toBe("people");
    expect(breadcrumbFor("/people", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "PEOPLE",
    ]);
    expect(appSource).toContain("V2PeoplePage");
    expect(appSource).toMatch(/path="\/people"/);
    expect(appSource).not.toContain('data-testid="v2-placeholder"');
  });
});

describe("People from Memberships (#192)", () => {
  it("empty Workspace uses empty geometry and never shows sample names or pending Invitations", () => {
    const page = composePeople(emptyPeople());
    const blob = JSON.stringify(page);

    expect(page.empty).toBe(true);
    expect(page.rows).toEqual([]);
    expect(page.emptyCopy.toLowerCase()).toContain("membership");
    expect(page.pagePrimary).toBe("case-ink");
    expect(page.seatCopy).toBe("Only accepted active Memberships consume a Billable Seat.");
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
    expect(page.seatCopy.toLowerCase()).not.toContain("invitation");
    expect(page.emptyCopy.toLowerCase()).not.toContain("invitation");
  });

  it("lists active Memberships with person, Workspace Role, and Capabilities the BFF returned", () => {
    const page = composePeople(
      emptyPeople({
        purchasedSeats: 500,
        memberships: [
          {
            membershipId: "m-owner",
            userId: "me",
            firstName: "Sam",
            lastName: "Lee",
            email: "sam@example.com",
            workspaceRole: "OWNER",
            capabilities: ["View daily updates", "Manage Webhook Endpoints"],
            archived: false,
          },
          {
            membershipId: "m-member",
            userId: "pat",
            firstName: "Pat",
            lastName: "Ng",
            email: "pat@example.com",
            workspaceRole: "MEMBER",
            capabilities: [],
            archived: false,
          },
        ],
      }),
    );

    expect(page.empty).toBe(false);
    expect(page.rows).toEqual([
      {
        membershipId: "m-owner",
        userId: "me",
        name: "Sam Lee",
        initials: "SL",
        email: "sam@example.com",
        workspaceRole: "OWNER",
        capabilities: "View daily updates · Manage Webhook Endpoints",
        status: "ACTIVE",
        canSignIn: true,
        archiveAction: null,
        self: true,
      },
      {
        membershipId: "m-member",
        userId: "pat",
        name: "Pat Ng",
        initials: "PN",
        email: "pat@example.com",
        workspaceRole: "MEMBER",
        capabilities: "—",
        status: "ACTIVE",
        canSignIn: true,
        archiveAction: "archive",
        self: false,
      },
    ]);
    expect(page.seatCopy).toBe(
      "2 of 500 Billable Seats consumed. Only accepted active Memberships consume a Billable Seat.",
    );
    expect(JSON.stringify(page)).not.toContain("Keystone");
  });

  it("does not present Archived Memberships as if they could still sign in", () => {
    const hidden = composePeople(
      emptyPeople({
        memberships: [
          {
            membershipId: "m-active",
            userId: "pat",
            firstName: "Pat",
            lastName: "Ng",
            email: "pat@example.com",
            workspaceRole: "MEMBER",
            capabilities: [],
            archived: false,
          },
          {
            membershipId: "m-gone",
            userId: "cid",
            firstName: "Cid",
            lastName: "Okeke",
            email: "cid@example.com",
            workspaceRole: "MEMBER",
            capabilities: [],
            archived: true,
          },
        ],
      }),
    );
    expect(hidden.rows.map((row) => row.userId)).toEqual(["pat"]);

    const shown = composePeople(
      emptyPeople({
        includeArchived: true,
        memberships: [
          {
            membershipId: "m-gone",
            userId: "cid",
            firstName: "Cid",
            lastName: "Okeke",
            email: "cid@example.com",
            workspaceRole: "MEMBER",
            capabilities: [],
            archived: true,
          },
        ],
      }),
    );
    expect(shown.rows[0]).toMatchObject({
      userId: "cid",
      status: "ARCHIVED",
      canSignIn: false,
      archiveAction: "restore",
    });
    expect(shown.seatCopy).toBe("Only accepted active Memberships consume a Billable Seat.");
  });

  it("asks the BFF for Memberships and archive, and does not wire Invitation send or accept", () => {
    expect(workspaceMembershipsPath()).toBe("/api/workspace/memberships");
    expect(workspaceMembershipsPath({ includeArchived: true })).toBe(
      "/api/workspace/memberships?includeArchived=true",
    );
    expect(peopleArchivePath("user-2")).toBe("/api/admin/users/user-2/archive");

    const pageSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2People.tsx"),
      "utf8",
    );
    expect(pageSource).toContain("/api/workspace/memberships");
    expect(pageSource).toContain("/api/admin/users/");
    expect(pageSource).toContain("Archive");
    expect(pageSource).toContain("df-project-mobile");
    expect(pageSource).not.toMatch(/Invitation pending/i);
    expect(pageSource).not.toMatch(/\/api\/admin\/users["']\s*,/);
    expect(pageSource).not.toContain("custom role");
  });

  it("refusal copy names Capability, Workspace condition, or seat capacity — never permission denied", () => {
    expect(
      peopleWriteRefusal({
        kind: "capability",
        ownerName: "Sam Lee",
      }),
    ).toBe("This action needs a Capability. Sam Lee (Owner) can grant it.");
    expect(
      peopleWriteRefusal({
        kind: "workspace-condition",
        workspaceName: "Harbor Co",
        condition: "Read-only",
      }),
    ).toBe("Harbor Co is read-only. Viewing, export, and recovery stay available.");
    expect(peopleWriteRefusal({ kind: "seat", purchased: 3 })).toBe(
      "All 3 purchased seats are consumed.",
    );
    expect(
      peopleWriteRefusal({
        kind: "error",
        workspaceName: "Harbor Co",
        ownerName: "Sam Lee",
        errorMessage: "Access denied",
      }),
    ).toBe("This action needs a Capability. Sam Lee (Owner) can grant it.");
    expect(
      peopleWriteRefusal({
        kind: "error",
        workspaceName: "Harbor Co",
        ownerName: "Sam Lee",
        errorMessage: "Billable Seat capacity is exhausted",
        purchasedSeats: 3,
      }),
    ).toBe("All 3 purchased seats are consumed.");
    expect(
      peopleWriteRefusal({
        kind: "error",
        workspaceName: "Harbor Co",
        ownerName: "Sam Lee",
        errorMessage: "Workspace is read-only",
      }),
    ).toBe("Harbor Co is read-only. Viewing, export, and recovery stay available.");
  });
});

describe("People Capability refusal motion (#192)", () => {
  it("opens from the failed control and keeps reduced motion on opacity", () => {
    const open = motionForSurface("capability-refusal");
    expect(open.enterExit).toBe("standard");
    expect(open.movement).toBe("allowed");

    const reduced = motionForSurface("capability-refusal", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);

    expect(rule('.df-refusal-pop[data-motion="standard"]')).toMatch(/var\(--ease-out\)/);
    expect(rule('.df-refusal-pop[data-motion="standard"]')).not.toMatch(/transition\s*:\s*all\b/);
    expect(rule(".df-people-register")).toMatch(/animation:\s*none/);
    expect(rule(".df-people-register .df-avatar")).toMatch(/animation:\s*none/);
    expect(reducedMotionCss()).toMatch(
      /\.df-refusal-pop\[data-motion="standard"\][^{]*\{[^}]*transform:\s*none/,
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
