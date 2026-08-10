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

const TRANSCRIPTION_FIXTURE = join(
  import.meta.dirname,
  "..",
  "fixtures",
  "loom-transcription-1.1.3.json"
);
const LOOM_VIDEO_ID = "sanitized-recording-id";
const LOOM_TRANSCRIPTION_URL =
  `https://cdn.loom.com/mediametadata/transcription/${LOOM_VIDEO_ID}-1.json`;
const LOOM_CAPTIONS_URL =
  `https://cdn.loom.com/mediametadata/captions/${LOOM_VIDEO_ID}-1.vtt`;

const VALID_VTT = [
  "WEBVTT - sanitized captions",
  "Kind: captions",
  "Language: en",
  "",
  "cue-1",
  "00:00.000 --> 00:02.500 align:start",
  "Neutral caption one.",
  "",
  "00:02.500 --> 00:05.000",
  "Neutral caption two.",
  "",
].join("\n");

describe("Loom's network transcript formats", () => {
  it("validates schema 1.1.3 and emits only each observed start and phrase", async () => {
    const { parseLoomTranscription } = await import("../../server/browser-transcript");
    const fixture = JSON.parse(readFileSync(TRANSCRIPTION_FIXTURE, "utf8"));

    expect(fixture.phrases[0].ranges).toEqual([
      {
        type: "text",
        start: 0,
        length: 23,
        source: { monologue: 0, element: 0, elementId: "sanitized-element-001" },
      },
    ]);
    expect(parseLoomTranscription(fixture)).toBe(
      "[0:01.420] Neutral opening phrase.\n[1:05.005] Neutral follow-up phrase."
    );
    expect(
      parseLoomTranscription({
        schemaVersion: "1.1.3",
        phrases: [{ ts: 3661, value: "Neutral long-form phrase.", ranges: [] }],
      })
    ).toBe("[1:01:01] Neutral long-form phrase.");
  });

  it("distinguishes an empty valid transcript from a malformed one", async () => {
    const { parseLoomTranscription } = await import("../../server/browser-transcript");

    expect(parseLoomTranscription({ schemaVersion: "1.1.3", phrases: [] })).toBe("");
    expect(() =>
      parseLoomTranscription({
        schemaVersion: "1.1.3",
        phrases: [{ ts: "0", value: "Neutral phrase.", ranges: [] }],
      })
    ).toThrow(/phrase 0.*timestamp/i);
    expect(() =>
      parseLoomTranscription({
        schemaVersion: "1.1.3",
        phrases: [{ ts: Number.NaN, value: "Neutral phrase.", ranges: [] }],
      })
    ).toThrow(/phrase 0.*timestamp/i);
    expect(() =>
      parseLoomTranscription({
        schemaVersion: "1.1.3",
        phrases: [{ ts: 1, value: "   ", ranges: [] }],
      })
    ).toThrow(/phrase 0.*text/i);
    expect(() =>
      parseLoomTranscription({
        schemaVersion: "1.1.3",
        phrases: [{ ts: 1, value: "Neutral phrase.", ranges: [{}] }],
      })
    ).toThrow(/phrase 0 range 0.*shape/i);
  });

  it("rejects schema drift in its own words", async () => {
    const { parseLoomTranscription } = await import("../../server/browser-transcript");

    expect(() => parseLoomTranscription({ schemaVersion: "1.1.4", phrases: [] })).toThrow(
      /expected 1\.1\.3, received 1\.1\.4/
    );
  });

  it("accepts WebVTT header metadata and retains cue timing", async () => {
    const { parseLoomVtt } = await import("../../server/browser-transcript");

    expect(parseLoomVtt(VALID_VTT)).toBe(
      "00:00.000 --> 00:02.500\nNeutral caption one.\n\n" +
        "00:02.500 --> 00:05.000\nNeutral caption two."
    );
  });

  it("rejects empty captions and zero-duration cues", async () => {
    const { parseLoomVtt } = await import("../../server/browser-transcript");

    expect(() => parseLoomVtt("WEBVTT\n\n")).toThrow(/no transcript/i);
    expect(() =>
      parseLoomVtt("WEBVTT\n\n00:01.000 --> 00:01.000\nNeutral caption.\n")
    ).toThrow(/duration/i);
    expect(() =>
      parseLoomVtt("WEBVTT\n\n60:00.000 --> 60:01.000\nNeutral caption.\n")
    ).toThrow(/duration/i);
    expect(
      parseLoomVtt("WEBVTT\n\n100:00:00.000 --> 100:00:01.000\nNeutral caption.\n")
    ).toContain("100:00:00.000 --> 100:00:01.000");
  });
});

