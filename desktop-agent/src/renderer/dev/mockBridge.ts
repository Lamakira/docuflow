/**
 * mockBridge — an in-browser stand-in for window.agentBridge.
 *
 * Lets the v2 UI be developed and reviewed in a normal browser: no Electron, no
 * server, no pairing, no waiting for a real timer to reach an interesting
 * value. Every state the design has to cover is reachable from a dropdown.
 *
 * It implements the real AgentBridge interface, so if a v2 component compiles
 * against this it compiles against the real bridge.
 *
 * Sample data matches the approved screen exports exactly — same projects, same
 * tasks, same totals — so a rendered screen can be compared to its PNG.
 */

import type { AgentBridge, AgentState, Project, Task, TimerState, BreakdownRow } from '../app/types';

export type Scenario =
  | 'running'      // timer on Northwind / Ledger rebuild, 1:36:12
  | 'paused'
  | 'stopped'      // last context retained, one-click resume
  | 'fresh'        // paired, but nothing tracked yet — every empty state
  | 'signed-out'
  | 'revoked'      // device disconnected by an admin
  | 'error'        // every fetch fails
  | 'rollover';    // dayKey is stale — exercises the midnight-rollover path

const SECOND = 1000;

/* ── Sample data ─────────────────────────────────────────────────────────── */

const PROJECTS: Project[] = [
  { id: 'p-northwind', name: 'Northwind' },
  { id: 'p-meridian', name: 'Meridian' },
  { id: 'p-kaleido', name: 'Kaleido' },
];

const TASKS: Record<string, Task[]> = {
  'p-northwind': [
    { id: 't-ledger', name: 'Ledger rebuild', crmProjectId: 'p-northwind', durationToday: 5772 },
    { id: 't-statement', name: 'Statement import', crmProjectId: 'p-northwind', durationToday: 9544 },
    { id: 't-recon', name: 'Reconciliation pass', crmProjectId: 'p-northwind', durationToday: 1102 },
    { id: 't-vendor-cleanup', name: 'Vendor cleanup', crmProjectId: 'p-northwind' },
    { id: 't-q4', name: 'Q4 audit prep', crmProjectId: 'p-northwind' },
  ],
  'p-meridian': [
    { id: 't-vendor-map', name: 'Vendor mapping', crmProjectId: 'p-meridian', durationToday: 3900 },
  ],
  'p-kaleido': [
    { id: 't-design-qa', name: 'Design QA', crmProjectId: 'p-kaleido', durationToday: 2880 },
  ],
};

const BREAKDOWN: BreakdownRow[] = [
  { projectName: 'Northwind', taskId: 't-ledger', taskName: 'Ledger rebuild', stoppedSeconds: 2040, activeSeconds: 5760 },
  { projectName: 'Meridian', taskId: 't-vendor-map', taskName: 'Vendor mapping', stoppedSeconds: 3900 },
  { projectName: 'Kaleido', taskId: 't-design-qa', taskName: 'Design QA', stoppedSeconds: 2880 },
  { projectName: 'Northwind', taskId: null, taskName: null, stoppedSeconds: 9540 }, // legacy, no task
];

