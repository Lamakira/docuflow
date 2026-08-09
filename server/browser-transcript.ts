import { accessSync, constants, statSync } from 'node:fs';

import { chromium, Browser, Page, BrowserContext, type LaunchOptions } from 'playwright';
import { config } from './config';

const BROWSER_TIMEOUT = 30000;

/** How long to wait for a copy button to put something on the clipboard. */
const CLIPBOARD_ATTEMPTS = 5;
const CLIPBOARD_POLL_MS = 1000;

/** Below this, there is nothing worth calling a transcript. */
const MINIMUM_CHARACTERS = 50;

/** `0:00`, `12:34`, `1:02:03` — the mark a spoken record is indexed by. */
const TIMESTAMP = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const TIMESTAMPS_REQUIRED = 3;

/**
 * Whether a scraped text is a transcript at all (#45).
 *
 * Length used to be the only question asked, and length is not evidence. A Loom
 * share page answered it with its cookie banner — `[class*="row"]` matched
 * OneTrust's `ot-sdk-row`, two elements joined past fifty characters, and the
 * scrape reported success. `syncTranscript` does not re-examine what it is
 * given: it hashes, chunks, embeds, and writes a Transcript, which is searchable
 * and citable. A failed scrape is recoverable; that is not, because it looks
 * like data.
 *
 * Timestamps are the test because they are the definition — a Transcript is the
 * "immutable, timestamped text record" (`CONTEXT.md`). Prose about cookies
 * carries none, and no amount of it ever will. A page holding no transcript now
 * fails, which is the outcome this replaces.
 */
export function looksLikeTranscript(text: string | null | undefined): boolean {
  if (!text) return false;

  const trimmed = text.trim();
  if (trimmed.length < MINIMUM_CHARACTERS) return false;

  return (trimmed.match(TIMESTAMP) ?? []).length >= TIMESTAMPS_REQUIRED;
}

/**
 * Which Chromium this launches, and how (#37).
 *
 * Finding it is Playwright's job. Given no `executablePath`, `chromium.launch()`
 * opens what `playwright install chromium` put in place — Chromium's headless
 * shell, which is what a headless launch uses, under `PLAYWRIGHT_BROWSERS_PATH`
 * in the image and in `~/.cache/ms-playwright` on a developer machine. In neither
 * case is it a path written down here. What stood here before was one absolute
 * Nix store path belonging to a single Replit machine, so every launch anywhere
 * else threw before the first navigation. `PLAYWRIGHT_CHROMIUM_PATH` is the
 * override for a host that has a browser of its own — that Nix path is a
 * perfectly good value for it, set on the machine that has it.
 *
 * An override naming nothing this host can execute is refused right here, before
 * `chromium.launch()` is asked to find out. That is the shape the old constant
 * failed in — thirty seconds into a background job, in Playwright's words, left
 * on a transcript row nobody was watching — and one scrape is the right size for
 * it: `server/config.ts` reads the variable without opening it, because a
 * scraper's knob does not get to keep the server from booting.
 *
 * The flags are the container's, each one a decision rather than an inheritance:
 *
 *  - **The sandbox stays off.** That is already Playwright's default, and saying
 *    it here is what makes it a choice: Chromium's namespace sandbox needs
 *    syscalls Docker's default seccomp profile denies, so `chromiumSandbox: true`
 *    in this image dies during browser startup unless the host is run with
 *    `--security-opt seccomp=<playwright's profile>`. What that costs is the
 *    boundary between a scraped page's renderer and this process, which is why
 *    the URLs stay assembled from a video id against two known hosts
 *    (`server/transcripts.ts`) rather than taken from a document.
 *  - `--disable-dev-shm-usage` moves Chromium's shared-memory files off /dev/shm,
 *    which Docker gives a container 64 MB of. Without it a page large enough to
 *    exhaust that takes the tab down mid-scrape; the alternative is a
 *    `--shm-size` flag on every host that runs the image.
 *  - `--disable-gpu`: there is no display and nothing to accelerate.
 */
export function browserLaunchOptions(): LaunchOptions {
  const executablePath = config.chromiumPath;

  if (executablePath !== undefined) {
    try {
      // Runnable, not merely present. Existence alone is the weaker question:
      // a directory answers it, and so does a file with no execute bit, and both
      // then die inside the launch — which is the reporting this check exists to
      // take back from Playwright. `X_OK` on a directory means "traverse", so
      // being a file is asked separately.
      if (!statSync(executablePath).isFile()) throw new Error('not a file');
      accessSync(executablePath, constants.X_OK);
    } catch {
      throw new Error(
        `PLAYWRIGHT_CHROMIUM_PATH is "${executablePath}", and there is nothing this ` +
          `machine can run there. Leave it unset to launch the browser Playwright ` +
          `installed, or name one this host can execute.`
      );
    }
  }

  return {
    executablePath,
    headless: true,
    chromiumSandbox: false,
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  };
}

