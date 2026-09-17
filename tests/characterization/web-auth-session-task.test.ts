import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SESSION_TASK_COMPLETE_PATH,
  SESSION_TASK_KEYS,
  composeSessionTask,
  sessionTaskUrls,
} from "../../client/src/lib/sessionTask";

/**
 * A provider session that is not finished yet (ADR-0007).
 *
 * Clerk may hold a session in `pending` while it asks for one more thing — a
 * new password, a second factor, an Organization. `useAuth()` then reports
 * `isSignedIn: false`, so the app renders its signed-out surface, and Clerk's
 * `<SignIn>` paints nothing because the step is routed away to `taskUrls`.
 * The result was a white page with no way out, found while walking #230.
 *
 * What is frozen here: every task key Clerk can send has a surface, and one it
 * cannot name still states a condition and offers a sign-out. Never nothing.
 */

const here = dirname(fileURLToPath(import.meta.url));

function source(path: string): string {
  return readFileSync(join(here, "../..", path), "utf8");
}

const authSource = source("client/src/pages/AuthPage.tsx");
const sessionSource = source("client/src/components/IdentityProviderSession.tsx");

describe("a pending provider session is never a blank page", () => {
  it("covers every task key Clerk declares", () => {
    // `SessionTask['key']` in @clerk/shared. A key added by an upgrade lands in
    // the unknown branch below rather than painting nothing.
    expect(SESSION_TASK_KEYS).toEqual(["choose-organization", "reset-password", "setup-mfa"]);

    for (const key of SESSION_TASK_KEYS) {
      const page = composeSessionTask({ key });
      expect(page.surface, key).toBe(key);
      expect(page.action, key).toBe("clerk");
      expect(page.title.length, key).toBeGreaterThan(0);
      expect(page.note.length, key).toBeGreaterThan(0);
    }
  });

  it("says whose step it is, and that an Organization is not a Workspace", () => {
    const page = composeSessionTask({ key: "choose-organization" });

    // The confusion this line exists to prevent: a Clerk Organization carries
    // no DocuFlow authority (ADR-0007), and the person is about to be asked to
    // name a Workspace straight afterwards.
    expect(page.note).toMatch(/not a .*Workspace/i);
    expect(page.note).toMatch(/sign-in provider/i);
  });

  it("states a condition and offers a way out for a task it cannot render", () => {
    for (const key of [undefined, null, "", "some-future-task"]) {
      const page = composeSessionTask({ key });
      expect(page.surface, String(key)).toBe("unknown");
      expect(page.action, String(key)).toBe("sign-out");
      expect(page.note, String(key)).not.toMatch(/undefined|null/);
    }
  });

  it("routes every task back to the page that renders it", () => {
    const urls = sessionTaskUrls();

    expect(Object.keys(urls).sort()).toEqual([...SESSION_TASK_KEYS].sort());
    for (const key of SESSION_TASK_KEYS) {
      expect(urls[key], key).toBe("/auth");
    }
    // Before this fix only `choose-organization` was routed, and the page it
    // named had nothing mounted to answer it.
    expect(sessionSource).toContain("sessionTaskUrls()");
    expect(sessionSource).not.toMatch(/taskUrls=\{\{/);
  });

  it("mounts Clerk's own task surfaces rather than building credential steps", () => {
    // ADR-0007: Clerk owns the credential surfaces. A password or a second
    // factor asked for here is still Clerk's screen inside DocuFlow's frame.
    expect(authSource).toMatch(/TaskChooseOrganization/);
    expect(authSource).toMatch(/TaskResetPassword/);
    expect(authSource).toMatch(/TaskSetupMFA/);
    expect(authSource).not.toMatch(/type="password"/);
    expect(authSource).toMatch(/status === "pending"/);
  });

  it("sends a finished task into the app, not back to the door", () => {
    // The session is active from that moment, and `/` is where Flow 1 step 3
    // waits for someone who holds no Workspace yet.
    expect(SESSION_TASK_COMPLETE_PATH).toBe("/");
    expect(authSource).toMatch(/redirectUrlComplete=\{SESSION_TASK_COMPLETE_PATH\}/);
  });
});