/** 45deg stripe placeholder — "image withheld" without inventing screen content. */
const STRIPE_TILE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">
       <defs><pattern id="s" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
         <rect width="8" height="8" fill="#f0efed"/><rect width="4" height="8" fill="#e6e4e1"/>
       </pattern></defs>
       <rect width="320" height="200" fill="url(#s)"/>
     </svg>`,
  );

/** Captures are dated relative to now so "N today" and the date grouping are
 *  meaningful whenever the harness is opened. */
function at(hour: number, minute: number, daysAgo = 0): number {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

const SCREENSHOTS = [
  { filename: 'shot-1428.jpg', timestampMs: at(14, 28), sizeKb: 248, projectName: 'Northwind', taskName: 'Ledger rebuild' },
  { filename: 'shot-1424.jpg', timestampMs: at(14, 24), sizeKb: 301, projectName: 'Northwind', taskName: 'Ledger rebuild' },
  { filename: 'shot-1419.jpg', timestampMs: at(14, 19), sizeKb: 192, projectName: 'Meridian', taskName: 'Vendor mapping' },
  { filename: 'shot-1415.jpg', timestampMs: at(14, 15), sizeKb: 210, projectName: 'Meridian', taskName: 'Vendor mapping' },
  { filename: 'shot-1752.jpg', timestampMs: at(17, 52, 1), sizeKb: 0, projectName: 'Kaleido', taskName: 'Design QA' },
];

/* ── Timer seeds per scenario ────────────────────────────────────────────── */

function seedTimer(scenario: Scenario): TimerState {
  const active: TimerState = {
    status: 'running',
    elapsed: 5772,        // 1:36:12
    elapsedToday: 5772,
    workedToday: 24120,   // 6h 42m
    thisSession: 7800,    // 2h 10m
    // Must match the main process's format — AgentContext compares this against
    // `new Date().toDateString()` to detect a midnight rollover. A literal date
    // string here fires that branch on the first tick and drops the session.
    dayKey: new Date().toDateString(),
    entryId: 'entry-1',
    taskId: 't-ledger',
    projectName: 'Northwind',
    taskName: 'Ledger rebuild',
    description: null,
  };

  switch (scenario) {
    case 'running': return active;
    case 'paused':  return { ...active, status: 'paused' };
    // Regression guard: a stale dayKey drives AgentContext's rollover branch on
    // the first tick. That branch used to wipe `isPaired` and eject the user to
    // "Session ended". The session must survive this scenario.
    case 'rollover': {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      return { ...active, dayKey: yesterday.toDateString() };
    }
    // Nothing running and no context: after a stop the store keeps neither, so
    // a relaunched agent knows only what was worked today.
    case 'stopped':
      return {
        ...active, status: 'stopped', entryId: null, taskId: null,
        taskName: null, projectName: null, elapsed: 0, elapsedToday: 0,
      };
    case 'fresh':
      return {
        status: 'stopped', elapsed: 0, elapsedToday: 0, workedToday: 0, thisSession: 0,
        dayKey: new Date().toDateString(), entryId: null, taskId: null,
        projectName: null, taskName: null, description: null,
      };
    default: return { ...active, status: 'stopped', entryId: null };
  }
}

/* ── Factory ─────────────────────────────────────────────────────────────── */

/**
 * Which API-base source the mock reports. `default` means the built-in
 * production URL; anything else means an override file or env var, i.e. a
 * staging build. v2 badges only the latter, so `?source=file` is how that
 * badge gets reviewed.
 */
let mockApiBaseSource: 'default' | 'file' | 'env' = 'default';

/** Toggled by the app-drawn maximise control so its icon can be reviewed. */
let mockMaximized = false;

export function createMockBridge(scenario: Scenario = 'running'): AgentBridge {
  const failing = scenario === 'error';
  const empty = scenario === 'fresh';

  let timer = seedTimer(scenario);
  const listeners: Array<(s: any) => void> = [];
  const idlePromptCbs: Array<(d: { idleSeconds: number }) => void> = [];
  const idleDismissCbs: Array<() => void> = [];

  // `revoked` starts paired and drops after a beat: the reducer only sets
  // wasRevoked on a paired -> unpaired transition, so a scenario that begins
  // unpaired would render the plain sign-in and never the notice.
  let paired = scenario !== 'signed-out';
  if (scenario === 'revoked') setTimeout(() => { paired = false; emit(); }, 600);

  const state = (): AgentState => ({
    isPaired: paired,
    deviceName: 'maya-mbp-14',
    userEmail: 'maya@northwind.studio',
    apiHost: 'app.docuflow.io',
    apiBase: 'https://app.docuflow.io',
    apiBaseSource: mockApiBaseSource,
    timer,
  });

  function emit() { listeners.forEach((cb) => cb(state())); }

  function patch(next: Partial<TimerState>) { timer = { ...timer, ...next }; emit(); }

  // Live tick so the readout actually moves — the design has to survive a
  // number that changes every second.
  setInterval(() => {
    if (timer.status !== 'running') return;
    patch({
      elapsed: timer.elapsed + 1,
      elapsedToday: timer.elapsedToday + 1,
      workedToday: timer.workedToday + 1,
      thisSession: timer.thisSession + 1,
    });
  }, SECOND);

  /** Fire the idle prompt from the console: `__mockIdle(720)` */
  (window as any).__mockIdle = (idleSeconds = 720) => {
    patch({ status: 'paused' });
    idlePromptCbs.forEach((cb) => cb({ idleSeconds }));
  };

  return {
    getState: async () => state(),
    timerState: async () => timer,

    login: async ({ email }) => {
      if (failing) return { ok: false, error: 'Cannot reach app.docuflow.io' };
      if (!email.includes('@')) return { ok: false, error: 'Invalid email or password.' };
      return { ok: true };
    },
    // Real unpair clears the session, so getState must stop reporting paired —
    // otherwise Sign out looks broken in the harness and works in the build.
    unpair: async () => { paired = false; emit(); return { ok: true }; },

    // Copies, not the backing arrays. Real IPC serialises across the process
    // boundary, so the renderer can never hold a reference the main process
    // later mutates — handing out the live array here made a create look like
    // it had inserted twice.
    getProjects: async () => {
      if (failing) return { ok: false, data: [] };
      if (empty) return { ok: true, data: [] };
      // ?projects=N clones the fixtures into a long list. The panel pages at
      // seven rows and the fixture three hide the pager, the page reset on
      // search, and the drill-down-from-page-2 path entirely.
      const n = Number(new URLSearchParams(location.search).get('projects') ?? 0);
      if (!n) return { ok: true, data: [...PROJECTS] };
      const many = Array.from({ length: n }, (_unused, i) => {
        const base = PROJECTS[i % PROJECTS.length];
        const id = `${base.id}-${i}`;
        TASKS[id] ??= (TASKS[base.id] ?? []).map((t) => ({ ...t, id: `${t.id}-${i}`, crmProjectId: id }));
        return { id, name: `${base.name} ${i + 1}` };
      });
      return { ok: true, data: many };
    },

    getTasks: async ({ crmProjectId }) =>
      failing ? { ok: false, data: [] } : { ok: true, data: empty ? [] : [...(TASKS[crmProjectId] ?? [])] },

    createProject: async ({ name }) => {
      if (failing) return { ok: false, error: 'Cannot reach app.docuflow.io' };
      const project: Project = { id: `p-${Date.now()}`, name };
      PROJECTS.push(project);
      TASKS[project.id] = [];
      return { ok: true, data: project };
    },

    createTask: async ({ crmProjectId, name }) => {
      if (name.length > 120) return { ok: false, error: 'Task name is too long (120 characters max).' };
      const task: Task = { id: `t-${Date.now()}`, name, crmProjectId };
      (TASKS[crmProjectId] ??= []).push(task);
      return { ok: true, data: task };
    },

    timerStart: async ({ taskId, taskName, projectName, taskDurationToday }) => {
      patch({
        status: 'running', entryId: `entry-${Date.now()}`,
        taskId: taskId ?? null, taskName: taskName ?? null, projectName,
        elapsed: taskDurationToday ?? 0, elapsedToday: taskDurationToday ?? 0,
      });
      return { ok: true };
    },
    timerPause: async () => {
      if (failing) return { ok: false, error: 'Cannot pause — server unreachable' };
      patch({ status: 'paused' }); return { ok: true };
    },
    timerResume: async () => {
      if (failing) return { ok: false, error: 'Cannot resume — server unreachable' };
      patch({ status: 'running' }); return { ok: true };
    },
    // Mirrors AgentStore.clearTimer: stopping drops the entry *and* the context.
    // The UI's "last task" after a stop comes from the recent-task list, not
    // from TimerState, and a mock that kept the names hid that entirely.
    timerStop: async () => {
      patch({
        status: 'stopped', entryId: null, taskId: null, taskName: null, projectName: null,
        elapsed: 0, elapsedToday: 0,
      });
      return { ok: true };
    },

    idleBreak: async () => { patch({ status: 'stopped', entryId: null }); idleDismissCbs.forEach((cb) => cb()); return { ok: true }; },
    idleResume: async () => { patch({ status: 'running' }); idleDismissCbs.forEach((cb) => cb()); return { ok: true }; },
    onIdlePrompt: (cb) => { idlePromptCbs.push(cb); return () => idlePromptCbs.splice(idlePromptCbs.indexOf(cb), 1); },
    onIdleDismiss: (cb) => { idleDismissCbs.push(cb); return () => idleDismissCbs.splice(idleDismissCbs.indexOf(cb), 1); },

    getTodayBreakdown: async () => {
      if (failing) return { ok: false, rows: [], error: "Failed to load today's breakdown." };
      if (empty) return { ok: true, rows: [] };
      // ?entries=N pushes the table past what fits, which is the only way to
      // see the "N more entries today" line the no-scrollbar rule depends on.
      const n = Number(new URLSearchParams(location.search).get('entries') ?? 0);
      if (!n) return { ok: true, rows: BREAKDOWN };
      const many = Array.from({ length: n }, (_unused, i) => {
        const base = BREAKDOWN[i % BREAKDOWN.length];
        return { ...base, taskId: `${base.taskId ?? 'legacy'}-${i}`, activeSeconds: i === 0 ? base.activeSeconds : undefined };
      });
      return { ok: true, rows: many };
    },
    getWorkedToday: async () => ({ ok: !failing, total: timer.workedToday }),
    getWorkedPeriod: async (startIso) => {
      if (failing) return { ok: false, total: 0 };
      // week 28h 15m / month 104h 03m, matching the hover card in the exports
      const isMonth = new Date(startIso).getDate() === 1;
      return { ok: true, total: isMonth ? 374580 : 101700 };
    },

    listScreenshots: async () => {
      if (failing) return { ok: false, data: [] };
      if (empty) return { ok: true, data: [] };
      // ?shots=N reproduces a real capture history — a working device holds
      // hundreds, and the fixture list of five hid every problem that only
      // appears at that volume.
      const n = Number(new URLSearchParams(location.search).get('shots') ?? 0);
      if (!n) return { ok: true, data: SCREENSHOTS };
      const many = Array.from({ length: n }, (_, i) => {
        const base = SCREENSHOTS[i % SCREENSHOTS.length];
        return { ...base, filename: `shot-${i}.jpg`, timestampMs: base.timestampMs - i * 240_000 };
      });
      return { ok: true, data: many };
    },
    readScreenshot: async (filename) =>
      filename === 'shot-1752.jpg' ? { ok: false } : { ok: true, dataUrl: STRIPE_TILE },

    getOrgPolicy: async () =>
      failing ? null : {
        screenshotsEnabled: true,
        idlePromptEnabled: true,
        idleTimeoutMinutes: 10,
        idleCountdownSeconds: 0,
      },

    getLocalPrefs: async () => ({ openAtLogin: true, isPackaged: false, appVersion: '2.4.1' }),
    setOpenAtLogin: async () => ({ ok: true }),
    resetWidgetPosition: async () => ({ ok: true }),
    // The harness frames the app itself; resizing is the Electron window's job.
    // It reports app chrome so the drawn title bar and the rounded corners can
    // be reviewed here — that is the state the packaged app runs in.
    setWindowLayout: async () => ({ ok: true, chromeApplied: true }),

    // Window controls exist so the app-drawn title bar can be reviewed here.
    // They log rather than act — the harness has no window to minimise.
    windowMinimize: async () => { console.info('[mock] window.minimize'); return { ok: true }; },
    windowToggleMaximize: async () => {
      mockMaximized = !mockMaximized;
      console.info('[mock] window.toggleMaximize ->', mockMaximized);
      return { ok: true, maximized: mockMaximized };
    },
    windowHide: async () => { console.info('[mock] window.hide — agent keeps running'); return { ok: true }; },
    windowIsMaximized: async () => ({ maximized: mockMaximized }),
    onWindowMaximizedChange: () => () => {},
    copyToClipboard: async (text) => { await navigator.clipboard?.writeText(text).catch(() => {}); return { ok: true }; },
    getDisplayTimezone: async () => 'local',
    setDisplayTimezone: async () => ({ ok: true }),

    checkUpdate: async () => ({
      ok: true, updateAvailable: true, currentVersion: '2.3.9',
      latestVersion: '2.4.1', downloadUrl: 'https://app.docuflow.io/downloads/desktop/latest',
    }),

    openExternal: (url) => console.info('[mock] openExternal', url),
    onStateUpdate: (cb) => { listeners.push(cb); },
    onLoginProgress: (cb) => {
      // Replays the real progress sequence so the button label can be designed.
      const steps = ['Connecting…', 'Authenticating…', 'Pairing device…'];
      steps.forEach((message, i) => setTimeout(() => cb({ message }), (i + 1) * 400));
      return () => {};
    },
  };
}

/**
 * The floating bar talks to a different, much smaller bridge than the main
 * window. Same scenarios so the two surfaces can be compared side by side.
 */
export function createMockWidgetBridge(scenario: Scenario = 'running') {
  let timer = seedTimer(scenario);
  const listeners: Array<(s: any) => void> = [];
  const failing = scenario === 'error';

  function emit() { listeners.forEach((cb) => cb({ timer })); }

  setInterval(() => {
    if (timer.status !== 'running') return;
    timer = { ...timer, elapsed: timer.elapsed + 1, elapsedToday: timer.elapsedToday + 1 };
    emit();
  }, SECOND);

  return {
    getState: async () => ({ timer }),
    timerPause: async () => {
      if (failing) return { ok: false, error: 'Cannot pause — server unreachable' };
      timer = { ...timer, status: 'paused' as const }; emit(); return { ok: true };
    },
    timerResume: async () => {
      if (failing) return { ok: false, error: 'Cannot resume — server unreachable' };
      timer = { ...timer, status: 'running' as const }; emit(); return { ok: true };
    },
    dismiss: async () => { console.info('[mock] widget dismissed — tracking continues'); },
    openMain: async () => { console.info('[mock] openMain'); },
    moveWindow: (x: number, y: number) => console.info('[mock] moveWindow', x, y),
    getWindowPos: async () => [0, 0] as [number, number],
    onStateUpdate: (cb: (s: any) => void) => { listeners.push(cb); },
  };
}

/** Scenario comes from ?scenario= so a review link can point at one state. */
export function installMockBridge(): Scenario {
  const params = new URLSearchParams(location.search);
  const src = params.get('source');
  if (src === 'file' || src === 'env') mockApiBaseSource = src;

  const param = params.get('scenario') as Scenario | null;
  const scenario: Scenario = param ?? 'running';
  (window as any).agentBridge = createMockBridge(scenario);
  (window as any).widgetBridge = createMockWidgetBridge(scenario);
  return scenario;
}
