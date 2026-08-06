/**
 * Outbound-HTTP guard and Replit-sidecar fake (ADR-0018).
 *
 * Three provider boundaries are reached with a raw `fetch` rather than an SDK, so
 * aliasing a package cannot cover them:
 *
 *   - the Replit object-storage sidecar on 127.0.0.1:1106, which mints the signed
 *     upload/download URLs that `server/objectStorage.ts` hands to clients;
 *   - the Replit connectors API, from which `server/email.ts` fetches Resend
 *     credentials before every send;
 *   - the signed storage URL itself, which `server/agentRoutes.ts` PUTs to when it
 *     relays a desktop-agent screenshot — the one upload the server performs
 *     itself instead of handing the URL to the client.
 *
 * `installNetworkFake()` answers all three from memory and makes every *other*
 * fetch throw, so a suite can never quietly reach a real service. Postgres and
 * supertest do not use `fetch`, so nothing legitimate is blocked.
 */

import { putObject } from "./gcs";

/** Storage origin every minted URL sits under, so no suite hard-codes a host. */
export const FAKE_STORAGE_ORIGIN = "https://storage.googleapis.com";

const FAKE_RESEND_API_KEY = "fake-resend-api-key";
const FAKE_RESEND_FROM_EMAIL = "DocuFlow <noreply@docuflow.test>";

/** The exact URL this fake mints for `<bucket>/<object name>`. */
export function fakeSignedUrl(objectPath: string, method = "PUT"): string {
  return `${FAKE_STORAGE_ORIGIN}/${objectPath}?fake-signature=${method}`;
}

/**
 * Matcher for a minted URL whose object name is only known by shape.
 * `objectPattern` is regex source, matched against `<bucket>/<object name>`.
 */
export function signedUrlPattern(objectPattern: string, method = "PUT"): RegExp {
  const prefix = FAKE_STORAGE_ORIGIN.replace(/[.]/g, "\\.");
  return new RegExp(`^${prefix}/${objectPattern}\\?fake-signature=${method}$`);
}

const SIDECAR_ORIGIN = "http://127.0.0.1:1106";

export interface SignedUrlRequest {
  bucket_name: string;
  object_name: string;
  method: string;
  expires_at: string;
}

const signedUrlRequests: SignedUrlRequest[] = [];

export function installNetworkFake(): void {
  globalThis.fetch = (async (
    input: unknown,
    init?: { method?: string; body?: unknown; headers?: Record<string, string> }
  ) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);

    if (url === `${SIDECAR_ORIGIN}/object-storage/signed-object-url`) {
      const request = JSON.parse(String(init?.body ?? "{}")) as SignedUrlRequest;
      signedUrlRequests.push(request);
      const signed = fakeSignedUrl(`${request.bucket_name}/${request.object_name}`, request.method);
      return jsonResponse({ signed_url: signed });
    }

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

    if (url.includes("/api/v2/connection") && url.includes("connector_names=resend")) {
      return jsonResponse({
        items: [
          { settings: { api_key: FAKE_RESEND_API_KEY, from_email: FAKE_RESEND_FROM_EMAIL } },
        ],
      });
    }

    throw new Error(
      `Blocked outbound request to ${url}. Tests must not reach real services (ADR-0018); ` +
        `add a fake at the provider boundary instead.`
    );
  }) as typeof fetch;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Test control surface ───

/** Every signed-URL request the server sent to the sidecar, in call order. */
export function signedUrlCalls(): SignedUrlRequest[] {
  return signedUrlRequests;
}

export function resetNetworkFake(): void {
  signedUrlRequests.length = 0;
}
