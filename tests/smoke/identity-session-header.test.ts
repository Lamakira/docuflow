/**
 * The browser half of the Clerk session (#110, ADR-0007): `/api/*` must leave
 * with `Authorization: Bearer <provider session>`.
 *
 * The interceptor and the component that feeds it are different importers of
 * `identitySession`, and a bundler can hand the same file out twice — Vite's
 * dev server does, when one importer's specifier is rewritten with the
 * dependency-version query and the other's is not. A `let` at module scope is
 * then two variables: `main.tsx` wraps `fetch` in one copy, the token provider
 * lands on the other, every call goes out unauthenticated, and the SPA never
 * becomes a DocuFlow User even though Clerk signed in. `vi.resetModules()`
 * reproduces exactly that split.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MODULE = "../../client/src/lib/identitySession";

type Sent = { url: string; authorization: string | null };

function installFakeWindow(sent: Sent[]): void {
  (globalThis as any).window = {
    location: { origin: "https://docuflow.test" },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      sent.push({ url, authorization: headers.get("Authorization") });
      return new Response("null", { status: 200 });
    },
  };
}

beforeEach(() => {
  delete (globalThis as any).__docuflowIdentitySession__;
  vi.resetModules();
});

afterEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).__docuflowIdentitySession__;
});

describe("identity session header", () => {
  it("carries the provider token on /api/ calls", async () => {
    const sent: Sent[] = [];
    installFakeWindow(sent);

    const identity = await import(MODULE);
    identity.installIdentitySessionHeader();
    identity.setIdentityTokenProvider(async () => "session-token");

    await (globalThis as any).window.fetch("/api/auth/user");

    expect(sent).toEqual([
      { url: "/api/auth/user", authorization: "Bearer session-token" },
    ]);
  });

  it("carries it when the wrapper and the provider come from different module instances", async () => {
    const sent: Sent[] = [];
    installFakeWindow(sent);

    // What `main.tsx` does.
    const wrapperCopy = await import(MODULE);
    wrapperCopy.installIdentitySessionHeader();

    // What `IdentityProviderSession` does — from a second instance of the
    // same file, which is what the duplicate module id produces.
    vi.resetModules();
    const providerCopy = await import(MODULE);
    expect(providerCopy).not.toBe(wrapperCopy);
    providerCopy.setIdentityTokenProvider(async () => "session-token");

    await (globalThis as any).window.fetch("/api/auth/user");

    expect(sent).toEqual([
      { url: "/api/auth/user", authorization: "Bearer session-token" },
    ]);
  });

  it("leaves the public boot config and other origins alone", async () => {
    const sent: Sent[] = [];
    installFakeWindow(sent);

    const identity = await import(MODULE);
    identity.installIdentitySessionHeader();
    identity.setIdentityTokenProvider(async () => "session-token");

    await (globalThis as any).window.fetch("/api/auth/config");
    await (globalThis as any).window.fetch("https://storage.example/signed-upload");

    expect(sent.map((s) => s.authorization)).toEqual([null, null]);
  });

  it("signs out through whichever instance registered the provider's sign-out", async () => {
    const sent: Sent[] = [];
    installFakeWindow(sent);

    const registrar = await import(MODULE);
    let signedOut = false;
    registrar.setIdentitySignOut(async () => {
      signedOut = true;
    });

    vi.resetModules();
    const caller = await import(MODULE);
    await caller.signOutOfIdentityProvider();

    expect(signedOut).toBe(true);
  });
});
