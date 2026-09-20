import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import {
  composeInvitationAccept,
  composeInvitePreview,
  composePeople,
  invitationAcceptPath,
  invitationPagePath,
  invitationRevokePath,
  membershipProfilePath,
  myInvitationsPath,
  peopleArchivePath,
  peopleWriteRefusal,
  workspaceInvitationsPath,
  workspaceMembershipsPath,
  type PeopleInput,
} from "../../client/src/v2/people";

/**
 * People from Memberships (#192) and Invitations (#211).
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
    expect(page.seatCopy).toBe(
      "Only accepted active Memberships consume a Billable Seat. 0 Invitations pending consume none.",
    );
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
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
        kind: "membership",
        membershipId: "m-owner",
        invitationId: null,
        userId: "me",
        name: "Sam Lee",
        initials: "SL",
        email: "sam@example.com",
        workspaceRole: "OWNER",
        capabilities: "View daily updates · Manage Webhook Endpoints",
        status: "ACTIVE",
        canSignIn: true,
        consumesSeat: true,
        hoursPerDay: 8,
        canViewDailyUpdates: 0,
        archiveAction: null,
        revokeAction: false,
        justAccepted: false,
        self: true,
      },
      {
        kind: "membership",
        membershipId: "m-member",
        invitationId: null,
        userId: "pat",
        name: "Pat Ng",
        initials: "PN",
        email: "pat@example.com",
        workspaceRole: "MEMBER",
        capabilities: "—",
        status: "ACTIVE",
        canSignIn: true,
        consumesSeat: true,
        hoursPerDay: 8,
        canViewDailyUpdates: 0,
        archiveAction: "archive",
        revokeAction: false,
        justAccepted: false,
        self: false,
      },
    ]);
    expect(page.seatCopy).toBe(
      "2 of 500 Billable Seats consumed. 0 Invitations pending consume none.",
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
      consumesSeat: false,
      archiveAction: "restore",
    });
    expect(shown.seatCopy).toBe(
      "Only accepted active Memberships consume a Billable Seat. 0 Invitations pending consume none.",
    );
  });

  it("asks the BFF for Memberships, Invitations, archive, and hours-per-day — not custom Workspace Roles", () => {
    expect(workspaceMembershipsPath()).toBe("/api/workspace/memberships");
    expect(workspaceMembershipsPath({ includeArchived: true })).toBe(
      "/api/workspace/memberships?includeArchived=true",
    );
    expect(peopleArchivePath("user-2")).toBe("/api/admin/users/user-2/archive");
    expect(workspaceInvitationsPath()).toBe("/api/workspace/invitations");
    expect(invitationRevokePath("inv-1")).toBe("/api/workspace/invitations/inv-1/revoke");
    expect(invitationAcceptPath()).toBe("/api/invitations/accept");
    expect(membershipProfilePath("m-1")).toBe("/api/workspace/memberships/m-1");

    const pageSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2People.tsx"),
      "utf8",
    );
    expect(pageSource).toContain("workspaceInvitationsPath");
    expect(pageSource).toContain("invitationRevokePath");
    expect(pageSource).toContain("Invitation pending");
    expect(pageSource).toContain("Archive");
    expect(pageSource).toContain("df-project-mobile");
    expect(pageSource).not.toContain("custom role");
    expect(pageSource).not.toContain("reset-password");
  });

  it("refusal copy names the Workspace Role, Workspace condition, or seat capacity — never permission denied", () => {
    expect(
      peopleWriteRefusal({
        kind: "workspace-role",
        workspaceRole: "MEMBER",
        ownerName: "Sam Lee",
      }),
    ).toBe(
      "Inviting and managing People is open to the Owner and Administrators. " +
        "Your Workspace Role is Member. Sam Lee (Owner) can change it.",
    );
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
        workspaceRole: "MEMBER",
        ownerName: "Sam Lee",
        errorMessage: "Access denied",
      }),
    ).toBe(
      "Inviting and managing People is open to the Owner and Administrators. " +
        "Your Workspace Role is Member. Sam Lee (Owner) can change it.",
    );
    expect(
      peopleWriteRefusal({
        kind: "error",
        workspaceName: "Harbor Co",
        workspaceRole: "MEMBER",
        ownerName: "Sam Lee",
        errorMessage: "Billable Seat capacity is exhausted",
        purchasedSeats: 3,
      }),
    ).toBe("All 3 purchased seats are consumed.");
    expect(
      peopleWriteRefusal({
        kind: "error",
        workspaceName: "Harbor Co",
        workspaceRole: "MEMBER",
        ownerName: "Sam Lee",
        errorMessage: "Workspace is read-only",
      }),
    ).toBe("Harbor Co is read-only. Viewing, export, and recovery stay available.");
  });

  it("lists pending Invitations separately from Memberships and previews the seat if accepted", () => {
    const page = composePeople(
      emptyPeople({
        purchasedSeats: 8,
        invitations: [{ id: "inv-1", email: "new@example.com", workspaceRole: "MEMBER" }],
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
            hoursPerDay: 7,
            canViewDailyUpdates: 1,
          },
        ],
      }),
    );
    expect(page.rows.map((row) => row.status)).toEqual(["ACTIVE", "INVITATION PENDING"]);
    expect(page.rows[1]).toMatchObject({
      kind: "invitation",
      email: "new@example.com",
      status: "INVITATION PENDING",
      canSignIn: false,
      consumesSeat: false,
      revokeAction: true,
    });
    expect(page.seatCopy).toBe("1 of 8 Billable Seats consumed. 1 Invitation pending consumes none.");
    expect(composeInvitePreview({ activeCount: 1, purchasedSeats: 8 })).toBe(
      "1 of 8 Billable Seats consumed. This Invitation will consume 1 of 8 if accepted.",
    );
    expect(page.rows[0]).toMatchObject({ hoursPerDay: 7, canViewDailyUpdates: 1 });
  });

  it("filters Memberships and pending Invitations by name or email", () => {
    const page = composePeople(
      emptyPeople({
        filterQuery: "new@",
        invitations: [{ id: "inv-1", email: "new@example.com", workspaceRole: "MEMBER" }],
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
      }),
    );
    expect(page.rows.map((row) => row.email)).toEqual(["new@example.com"]);
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

  it("tells the invitee they join a Membership and names revoked, expired, and already-accepted", () => {
    const signedOut = composeInvitationAccept({ signedIn: false, status: "ready" });
    expect(signedOut.action).toBe("sign-in");
    expect(signedOut.copy.toLowerCase()).toContain("membership");
    expect(signedOut.copy.toLowerCase()).toContain("does not create a workspace");

    const ready = composeInvitationAccept({
      signedIn: true,
      status: "ready",
      workspaceName: "Harbour View",
    });
    expect(ready.action).toBe("accept");
    expect(ready.copy).toContain("Harbour View");
    expect(ready.copy.toLowerCase()).toContain("membership");
    expect(ready.copy.toLowerCase()).toContain("does not create a workspace");

    expect(composeInvitationAccept({ signedIn: true, status: "revoked" }).copy.toLowerCase()).toContain(
      "revoked",
    );
    expect(composeInvitationAccept({ signedIn: true, status: "expired" }).copy.toLowerCase()).toContain(
      "expired",
    );
    expect(composeInvitationAccept({ signedIn: true, status: "already" }).copy.toLowerCase()).toContain(
      "already accepted",
    );
    expect(composeInvitationAccept({ signedIn: true, status: "accepted" }).action).toBe("today");
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

    expect(rule('.df-refusal-pop[data-motion="standard"]')).toMatch(/var\(--ease-out\)/);
    expect(rule('.df-refusal-pop[data-motion="standard"]')).not.toMatch(/transition\s*:\s*all\b/);
    expect(rule(".df-people-register")).toMatch(/animation:\s*none/);
    expect(rule(".df-people-register .df-avatar")).toMatch(/animation:\s*none/);
    expect(reducedMotionCss()).toMatch(
      /\.df-refusal-pop\[data-motion="standard"\][^{]*\{[^}]*transform:\s*none/,
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
    expect(rule(".df-people-filter input")).toMatch(/transition:\s*none/);
    expect(rule(".df-people-role")).toMatch(/animation:\s*none/);
    expect(rule(".df-people-seats")).toMatch(/animation:\s*none/);
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
