/**
 * Outbound-HTTP guard and Replit-sidecar fake (ADR-0018).
 *
 * Two provider boundaries are reached with a raw `fetch` rather than an SDK, so
 * aliasing a package cannot cover them:
 *
 *   - the Replit object-storage sidecar on 127.0.0.1:1106, which mints the signed
 *     upload/download URLs that `server/objectStorage.ts` hands to clients;
 *   - the Replit connectors API, from which `server/email.ts` fetches Resend
 *     credentials before every send.
 *
 * `installNetworkFake()` answers both from memory and makes every *other* fetch
 * throw, so a suite can never quietly reach a real service. Postgres and supertest
 * do not use `fetch`, so nothing legitimate is blocked.
 */

/** Stable prefix for signed URLs, so upload-URL assertions do not depend on a signature. */
export const FAKE_SIGNED_URL_PREFIX = "https://storage.googleapis.com";

export const FAKE_RESEND_API_KEY = "fake-resend-api-key";
export const FAKE_RESEND_FROM_EMAIL = "DocuFlow <noreply@docuflow.test>";

const SIDECAR_ORIGIN = "http://127.0.0.1:1106";

export interface SignedUrlRequest {
  bucket_name: string;
  object_name: string;
  method: string;
  expires_at: string;
}

const signedUrlRequests: SignedUrlRequest[] = [];

export function installNetworkFake(): void {
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);

    if (url === `${SIDECAR_ORIGIN}/object-storage/signed-object-url`) {
      const request = JSON.parse(String(init?.body ?? "{}")) as SignedUrlRequest;
      signedUrlRequests.push(request);
      const signed =
        `${FAKE_SIGNED_URL_PREFIX}/${request.bucket_name}/${request.object_name}` +
        `?fake-signature=${request.method}`;
      return jsonResponse({ signed_url: signed });
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
