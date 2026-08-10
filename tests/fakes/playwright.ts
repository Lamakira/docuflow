/**
 * Stand-in for `playwright` (ADR-0018: fakes only).
 *
 * `server/browser-transcript.ts` drives a headless Chromium over the network to
 * scrape Loom/Fathom transcripts. Nothing in the characterization suites should
 * reach it — transcript sync only fires for document content containing a Loom or
 * Fathom URL. Aliasing the package here makes any accidental reach a loud, instant
 * failure instead of a browser launch or a 30-second timeout.
 *
 * `launch` throws by default. The transcript-browser suite can opt into the
 * small page/response boundary below; no other suite can accidentally launch it.
 */

type FakeResponse = {
  url: string;
  body: string | Promise<string> | (() => string | Promise<string>);
  contentType?: string;
  status?: number;
};

type FakeScenario = {
  responses?: FakeResponse[];
  afterNavigationResponses?: FakeResponse[];
};

type FakeState = {
  scenario: FakeScenario | null;
  events: string[];
  renderedInteractions: number;
};

const stateKey = Symbol.for('docuflow.fake-playwright');
const globals = globalThis as typeof globalThis & { [stateKey]?: FakeState };
const state = globals[stateKey] ??= {
  scenario: null,
  events: [],
  renderedInteractions: 0,
};

export function useFakeBrowser(scenario: FakeScenario): void {
  state.scenario = scenario;
  state.events.length = 0;
  state.renderedInteractions = 0;
}

export function resetFakeBrowser(): void {
  state.scenario = null;
  state.events.length = 0;
  state.renderedInteractions = 0;
}

export const fakeBrowserState = state;

type ResponseListener = (response: ReturnType<typeof fakeResponse>) => void;

function fakeResponse(spec: FakeResponse) {
  return {
    url: () => spec.url,
    status: () => spec.status ?? 200,
    headers: () => ({ 'content-type': spec.contentType ?? '' }),
    text: async () => {
      const body = typeof spec.body === 'function' ? spec.body() : spec.body;
      return await body;
    },
  };
}

function fakePage(scenario: FakeScenario) {
  const listeners = new Set<ResponseListener>();
  const emit = (responses: FakeResponse[] | undefined) => {
    for (const spec of responses ?? []) {
      for (const listener of listeners) listener(fakeResponse(spec));
    }
  };

  const missingLocator = {
    first() {
      return this;
    },
    async waitFor() {
      throw new Error('fake-playwright: locator is absent');
    },
    async click() {},
  };

  return {
    on(event: string, listener: ResponseListener) {
      if (event === 'response') {
        state.events.push('listener-attached');
        listeners.add(listener);
      }
      return this;
    },
    off(event: string, listener: ResponseListener) {
      if (event === 'response') {
        state.events.push('listener-removed');
        listeners.delete(listener);
      }
      return this;
    },
    async goto() {
      state.events.push('navigation-started');
      emit(scenario.responses);
      state.events.push('navigation-finished');
      setTimeout(() => emit(scenario.afterNavigationResponses), 0);
      return null;
    },
    locator() {
      state.renderedInteractions++;
      return missingLocator;
    },
    async waitForSelector() {
      state.renderedInteractions++;
      throw new Error('fake-playwright: selector is absent');
    },
    async waitForTimeout() {},
    async evaluate(callback: unknown) {
      state.renderedInteractions++;
      return String(callback).includes('const candidates') ? [] : null;
    },
  };
}

export const chromium = {
  async launch() {
    if (state.scenario === null) {
      throw new Error(
        "fake-playwright: a test reached the browser transcript scraper. " +
          "Characterization suites must not embed Loom/Fathom URLs in document content."
      );
    }

    const scenario = state.scenario;
    return {
      async newContext() {
        return {
          async newPage() {
            return fakePage(scenario);
          },
          async grantPermissions() {},
        };
      },
      async close() {
        state.events.push('browser-closed');
      },
    };
  },
};

export type Browser = never;
export type BrowserContext = never;
export type Page = never;
