import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_PAGE,
  accountProfileAppearance,
  accountProfileSyncPath,
  profileSignature,
} from "../../client/src/v2/account";

const here = dirname(fileURLToPath(import.meta.url));
const css = `\n${readFileSync(join(here, "../../client/src/v2/tokens.css"), "utf8")}`;

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/(--df-[a-z0-9-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const light = block(".df-v2");
const dark = { ...light, ...block(".dark .df-v2") };

function resolve(vars: Record<string, string>, name: string): string {
  let value = vars[name];
  for (let i = 0; i < 5 && value?.startsWith("var("); i++) value = vars[value.slice(4, -1)];
  return value;
}

describe("account profile (#316)", () => {
  it("syncs through the profile route", () => {
    expect(accountProfileSyncPath()).toBe("/api/account/profile/sync");
    expect(ACCOUNT_PAGE.kicker).toBe("ACCOUNT");
  });

  it("signs a Clerk User so a change is visible", () => {
    expect(profileSignature(null)).toBeNull();
    expect(profileSignature(undefined)).toBeNull();
    const base = { firstName: "Ada", lastName: "Lovelace", imageUrl: "https://x/i.png", hasImage: true, primaryEmailAddress: { emailAddress: "a@x.io" } };
    const sig = profileSignature(base);
    expect(sig).toBe(profileSignature({ ...base }));
    expect(profileSignature({ ...base, firstName: "Grace" })).not.toBe(sig);
    expect(profileSignature({ ...base, lastName: "Hopper" })).not.toBe(sig);
    expect(profileSignature({ ...base, imageUrl: "https://x/j.png" })).not.toBe(sig);
    expect(profileSignature({ ...base, primaryEmailAddress: { emailAddress: "b@x.io" } })).not.toBe(sig);
    // The default avatar URL is not a photo the User set.
    expect(profileSignature({ ...base, hasImage: false, imageUrl: "https://x/a" })).toBe(
      profileSignature({ ...base, hasImage: false, imageUrl: "https://x/b" }),
    );
    expect(profileSignature({})).not.toBeNull();
  });

  it.each([
    ["light", light, accountProfileAppearance("light")],
    ["dark", dark, accountProfileAppearance("dark")],
  ] as const)("%s appearance equals the tokens", (_mode, vars, appearance) => {
    const v = appearance.variables as Record<string, string>;
    expect(v.colorBackground).toBe(resolve(vars, "--df-card-white"));
    expect(v.colorForeground).toBe(resolve(vars, "--df-case-ink"));
    expect(v.colorMutedForeground).toBe(resolve(vars, "--df-archive-slate"));
    expect(v.colorPrimary).toBe(resolve(vars, "--df-case-ink"));
    expect(v.colorPrimaryForeground).toBe(resolve(vars, "--df-on-ink"));
    expect(v.colorDanger).toBe(resolve(vars, "--df-destructive"));
    expect(v.colorSuccess).toBe(resolve(vars, "--df-signed-off"));
    expect(v.colorBorder).toBe(resolve(vars, "--df-divider"));
    expect(v.colorInput).toBe(resolve(vars, "--df-card-white"));
    expect(v.colorInputForeground).toBe(resolve(vars, "--df-case-ink"));
    expect(v.colorRing).toBe(resolve(vars, "--df-amber"));
    expect(v.colorNeutral).toBe(resolve(vars, "--df-case-ink"));
    expect(v.colorMuted).toBe(resolve(vars, "--df-cold-stock"));
    expect(v.borderRadius).toBe(resolve(vars, "--df-radius-3"));
    expect(v.fontFamily).toBe("Switzer, system-ui, sans-serif");
    const elements = appearance.elements as Record<string, Record<string, string>>;
    expect(elements.profileSection__danger).toEqual({ display: "none" });
    expect(elements.cardBox.boxShadow).toBe("none");
    expect(elements.cardBox.border).toContain(resolve(vars, "--df-divider"));
  });
});
