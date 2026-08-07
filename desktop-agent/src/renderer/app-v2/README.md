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

   Toasts come in three kinds, because a checkmark on "Could not pause" is a
   lie: `ok` (ink pill, green tick — it happened), `now` (ink pill, amber dot —
   the current state changed) and `error` (red pill, white warning, and
   `aria-live="assertive"`). Only the failure recolours the pill; colouring all
   three would make the common case shout as loudly as the rare one.

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
- `src/lib/windowChrome.ts` — which chrome a v2 window gets, per platform:
  frameless and transparent on Linux (`app`), frameless and opaque on Windows
  (`app-opaque`, because a transparent window there loses the shadow and the
  snap and resize borders), a native frame with the traffic lights inset into
  the app's bar on macOS (`inset`). The handler answers with the mode the window
  was really built with; `data-chrome` on `<html>` carries it into the CSS.

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
- **The activity chart is measured, and the handoff's chart is not.** The design
  derives all three ranges from today's total by spreading it backwards over the
  hours, because the prototype had no history to ask for. `getWorkedPeriod` does
  have it, so `ActivityChart.tsx` queries cumulative windows sharing the range's
  start and differences them. The rule that falls out is *time counts in the
  bucket its entry started in* — a session from 09:10 to 11:30 stands whole in
  the 09 bar — which is coarse but true, where a spread would draw work into
  hours nobody worked. The bars always sum to the range total, and any range
  containing today sums to WORKED TODAY: the running timer contributes whatever
  the stat card knows that the server's stopped total does not.
- **The bar the timer is in is amber; every other bar is green.** Tracked hours
  are a logged result and green is the brand's result; the bucket still filling
  is a state, which is amber's job. It is also the only bar that moves, so the
  colour marks the one thing on the card that is not yet final. Hover names it —
  the distinction is never colour alone.
- **The day view's window is fixed at 08:00–20:00**, not sliding with the clock.
  A window ending at the current hour opens at 01:00 at noon and spends half the
  plot on hours nobody works. Nothing is dropped: the first bucket's query
  starts at midnight and the last one's ends at the next, so early starts and
  late nights fold into the end bars, which say so on hover.
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
- **The stage's window dots are real controls**, not the design's decoration —
  minimise, maximise, close — and only where the window is frameless. On macOS
  the OS still owns them, so the app draws none: a second, dead set beside the
  traffic lights would be a control that lies.

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
