import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { base64url, decodeSegment, headerOf, signJwt } from "../helpers/jwt";
import { parseSigningKey } from "../../server/signingKeys";

/**
 * The desktop agent's access-token signing keys, exercised the way a deployment
 * meets them: every case loads `server/desktopTokens.ts` against an environment,
 * and a **restart is that module loaded again** — a second process, or a second
 * replica, reading the same variables. Tokens minted by one load and presented
 * to the next are therefore tokens crossing a process boundary, which is the
 * whole property the keys exist to provide.
 *
 * The module's only dependency is `server/config.ts`, so nothing here touches
 * the database or the app. The rest of the environment stays as `tests/setup.ts`
 * fixed it; only the two key variables move.
 *
 * The HTTP-seam behavior these keys sit under — what a client sees when a token
 * is missing, expired, or unsigned — is frozen in
 * `tests/characterization/agent-auth.test.ts`.
 */

const DEVICE_ID = "0d4d1a3a-b5f4-4a0e-9f8f-0b4a6c8d9e10";
const USER_ID = "9f2c7b61-2b7e-4f30-9d2a-1c3b5e7f8a90";

/** ADR-0018: invented values. Ids are dates because a rotation is an event. */
const IN_USE = "2026-08:the-signing-secret-currently-in-use";
const TAKING_OVER = "2026-11:the-signing-secret-that-is-taking-over";
/** The incoming key's id over somebody else's secret. */
const IMPOSTOR = "2026-11:a-secret-this-deployment-never-had";

let saved: { current?: string; previous?: string };

beforeEach(() => {
  saved = { current: process.env.JWT_SECRET, previous: process.env.JWT_PREVIOUS_SECRET };
});

afterEach(() => {
  setKeys({ current: saved.current, previous: saved.previous });
  // Leave the registry holding the harness's own configuration, not a case's.
  vi.resetModules();
});

function setKeys(keys: { current?: string; previous?: string }): void {
  if (keys.current === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = keys.current;

  if (keys.previous === undefined) delete process.env.JWT_PREVIOUS_SECRET;
  else process.env.JWT_PREVIOUS_SECRET = keys.previous;
}

/** Boot the token module against a set of keys — one process's worth of state. */
async function boot(keys: { current: string; previous?: string }) {
  setKeys(keys);
  vi.resetModules();
  return import("../../server/desktopTokens");
}

/** The secret half of a written key, split by the server's own rules. */
const secretOf = (key: string) => parseSigningKey("JWT_SECRET", key).secret;

describe("desktop access tokens — surviving the process", () => {
  it("verifies a token the running process never issued, because the key outlived the last one", async () => {
    const before = await boot({ current: IN_USE });
    const { accessToken, expiresAt } = before.issueAccessToken(DEVICE_ID, USER_ID);

    const after = await boot({ current: IN_USE });

    expect(after.verifyAccessToken(accessToken)).toEqual({
      deviceId: DEVICE_ID,
      userId: USER_ID,
      expiresAt: Math.floor(expiresAt.getTime() / 1000),
    });
  });

  it("stamps every token with the id of the key that signed it", async () => {
    const { issueAccessToken } = await boot({ current: IN_USE });

    expect(headerOf(issueAccessToken(DEVICE_ID, USER_ID).accessToken)).toEqual({
      alg: "HS256",
      typ: "JWT",
      kid: "2026-08",
    });
  });

  it("refuses a token naming a key this deployment does not hold", async () => {
    const elsewhere = (await boot({ current: TAKING_OVER })).issueAccessToken(DEVICE_ID, USER_ID);

    const here = await boot({ current: IN_USE });

    expect(here.verifyAccessToken(elsewhere.accessToken)).toBeNull();
  });

  it("refuses a token whose key id it knows but whose signature it cannot make", async () => {
    const forged = (await boot({ current: IMPOSTOR })).issueAccessToken(DEVICE_ID, USER_ID);
    expect(headerOf(forged.accessToken).kid).toBe("2026-11");

    // Same id, different secret: the id is a label, never the credential.
    const here = await boot({ current: TAKING_OVER });

    expect(here.verifyAccessToken(forged.accessToken)).toBeNull();
  });

  it("refuses a token whose claims were edited after it was signed", async () => {
    const { issueAccessToken, verifyAccessToken } = await boot({ current: IN_USE });
    const [header, payload, signature] = issueAccessToken(DEVICE_ID, USER_ID).accessToken.split(".");

    const escalated = base64url(
      JSON.stringify({ ...decodeSegment(payload), sub: "someone-elses-device" })
    );

    expect(verifyAccessToken(`${header}.${escalated}.${signature}`)).toBeNull();
  });

  it("refuses anything that is not three signed segments", async () => {
    const { verifyAccessToken } = await boot({ current: IN_USE });

    expect(verifyAccessToken("")).toBeNull();
    expect(verifyAccessToken("one-segment")).toBeNull();
    expect(verifyAccessToken("two.segments")).toBeNull();
    expect(verifyAccessToken("far.too.many.segments")).toBeNull();
  });
});

describe("desktop access tokens — rotation", () => {
  it("keeps the outgoing key's tokens valid while issuing under the incoming one", async () => {
    const outgoing = (await boot({ current: IN_USE })).issueAccessToken(DEVICE_ID, USER_ID);

    // Step one of the rotation: the new key becomes current, the old one demoted.
    const rotating = await boot({ current: TAKING_OVER, previous: IN_USE });

    expect(rotating.verifyAccessToken(outgoing.accessToken)).toMatchObject({
      deviceId: DEVICE_ID,
      userId: USER_ID,
    });

    const issued = rotating.issueAccessToken(DEVICE_ID, USER_ID);
    expect(headerOf(issued.accessToken).kid).toBe("2026-11");
    expect(rotating.verifyAccessToken(issued.accessToken)).toMatchObject({ deviceId: DEVICE_ID });
  });

  it("stops honouring the outgoing key once it is retired from the environment", async () => {
    const outgoing = (await boot({ current: IN_USE })).issueAccessToken(DEVICE_ID, USER_ID);

    // Step two, taken after the last token signed with it has expired.
    const rotated = await boot({ current: TAKING_OVER });

    expect(rotated.verifyAccessToken(outgoing.accessToken)).toBeNull();
  });

  it("accepts a token from before the keys were versioned, which carries no id at all", async () => {
    // Shaped exactly like what the server emitted before this change: the same
    // claims under a header naming no key. It has to keep working across the
    // deploy that starts naming them, or every signed-in agent is logged out at
    // once; it then ages out on its own within a token lifetime. This case goes
    // when the branch does — the follow-up under B1 in
    // docs/RELEASE_CANDIDATE_CHECKLIST.md.
    const now = Math.floor(Date.now() / 1000);
    const legacy = signJwt(
      secretOf(IN_USE),
      { alg: "HS256", typ: "JWT" },
      { sub: DEVICE_ID, uid: USER_ID, iat: now, exp: now + 3600 }
    );

    const upgraded = await boot({ current: TAKING_OVER, previous: IN_USE });

    expect(upgraded.verifyAccessToken(legacy)).toMatchObject({
      deviceId: DEVICE_ID,
      userId: USER_ID,
    });
  });
});