async function launchBrowser(): Promise<Browser> {
  const options = browserLaunchOptions();
  console.log(
    `[Browser] Launching headless Chromium${options.executablePath ? ` from ${options.executablePath}` : ''}...`
  );

  return await chromium.launch(options);
}

async function createContext(browser: Browser): Promise<BrowserContext> {
  return await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
}

/** Whitespace collapsed and the copy widget's own label dropped. */
function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/CopySearch/g, '').trim();
}

/**
 * Every text on the page that could be a transcript, most specific first. The
 * page cannot decide which one is (`looksLikeTranscript` runs here, not there),
 * so it offers rather than chooses.
 *
 * Both rungs key on the word "transcript" in a selector or a class. A third one
 * used to sweep `[class*="segment"], [class*="row"]` and join whatever it found,
 * which is what returned a cookie banner (#45). It is gone rather than
 * tightened: an arbitrary substring sweep of page classes has no version that
 * tells content from furniture.
 */
async function transcriptCandidatesFromDOM(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const candidates: string[] = [];

    const transcriptSelectors = [
      '[class*="transcript-list"]',
      '[class*="TranscriptList"]',
      '[class*="transcript-content"]',
      '[class*="transcript-body"]',
      '[class*="transcript-row"]',
      '[data-testid="transcript-text"]',
      '.transcript-text',
      '.transcript-content',
    ];

    for (const selector of transcriptSelectors) {
      const text = document.querySelector(selector)?.textContent ?? '';
      if (text.trim().length > 0) candidates.push(text);
    }

    // Loom ships CSS-module names now — `transcript-header_header_VVf` — so the
    // class substring outlives any one of the names above. Longest wins: the
    // headers beside the content carry the same prefix and no text.
    let longest = '';
    for (const element of Array.from(document.querySelectorAll('[class*="transcript" i]'))) {
      const text = element.textContent ?? '';
      if (text.length > longest.length) longest = text;
    }
    if (longest.trim().length > 0) candidates.push(longest);

    return candidates;
  });
}

/** The first candidate that is a transcript, tidied; null when none is. */
async function transcriptFromDOM(page: Page): Promise<string | null> {
  for (const candidate of await transcriptCandidatesFromDOM(page)) {
    const text = tidy(candidate);
    if (looksLikeTranscript(text)) return text;
  }

  return null;
}

/**
 * The clipboard once a copy button has filled it, or null.
 *
 * Polled rather than read once after a fixed second. Fathom's extraction used to
 * survive on an accident: `copySelectors` named the same button twice, the loop
 * did not break, and the second click bought the second attempt that the first
 * one's timing had missed (#45).
 */
async function clipboardTranscript(page: Page): Promise<string | null> {
  for (let attempt = 0; attempt < CLIPBOARD_ATTEMPTS; attempt++) {
    await page.waitForTimeout(CLIPBOARD_POLL_MS);

    const text = await page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch (err) {
        return null;
      }
    });

    if (looksLikeTranscript(text)) return text!.trim();
  }

  return null;
}

