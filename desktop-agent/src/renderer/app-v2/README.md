# Desktop Agent — v2 UI (rail layout)

Built against the handoff in `design_handoff_docuflow_agent/` — a three-column
desktop shell (**icon rail 78 → context panel 292 → stage**) with four screens:
Timer, Activity, Screens, Settings.

Two rules from that handoff are structural, not decoration:

1. **No scrollbars anywhere.** Scrollbars are hidden globally *and* every pane
   is `overflow: hidden`, so nothing is silently cut — lists page, the capture
   grid pages, the activity table truncates with an explicit "N more" line.
2. **Every action gives feedback.** Press-scale on controls, one toast per
   mutation (single slot, 2.2s), a loading label on Refresh, a pulsing ring on
   the play button while recording. `prefers-reduced-motion` drops the
   animations and keeps the static ring.

## Why it lives beside the old UI

`src/renderer/app/` is untouched and still ships. v2 is a parallel view layer
that reuses the existing `AgentContext` and `window.agentBridge`, so **no logic
was rewritten**: the main process, the four workers, the timer reducer and every
IPC handler behave as before.

Two files outside this folder were edited:

- `src/renderer/index.tsx` — picks a UI at boot (unchanged from before).
- `src/main/index.ts` — a new `ui:set-window-layout` handler. The window is
  created at v1's portrait 680×780; three columns need landscape, and *which*
  UI booted is a renderer-side decision, so the renderer asks for 1020×660
  (min 820×560) once it knows. A window the user has already sized past that
  minimum is left alone.

## Switching UI

Both interfaces are in every build. From DevTools:

```js
localStorage.setItem('docuflow-ui', 'v2'); location.reload();  // rail layout
localStorage.removeItem('docuflow-ui');    location.reload();  // current build
```

Rolling back a bad v2 build is a key, not a revert.

## Developing without Electron

```bash
npm run harness   # http://localhost:5180
```

The harness stubs `window.agentBridge` with `src/renderer/dev/mockBridge.ts` and
frames the app at its real sizes (1020×660, 820×560, and the 380×44 activity
bar). Every state the design covers is one click away.

Query parameters worth knowing — the fixture data is small, and small data
hides exactly the cases the no-scrollbar rule exists for:

| Parameter | What it exercises |
|---|---|
| `?scenario=…` | `running`, `paused`, `stopped`, `fresh`, `signed-out`, `revoked`, `error`, `rollover` |
| `?projects=20` | panel pager, page reset on search, drill-down from a later page |
| `?entries=17` | activity table truncation and the "N more entries today" line |
| `?shots=40` | capture grid paging |
| `?source=file` | the DEV badge (staging server) |

Fire the idle prompt from the console: `__mockIdle(720)`.

## Structure

```
App.tsx              shell: rail + the active screen + idle overlay
ui/UiContext.tsx     view state — search, drill-down, settings section, toast
ui/useActiveTask.ts  which task the Timer is about (see "Stop" below)
ui/useFitCount.ts    how many rows fit a pane
ui/useGridFit.ts     how many capture cards fit the stage
components/          Rail, Panel primitives, Stage, Toast, IdlePrompt, UpdateBanner
screens/             one file per tab where panel and stage share data
panels/, pages/      the Timer halves, which are big enough to split
```

Each screen owns **both** its panel and its stage. Activity's day list needs the
same breakdown the table renders; Screens' day list needs the same captures the
grid pages. Splitting them across a context would mean fetching twice.

## Decisions worth knowing

- **Page sizes are measured, not hard-coded.** The handoff's 7 rows / 6 captures
  / 4 entries are right at 1020×660 only. `useFitCount` and `useGridFit` measure
  the pane, so a resized window pages instead of clipping.
- **Stop keeps the task, ✓ clears it.** The API has no "complete" call — ✓ is a
  stop plus a UI decision (`UiContext.completedKey`). And the store's
  `clearTimer()` drops the project and task names with the entry, so the task
  still shown after a stop comes from `AgentContext.recentTasks`, which also
  carries the CRM project id the play button needs to start it again.
- **Task counts and task-name search** need a server call per project. They are
  fetched for the projects actually on screen and cached; a project whose tasks
  have not loaded yet still matches on its own name.
- **Past days show a total only.** The agent exposes per-entry detail for today
  and totals for any period. The stage says where the rest lives rather than
  implying a past day was empty.
- **The rail is Case Ink.** Marketing has no icon rail to copy; the dark band is
  how that system carries structure, so the rail takes it. The active tab is
  still the white notch merging into the panel, with amber marking which tab it
  is — the same "this is the current one" job amber does on the site.
- **The transport buttons are colour-coded**, and they keep the media-transport
  convention rather than the brand's amber-is-now rule: green while recording,
  amber while held, red to stop, mint ✓. Three controls that do different and
  partly irreversible things must not read as one grey row. The pulse ring
  follows the button colour (`--transport-rgb`), and the glyph flips to ink on
  amber because amber never carries white.
- **The avatar is a menu**, not decoration: account, Settings, open the web app,
  check for updates, sign out. It is the only place in the shell that stands
  for "you", so the account actions live there instead of only in Settings.
- **"Capture now" is not built.** The agent has no manual-capture path — the
  worker captures on its own schedule while a timer runs.
- **The stage's fake window dots are not built.** The window has real controls
  from the OS; a second, dead set beside them is a control that lies.

## Tokens

`styles/tokens.css` has two layers. The palette mirrors
`docuflow-marketing/src/styles/global.css` value for value under the same names,
so the two surfaces can be diffed; the semantic layer is what components
reference (`--surface-card`, `--accent`, `--text-muted`). Components must never
use a raw hex or a palette variable directly — retheming should mean editing one
block.

The brand rule is a cold clerical ground (Case Ink `#0F1524`, Cold Stock
`#F3F5F7`, Card White, Archive Slate, Divider Grey) with exactly two chromatic
voices: **amber `#E9A23B` = the current thing** (primary action, running timer,
selected row) and **green `#1F9D6B` = a confirmed result** (logged entries,
on-states, capture counts). Amber carries ink text, never white — `#E9A23B`
under white is 1.9:1 — and it never becomes a resting border or body text; text
that wants to be amber uses `--accent-text` (`#8A5A0F`).

Four tokens are additions the marketing system does not define, each marked
DERIVED in the file: a destructive red (marketing has none, a timer needs one),
a second muted slate for row meta, a softer in-card hairline, and the darkened
amber above.

Fonts are the brand's, bundled from `fonts/` (5 woff2, ~95KB): **Cabinet
Grotesk** for headings and **Switzer** for everything else. Numerals stay on
Switzer — Cabinet Grotesk has no tabular figures, so a 92px clock in it jumps
~120px between `11:11` and `00:00`.

## Status

| Surface | File |
|---|---|
| Shell + rail | `App.tsx`, `components/Rail.tsx` |
| Timer | `panels/TimerPanel.tsx`, `pages/TimerPage.tsx` |
| Activity | `screens/ActivityScreen.tsx` |
| Screens | `screens/ScreensScreen.tsx` |
| Settings | `screens/SettingsScreen.tsx` |
| Login | `pages/LoginPage.tsx` |
| Idle prompt | `components/IdlePrompt.tsx` |
| Activity bar | `Widget.tsx` — not part of this handoff, restated in the new tokens |

Not done: the tray icon and its menu (native, `src/main/`), and wiring
`Widget.tsx` into the `widget_window` entry in `forge.config.ts` — the harness
renders it, but the packaged app still loads the old `widget.tsx`.
