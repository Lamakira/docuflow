import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import {
  composeInvitationPage,
  composePeople,
  invitationAcceptPath,
  invitationAcceptRefusal,
  invitationLookupPath,
  invitationPagePath,
  invitationResendPath,
  invitationRevokePath,
  membershipArchivePath,
  membershipProfilePath,
  membershipRestorePath,
  myInvitationsPath,
  workspaceInvitationsPath,
  workspaceMembershipsPath,
  type PeopleInput,
} from "../../client/src/v2/people";

/**
 * People from Memberships (#192) and Invitations (#211); the review's own cases
 * are in web-app-v2-people-review.test.ts.
 * Seams: matchV2Route (flagged app chrome) and composePeople over `/api/*`.
 * Invitation HTTP is characterized in workspace-invitations.test.ts.
 * Do not assert hex.
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
    currentUserId: "me",
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
    expect(breadcrumbFor("/people", "Harbor Co").map((crumb) => crumb.label)).toEqual(["Harbor Co"]);
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
    expect(page.emptyState?.copy.toLowerCase()).toContain("membership");
    expect(page.pagePrimary).toBe("case-ink");
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("lists active Memberships with person, Workspace Role, and Access the BFF returned", () => {
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
            manageable: false,
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
            manageable: true,
          },
        ],
      }),
    );

    expect(page.empty).toBe(false);
    expect(page.rows.map((row) => [row.name, row.workspaceRole, row.access, row.status, row.self])).toEqual([
      ["Sam Lee", "Owner", "Daily Updates", "Active", true],
      ["Pat Ng", "Member", "-", "Active", false],
    ]);
    expect(page.rows[0].actions).toEqual([]);
    expect(page.rows[1].actions).toEqual(["settings", "archive"]);
    expect(JSON.stringify(page)).not.toContain("Keystone");
  });

  it("offers an Archived Membership only Restore, and never as one who can sign in", () => {
    const row = {
      membershipId: "m-gone",
      userId: "cid",
      firstName: "Cid",
      lastName: "Okeke",
      email: "cid@example.com",
      workspaceRole: "MEMBER",
      capabilities: [],
      archived: true,
      manageable: true,
    };
    expect(composePeople(emptyPeople({ memberships: [row] })).rows).toEqual([]);
    const shown = composePeople(emptyPeople({ includeArchived: true, memberships: [row] }));
    expect(shown.rows[0]).toMatchObject({ state: "archived", status: "Archived", actions: ["restore"] });
  });

  it("asks the BFF for Memberships, Invitations and the Membership's own archive, restore and settings", () => {
    expect(workspaceMembershipsPath()).toBe("/api/workspace/memberships");
    expect(workspaceMembershipsPath({ includeArchived: true })).toBe(
      "/api/workspace/memberships?includeArchived=true",
    );
    expect(membershipArchivePath("m-1")).toBe("/api/workspace/memberships/m-1/archive");
    expect(membershipRestorePath("m-1")).toBe("/api/workspace/memberships/m-1/restore");
    expect(workspaceInvitationsPath()).toBe("/api/workspace/invitations");
    expect(invitationRevokePath("inv-1")).toBe("/api/workspace/invitations/inv-1/revoke");
    expect(invitationResendPath("inv-1")).toBe("/api/workspace/invitations/inv-1/resend");
    expect(invitationAcceptPath()).toBe("/api/invitations/accept");
    expect(invitationLookupPath()).toBe("/api/invitations/lookup");
    expect(membershipProfilePath("m-1")).toBe("/api/workspace/memberships/m-1");

    const pageSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2People.tsx"),
      "utf8",
    );
    expect(pageSource).toContain("workspaceInvitationsPath");
    expect(pageSource).toContain("invitationRevokePath");
    expect(pageSource).toContain("df-project-mobile");
    // A send refusal lands inside the invite dialog, beside what was typed (#273, F91).
    expect(pageSource).toContain('id="df-invite-problem" className="df-field-problem" role="alert"');
    expect(pageSource).not.toContain("/api/admin/users");
    expect(pageSource).not.toContain("custom role");
    expect(pageSource).not.toContain("reset-password");
  });

  it("lists Invitations after the active Members, and filters Memberships and Invitations by name or email", () => {
    const input = emptyPeople({
      purchasedSeats: 8,
      invitations: [
        { id: "inv-1", email: "new@example.com", workspaceRole: "MEMBER", status: "pending", expiresAt: "2026-11-28T12:00:00Z", invitedBy: null },
      ],
      memberships: [
        {
          membershipId: "m-owner",
          userId: "me",
          firstName: "Sam",
          lastName: "Lee",
          email: "sam@example.com",
          workspaceRole: "OWNER",
          capabilities: [],
          archived: false,
        },
      ],
    });
    const page = composePeople(input);
    expect(page.rows.map((row) => row.state)).toEqual(["active", "invited"]);
    expect(page.rows[1]).toMatchObject({ kind: "invitation", email: "new@example.com", actions: ["resend", "revoke"] });
    expect(composePeople({ ...input, filterQuery: "new@" }).rows.map((row) => row.email)).toEqual(["new@example.com"]);
  });
});

describe("Invitation acceptance (#211, Flow 6)", () => {
  it("resolves /invitations/:token to acceptance, not Workspace creation", () => {
    const match = matchV2Route("/invitations/tok");
    expect(match.kind).toBe("invitation-accept");
    if (match.kind === "invitation-accept") {
      expect(match.title).toBe("Invitation");
    }
    expect(invitationPagePath("tok")).toBe("/invitations/tok");
    expect(invitationAcceptPath()).toBe("/api/invitations/accept");
    expect(myInvitationsPath()).toBe("/api/invitations");
    expect(appSource).toContain("V2InvitationAcceptPage");
    expect(appSource).toMatch(/path="\/invitations\/:token"/);

    const rootApp = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../client/src/App.tsx"),
      "utf8",
    );
    expect(rootApp).toContain("/invitations/");
    expect(rootApp).toContain("V2InvitationAcceptPage");
  });

  it("names revoked, expired, and already-accepted Invitations", () => {
    const base = {
      workspaceName: "Harbour View",
      workspaceRole: "MEMBER",
      invitedBy: "Sam Lee",
      email: "pat@example.com",
      expiresAt: "2026-11-28T12:00:00Z",
    };
    const at = (status: "pending" | "expired" | "revoked" | "accepted") =>
      composeInvitationPage({ lookup: { ...base, status }, signedIn: true, signedInEmail: "pat@example.com" });
    expect(at("revoked").copy.toLowerCase()).toContain("revoked");
    expect(at("expired").copy).toBe("This Invitation expired. Ask Sam Lee to send it again.");
    expect(at("accepted").action).toBe("open");
    expect(at("pending").action).toBe("accept");
    expect(invitationAcceptRefusal("Billable Seat capacity is exhausted", "Sam Lee")).toContain("Ask Sam Lee to add one");
  });
});

describe("People Capability refusal and Invitation accept motion (#192, #211)", () => {
  it("opens from the failed control and keeps reduced motion on opacity", () => {
    const open = motionForSurface("capability-refusal");
    expect(open.enterExit).toBe("standard");
    expect(open.movement).toBe("allowed");

    const reduced = motionForSurface("capability-refusal", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);

    expect(rule('.df-v2.df-refusal-popover[data-motion="standard"]')).toMatch(/var\(--ease-out\)/);
    expect(rule('.df-v2.df-refusal-popover[data-motion="standard"]')).not.toMatch(/transition\s*:\s*all\b/);
    expect(rule(".df-people-register")).toMatch(/animation:\s*none/);
    expect(rule(".df-people-register .df-avatar")).toMatch(/animation:\s*none/);
    expect(reducedMotionCss()).toMatch(
      /\.df-v2\.df-refusal-popover\[data-motion="standard"\][^{]*\{[^}]*transform:\s*none/,
    );
  });

  it("lets an accepted Membership appear without bounce, and does not animate filter or seat digits", () => {
    const enter = motionForSurface("invitation-accept");
    expect(enter.enterExit).toBe("standard");
    expect(enter.movement).toBe("allowed");
    expect(enter.press).toBe("none");

    const reduced = motionForSurface("invitation-accept", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);

    expect(rule('.df-people-row-wrap[data-just-accepted="true"][data-motion="standard"]')).toMatch(
      /var\(--ease-out\)/,
    );
    expect(rule('.df-people-row-wrap[data-just-accepted="true"][data-motion="standard"]')).not.toMatch(
      /scale\(/,
    );
    expect(rule(".df-people-role")).toMatch(/animation:\s*none/);
  });
});

describe("the Members table reads like the other registers (#280)", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2People.tsx"),
    "utf8",
  );

  it("draws the desktop register with the shared shadcn table, one column per head", () => {
    expect(source).toContain('from "@/components/ui/table"');
    expect(source).toContain('<Table className="df-table" data-testid="v2-people-table">');
    for (const column of ["member", "role", "access", "status", "actions"]) {
      expect(source).toContain(`className="df-table-head" data-column="${column}"`);
      expect(source).toContain(`className="df-table-cell" data-column="${column}"`);
    }
    expect(source).not.toContain('className="df-register-head');
  });

  it("puts every row's actions in one row menu", () => {
    expect(source).toContain("<V2RowMenu");
    for (const label of ["Revoke Invitation", "Resend Invitation", "Member settings", "Archive", "Restore"]) {
      expect(source).toContain(`label: "${label}"`);
    }
    expect(source).not.toContain("onBlur=");
    expect(source).not.toContain("Hours/day");
  });

  it("edits a Member's role and Daily Updates access in a dialog, never hours", () => {
    expect(source).toContain('testId="v2-people-settings-dialog"');
    expect(source).toContain("Can view Daily Updates");
    expect(source).not.toContain("Hours per day");
    expect(source).not.toContain("hoursPerDay");
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
