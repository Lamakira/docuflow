import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  composeInvitationPage,
  composePeople,
  invitationAcceptRefusal,
  invitationSentNotice,
  inviteEmailProblem,
  memberSettingsPatch,
  peopleFailure,
  readPeopleFilters,
  writePeopleFilters,
  type InvitationLookup,
  type PeopleInput,
  type PeopleInvitationInput,
  type PeopleMembershipInput,
} from "../../client/src/v2/people";

/**
 * The People review (F84, F88 to F91): each finding's measured case.
 * Dates sit at midday UTC so no time zone moves them to another day.
 */

const v2 = (name: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2", name), "utf8");

function member(id: string, first: string, role: string, extra: Partial<PeopleMembershipInput> = {}): PeopleMembershipInput {
  return {
    membershipId: `m-${id}`,
    userId: id,
    firstName: first,
    lastName: "Ng",
    email: `${id}@example.com`,
    workspaceRole: role,
    capabilities: [],
    archived: false,
    manageable: true,
    ...extra,
  };
}

function invitation(id: string, extra: Partial<PeopleInvitationInput> = {}): PeopleInvitationInput {
  return {
    id,
    email: `${id}@example.com`,
    workspaceRole: "MEMBER",
    status: "pending",
    expiresAt: "2026-11-28T12:00:00Z",
    invitedBy: null,
    ...extra,
  };
}

function people(overrides: Partial<PeopleInput> = {}): PeopleInput {
  return { currentUserId: "me", condition: null, includeArchived: false, purchasedSeats: 500, memberships: [], ...overrides };
}

describe("F84: Archive acts on one Membership, through the Workspace's route", () => {
  const source = v2("V2People.tsx");

  it("never calls the platform directory's route", () => {
    expect(source).not.toContain("/api/admin/users");
    expect(source).toContain("membershipArchivePath");
    expect(source).toContain("membershipRestorePath");
    expect(v2("people.ts")).not.toContain("peopleArchivePath");
  });

  it("offers Archive, Restore and Member settings only where the server says the row is manageable", () => {
    const page = people({
      includeArchived: true,
      memberships: [
        member("owner", "Sam", "OWNER", { manageable: false }),
        member("pat", "Pat", "MEMBER"),
        member("cid", "Cid", "MEMBER", { archived: true }),
        member("adm", "Ada", "ADMINISTRATOR", { manageable: false }),
      ],
    });
    const rows = Object.fromEntries(composePeople(page).rows.map((row) => [row.userId, row.actions]));
    expect(rows).toEqual({ owner: [], adm: [], pat: ["settings", "archive"], cid: ["restore"] });
  });

  it("gives a Read-only reader no row menu at all", () => {
    const rows = composePeople(people({ canInvite: false, memberships: [member("pat", "Pat", "MEMBER")] })).rows;
    expect(rows[0].actions).toEqual([]);
  });

  it("archives at once with Undo for 8 seconds, restores with a plain toast", () => {
    expect(source).toContain("`${row.name} archived`");
    expect(source).toContain("`${row.name} restored`");
    expect(source).toContain("ARCHIVE_UNDO_MS");
    expect(source).toContain('label: "Undo"');
    expect(v2("people.ts")).toContain("ARCHIVE_UNDO_MS = 8000");
  });

  it("names Billing in a refused seat only to those who can act on it", () => {
    expect(peopleFailure("Billable Seat capacity is exhausted", { purchasedSeats: 2, canManage: true })).toBe(
      "All 2 Billable Seats are in use. Add seats in Administration → Billing, then try again.",
    );
    expect(peopleFailure("Billable Seat capacity is exhausted", { purchasedSeats: null, canManage: false })).toBe(
      "All Billable Seats are in use. Ask an Administrator to add seats.",
    );
    expect(peopleFailure("This account is archived. Contact DocuFlow support to restore it.", { purchasedSeats: 2, canManage: true })).toBe(
      "This account is archived. Contact DocuFlow support to restore it.",
    );
  });

  it("re-reads every list a change touches", () => {
    const keys = v2("people.ts").match(/PEOPLE_STALE_KEYS = \[([^\]]*)\]/)?.[1] ?? "";
    for (const key of ["/api/workspace/memberships", "/api/workspace/invitations", "/api/users", "/api/billing/subscription"]) {
      expect(keys).toContain(key);
    }
    expect(v2("V2People.tsx")).toContain("staleTime: 0");
  });
});

