# Phase 8 the customer journey, walked and recorded

- **Recorded:** _(fill: date the run finished)_
- **Ticket:** [#232](https://github.com/Lamakira/docuflow/issues/232) (Spec [#228](https://github.com/Lamakira/docuflow/issues/228), ADR-0002, ADR-0007, ADR-0010, ADR-0017, ADR-0018)
- **Verdict:** _(fill after the run — do not write it in advance)_

This is the ticket that closes [#228](https://github.com/Lamakira/docuflow/issues/228).
The three before it each retired one risk in isolation: [#229](https://github.com/Lamakira/docuflow/issues/229)
proved Checkout against real Stripe, [#230](https://github.com/Lamakira/docuflow/issues/230)
reopened self-service registration, and [#231](https://github.com/Lamakira/docuflow/issues/231)
pointed the marketing site's calls-to-action at the application. None of them
walked the whole thing in one sitting, and no recorded run has ever started
where a real visitor starts — on the marketing site.

**Cells are left empty rather than inferred.** A step that was not observed is
written as not observed. The `Active` projection is read out of
`workspace_billing`, never taken from Checkout's redirect.

## This run is local, and that is a departure from the ticket

[#232](https://github.com/Lamakira/docuflow/issues/232) asks for the journey
"in the parallel environment". **This run is on `localhost` instead**, and the
reason is recorded here rather than left for a reader to discover:

- The marketing site is not deployed anywhere. `docuflow-marketing` carries no
  deployment configuration at all, so step 1 — landing on the site — has no
  hosted destination to land on. It is served from `npm run dev` here.
- The application is the local development server, against the local Postgres
  on port 5434, with the Stripe CLI forwarding webhooks.

What that costs, stated plainly: this run proves that the journey **works**. It
does not prove that it works **on the deployed environment**, which is what
[#228](https://github.com/Lamakira/docuflow/issues/228) wanted when it said the
journey should not be "first attempted in front of an audience". The criteria
this leaves unmet are listed in **Acceptance criteria** and are not quietly
marked green.

## The environment, pinned before the run

Both interfaces are the new ones. This is a decision, not a default, and it is
written down because a mixed run would record an experience no customer will
ever have.

| | Chosen | How it is set |
| --- | --- | --- |
| Web chrome | **v2** | `webAppV2` is `dev: true` in `client/src/lib/featureFlags.ts`, so `npm run dev` already serves it. Nothing is overridden, and `prod` stays `false` |
| Desktop agent UI | **v2** | `npm run dev:v2` in `desktop-agent/` (`DOCUFLOW_UI=v2`). The packaged default is still v1; a packaged build needs `DOCUFLOW_UI=v2 npm run dist:linux`, or the `docuflow-ui` key at runtime |

Neither flag is retired by this run. Both are temporary by ADR-0017's
discipline, and each has its own retirement step — the web flag's default, and
the agent's switch plus `src/renderer/app/`. Those belong to their own ticket.

## What must be true before the run

| # | Precondition | Why | Ready |
| --- | --- | --- | --- |
| 1 | Postgres on **5434** up | The dev database does not survive a reboot here | |
| 2 | **Every pending migration applied** (`npm run db:migrate`) | The Worker calls `completeDueAccountDeletions` on its first tick and exits if `account_deletions` is absent | |
| 3 | `stripe listen --forward-to http://localhost:5000/api/billing/webhooks` running **first** | It prints the `whsec_` the HTTP server must already hold at boot | |
| 4 | HTTP server started **after** the CLI, with that `whsec_` in `.env` | A secret from another Stripe account rejects every delivery; since Defect C that now logs `billing.webhook_secret_mismatch` | |
| 5 | A **`DOCUFLOW_ROLE=worker`** process running | Without it the projection Job never runs and the Workspace never leaves `Trialing`. The Checkout redirect returns before the Job | |
| 6 | The marketing site on `APP_URL=http://localhost:5000 npm run dev` | So the run starts where a visitor starts, and the CTA reaches this application | |
| 7 | Stripe preconditions 1–9 of [`phase-8-stripe-checkout.md`](phase-8-stripe-checkout.md) | Test mode, a recurring Price with no trial period, Stripe Tax on, `STRIPE_PRICE_PRO` | |
| 8 | A **browser with no existing session** (private window) | A visitor who already has a session hits a known defect at step 2 — see **Defects** | |
| 9 | The desktop agent buildable and runnable on this machine | Step 6 needs a paired Device, a running Timer, and a capture arriving | |
| 10 | `/health` checked for `commit` and `startedAt` | Since Defect D, do not trust `status: ok` from a stale server | |

## The run

One sitting. No database write by hand, no Administrator acting for the
visitor, no code change mid-run. If any of those three becomes necessary, the
run stops and the reason is written in **Defects**.

| # | Step | Observed | Time (UTC) |
| --- | --- | --- | ---: |
| 1 | Land on the marketing site | | |
| 2 | Follow a "Start free trial" call-to-action into the application | | |
| 3 | Create an account — no Invitation, no Administrator | | |
| 4 | Name the first Workspace, become its Owner, enter `Trialing` | | |
| 5a | Start Checkout from the v2 Administration UI | | |
| 5b | Pay with a test card, return to the application | | |
| 5c | **Read `workspace_billing` and see `Active`** | | |
| 6a | Create a record — a client, a project | | |
| 6b | Track time from the web timer | | |
| 6c | Open a File | | |
| 6d | Invite someone | | |
| 6e | Pair a Device from the desktop agent | | |
| 6f | Run the Timer from the agent, see the time arrive | | |
| 6g | See a capture arrive in the web application | | |

### Reading the projection

`Active` is read from the database, not from the redirect. The query and the
row go here, with the moment `billing_state` changed:

```
(fill: the query used, and the row it returned)
```

## Viewports

The journey is walked wide and narrow. Narrow is not a screenshot of a wide
run — it is walked.

| Width | Walked | What broke or degraded |
| --- | --- | --- |
| Wide (≥ 1280px) | | |
| Narrow (≤ 400px) | | |

## Defects

Two lists, deliberately separate. The first stops the journey; the second only
makes it worse and feeds the parity spec rather than being fixed here.

### Blocking

| # | What | Where | Filed as |
| --- | --- | --- | --- |
| | | | |

### Degrading

| # | What | Where | Filed as |
| --- | --- | --- | --- |
| | | | |

### Known before the run

| What | Where | Filed as |
| --- | --- | --- |
| A visitor who already has a session and follows "Start free trial" lands on `NotFound`. The authenticated router redirects `/auth` to `/` but has no `/signup` or `/sign-up` route, so both fall through — `NotFound` under v1 chrome, `V2PlaceholderPage` under v2 | `client/src/App.tsx`, `client/src/v2/V2AuthenticatedApp.tsx` | _(fill: issue)_ |
| The marketing site sells Starter, Growth, Business and Enterprise, and the Plan Registry knows only `legacy`, `trial` and `pro`. One Stripe Price is configured. Entitlements carry seats and two rate limits — no feature is gated by plan, so the site's comparison table is not enforced anywhere | `server/modules/billing/planRegistry.ts`, `docuflow-marketing/src/data/site.ts` | _(fill: issue)_ |
| `?plan=` travels from the pricing cards into the sign-up URL and nothing reads it | `docuflow-marketing/src/data/app.ts` | _(fill: issue)_ |
| `client/src/hooks/useScreenCapture.ts` is dead — superseded by `ScreenCaptureWebService`, which is the live one — and implements a web capture path that could never replace the agent | `client/src/hooks/useScreenCapture.ts` | _(fill: issue)_ |

### Found while setting the run up, before step 1

Both were hit within twenty minutes of starting, by an operator who had been
warned about neither. They are recorded as **blocking**: the run could not
begin until both were understood.

| # | What | Where | Filed as |
| --- | --- | --- | --- |
| S1 | **The desktop agent targets production by default.** `DEFAULT_API_URL = "https://docs.appvibed.com"` is committed here and is the last resort in `resolveApiBase`, so `npm run dev:v2` with no override authenticates against production, refreshes a live credential, and arms screen capture. It logged `auth.refresh.success`, six heartbeats, and synced a `resume` and a `pause` onto a real production time entry before anyone noticed. Capture uploaded nothing for one reason only — `Skipping — timer not running`. ADR-0018 forbids exactly this: the repository "must never contain production credentials, **production URLs**, or any data-plane connection to production systems". The default should be local, or absent, with production set explicitly | `desktop-agent/src/lib/config.ts:28` | _(fill: issue)_ |
| S2 | **`Ctrl+C` does not stop the agent.** It kills the `electron-forge start` parent in the terminal and returns the prompt, while the Electron main process and its children keep running — still pointed at whatever server they booted against, still heartbeating, still writing. Here it survived the interrupt by twenty minutes and kept rewriting `agent-config.json` and `agent-queue.json`, and killing its children was not enough because the main process respawned them. The operator believed the agent was stopped and relaunched a second one on top of it. Nothing in the terminal says the app is still alive | `desktop-agent/`, `npm run dev` / `dev:v2` | _(fill: issue)_ |

**What the run must do because of S1 and S2**, until they are fixed:

- Launch the agent only as `DOCUFLOW_API_URL=http://localhost:5000 npm run dev:v2`,
  and read the first log line before touching anything:
  `API_BASE=http://localhost:5000 (source: env)`. If it names any other host,
  stop.
- Move `~/.config/docuflow-desktop-agent/agent-config.json` and `agent-queue.json`
  aside first. A queue written against one server must not be drained against
  another, in either direction. They were moved to `*.prod.bak` for this run.
- Stop the agent by killing the Electron **main** process, not with `Ctrl+C`, and
  verify with `pgrep -f docuflow-desktop-agent/node_modules/electron` that
  nothing is left.

## Acceptance criteria

Filled after the run. A criterion that was not met is written as not met.

| Criterion | Status | Evidence |
| --- | --- | --- |
| Completes in one sitting, no hand-written database row, no Administrator acting for the visitor, no code change mid-run | | |
| Each step recorded with its timestamp and what was observed | | |
| Walked at a narrow viewport as well as a wide one | | |
| Every defect filed, and split into blocking and degrading | | |
| Production untouched — `webAppV2` default stays `prod: false`, no live credential | | |
| The desktop agent exercised once against the same Workspace — Device paired, Timer run, time and a capture arrived | | |
| **In the parallel environment** | **Not met** | This run is local. See **This run is local** above |

## Window

| | |
| --- | ---: |
| Run started (UTC) | |
| Account created (UTC) | |
| `Trialing` entered (UTC) | |
| Checkout Session created (UTC) | |
| `billing_state` reached `Active` (UTC) | |
| First agent capture stored (UTC) | |
| Run ended (UTC) | |
