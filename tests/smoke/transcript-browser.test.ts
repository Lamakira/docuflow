import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * How `server/browser-transcript.ts` finds a browser (#37), and what it accepts
 * once it has one (#45).
 *
 * The scraper used to hold an absolute `/nix` store path as a constant: it named
 * one Replit machine's Chromium, so `chromium.launch()` threw on every other
 * host — a developer's, CI's, the image's — before it reached a single page. The
 * launch options are exported for exactly this reason. They are the whole
 * decision, and they are checkable without a browser: `playwright` is aliased to
 * a fake that throws on `launch()` (ADR-0018), so nothing here starts one.
 *
 * What is *not* checked here is that a browser exists to be found when nothing
 * names one — that is the image's half, and `.github/workflows/ci.yml` opens a
 * page inside the built image to answer it. An override that names one *is*
 * checked here, because refusing it is this module's own work.
 *
 * `looksLikeTranscript` is checked here for the same reason: it decides what a
 * scrape is allowed to call a transcript, and it decides it in Node rather than
 * in the page, so it is answerable without either.
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

  it("refuses an override with nothing at it, in its own words", async () => {
    // The shape of the constant this replaced: a store path belonging to one
    // Replit machine. `chromium.launch()` would reach the same verdict thirty
    // seconds later, in Playwright's words, from inside a background job.
    const elsewhere = "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125/bin/chromium";

    await expect(launchOptions(elsewhere)).rejects.toThrow(/PLAYWRIGHT_CHROMIUM_PATH/);
    await expect(launchOptions(elsewhere)).rejects.toThrow(elsewhere);
  });

  it("refuses an override that is a directory", async () => {
    // Present, and `X_OK` on a directory means "traverse" rather than "run" —
    // so existence alone would have let this through to die in the launch.
    await expect(launchOptions(SERVER_DIR)).rejects.toThrow(/PLAYWRIGHT_CHROMIUM_PATH/);
  });

  it("refuses an override this host cannot execute", async () => {
    // A real file, no execute bit: the other half existence alone misses.
    const notExecutable = join(SERVER_DIR, "..", "package.json");

    await expect(launchOptions(notExecutable)).rejects.toThrow(/PLAYWRIGHT_CHROMIUM_PATH/);
  });

  it("names no /nix store path anywhere under server/", () => {
    const naming = serverSources(SERVER_DIR).filter((path) =>
      readFileSync(path, "utf8").includes("/nix/store")
    );

    // A store path is the specific way this broke, and the general rule is the
    // one above it: a machine's filesystem layout is configuration, and
    // configuration reaches this server through `server/config.ts` alone.
    expect(naming).toEqual([]);
  });
});

/**
 * What Loom's share page actually handed the scraper when it was asked for a
 * transcript: OneTrust's cookie preference text, swept up by a
 * `[class*="row"]` selector matching `ot-sdk-row` (#45). Kept verbatim, because
 * the whole point is that it is long, prose-shaped, and not a transcript.
 */
const COOKIE_BANNER =
  "Strictly Necessary CookiesAlways ActiveThese cookies are necessary for the " +
  "website to function and cannot be switched off in our systems. They are usually " +
  "only set in response to actions made by you which amount to a request for " +
  "services, such as setting your privacy preferences, logging in or filling in " +
  "forms. You can set your browser to block or alert you about these cookies, but " +
  "some parts of the site will not then work. These cookies do not store any " +
  "personally identifiable information.Targeting CookiesAlways ActiveThese cookies " +
  "may be set through our site by our advertising partners.";

/** The shape a real one arrives in — timestamp, speaker, what they said. */
const TRANSCRIPT = [
  "Weekly sync - 3 March",
  "VIEW RECORDING - 55 mins (No highlights):",
  "",
  "0:00 - Alex Rivera",
  "  Morning, thanks for joining.",
  "",
  "1:24 - Sam Okonkwo",
  "  Let us start with the migration status.",
  "",
  "12:07 - Alex Rivera",
  "  Agreed, we ship on Thursday.",
].join("\n");

describe("what a scrape may call a transcript", () => {
  it("refuses the cookie banner Loom served in place of one", async () => {
    const { looksLikeTranscript } = await import("../../server/browser-transcript");

    // 800-odd characters, comfortably past the length gate that used to be the
    // only question asked — and written as a Transcript row, embedded, and made
    // citable, had it passed.
    expect(COOKIE_BANNER.length).toBeGreaterThan(50);
    expect(looksLikeTranscript(COOKIE_BANNER)).toBe(false);
  });

  it("accepts a timestamped record of who said what", async () => {
    const { looksLikeTranscript } = await import("../../server/browser-transcript");

    expect(looksLikeTranscript(TRANSCRIPT)).toBe(true);
  });

  it("refuses prose however much of it there is", async () => {
    const { looksLikeTranscript } = await import("../../server/browser-transcript");

    // The general rule under the specific banner: a Transcript is the
    // "immutable, timestamped text record" (CONTEXT.md), so length is never the
    // evidence and no quantity of untimed prose becomes one.
    expect(looksLikeTranscript("word ".repeat(4000))).toBe(false);
  });

  it("refuses a stray clock reading in ordinary text", async () => {
    const { looksLikeTranscript } = await import("../../server/browser-transcript");

    expect(
      looksLikeTranscript(
        "The recording starts at 14:30 and the meeting room is booked until then."
      )
    ).toBe(false);
  });

  it("refuses nothing at all", async () => {
    const { looksLikeTranscript } = await import("../../server/browser-transcript");

    expect(looksLikeTranscript(null)).toBe(false);
    expect(looksLikeTranscript(undefined)).toBe(false);
    expect(looksLikeTranscript("")).toBe(false);
    expect(looksLikeTranscript("0:00 - Alex")).toBe(false);
  });
});