describe("Loom's response collection lifecycle", () => {
  afterEach(async () => {
    const { resetFakeBrowser } = await import("../fakes/playwright");
    resetFakeBrowser();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("listens before navigation, waits for a delayed body, and prefers JSON over VTT", async () => {
    const fake = await import("../fakes/playwright");
    let releaseBody!: (body: string) => void;
    const delayedBody = new Promise<string>((resolve) => {
      releaseBody = resolve;
    });
    const fixture = readFileSync(TRANSCRIPTION_FIXTURE, "utf8");
    fake.useFakeBrowser({
      responses: [
        {
          url: LOOM_CAPTIONS_URL,
          contentType: "text/vtt",
          body: VALID_VTT,
        },
        {
          url: LOOM_TRANSCRIPTION_URL,
          contentType: "application/json",
          body: delayedBody,
        },
      ],
    });

    const { extractLoomTranscript } = await import("../../server/browser-transcript");
    const extraction = extractLoomTranscript(LOOM_VIDEO_ID);
    await Promise.resolve();
    releaseBody(fixture);
    const result = await extraction;

    expect(result).toEqual({
      success: true,
      transcript: "[0:01.420] Neutral opening phrase.\n[1:05.005] Neutral follow-up phrase.",
    });
    expect(fake.fakeBrowserState.events.indexOf("listener-attached")).toBeLessThan(
      fake.fakeBrowserState.events.indexOf("navigation-started")
    );
    expect(fake.fakeBrowserState.events.indexOf("listener-removed")).toBeLessThan(
      fake.fakeBrowserState.events.indexOf("browser-closed")
    );
    expect(fake.fakeBrowserState.renderedInteractions).toBe(0);
  });

  it("uses VTT when every observed JSON response is unreadable within the bound", async () => {
    vi.useFakeTimers();
    const fake = await import("../fakes/playwright");
    fake.useFakeBrowser({
      responses: [
        {
          url: LOOM_TRANSCRIPTION_URL,
          contentType: "application/json",
          body: new Promise<string>(() => {}),
        },
        {
          url: LOOM_CAPTIONS_URL,
          contentType: "text/vtt",
          body: VALID_VTT,
        },
      ],
    });

    const { extractLoomTranscript } = await import("../../server/browser-transcript");
    const extraction = extractLoomTranscript(LOOM_VIDEO_ID);
    await vi.advanceTimersByTimeAsync(2100);
    const result = await extraction;

    expect(result.success).toBe(true);
    expect(result.transcript).toContain("00:00.000 --> 00:02.500");
    expect(fake.fakeBrowserState.renderedInteractions).toBe(0);
  });

  it("chooses the first readable JSON deterministically across multiple responses", async () => {
    const fake = await import("../fakes/playwright");
    fake.useFakeBrowser({
      responses: [
        {
          url: LOOM_TRANSCRIPTION_URL,
          contentType: "application/json",
          body: Promise.reject(new Error("body unavailable")),
        },
        {
          url: LOOM_TRANSCRIPTION_URL,
          contentType: "application/json",
          body: readFileSync(TRANSCRIPTION_FIXTURE, "utf8"),
        },
        {
          url: LOOM_CAPTIONS_URL,
          contentType: "text/vtt",
          body: VALID_VTT,
        },
      ],
    });

    const { extractLoomTranscript } = await import("../../server/browser-transcript");
    const result = await extractLoomTranscript(LOOM_VIDEO_ID);

    expect(result.transcript).toBe(
      "[0:01.420] Neutral opening phrase.\n[1:05.005] Neutral follow-up phrase."
    );
    expect(fake.fakeBrowserState.renderedInteractions).toBe(0);
  });

  it("retains the rendered fallbacks only when no network representation is readable", async () => {
    const fake = await import("../fakes/playwright");
    fake.useFakeBrowser({});

    const { extractLoomTranscript } = await import("../../server/browser-transcript");
    const result = await extractLoomTranscript(LOOM_VIDEO_ID);

    expect(result).toEqual({
      success: false,
      error:
        "Transcript not found. The video may not have transcription enabled or the transcript is not publicly available.",
    });
    expect(fake.fakeBrowserState.renderedInteractions).toBeGreaterThan(0);
  });

  it("ignores transcript-shaped responses not bound to Loom and the requested recording", async () => {
    const fake = await import("../fakes/playwright");
    const fixture = readFileSync(TRANSCRIPTION_FIXTURE, "utf8");
    fake.useFakeBrowser({
      responses: [
        {
          url: `https://cdn.invalid/mediametadata/transcription/${LOOM_VIDEO_ID}-1.json`,
          contentType: "application/json",
          body: fixture,
        },
        {
          url: "https://cdn.loom.com/mediametadata/transcription/another-recording-1.json",
          contentType: "application/json",
          body: fixture,
        },
      ],
    });

    const { extractLoomTranscript } = await import("../../server/browser-transcript");
    const result = await extractLoomTranscript(LOOM_VIDEO_ID);

    expect(result.success).toBe(false);
    expect(fake.fakeBrowserState.renderedInteractions).toBeGreaterThan(0);
  });

  it("rejects an oversized matching response before parsing it", async () => {
    const fake = await import("../fakes/playwright");
    fake.useFakeBrowser({
      responses: [
        {
          url: LOOM_TRANSCRIPTION_URL,
          contentType: "application/json",
          body: "x".repeat(2 * 1024 * 1024 + 1),
        },
      ],
    });

    const { extractLoomTranscript } = await import("../../server/browser-transcript");
    const result = await extractLoomTranscript(LOOM_VIDEO_ID);

    expect(result.success).toBe(false);
    expect(fake.fakeBrowserState.renderedInteractions).toBeGreaterThan(0);
  });

  it.each([
    {
      name: "empty structured transcript",
      body: JSON.stringify({ schemaVersion: "1.1.3", phrases: [] }),
      error: /no transcript/i,
    },
    {
      name: "unknown structured schema",
      body: JSON.stringify({ schemaVersion: "9.0.0", phrases: [] }),
      error: /unsupported.*schema/i,
    },
  ])("treats a $name as definitive", async ({ body, error }) => {
    const fake = await import("../fakes/playwright");
    fake.useFakeBrowser({
      responses: [
        {
          url: LOOM_TRANSCRIPTION_URL,
          contentType: "application/json",
          body,
        },
      ],
    });

    const { extractLoomTranscript } = await import("../../server/browser-transcript");
    const result = await extractLoomTranscript(LOOM_VIDEO_ID);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(error);
    expect(fake.fakeBrowserState.renderedInteractions).toBe(0);
  });

  it("freezes capture after navigation", async () => {
    const fake = await import("../fakes/playwright");
    fake.useFakeBrowser({
      responses: [
        {
          url: LOOM_TRANSCRIPTION_URL,
          contentType: "application/json",
          body: JSON.stringify({ schemaVersion: "1.1.3", phrases: [] }),
        },
      ],
      afterNavigationResponses: [
        {
          url: LOOM_TRANSCRIPTION_URL,
          contentType: "application/json",
          body: readFileSync(TRANSCRIPTION_FIXTURE, "utf8"),
        },
      ],
    });

    const { extractLoomTranscript } = await import("../../server/browser-transcript");
    const result = await extractLoomTranscript(LOOM_VIDEO_ID);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no transcript/i);
  });
});
