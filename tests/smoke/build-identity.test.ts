import { describe, expect, it } from "vitest";

/**
 * Build identity on `/health` (#229, Defect D).
 *
 * A server left running from an earlier commit answered `/health` with
 * `200 {"status":"ok"}` exactly like a fresh one, and its missing routes
 * presented as the Vite catch-all — which reads as "no such route", not as
 * "you are talking to the wrong build". `/health` reported liveness and
 * nothing about identity. These tests pin the identity.
 */

describe("build identity", () => {
  it("reads the commit from the environment when the build injected one", async () => {
    const { resolveBuildIdentity } = await import("../../server/buildInfo");

    const identity = resolveBuildIdentity({
      env: { DOCUFLOW_COMMIT: "abc1234" },
      readGitHead: () => "should not be consulted",
    });

    expect(identity.commit).toBe("abc1234");
    expect(identity.source).toBe("env");
  });

  it("falls back to the checked-out git HEAD in development", async () => {
    const { resolveBuildIdentity } = await import("../../server/buildInfo");

    const identity = resolveBuildIdentity({
      env: {},
      readGitHead: () => "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });

    expect(identity.commit).toBe("deadbeef");
    expect(identity.source).toBe("git");
  });

  it("says so rather than guessing when neither is available", async () => {
    const { resolveBuildIdentity } = await import("../../server/buildInfo");

    const identity = resolveBuildIdentity({ env: {}, readGitHead: () => null });

    expect(identity.commit).toBe("unknown");
    expect(identity.source).toBe("unknown");
  });

  it("treats a blank environment value as absent", async () => {
    const { resolveBuildIdentity } = await import("../../server/buildInfo");

    const identity = resolveBuildIdentity({
      env: { DOCUFLOW_COMMIT: "   " },
      readGitHead: () => "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });

    expect(identity.source).toBe("git");
  });
});