describe("F88: a Member's role can be changed", () => {
  const row = { roleValue: "MEMBER", canViewDailyUpdates: 0 };

  it("sends only what changed, and nothing when nothing did", () => {
    expect(memberSettingsPatch(row, { workspaceRole: "MEMBER", canViewDailyUpdates: false })).toBeNull();
    expect(memberSettingsPatch(row, { workspaceRole: "ADMINISTRATOR", canViewDailyUpdates: false })).toEqual({
      workspaceRole: "ADMINISTRATOR",
    });
    expect(memberSettingsPatch(row, { workspaceRole: "MEMBER", canViewDailyUpdates: true })).toEqual({
      canViewDailyUpdates: 1,
    });
  });

  it("sends the Daily Updates grant for a Member only", () => {
    expect(memberSettingsPatch(row, { workspaceRole: "ADMINISTRATOR", canViewDailyUpdates: true })).toEqual({
      workspaceRole: "ADMINISTRATOR",
    });
    expect(
      memberSettingsPatch({ roleValue: "ADMINISTRATOR", canViewDailyUpdates: 0 }, { workspaceRole: "MEMBER", canViewDailyUpdates: true }),
    ).toEqual({ workspaceRole: "MEMBER", canViewDailyUpdates: 1 });
  });

  it("puts the role choice and the Save button, enabled by a change, in the dialog", () => {
    const source = v2("V2People.tsx");
    expect(source).toContain("canSubmit={settingsPatch !== null}");
    expect(source).toContain('ariaLabel="Workspace role"');
    expect(source).toContain("settingsDraft.workspaceRole === \"MEMBER\"");
  });
});

