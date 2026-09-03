/**
 * Which IdentityProvider instance this deployment signs in against (#110).
 *
 * Read from the server at runtime rather than from `import.meta.env`, because
 * one image is built and deployed to every environment (ADR-0018) — a key baked
 * into the bundle would pin every deployment to whichever instance the build
 * machine knew about.
 */

import { useEffect, useState } from "react";
import type { WebAuthConfig } from "@shared/webAuth";

export type { WebAuthConfig };

const UNAVAILABLE: WebAuthConfig = { publishableKey: null, enabled: false };

let pending: Promise<WebAuthConfig> | null = null;

/** Fetched once per page load; the answer cannot change under a running process. */
export function loadWebAuthConfig(): Promise<WebAuthConfig> {
  pending ??= fetch("/api/auth/config")
    .then((res) => (res.ok ? (res.json() as Promise<WebAuthConfig>) : UNAVAILABLE))
    // A server that cannot say how to sign in is one nobody can sign in to; the
    // page renders that rather than a spinner that never resolves.
    .catch(() => UNAVAILABLE);
  return pending;
}

/** `null` until the answer arrives, which is the caller's cue to render nothing yet. */
export function useWebAuthConfig(): WebAuthConfig | null {
  const [webAuth, setWebAuth] = useState<WebAuthConfig | null>(null);

  useEffect(() => {
    let mounted = true;
    loadWebAuthConfig().then((value) => {
      if (mounted) setWebAuth(value);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return webAuth;
}
