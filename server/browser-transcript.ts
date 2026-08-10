import { accessSync, constants, statSync } from 'node:fs';

import {
  chromium,
  Browser,
  Page,
  BrowserContext,
  type LaunchOptions,
  type Response,
} from 'playwright';
import { config } from './config';

const BROWSER_TIMEOUT = 30000;
const LOOM_RESPONSE_BODY_TIMEOUT = 2000;
const LOOM_RESPONSE_LIMIT = 20;
const LOOM_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const LOOM_TRANSCRIPTION_SCHEMA = '1.1.3';

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

type LoomTranscriptionRange = {
  type: string;
  start: number;
  length: number;
  source: {
    monologue: number;
    element: number;
    elementId: string;
  };
};

type LoomTranscriptionPhrase = {
  ts: number;
  value: string;
  ranges: LoomTranscriptionRange[];
};

type LoomTranscription = {
  schemaVersion: string;
  phrases: LoomTranscriptionPhrase[];
};

/** A deterministic, user-safe description of an incompatible provider response. */
export class LoomTranscriptResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoomTranscriptResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatLoomTimestamp(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000);
  if (!Number.isSafeInteger(milliseconds)) {
    throw new LoomTranscriptResponseError('Loom transcription timestamp is outside the supported range.');
  }

  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = milliseconds % 1000;
  const clock = hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}`
    : `${minutes}:${String(wholeSeconds).padStart(2, '0')}`;

  return remainder === 0 ? clock : `${clock}.${String(remainder).padStart(3, '0')}`;
}

/**
 * Validate and format the versioned response Loom currently serves.
 *
 * `ts` is Loom's seconds offset. Brackets distinguish the immutable start marker
 * from phrase text without inventing an end time or speaker.
 */
export function parseLoomTranscription(value: unknown): string {
  if (!isRecord(value)) {
    throw new LoomTranscriptResponseError('Loom transcription response must be an object.');
  }

  if (value.schemaVersion !== LOOM_TRANSCRIPTION_SCHEMA) {
    const received = typeof value.schemaVersion === 'string' ? value.schemaVersion : 'missing';
    throw new LoomTranscriptResponseError(
      `Unsupported Loom transcription schema: expected ${LOOM_TRANSCRIPTION_SCHEMA}, received ${received}.`
    );
  }

  if (!Array.isArray(value.phrases)) {
    throw new LoomTranscriptResponseError('Loom transcription schema 1.1.3 has no phrases array.');
  }

  const transcription: LoomTranscription = {
    schemaVersion: value.schemaVersion,
    phrases: value.phrases.map((phrase, index) => {
      if (!isRecord(phrase)) {
        throw new LoomTranscriptResponseError(`Loom transcription phrase ${index} must be an object.`);
      }
      if (typeof phrase.ts !== 'number' || !Number.isFinite(phrase.ts) || phrase.ts < 0) {
        throw new LoomTranscriptResponseError(
          `Loom transcription phrase ${index} has an invalid timestamp.`
        );
      }
      if (typeof phrase.value !== 'string' || phrase.value.trim() === '') {
        throw new LoomTranscriptResponseError(`Loom transcription phrase ${index} has invalid text.`);
      }
      if (!Array.isArray(phrase.ranges)) {
        throw new LoomTranscriptResponseError(`Loom transcription phrase ${index} has no ranges array.`);
      }

      const ranges = phrase.ranges.map((range, rangeIndex): LoomTranscriptionRange => {
        const source = isRecord(range) ? range.source : null;
        if (
          !isRecord(range) ||
          typeof range.type !== 'string' ||
          !Number.isSafeInteger(range.start) ||
          (range.start as number) < 0 ||
          !Number.isSafeInteger(range.length) ||
          (range.length as number) < 0 ||
          !isRecord(source) ||
          !Number.isSafeInteger(source.monologue) ||
          (source.monologue as number) < 0 ||
          !Number.isSafeInteger(source.element) ||
          (source.element as number) < 0 ||
          typeof source.elementId !== 'string' ||
          source.elementId.trim() === ''
        ) {
          throw new LoomTranscriptResponseError(
            `Loom transcription phrase ${index} range ${rangeIndex} has an invalid shape.`
          );
        }

        return {
          type: range.type,
          start: range.start as number,
          length: range.length as number,
          source: {
            monologue: source.monologue as number,
            element: source.element as number,
            elementId: source.elementId,
          },
        };
      });

      return { ts: phrase.ts, value: phrase.value.trim(), ranges };
    }),
  };

  return transcription.phrases
    .map(({ ts, value: text }) => `[${formatLoomTimestamp(ts)}] ${text}`)
    .join('\n');
}

function parseVttTimestamp(value: string): number | null {
  const parts = value.split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;

  const secondsPart = parts.at(-1)!;
  const minutesPart = parts.at(-2)!;
  const hoursPart = parts.length === 3 ? parts[0] : '0';
  if (!/^\d{2}\.\d{3}$/.test(secondsPart) || !/^\d{2}$/.test(minutesPart)) return null;
  if (parts.length === 3 && !/^\d{2,}$/.test(hoursPart)) return null;

  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  const seconds = Number(secondsPart);
  if (seconds >= 60 || minutes >= 60) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

/** Validate WebVTT and retain each cue's provider-supplied timing and text. */
export function parseLoomVtt(value: string): string {
  const normalized = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0] ?? '')) {
    throw new LoomTranscriptResponseError('Loom captions response is not valid WEBVTT.');
  }

  const cues: string[] = [];
  let index = 1;
  while (index < lines.length && lines[index].trim() !== '') index++;

  while (index < lines.length) {
    while (index < lines.length && lines[index].trim() === '') index++;
    if (index >= lines.length) break;

    if (/^(NOTE|STYLE|REGION)(?:[ \t]|$)/.test(lines[index])) {
      while (index < lines.length && lines[index].trim() !== '') index++;
      continue;
    }

    let timing = lines[index];
    if (!timing.includes('-->')) {
      index++;
      timing = lines[index] ?? '';
    }

    const match = timing.match(
      /^((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})[ \t]+-->[ \t]+((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})(?:[ \t]+.*)?$/
    );
    if (!match) {
      throw new LoomTranscriptResponseError('Loom captions response contains an invalid cue timing.');
    }

    const start = parseVttTimestamp(match[1]);
    const end = parseVttTimestamp(match[2]);
    if (start === null || end === null || end <= start) {
      throw new LoomTranscriptResponseError('Loom captions response contains an invalid cue duration.');
    }

    index++;
    const cueText: string[] = [];
    while (index < lines.length && lines[index].trim() !== '') {
      cueText.push(lines[index]);
      index++;
    }
    if (cueText.length === 0 || cueText.every((line) => line.trim() === '')) {
      throw new LoomTranscriptResponseError('Loom captions response contains an empty cue.');
    }
    cues.push(`${match[1]} --> ${match[2]}\n${cueText.join('\n')}`);
  }

  if (cues.length === 0) {
    throw new LoomTranscriptResponseError('The Loom recording has no transcript.');
  }

  return cues.join('\n\n');
}

type LoomResponseKind = 'json' | 'vtt';
type CapturedLoomResponse = {
  kind: LoomResponseKind;
  body: Promise<string | null>;
};
type LoomNetworkResult =
  | { kind: 'absent' }
  | { kind: 'success'; transcript: string }
  | { kind: 'failure'; error: string };

function loomResponseKind(response: Response, videoId: string): LoomResponseKind | null {
  if (response.status() < 200 || response.status() >= 300) return null;

  const url = new URL(response.url());
  if (url.protocol !== 'https:' || url.hostname !== 'cdn.loom.com') return null;

  const contentType = response.headers()['content-type']?.toLowerCase() ?? '';
  const transcriptionPath = `/mediametadata/transcription/${videoId}-1.json`;
  const captionsPath = `/mediametadata/captions/${videoId}-1.vtt`;

  if (url.pathname === transcriptionPath && contentType.includes('json')) {
    return 'json';
  }
  if (url.pathname === captionsPath && contentType.includes('text/vtt')) return 'vtt';
  return null;
}

function boundedResponseBody(response: Response): Promise<string | null> {
  const declaredLength = Number(response.headers()['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > LOOM_RESPONSE_MAX_BYTES) {
    return Promise.resolve(null);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    response.text().then(
      (body) => Buffer.byteLength(body, 'utf8') <= LOOM_RESPONSE_MAX_BYTES ? body : null,
      () => null
    ),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), LOOM_RESPONSE_BODY_TIMEOUT);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

class LoomResponseCollector {
  private readonly captured: CapturedLoomResponse[] = [];
  private frozen = false;
  private overflowed = false;
  private settled: Promise<Array<CapturedLoomResponse & { text: string | null }>> | null = null;
  private readonly listener = (response: Response) => {
    if (this.frozen) return;
    const kind = loomResponseKind(response, this.videoId);
    if (!kind) return;
    if (this.captured.length >= LOOM_RESPONSE_LIMIT) {
      this.overflowed = true;
      return;
    }
    this.captured.push({ kind, body: boundedResponseBody(response) });
  };

  constructor(private readonly page: Page, private readonly videoId: string) {
    page.on('response', this.listener);
  }

  freeze(): void {
    if (this.frozen) return;
    this.frozen = true;
    this.page.off('response', this.listener);
  }

  async settle(): Promise<Array<CapturedLoomResponse & { text: string | null }>> {
    this.freeze();
    this.settled ??= Promise.all(
      this.captured.map(async (response) => ({ ...response, text: await response.body }))
    );
    return await this.settled;
  }

  async resolve(): Promise<LoomNetworkResult> {
    const captured = await this.settle();
    if (this.overflowed) {
      return { kind: 'failure', error: 'Too many Loom transcript responses were observed.' };
    }

    for (const response of captured.filter(({ kind }) => kind === 'json')) {
      if (response.text === null) continue;
      try {
        let decoded: unknown;
        try {
          decoded = JSON.parse(response.text);
        } catch {
          throw new LoomTranscriptResponseError('Loom transcription response is not valid JSON.');
        }
        const transcript = parseLoomTranscription(decoded);
        if (transcript === '') {
          return { kind: 'failure', error: 'The Loom recording has no transcript.' };
        }
        return { kind: 'success', transcript };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid Loom transcription response.';
        return { kind: 'failure', error: message };
      }
    }

    for (const response of captured.filter(({ kind }) => kind === 'vtt')) {
      if (response.text === null) continue;
      try {
        return { kind: 'success', transcript: parseLoomVtt(response.text) };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid Loom captions response.';
        return { kind: 'failure', error: message };
      }
    }

    return { kind: 'absent' };
  }
}

export async function extractLoomTranscript(videoId: string): Promise<{ success: boolean; transcript?: string; error?: string }> {
  let browser: Browser | null = null;
  let responseCollector: LoomResponseCollector | null = null;
  
  try {
    const url = `https://www.loom.com/share/${videoId}`;
    console.log('[Loom] Starting Playwright extraction');
    
    browser = await launchBrowser();
    const context = await createContext(browser);
    const page = await context.newPage();
    responseCollector = new LoomResponseCollector(page, videoId);
    
    console.log('[Loom] Navigating to URL...');
    await page.goto(url, { waitUntil: 'networkidle', timeout: BROWSER_TIMEOUT });
    responseCollector.freeze();
    console.log('[Loom] Page loaded');

    const networkTranscript = await responseCollector.resolve();
    if (networkTranscript.kind === 'success') {
      console.log(`[Loom] Transcript extracted from a network response (${networkTranscript.transcript.length} chars)`);
      return { success: true, transcript: networkTranscript.transcript };
    }
    if (networkTranscript.kind === 'failure') {
      return { success: false, error: networkTranscript.error };
    }
    
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
    const safeMessage = String(error?.message ?? error).replace(/https?:\/\/\S+/g, '[redacted URL]');
    console.error('[Loom] Extraction failed:', safeMessage);
    return { success: false, error: `Failed to extract Loom transcript: ${safeMessage}` };
  } finally {
    if (responseCollector) {
      await responseCollector.settle();
    }
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
