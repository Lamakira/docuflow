/**
 * Which IdentityProvider instance this deployment signs in against (#110).
 *
 * Read from the server at runtime rather than from `import.meta.env`, because
 * one image is built and deployed to every environment (ADR-0018) — a key baked
 * into the bundle would pin every deployment to whichever instance the build
 * machine knew about.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { WebAuthConfig } from "@shared/webAuth";

export type { WebAuthConfig };

const UNAVAILABLE: WebAuthConfig = { publishableKey: null, enabled: false };
const MAX_ATTEMPTS = 8;
const RETRY_MS = 400;

let cached: WebAuthConfig | null = null;
let inflight: Promise<WebAuthConfig> | null = null;

const WebAuthConfigContext = createContext<WebAuthConfig | null>(null);

function hasPublishableKey(value: WebAuthConfig): boolean {
  return typeof value.publishableKey === "string" && value.publishableKey.length > 0;
}

/** Fetched once per successful key. A miss (boot race, HMR) is retried, never sticky. */
export function loadWebAuthConfig(): Promise<WebAuthConfig> {
  if (cached && hasPublishableKey(cached)) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = fetch("/api/auth/config", { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) throw new Error(`auth config ${res.status}`);
      const value = (await res.json()) as WebAuthConfig;
      if (hasPublishableKey(value)) {
        cached = value;
        return value;
      }
      return UNAVAILABLE;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cached = null;
    inflight = null;
  });
}

function useWebAuthConfigState(): WebAuthConfig | null {
  const [webAuth, setWebAuth] = useState<WebAuthConfig | null>(null);

  useEffect(() => {
    let mounted = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const retryOrGiveUp = () => {
      if (attempts < MAX_ATTEMPTS) {
        attempts += 1;
        timer = setTimeout(load, RETRY_MS);
        return;
      }
      if (mounted) setWebAuth(UNAVAILABLE);
    };

    const load = () => {
      loadWebAuthConfig()
        .then((value) => {
          if (!mounted) return;
          if (hasPublishableKey(value)) {
            setWebAuth(value);
            return;
          }
          retryOrGiveUp();
        })
        .catch(() => {
          if (!mounted) return;
          retryOrGiveUp();
        });
    };

    load();

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return webAuth;
}

/** One answer for the whole tree, so Clerk mounts as soon as the key arrives. */
export function WebAuthConfigProvider({ children }: { children: ReactNode }) {
  const webAuth = useWebAuthConfigState();
  return <WebAuthConfigContext.Provider value={webAuth}>{children}</WebAuthConfigContext.Provider>;
}

/** `null` until a key arrives, or until retries are exhausted. Callers wait on null. */
export function useWebAuthConfig(): WebAuthConfig | null {
  return useContext(WebAuthConfigContext);
}
