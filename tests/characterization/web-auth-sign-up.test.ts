import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  composeRegistration,
  registrationPath,
  SIGN_IN_PATH,
  SIGN_UP_PATH,
} from "../../client/src/lib/registration";

/**
 * The sign-up surface (#230, Flow 1 steps 1–2; ADR-0007).
 * Seams: `registration.ts` composition, and the source of the two signed-out
 * pages plus the router that reaches them. HTTP is characterized in
 * `self-service-registration.test.ts`.
 *
 * The rule the source assertions exist for: DocuFlow provides the frame and the
 * brand, Clerk provides the fields. A credential input appearing on this side
 * is the failure this suite is here to catch.
 */

const here = dirname(fileURLToPath(import.meta.url));

function source(path: string): string {
  return readFileSync(join(here, "../..", path), "utf8");
}

const authSource = source("client/src/pages/AuthPage.tsx");
const appSource = source("client/src/App.tsx");
const sessionSource = source("client/src/components/IdentityProviderSession.tsx");

describe("the sign-up surface is Clerk's (#230, Flow 1 step 1)", () => {
  it("shows Clerk's sign-up instead of hiding the link #110 closed", () => {
    expect(authSource).toMatch(/<SignUp\b/);
    expect(authSource).toMatch(/signUpUrl=\{SIGN_UP_PATH\}/);
    // The closure itself: a footer link painted out so nobody could reach a
    // dead end. #217 removed the dead end, so the paint comes off.
    expect(authSource).not.toMatch(/footerAction:\s*\{\s*display:\s*"none"/);
  });

  it("adds no DocuFlow credential field anywhere on the signed-out surface", () => {
    for (const [name, text] of [
      ["AuthPage", authSource],
      ["App", appSource],
    ] as const) {
      expect(text, name).not.toMatch(/type="password"/);
      expect(text, name).not.toMatch(/name="password"/);
      expect(text, name).not.toMatch(/strength|passwordStrength/i);
    }
  });

  it("routes the signed-out visitor to sign-up and back to sign-in", () => {
    expect(SIGN_IN_PATH).toBe("/auth");
    expect(SIGN_UP_PATH).toBe("/sign-up");
    expect(appSource).toMatch(/function SignedOutSwitch[\s\S]*?path=\{SIGN_UP_PATH\}/);
    // The marketing site's call-to-action spelling, so a link that lands on
    // `/signup` is not a 404 the visitor has to read (#231).
    expect(appSource).toMatch(/function SignedOutSwitch[\s\S]*?path="\/signup"/);
    expect(authSource).toMatch(/signInUrl=\{SIGN_IN_PATH\}/);
  });

  it("sends a new account to the app, where Flow 1 step 3 is waiting", () => {
    expect(sessionSource).toMatch(/signUpFallbackRedirectUrl="\/"/);
    // The fallback, never the force: a sign-up carrying its own destination —
    // an Invitation's above all — has to keep it (Flow 6, step 4).
    expect(sessionSource).not.toMatch(/signUpForceRedirectUrl/);
  });
});

describe("the return from Clerk is a step, not a dead end (#230, Flow 1 step 2)", () => {
  it("asks the DocuFlow BFF for its own User", () => {
    expect(registrationPath()).toBe("/api/auth/user");
    expect(authSource).toContain("registrationPath");
  });

  it("states what is happening while it registers, and offers nothing to decide", () => {
    const page = composeRegistration({ status: "registering" });

    expect(page.title).toBe("Setting up your account");
    expect(page.action).toBe("none");
    expect(page.copy).toMatch(/moment|Workspace/i);
  });

  it("says an address held by another account is that, and offers the way out", () => {
    const page = composeRegistration({
      status: "failed",
      message: "That email address is already linked to a different account",
    });

    expect(page.action).toBe("sign-out");
    expect(page.copy).toMatch(/already linked to a different account/);
    // Never blamed on the person, and never a bare "try again".
    expect(page.title).not.toMatch(/error|failed/i);
  });

  it("falls back to a stated condition when the reason is not known", () => {
    const page = composeRegistration({ status: "failed" });

    expect(page.action).toBe("sign-out");
    expect(page.copy.length).toBeGreaterThan(0);
    expect(page.copy).not.toMatch(/undefined/);
  });

  it("still lets an Invitation be accepted before any of this runs", () => {
    // Flow 6 step 4: the invitee reaching the app through their link accepts a
    // Membership, and never passes through Workspace creation.
    expect(appSource).toMatch(/isInvitationPath\(location\)[\s\S]{0,80}V2InvitationAcceptPage/);
  });
});
