/**
 * Stand-in for `playwright` (ADR-0018: fakes only).
 *
 * `server/browser-transcript.ts` drives a headless Chromium over the network to
 * scrape Loom/Fathom transcripts. Nothing in the characterization suites should
 * reach it — transcript sync only fires for document content containing a Loom or
 * Fathom URL. Aliasing the package here makes any accidental reach a loud, instant
 * failure instead of a browser launch or a 30-second timeout.
 *
 * `launch` is the only thing that throws, so `tests/smoke/transcript-browser.test.ts`
 * can still import the module and read the options it would have launched with.
 */

export const chromium = {
  launch(): never {
    throw new Error(
      "fake-playwright: a test reached the browser transcript scraper. " +
        "Characterization suites must not embed Loom/Fathom URLs in document content."
    );
  },
};

export type Browser = never;
export type BrowserContext = never;
export type Page = never;
