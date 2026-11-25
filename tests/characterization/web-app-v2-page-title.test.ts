import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pageTitleFor, V2_FOOTER_NAV, V2_NAV } from "../../client/src/v2/presentation";

/** The browser tab says which screen is open, the screen first (2026-11-25). */

const v2 = (name: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2", name), "utf8");

describe("the browser tab's title", () => {
  it("names every destination of the sidebar, each one differently", () => {
    const items = [...V2_NAV.flatMap((section) => section.items), ...V2_FOOTER_NAV];
    const titles = items.map((item) => pageTitleFor(item.href));
    expect(new Set(titles).size).toBe(items.length);
    for (const title of titles) expect(title).toMatch(/^.+ - DocuFlow$/);
    expect(pageTitleFor("/")).toBe("Today - DocuFlow");
    expect(pageTitleFor("/activity")).toBe("Activity - DocuFlow");
    expect(pageTitleFor("/daily-updates")).toBe("Daily Updates - DocuFlow");
  });

  it("puts a section before the page that holds it", () => {
    expect(pageTitleFor("/activity/gallery")).toBe("Gallery - Activity - DocuFlow");
    expect(pageTitleFor("/administration/billing")).toMatch(/ - Administration - DocuFlow$/);
    expect(pageTitleFor("/time/stats")).toMatch(/ - Time Tracking - DocuFlow$/);
  });

  it("puts a record's name first, and its kind while it loads", () => {
    expect(pageTitleFor("/clients/c1")).toBe("Client - Clients - DocuFlow");
    expect(pageTitleFor("/clients/c1", "Acme")).toBe("Acme - Clients - DocuFlow");
    expect(pageTitleFor("/opportunities/o1", "Pier sale")).toBe("Pier sale - Opportunities - DocuFlow");
    expect(pageTitleFor("/projects/p1", "Site")).toBe("Site - Projects - DocuFlow");
    expect(pageTitleFor("/projects/p1/settings", "Site")).toBe("Site - Settings - Projects - DocuFlow");
    expect(pageTitleFor("/document/d1", "Scope", "opportunities")).toBe("Scope - Opportunities - DocuFlow");
    expect(pageTitleFor("/files", "brief.pdf")).toBe("brief.pdf - DocuFlow");
  });

  it("names the platform console's tabs, and an unknown address", () => {
    expect(pageTitleFor("/platform/users")).toBe("Users - Platform - DocuFlow");
    expect(pageTitleFor("/platform/workspaces/w1")).toBe("Workspace - Workspaces - Platform - DocuFlow");
    expect(pageTitleFor("/no-such-page")).toBe("Page not found - DocuFlow");
  });

  it("is set by the Workspace shell, on desktop and mobile, and by the platform console", () => {
    expect(v2("V2Shell.tsx")).toContain("<V2PageTitle />");
    expect(v2("V2PlatformFrame.tsx")).toContain("<V2PageTitle />");
  });
});
