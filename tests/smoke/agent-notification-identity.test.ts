import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const pkg = JSON.parse(readFileSync(path.join(root, "desktop-agent/package.json"), "utf8"));
const main = readFileSync(path.join(root, "desktop-agent/src/main/index.ts"), "utf8");

describe("Desktop agent notifications carry the DocuFlow identity", () => {
  it("names the installed .desktop file on Linux, so GNOME shows its name and icon", () => {
    // electron-builder installs <linux.executableName>.desktop; Electron otherwise
    // guesses docuflow-desktop-agent.desktop, which does not exist.
    expect(pkg.desktopName).toBe(`${pkg.build.linux.executableName}.desktop`);
  });

  it("keeps the package name, which locates the userData folder of every installed agent", () => {
    expect(pkg.name).toBe("docuflow-desktop-agent");
    expect(pkg.productName).toBeUndefined();
    expect(main).not.toMatch(/app\.setName\(/);
  });

  it("sets the Windows AppUserModelID to the installer's appId", () => {
    expect(main).toContain(`const APP_USER_MODEL_ID = "${pkg.build.appId}";`);
    expect(main).toMatch(/if \(process\.platform === "win32"\) \{\s*app\.setAppUserModelId\(APP_USER_MODEL_ID\);/);
  });

  it("gives every reminder notification the app icon", () => {
    const notifications = main.match(/new Notification\(\{[\s\S]*?\}\)/g) ?? [];
    expect(notifications.length).toBeGreaterThanOrEqual(2);
    for (const block of notifications) expect(block).toContain("icon: appIconPath()");
  });
});
