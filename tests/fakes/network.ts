/**
 * Outbound-HTTP guard (ADR-0018).
 *
 * One provider boundary is still crossed with a raw `fetch` rather than an SDK,
 * so aliasing a package cannot cover it: the signed storage URL itself, which
 * `server/agentRoutes.ts` PUTs to when it relays a desktop-agent screenshot —
 * the one upload the server performs itself instead of handing the URL to the
 * client.
 *
 * `installNetworkFake()` answers that PUT from memory, into the same in-memory
 * bucket `tests/fakes/gcs.ts` serves from, and makes every *other* fetch throw,
 * so a suite can never quietly reach a real service. Postgres and supertest do
 * not use `fetch`, so nothing legitimate is blocked.
 */

import { FAKE_STORAGE_ORIGIN, putObject } from "./gcs";

export function installNetworkFake(): void {
  globalThis.fetch = (async (
    input: unknown,
    init?: { method?: string; body?: unknown; headers?: Record<string, string> }
  ) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);

    // A PUT the server makes itself: the desktop agent uploads screenshot bytes
    // to the app, which compresses them and relays them to storage. Store the
    // body so the object exists for whoever reads it back.
    if (url.startsWith(`${FAKE_STORAGE_ORIGIN}/`) && init?.method === "PUT") {
      const objectPath = new URL(url).pathname.slice(1);
      const body = init.body;
      putObject(objectPath, Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? "")), {
        contentType: init.headers?.["Content-Type"] ?? "application/octet-stream",
      });
      return new Response(null, { status: 200 });
    }

    throw new Error(
      `Blocked outbound request to ${url}. Tests must not reach real services (ADR-0018); ` +
        `add a fake at the provider boundary instead.`
    );
  }) as typeof fetch;
}
