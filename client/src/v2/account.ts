import type { ComponentProps } from "react";
import type { UserProfile } from "@clerk/clerk-react";

/** The route that copies the Clerk User's profile onto the DocuFlow User (#316). */
export function accountProfileSyncPath(): string {
  return "/api/account/profile/sync";
}

export const ACCOUNT_PAGE = {
  kicker: "ACCOUNT",
  title: "Your account",
  lead: "Your profile, email, password, second factor and sessions are held by our sign-in provider. Changes to your name, photo or email follow you across DocuFlow.",
};

type ClerkProfileUser = {
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string | null;
  hasImage?: boolean;
  primaryEmailAddress?: { emailAddress: string } | null;
};

/** Changes whenever the Clerk User's name, photo or primary email does. */
export function profileSignature(user: ClerkProfileUser | null | undefined): string | null {
  if (!user) return null;
  return [
    user.firstName ?? "",
    user.lastName ?? "",
    user.hasImage ? (user.imageUrl ?? "") : "",
    user.primaryEmailAddress?.emailAddress ?? "",
  ].join("|");
}

export type AccountThemeMode = "light" | "dark";

type ClerkAppearance = NonNullable<ComponentProps<typeof UserProfile>["appearance"]>;

// Literal values, not var(--df-*): Clerk portals some popovers to <body>, where
// the `.df-v2` tokens do not exist. Each one mirrors tokens.css for its mode.
const PALETTE: Record<
  AccountThemeMode,
  { card: string; ink: string; slate: string; onInk: string; danger: string; success: string; divider: string; stock: string }
> = {
  light: { card: "#ffffff", ink: "#0f1524", slate: "#59657a", onInk: "#ffffff", danger: "#95232a", success: "#1f9d6b", divider: "#d8dee6", stock: "#f3f5f7" },
  dark: { card: "#161d30", ink: "#e8ecf2", slate: "#9aa6b8", onInk: "#0f1524", danger: "#e0676e", success: "#4cc393", divider: "#2a3348", stock: "#0f1524" },
};

/** `.df-btn.bg-primary`: amber 500 over amber 600, ink text. */
const PRIMARY_ACTION = { fill: "#e9a23b", edge: "#d8912f", ink: "#0f1524" };

const UI_FONT ="Switzer, system-ui, sans-serif";

export function accountProfileAppearance(mode: AccountThemeMode): ClerkAppearance {
  const c = PALETTE[mode];
  return {
    variables: {
      colorBackground: c.card,
      colorForeground: c.ink,
      colorMutedForeground: c.slate,
      colorPrimary: c.ink,
      colorPrimaryForeground: c.onInk,
      colorDanger: c.danger,
      colorSuccess: c.success,
      colorBorder: c.divider,
      colorInput: c.card,
      colorInputForeground: c.ink,
      colorRing: "#e9a23b",
      colorNeutral: c.ink,
      colorMuted: c.stock,
      fontFamily: UI_FONT,
      fontFamilyButtons: UI_FONT,
      borderRadius: "8px",
    },
    elements: {
      rootBox: { width: "100%", maxWidth: "100%" },
      cardBox: { width: "100%", maxWidth: "100%", boxShadow: "none", border: `1px solid ${c.divider}` },
      // The page's primary action wears the v2 amber fill with ink, in both modes.
      formButtonPrimary: {
        backgroundColor: PRIMARY_ACTION.fill,
        borderColor: PRIMARY_ACTION.edge,
        color: PRIMARY_ACTION.ink,
        boxShadow: "none",
        "&:hover, &:active": { backgroundColor: PRIMARY_ACTION.edge },
      },
      // Account deletion is DocuFlow's own flow (ADR-0015), below the profile.
      profileSection__danger: { display: "none" },
    },
  };
}
