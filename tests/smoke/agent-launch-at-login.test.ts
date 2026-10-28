import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyOpenAtLoginDefault,
  linuxAutostartEntry,
  linuxAutostartPath,
  readLinuxOpenAtLogin,
  writeLinuxOpenAtLogin,
} from "../../desktop-agent/src/lib/loginItem";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "docuflow-login-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("linuxAutostartPath", () => {
  it("uses XDG_CONFIG_HOME when set", () => {
    expect(linuxAutostartPath({ XDG_CONFIG_HOME: "/x/cfg" }, "/home/u")).toBe("/x/cfg/autostart/docuflow-agent.desktop");
  });
  it("falls back to ~/.config", () => {
    expect(linuxAutostartPath({}, "/home/u")).toBe("/home/u/.config/autostart/docuflow-agent.desktop");
  });
});

describe("linux open at login", () => {
  it("enable writes a parseable entry with a quoted Exec, read is true", () => {
    const file = linuxAutostartPath({ XDG_CONFIG_HOME: dir }, "/unused");
    const exec = "/opt/Docu Flow/agent \"x\" $HOME.AppImage";
    writeLinuxOpenAtLogin(file, true, exec);
    const text = fs.readFileSync(file, "utf8");
    expect(text.startsWith("[Desktop Entry]\n")).toBe(true);
    expect(text).toContain("Type=Application");
    expect(text).toContain("Name=DocuFlow Agent");
    expect(text).toContain("Terminal=false");
    expect(text).toContain("X-GNOME-Autostart-enabled=true");
    expect(text).toContain('Exec="/opt/Docu Flow/agent \\"x\\" \\$HOME.AppImage"');
    expect(linuxAutostartEntry("/a b/c")).toContain('Exec="/a b/c"');
    expect(readLinuxOpenAtLogin(file)).toBe(true);
  });

  it("disable removes the file and read is false", () => {
    const file = linuxAutostartPath({ XDG_CONFIG_HOME: dir }, "/unused");
    writeLinuxOpenAtLogin(file, true, "/bin/agent");
    writeLinuxOpenAtLogin(file, false, "/bin/agent");
    expect(fs.existsSync(file)).toBe(false);
    expect(readLinuxOpenAtLogin(file)).toBe(false);
    expect(() => writeLinuxOpenAtLogin(file, false, "/bin/agent")).not.toThrow();
  });

  it("reads false for a Hidden=true or disabled entry", () => {
    const file = path.join(dir, "a.desktop");
    fs.writeFileSync(file, "[Desktop Entry]\nType=Application\nHidden=true\n");
    expect(readLinuxOpenAtLogin(file)).toBe(false);
    fs.writeFileSync(file, "[Desktop Entry]\nX-GNOME-Autostart-enabled=false\n");
    expect(readLinuxOpenAtLogin(file)).toBe(false);
  });
});

describe("applyOpenAtLoginDefault", () => {
  it("enables once and never again after the user turned it off", () => {
    let defaulted = false;
    let enabled = false;
    const store = { getOpenAtLoginDefaulted: () => defaulted, setOpenAtLoginDefaulted: (v: boolean) => { defaulted = v; } };
    const set = (v: boolean) => { enabled = v; };
    applyOpenAtLoginDefault(store, set);
    expect(enabled).toBe(true);
    enabled = false; // user turned it off
    applyOpenAtLoginDefault(store, set);
    expect(enabled).toBe(false);
  });
});
