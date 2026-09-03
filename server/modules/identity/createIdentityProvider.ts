import type { IdentityConfig } from "../../config";
import { ClerkIdentityProvider } from "./clerkAdapter";
import {
  UnconfiguredIdentityProvider,
  type IdentityProvider,
  type IdentityProviderConfig,
} from "./identityProvider";

export function createIdentityProvider(config: IdentityProviderConfig): IdentityProvider {
  if (!config.secretKey) return new UnconfiguredIdentityProvider();
  return new ClerkIdentityProvider(config);
}

export function identityProviderFromAppConfig(identity: IdentityConfig): IdentityProvider {
  return createIdentityProvider({
    secretKey: identity.secretKey,
    publishableKey: identity.publishableKey,
  });
}
