/**
 * The browser's half of the Clerk cutover (#110, ADR-0007).
 *
 * The server reads an `Authorization: Bearer <provider session>` header on
 * `/api/*` instead of a cookie it minted itself. The SPA reaches the API from
 * dozens of call sites — `apiRequest`, react-query, and plain `fetch` in pages
 * and components — so the header is attached once, here, rather than threaded
 * through every one of them.
 *
 * Two rules keep that from being a blunt instrument:
 *  - Only same-origin `/api/` requests are touched. Object-storage uploads go to
 *    signed URLs on another origin, where an extra `Authorization` header both
 *    breaks the signature and hands the token to a third party.
 *  - A caller that set its own `Authorization` header keeps it.
 */

type TokenProvider = () => Promise<string | null>;

let provideToken: TokenProvider = async () => null;
let installed = false;

/**
 * Point the interceptor at Clerk's session. Called from inside `ClerkProvider`,
 * so until Clerk has loaded there is simply no token and the API answers as it
 * does for anyone signed out.
 */
export function setIdentityTokenProvider(provider: TokenProvider): void {
  provideToken = provider;
}

type SignOut = () => Promise<void>;

/**
 * Ending the session is the provider's job — `POST /api/auth/logout` only ever
 * reached the cookie session, which a Clerk sign-in never created. Registered
 * the same way the token is, so a sign-out button does not have to be inside
 * `ClerkProvider` (a deployment with no key never mounts one).
 */
let signOutOfProvider: SignOut = async () => {};

export function setIdentitySignOut(signOut: SignOut): void {
  signOutOfProvider = signOut;
}

export function signOutOfIdentityProvider(): Promise<void> {
  return signOutOfProvider();
}

function isDocuFlowApi(input: RequestInfo | URL): boolean {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

function alreadyAuthorized(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (new Headers(init?.headers).has("Authorization")) return true;
  return input instanceof Request && input.headers.has("Authorization");
}

/**
 * Wrap `window.fetch` once, at startup. Idempotent, so a hot reload does not
 * stack wrappers on top of each other.
 */
export function installIdentitySessionHeader(): void {
  if (installed) return;
  installed = true;

  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isDocuFlowApi(input) || alreadyAuthorized(input, init)) {
      return original(input, init);
    }
    const token = await provideToken();
    if (!token) return original(input, init);

    // A `Request` carries its own headers; anything else takes them from init.
    // `new Request(input, init)` is how `fetch` itself applies init over a
    // Request, so init is merged here rather than passed on a second time.
    if (input instanceof Request) {
      const headers = new Headers(init?.headers ?? input.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return original(new Request(input, { ...init, headers }));
    }
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return original(input, { ...init, headers });
  };
}
