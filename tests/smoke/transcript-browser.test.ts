import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * How `server/browser-transcript.ts` finds a browser (#37).
 *
 * The scraper used to hold an absolute `/nix` store path as a constant: it named
 * one Replit machine's Chromium, so `chromium.launch()` threw on every other
 * host — a developer's, CI's, the image's — before it reached a single page. The
 * launch options are exported for exactly this reason. They are the whole
 * decision, and they are checkable without a browser: `playwright` is aliased to
 * a fake that throws on `launch()` (ADR-0018), so nothing here starts one.
 *
 * What is *not* checked here is that a browser exists to be found — that is the
 * image's half, and `.github/workflows/ci.yml` opens a page inside the built
 * image to answer it.
 */

/** Every `.ts` under `server/`, which is the tree the ban below applies to. */
function serverSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return serverSources(path);
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}

const SERVER_DIR = join(import.meta.dirname, "..", "..", "server");

async function launchOptions(chromiumPath?: string) {
  if (chromiumPath === undefined) delete process.env.PLAYWRIGHT_CHROMIUM_PATH;
  else process.env.PLAYWRIGHT_CHROMIUM_PATH = chromiumPath;

  // Both modules again: the options read `server/config.ts`, which resolves the
  // environment once at import — the same sequence a boot performs.
  vi.resetModules();
  const { browserLaunchOptions } = await import("../../server/browser-transcript");
  return browserLaunchOptions();
}

describe("the transcript scraper's browser", () => {
  afterEach(() => {
    delete process.env.PLAYWRIGHT_CHROMIUM_PATH;
    vi.resetModules();
  });

  it("names no executable, so Playwright opens the one it installed", async () => {
    const options = await launchOptions();

    // Absent rather than empty: `chromium.launch()` given no `executablePath`
    // resolves its own build, wherever `playwright install chromium` put it.
    expect(options.executablePath).toBeUndefined();
    expect(options.headless).toBe(true);
  });

  it("opens the browser a host names for itself", async () => {
    // Any executable this machine certainly has; the fake never launches it.
    const options = await launchOptions(process.execPath);

    expect(options.executablePath).toBe(process.execPath);
  });

  it("keeps the two flags a container needs, and says so by keeping them", async () => {
    const options = await launchOptions();

    // /dev/shm is 64 MB in a default container, which a large page exhausts.
    expect(options.args).toContain("--disable-dev-shm-usage");
    expect(options.args).toContain("--disable-gpu");
    // Playwright's default, written out: Chromium's namespace sandbox needs
    // syscalls Docker's default seccomp profile denies, and `true` here means a
    // browser that dies during startup in the image.
    expect(options.chromiumSandbox).toBe(false);
  });

  it("holds no path belonging to one machine", () => {
    const naming = serverSources(SERVER_DIR).filter((path) =>
      readFileSync(path, "utf8").includes("/nix/store")
    );

    // A store path is the specific way this broke, and the general rule is the
    // one above it: a machine's filesystem layout is configuration, and
    // configuration reaches this server through `server/config.ts` alone.
    expect(naming).toEqual([]);
  });
});
