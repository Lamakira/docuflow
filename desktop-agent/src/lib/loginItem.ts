/**
 * Launch at system sign-in. Electron's login item API only works on macOS and
 * Windows; on Linux the agent writes an XDG autostart entry itself. Pure: the
 * filesystem and the executable path are injected by main/index.ts.
 */
import nodeFs from "node:fs";
import nodePath from "node:path";

export const LINUX_AUTOSTART_FILE = "docuflow-agent.desktop";

export type LoginItemFs = Pick<typeof nodeFs, "existsSync" | "readFileSync" | "writeFileSync" | "mkdirSync" | "rmSync">;

/** `<XDG_CONFIG_HOME or ~/.config>/autostart/docuflow-agent.desktop`. */
export function linuxAutostartPath(env: Record<string, string | undefined>, homeDir: string): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && nodePath.isAbsolute(xdg) ? xdg : nodePath.join(homeDir, ".config");
  return nodePath.join(base, "autostart", LINUX_AUTOSTART_FILE);
}

/** Desktop Entry spec: quote the argument and escape `"`, backtick, `$` and `\`. */
function quoteExec(execPath: string): string {
  return `"${execPath.replace(/["`$\\]/g, (c) => `\\${c}`)}"`.replace(/%/g, "%%");
}

export function linuxAutostartEntry(execPath: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=DocuFlow Agent",
    `Exec=${quoteExec(execPath)}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

/** On when the entry exists and is not disabled. */
export function readLinuxOpenAtLogin(filePath: string, fs: LoginItemFs = nodeFs): boolean {
  if (!fs.existsSync(filePath)) return false;
  const content = String(fs.readFileSync(filePath, "utf8"));
  return !/^\s*Hidden\s*=\s*true\s*$/mi.test(content)
    && !/^\s*X-GNOME-Autostart-enabled\s*=\s*false\s*$/mi.test(content);
}

export function writeLinuxOpenAtLogin(
  filePath: string,
  enabled: boolean,
  execPath: string,
  fs: LoginItemFs = nodeFs,
): void {
  if (enabled) {
    fs.mkdirSync(nodePath.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, linuxAutostartEntry(execPath), "utf8");
  } else if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

/** First packaged run only: enable once, then never touch the user's choice again. */
export function applyOpenAtLoginDefault(
  store: { getOpenAtLoginDefaulted(): boolean; setOpenAtLoginDefaulted(v: boolean): void },
  setOpenAtLogin: (value: boolean) => void,
): void {
  if (store.getOpenAtLoginDefaulted()) return;
  setOpenAtLogin(true);
  store.setOpenAtLoginDefaulted(true);
}