describe("F89: Invitations say what is true", () => {
  it("says an unsent email is saved, not sent, and names the way on", () => {
    expect(invitationSentNotice("a@b.co", true)).toEqual({ kind: "success", message: "Invitation sent to a@b.co" });
    expect(invitationSentNotice("a@b.co", true, true).message).toBe("Invitation sent again to a@b.co");
    expect(invitationSentNotice("a@b.co", false)).toEqual({
      kind: "info",
      message: "The Invitation is saved, but its email could not be sent. Use Resend Invitation.",
    });
  });

  it("shows the expiry date, the inviter, and an expired Invitation that can be resent", () => {
    const rows = composePeople(
      people({
        invitations: [
          invitation("new", { invitedBy: "Sam Lee" }),
          invitation("old", { status: "expired" }),
        ],
      }),
    ).rows;
    expect(rows.map((row) => row.status)).toEqual(["Invited, expires 28 Nov", "Invitation expired"]);
    expect(rows[0].invitedBy).toBe("Sam Lee");
    expect(rows[1].actions).toEqual(["resend", "revoke"]);
  });

  it("counts no Invitations pending when they could not be loaded, and says so under the table", () => {
    const failed = composePeople(people({ invitations: null, memberships: [member("me", "Sam", "OWNER")] }));
    expect(failed.seatCopy).toBe("1 of 500 Billable Seats used.");
    const source = v2("V2People.tsx");
    expect(source).toContain('title="Invitations could not be loaded"');
    expect(source).toContain("enabled: canManage");
  });

  it("refuses an address that is not whole before sending, and shows every refusal inside the dialog", () => {
    expect(inviteEmailProblem("a@b")).toBe("Enter a full email address, like name@company.com");
    expect(inviteEmailProblem("")).not.toBeNull();
    expect(inviteEmailProblem(" name@company.com ")).toBeNull();
    const source = v2("V2People.tsx");
    expect(source).toContain('id="df-invite-problem" className="df-field-problem" role="alert"');
    expect(source).toMatch(/invite = useMutation\([\s\S]*?onError: \(error: Error\) =>\s*setInviteProblem/);
  });
});

describe("F90: the Invitation page says to what", () => {
  const lookup: InvitationLookup = {
    workspaceName: "Harbour View",
    workspaceRole: "MEMBER",
    invitedBy: "Sam Lee",
    email: "Pat@Example.com",
    status: "pending",
    expiresAt: "2026-11-28T12:00:00Z",
  };

  it("names the Workspace, the role, the inviter and the date, and offers sign-in when signed out", () => {
    const page = composeInvitationPage({ lookup, signedIn: false });
    expect(page.title).toBe("Join Harbour View");
    expect(page.copy).toBe("Sam Lee invited Pat@Example.com to join as Member.");
    expect(page.detail).toBe("The Invitation is open until 28 Nov 2026.");
    expect(page.action).toBe("sign-in");
    expect(composeInvitationPage({ lookup: { ...lookup, invitedBy: null }, signedIn: false }).copy).toMatch(/^You were invited/);
  });

  it("offers Accept to the right address, compared in lower case, and a way out to another one", () => {
    expect(composeInvitationPage({ lookup, signedIn: true, signedInEmail: "pat@example.com" }).action).toBe("accept");
    const other = composeInvitationPage({ lookup, signedIn: true, signedInEmail: "zed@example.com" });
    expect(other.action).toBe("switch");
    expect(other.actionLabel).toBe("Switch account");
    expect(other.copy).toBe("This Invitation was sent to Pat@Example.com. You are signed in as zed@example.com.");
  });

  it("gives a link that names no Invitation, and a spent one, a way out", () => {
    expect(composeInvitationPage({ lookup: null, signedIn: true })).toMatchObject({ action: "go", actionLabel: "Go to DocuFlow" });
    expect(composeInvitationPage({ lookup: { ...lookup, status: "expired" }, signedIn: true }).copy).toBe(
      "This Invitation expired. Ask Sam Lee to send it again.",
    );
    expect(composeInvitationPage({ lookup: { ...lookup, status: "expired", invitedBy: null }, signedIn: true }).copy).toBe(
      "This Invitation expired. Ask the person who invited you to send it again.",
    );
    expect(composeInvitationPage({ lookup: { ...lookup, status: "accepted" }, signedIn: true })).toMatchObject({
      action: "open",
      actionLabel: "Open DocuFlow",
    });
    expect(composeInvitationPage({ lookup: { ...lookup, status: "revoked" }, signedIn: true }).action).toBe("go");
  });

  it("says the next step for each refused accept", () => {
    expect(invitationAcceptRefusal("Billable Seat capacity is exhausted", "Sam Lee")).toBe(
      "This Workspace has no free seat. Ask Sam Lee to add one, then open this link again.",
    );
    expect(invitationAcceptRefusal("Confirm your email address with your sign-in provider, then reload this page", null)).toContain(
      "reload this page",
    );
    expect(invitationAcceptRefusal("This account is archived. Contact DocuFlow support to restore it.", null)).toContain("support");
  });

  it("never promises a Membership, reads the lookup, and names the tab", () => {
    const source = v2("V2InvitationAccept.tsx") + v2("people.ts");
    expect(source).not.toContain("does not create a Workspace");
    expect(source).not.toContain("You will gain a Membership");
    expect(source).toContain("invitationLookupPath");
    expect(source).toContain("`Invitation - ${APP_NAME}`");
    expect(source).toContain("signOutOfIdentityProvider");
    expect(source).toContain("<V2LoadFailed");
  });
});

describe("F91: People polish", () => {
  const source = v2("V2People.tsx");

  it("keeps the search and the archived switch in the address", () => {
    expect(readPeopleFilters("?q=ada&archived=1")).toEqual({ q: "ada", archived: true });
    expect(readPeopleFilters("")).toEqual({ q: "", archived: false });
    expect(writePeopleFilters("", { q: "ada", archived: true })).toBe("?q=ada&archived=1");
    expect(writePeopleFilters("?q=ada&archived=1", { q: "", archived: false })).toBe("");
    expect(source).toContain("placeholderData: keepPreviousData");
    expect(source).toContain("<FilterCheck");
    expect(v2("V2Activity.tsx")).toContain('from "./V2FilterCheck"');
    expect(v2("V2Activity.tsx")).not.toContain("function FilterCheck");
  });

  it("shows Daily Updates under Access for a Member who has the grant or the Capability", () => {
    const rows = composePeople(
      people({
        memberships: [
          member("a", "Ada", "MEMBER", { canViewDailyUpdates: 1 }),
          member("b", "Bo", "MEMBER", { capabilities: ["View daily updates"] }),
          member("c", "Cy", "MEMBER"),
        ],
      }),
    ).rows;
    expect(rows.map((row) => row.access)).toEqual(["Daily Updates", "Daily Updates", "-"]);
  });

  it("puts Invite in the head, for a manager of a Workspace that is not Read-only only", () => {
    expect(source).toContain("!readOnly && canManage ? (");
    expect(source).toContain("canInvite: !readOnly && canManage");
    const start = source.lastIndexOf("<V2PageHead");
    const head = source.slice(start, source.indexOf("<V2FormDialog", start));
    expect(head).toContain("chip={page.chip}");
    expect(head).toContain("subhead={page.seatCopy}");
    expect(head).toContain('data-testid="v2-people-invite"');
    expect(source).not.toContain("df-refusal-anchor");
  });

  it("finds a name whatever its accents and case", () => {
    const rows = composePeople(people({ filterQuery: "SAI", memberships: [member("a", "Saïd", "MEMBER"), member("b", "Bob", "MEMBER")] })).rows;
    expect(rows.map((row) => row.name)).toEqual([expect.stringContaining("Saïd")]);
  });

  it("writes status and role as plain text in sentence case", () => {
    const rows = composePeople(
      people({
        includeArchived: true,
        memberships: [member("cid", "Cid", "MEMBER", { archived: true }), member("adm", "Ada", "ADMINISTRATOR")],
      }),
    ).rows;
    expect(rows.map((row) => [row.workspaceRole, row.status])).toEqual([
      ["Administrator", "Active"],
      ["Member", "Archived"],
    ]);
    expect(source).not.toContain("df-status");
  });

  it("words the seats and the chip for the reader", () => {
    const m = [member("me", "Sam", "OWNER"), member("pat", "Pat", "MEMBER")];
    const withInvite = composePeople(people({ memberships: m, invitations: [invitation("x")] }));
    expect(withInvite.chip).toBe("2 Members");
    expect(withInvite.seatCopy).toBe("2 of 500 Billable Seats used. 1 Invitation pending.");
    expect(composePeople(people({ memberships: m, invitations: [] })).seatCopy).toBe("2 of 500 Billable Seats used.");
    expect(composePeople(people({ memberships: [m[0]], invitations: [] })).chip).toBe("1 Member");
    // A Member sees no seats, and the seats being unknown leaves no line either.
    expect(composePeople(people({ memberships: m, canManage: false })).seatCopy).toBeNull();
    expect(composePeople(people({ memberships: m, purchasedSeats: null })).seatCopy).toBeNull();
  });

  it("orders the Owner first, then Administrators, Members, Invitations, archived", () => {
    const rows = composePeople(
      people({
        includeArchived: true,
        invitations: [invitation("inv")],
        memberships: [
          member("z", "Zed", "MEMBER"),
          member("arch", "Abe", "MEMBER", { archived: true }),
          member("a", "Ada", "MEMBER"),
          member("adm", "Mel", "ADMINISTRATOR"),
          member("own", "Sam", "OWNER"),
        ],
      }),
    ).rows;
    expect(rows.map((row) => row.userId)).toEqual(["own", "adm", "a", "z", "inv", "arch"]);
  });

  it("shows an Invitation's address once, with who invited under it", () => {
    const [row] = composePeople(people({ invitations: [invitation("inv", { invitedBy: "Sam Lee" })] })).rows;
    expect(row.name).toBe("inv@example.com");
    expect(source).toContain("`Invited by ${row.invitedBy}`");
  });

  it("marks the reader's own row, and keeps hours per day out", () => {
    expect(composePeople(people({ memberships: [member("me", "Sam", "OWNER")] })).rows[0].self).toBe(true);
    expect(source).toContain('className="df-workday-you"');
    expect(source).not.toMatch(/hoursPerDay|Hours per day/);
    expect(v2("people.ts")).not.toContain("hoursPerDay");
  });
});
