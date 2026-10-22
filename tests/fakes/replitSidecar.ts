/**
 * A stand-in for the Replit sidecar's signing endpoint (ADR-0018, #328).
 *
 * In memory, like the other fakes: `ReplitStoragePort` takes it as its `fetch`,
 * so no request leaves the process and the outbound-HTTP guard
 * (`tests/fakes/network.ts`) stays closed. It records every request and answers
 * `{ signed_url }`, or a configured error.
 */

export interface SidecarRequest {
  method: string;
  url: string;
  body: Record<string, unknown>;
}

export interface ReplitSidecarFake {
  fetch: typeof fetch;
  requests: SidecarRequest[];
  /** Answer every later request with this status and body instead of signing. */
  failWith(status: number, body: string): void;
}

export const FAKE_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export function createReplitSidecarFake(): ReplitSidecarFake {
  const requests: SidecarRequest[] = [];
  let failure: { status: number; body: string } | undefined;

  const fakeFetch = (async (input: unknown, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : "";
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    requests.push({ method: init?.method ?? "GET", url: String(input), body });
    if (failure) return new Response(failure.body, { status: failure.status });
    const signed = `https://storage.googleapis.com/${body.bucket_name}/${body.object_name}?X-Sig=fake`;
    return Response.json({ signed_url: signed });
  }) as typeof fetch;

  return {
    fetch: fakeFetch,
    requests,
    failWith(status, body) {
      failure = { status, body };
    },
  };
}