export async function extractLoomTranscript(videoId: string): Promise<{ success: boolean; transcript?: string; error?: string }> {
  let browser: Browser | null = null;
  
  try {
    const url = `https://www.loom.com/share/${videoId}`;
    console.log(`[Loom] Starting Playwright extraction from: ${url}`);
    
    browser = await launchBrowser();
    const context = await createContext(browser);
    const page = await context.newPage();
    
    console.log('[Loom] Navigating to URL...');
    await page.goto(url, { waitUntil: 'networkidle', timeout: BROWSER_TIMEOUT });
    console.log('[Loom] Page loaded');
    
    const urlObj = new URL(url);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { 
      origin: `${urlObj.protocol}//${urlObj.host}` 
    });
    
    console.log('[Loom] Looking for transcript button/tab...');
    const transcriptButtonSelectors = [
      // What Loom serves today, observed on a real share page (#45).
      '[data-testid="sidebar-tab-Transcript"]',
      'button:has-text("Transcript")',
      '[aria-label="Transcript"]',
      '[data-qa="transcript-button"]',
      'button:has-text("Show transcript")',
      '.transcript-toggle',
      '[role="tab"]:has-text("Transcript")'
    ];
    
    for (const selector of transcriptButtonSelectors) {
      try {
        const button = page.locator(selector).first();
        await button.waitFor({ state: 'visible', timeout: 3000 });
        await button.click();
        console.log(`[Loom] Clicked transcript button: ${selector}`);
        await page.waitForTimeout(2000);
        break;
      } catch (e) {
        continue;
      }
    }
    
    const transcriptPanelSelectors = [
      '[data-testid="transcript-panel"]',
      '.transcript-container',
      '[data-qa="transcript-panel"]',
      '.transcript-list',
      '[role="region"][aria-label*="ranscript"]',
      '[class*="Transcript"]',
      'div[data-testid*="transcript"]'
    ];
    
    let transcriptPanelFound = false;
    for (const selector of transcriptPanelSelectors) {
      try {
        await page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
        console.log(`[Loom] Transcript panel found: ${selector}`);
        transcriptPanelFound = true;
        break;
      } catch (e) {
        continue;
      }
    }
    
    if (!transcriptPanelFound) {
      console.log('[Loom] No transcript panel found, trying DOM extraction');
    }
    
    try {
      const copyButton = page.locator('button:has-text("Copy")').first();
      await copyButton.waitFor({ state: 'visible', timeout: 5000 });
      await copyButton.click();
      console.log('[Loom] Copy button clicked');

      const transcript = await clipboardTranscript(page);
      if (transcript) {
        console.log(`[Loom] Transcript extracted via clipboard (${transcript.length} chars)`);
        return { success: true, transcript };
      }
    } catch (error) {
      console.log('[Loom] Copy button not found, trying DOM extraction');
    }

    const domTranscript = await transcriptFromDOM(page);
    if (domTranscript) {
      console.log(`[Loom] Transcript extracted via DOM (${domTranscript.length} chars)`);
      return { success: true, transcript: domTranscript };
    }
    
    const apolloTranscript = await page.evaluate(() => {
      const apolloState = (window as any).__APOLLO_STATE__;
      if (!apolloState) return null;
      
      for (const key of Object.keys(apolloState)) {
        if (key.startsWith('Transcription:')) {
          const transcription = apolloState[key];
          if (transcription.source_text) {
            return transcription.source_text;
          }
        }
        
        const value = apolloState[key];
        if (value && typeof value === 'object') {
          if (value.transcript_with_chapters || value.transcript) {
            const transcript = value.transcript_with_chapters || value.transcript;
            if (typeof transcript === 'string') {
              return transcript;
            }
          }
        }
      }
      
      return null;
    });
    
    if (looksLikeTranscript(apolloTranscript)) {
      console.log(`[Loom] Transcript extracted via Apollo state (${apolloTranscript.length} chars)`);
      return { success: true, transcript: apolloTranscript.trim() };
    }
    
    return { 
      success: false, 
      error: "Transcript not found. The video may not have transcription enabled or the transcript is not publicly available." 
    };
    
  } catch (error: any) {
    console.error('[Loom] Extraction failed:', error.message);
    return { success: false, error: `Failed to extract Loom transcript: ${error.message}` };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function extractFathomTranscript(videoId: string): Promise<{ success: boolean; transcript?: string; error?: string }> {
  let browser: Browser | null = null;
  
  try {
    const url = `https://fathom.video/share/${videoId}`;
    console.log(`[Fathom] Starting Playwright extraction from: ${url}`);
    
    browser = await launchBrowser();
    const context = await createContext(browser);
    const page = await context.newPage();
    
    console.log('[Fathom] Navigating to URL...');
    await page.goto(url, { waitUntil: 'networkidle', timeout: BROWSER_TIMEOUT });
    console.log('[Fathom] Page loaded');
    
    const urlObj = new URL(url);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { 
      origin: `${urlObj.protocol}//${urlObj.host}` 
    });
    
    try {
      console.log('[Fathom] Looking for TRANSCRIPT tab...');
      const transcriptTab = page.locator('text=TRANSCRIPT').first();
      await transcriptTab.waitFor({ state: 'visible', timeout: 5000 });
      await transcriptTab.click();
      console.log('[Fathom] TRANSCRIPT tab clicked');
      await page.waitForTimeout(1500);
    } catch (error) {
      console.log('[Fathom] No TRANSCRIPT tab found, continuing...');
    }
    
    // `has-text` matches case-insensitively, so one spelling covers both. A
    // second, differently-cased copy of the first entry used to sit here and was
    // doing the retry's work — clicking the same button again bought the attempt
    // the fixed one-second wait had missed. `clipboardTranscript` polls now, so
    // the duplicate is finally what it always looked like (#45).
    const copySelectors = [
      'button:has-text("Copy transcript")',
      '[aria-label*="transcript" i]',
      '.transcript-copy-button',
    ];

    for (const selector of copySelectors) {
      try {
        const button = page.locator(selector).first();
        await button.waitFor({ state: 'visible', timeout: 5000 });
        await button.click();
        console.log(`[Fathom] Clicked: ${selector}`);

        const transcript = await clipboardTranscript(page);
        if (transcript) {
          console.log(`[Fathom] Transcript extracted via clipboard (${transcript.length} chars)`);
          return { success: true, transcript };
        }
      } catch {
        continue;
      }
    }

    console.log('[Fathom] Trying DOM extraction...');
    const domTranscript = await transcriptFromDOM(page);
    if (domTranscript) {
      console.log(`[Fathom] Transcript extracted via DOM (${domTranscript.length} chars)`);
      return { success: true, transcript: domTranscript };
    }
    
    return { 
      success: false, 
      error: "Transcript not found. The video may not have transcription available or the transcript is not publicly accessible." 
    };
    
  } catch (error: any) {
    console.error('[Fathom] Extraction failed:', error.message);
    return { success: false, error: `Failed to extract Fathom transcript: ${error.message}` };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
