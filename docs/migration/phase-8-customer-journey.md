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
| 1 | Land on the marketing site | Served locally on `:4323`, private window | _(fill)_ |
| 2 | Follow a "Start free trial" call-to-action into the application | Reached the application's sign-up | _(fill)_ |
| 3 | Create an account — no Invitation, no Administrator | `pr-user-test-1@protonmail.com`, `users.id 8ae259f4`. No Invitation row, no Administrator acted | 10:44:13 |
| 4 | Name the first Workspace, become its Owner, enter `Trialing` | Workspace `40a3474e` "User's Workspace". Membership role **Owner**, not archived. `plan_key=trial`, `billing_state=Trialing`, 1 seat, `trial_ends_at 2026-10-02 10:44:17`, both Stripe ids null. Four seconds after the account | 10:44:17 |
| 5a | Start Checkout from the v2 Administration UI | `Start Pro` on the Billing card, which read Plan Trial, Condition Trial, 1 of 1 seats, trial ending 2 Oct, writes allowed | _(fill)_ |
| 5b | Pay with a test card, return to the application | Hosted Checkout, test card, returned to the application. Four events landed in `billing_webhook_inbox` | _(fill)_ |
| 5c | **Read `workspace_billing` and see `Active`** | `plan_key=pro`, `billing_state=Active`, 1 seat, `authorization_version` 2, `trial_ends_at` cleared, `period_ends_at 2026-10-18 10:51:36`, `cus_VHYVMvI3EN8KYO` / `sub_1UGzOJGJ9wdyG8Wi4ZkodgEN`. The audit row reads `provider_projection`, so the Worker's Job wrote it — not the redirect | 10:51:43 |
| 6a | Create a record — a client, a project | | |
| 6b | Track time from the web timer | | |
| 6c | Open a File | | |
| 6d | Invite someone | Invitation `177aece4` for `prt-user-test-2@protonmail.com`, `pending`, expiring 2026-10-02. No email was delivered — this environment boots `email unconfigured`, so the Invitation exists and its link works while the notification does not. Seats were raised 1 → 2 → 3 first, through `stripe.subscriptions.update` with no hosted Checkout, projected to `purchased_seat_capacity = 3` and `authorization_version` 4 | 11:56:47 |
| 6e | Pair a Device from the desktop agent | `auth.pair.success — user=pr-user-test-1@protonmail.com device=1ce6ae3a`, against `http://localhost:5000`, agent UI v2 | 11:02 |
| 6f | Run the Timer from the agent, see the time arrive | `time_entries` `1398e595`, `status=running`, a server UUID rather than a `local-` placeholder, `crm_project_id 1253368f`, `task_id d22875f0`, `workspace_id 40a3474e`. Blocked first by **B2** and recorded after the fix | 11:23:47 |
| 6g | See a capture arrive in the web application | **Not met, and not a product defect.** The agent captured — `screenshot.capture`, a 408 KB PNG written to disk — and the activity metrics reached the database with it: `keyboard_activity_percent 25`, `mouse_activity_percent 48`, the signal a browser cannot produce. The upload failed: this environment resolves object storage to Replit App Storage, which authenticates against a sidecar at `127.0.0.1:1106` that does not exist outside Replit. Both rows are still `storage_key = pending-…` with an empty `content_hash` | capture 11:24:16 |

### Reading the projection

`Active` is read from the database, not from the redirect. The query and the
row go here, with the moment `billing_state` changed:

```
select plan_key, billing_state, purchased_seat_capacity, authorization_version,
       trial_ends_at, period_ends_at, stripe_customer_id, stripe_subscription_id, updated_at
  from workspace_billing where workspace_id = '40a3474e-b108-446e-bf5e-1988d6054294';

pro | Active | 1 | 2 | (null) | 2026-10-18 10:51:36 |
cus_VHYVMvI3EN8KYO | sub_1UGzOJGJ9wdyG8Wi4ZkodgEN | 2026-09-18 10:51:43.898
```

The audit trail for the same Workspace, which is what separates the projection
from the redirect:

```
10:44:17  billing.state_transition  null -> Trialing   {"reason": "trial_started"}
10:44:17  workspace.created         {"name": "User's Workspace"}
10:51:43  billing.state_transition  Trialing -> Active {"reason": "provider_projection"}
10:51:43  billing.plan_change       trial -> pro
```

`provider_projection` is the Worker's Job. `authorization_version` moved 1 -> 2,
so entitlements were recomputed rather than the row merely touched. Seven
minutes twenty-six between `Trialing` and `Active`, almost all of it the
operator at the hosted Checkout.

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
| B2 | **The agent's timer cannot start on a Task it did not just create.** `GET /api/agent/tasks` returned `id`, `name`, `status` and `durationToday` and left out `crmProjectId`, while `POST /api/agent/tasks` had always returned it. `POST /api/agent/timer/start` demands `crmProjectId`, and the v2 timer panel reads it off the listed Task — so every start from an existing Task sent `undefined` and came back `400 crmProjectId is required`. The agent then retried in a loop: start, fail, resync to `server=stopped`, start again. The renderer's `Task` type declares `crmProjectId: string` as required, so TypeScript could not see that the wire never carried it; `ApiClient`'s own `TaskSummary` had it optional, which was the honest shape. Two responses for one resource disagreed | `server/agentRoutes.ts:930` | **Fixed in this branch** — the list now carries `crmProjectId`, covered in `tests/characterization/agent-workspace.test.ts` |
| B3 | **Project Documentation leaks the same way, through a different query.** After B1 was fixed, `Folder 1` was still listed — on the Project Documentation screen this time, `ACCESS: ASSIGNED`, updated 10 SEP, in a Workspace created that morning. `getDocumentationEnabledProjects` carried the comment "Company-wide visibility - return all documentation-enabled projects" and no predicate. That comment is a single-tenant leftover: "company-wide" meant the whole install when there was one company per install. `projects` and `crm_projects` both carry `workspaceId`, and both sides of the join are now scoped | `server/modules/postgresStorage.ts:1355` | **Fixed in this branch**, covered in `tests/smoke/workspace-context.test.ts` |
| B1 | **Workspace Documents are not scoped to a Workspace.** A Workspace created minutes earlier, by a stranger who had just paid, listed `Folder 1` — a folder belonging to the seeded Workspace, carrying a real employee's name as last editor and a date from before the account existed. `company_document_folders.workspace_id` for that row is the literal string `seeded`, so the row is not the new Workspace's; the register simply does not filter. All twelve `*CompanyDocument*` methods in `postgresStorage.ts` query the tables with no workspace predicate — `getCompanyDocumentFolders`, `getCompanyDocumentFolder`, `createCompanyDocumentFolder`, `updateCompanyDocumentFolder`, `deleteCompanyDocumentFolder`, `getCompanyDocuments`, `getCompanyDocument`, `createCompanyDocument`, `updateCompanyDocument`, `deleteCompanyDocument`, `searchCompanyDocuments`, `searchCompanyDocumentFolders`. Read, write **and delete**: a Workspace holding another's document id can modify or delete it. `server/embeddings.ts:440` reads every folder in the database, so Ask DocuFlow is in the same blast radius. The preview panel on the same screen promises the opposite in as many words — "Restricted items never appear in this register, search results, Ask DocuFlow answers, or notifications". The helper this code needs exists and is used elsewhere: `inWorkspace()`, as `effectiveEntitlements` uses it | `server/modules/postgresStorage.ts:1491-1640`, `server/embeddings.ts:440` | **Fixed in this branch** — see below |

`inWorkspace` is not the same subject as the row-level security ADR-0018 and
[#228](https://github.com/Lamakira/docuflow/issues/228) place out of scope.
RLS is defence in depth under the application; this is the application itself
handing one tenant another tenant's rows. It stops the journey: step 6c cannot
be recorded as a customer opening *their* File.

**Fixed during the run**, which is a departure from "no code change mid-run" and
is recorded as one. The run stopped, the defect was closed, and step 6c restarts
after it. The alternative was to record a customer opening somebody else's File
and call the journey walked.

Ten queries gained `inWorkspace()` — the four folder methods, the four document
methods, and both searches; the two creates already stamped the Workspace. The
embedding path was scoped through the document the chunk belongs to, because
`company_document_embeddings` carries no `workspace_id` of its own: the semantic
search and the count now test `EXISTS (… company_documents.workspace_id = …)`,
and `rebuildAllCompanyDocumentEmbeddings` repairs only the caller's Workspace
rather than every tenant's index from one tenant's button.

`tests/smoke/workspace-context.test.ts` gained the case, written before the fix
and failing on the first assertion — Workspace A listed two folders where one
was its own. It now proves that A cannot list, read, search, edit or delete B's
folders or documents, and that knowing an id is not authority.

### The extent, measured rather than guessed

B3 arriving straight after B1 made clear that fixing screens as they surface is
not a strategy. The audit below was run instead: every `postgresStorage.ts`
method that reads or writes a table carrying `workspaceId`, and mentions neither
`inWorkspace`, `stampWorkspace`, nor `workspaceId` anywhere in its body.

**32 Workspace-owned tables. 18 such methods remain**, after B1 and B3:

| Line | Method | Table |
| ---: | --- | --- |
| 171, 176, 1373, 1380, 1487, 1492 | `getUser`, `getUserByEmail`, `getMainAdmin`, `getAllUsers`, `getAdminUserDetails`, `deleteUser` | `users` |
| 1767, 1786, 1819 | `getCrmProjectNotes`, `getCrmProjectLatestNote`, `deleteCrmProjectNote` | `crm_project_notes` |
| 1823 | `getCrmProjectStageHistory` | `crm_project_stage_history` |
| 1918, 1922 | `markNotificationRead`, `markAllNotificationsRead` | `notifications` |
| 1926 | `getAudioRecording` | `audio_recordings` |
| 1949, 1953, 1975 | `getAllCrmTags`, `getCrmTag`, `deleteCrmTag` | `crm_tags` |
| 1999 | `removeTagFromProject` | `crm_project_tags` |
| 2102 | `getCrmProjectCustomFields` | `crm_custom_field_values` |

**Not all eighteen are defects, and that is why none of them were touched here.**
A `User` is a cross-Workspace identity by definition, so `getUser` and
`getUserByEmail` are right to be unscoped. A `Notification` is defined as
belonging to one Workspace but appearing in the user's *cross-Workspace* inbox,
so `markNotificationRead` may be right too. The rest — notes, stage history,
tags, custom field values, audio recordings — look like B1 and B3, but each one
needs its own reading, and blanket-scoping them on a journey ticket would be
guessing with a delete statement.

This is a spec, not a defect list. It belongs beside the row-level security work
rather than inside #232, and #232's contribution is the measurement.

### Degrading

These feed the parity spec and are not fixed here. The v2 ones are kept in
[`docs/web-app-v2/UI-FINDINGS.md`](../web-app-v2/UI-FINDINGS.md), which is the
standing list any agent should read before touching a v2 screen.

| # | What | Where | Filed as |
| --- | --- | --- | --- |
| D5 | **A self-service Owner is locked out of Analytics in their own Workspace, and told a false reason.** `/api/admin/analytics/*` is gated by the legacy `isAdmin` middleware, which tests the global `users.role !== "admin"` column from the single-tenant era. A customer created through #217/#230 has `role = 'user'` and `is_main_admin = 0`, so every analytics route answers 403. Three things then go wrong at once: the client disagrees with the server, since `canManageAdministration()` returns true for `OWNER`; the UI reports the refusal as a missing **Capability**, which is not what happened; and it names "Administration", which is not one of the six rows in `capabilities` — so "User Test (Owner) can grant it" offers a grant that cannot exist, to the person already holding ultimate authority. The root of the poverty is `ROLE_CAPABILITIES` in `firstWorkspace.ts:40`, which gives a new Owner one capability of six under the comment "so a new one is not born poorer" — true, and the Workspace it copies is itself impoverished. This degrades rather than blocks, but it is the most serious degrading finding of the run: it reaches every paying self-service customer on their first visit to Administration | `server/routes.ts:2649`, `server/routes.ts:3276-3333`, `server/modules/workspace/firstWorkspace.ts:40`, `client/src/v2/administration.ts:196` | _(fill: issue)_ |
| D4 | **A failing screenshot upload creates a new row per retry.** One capture at `11:24:16.404` produced two `time_entry_screenshots` rows with that identical `captured_at`, `created_at` thirty-one seconds apart — the SyncWorker interval. Each retry presigns afresh instead of reusing the row it already holds. **Measured after ninety minutes of a running Timer: 41 rows for 9 distinct `captured_at` values**, a factor of 4.5 and still climbing, every one of them `storage_key = pending-…` naming an object that was never written. Independent of the environment: the same retry path runs wherever an upload fails, and a transient outage in the parallel environment would do the same at a smaller scale. Worth pairing with the observation that everything before the last hop works — the server received each image and compressed it (`382191 → 146934 bytes, 62%`) before failing on the bucket write | `desktop-agent/src/workers/SyncWorker.ts`, `server/agentRoutes.ts:583` | _(fill: issue)_ |
| D3 | Inviting into a full Workspace refuses correctly, but the refusal lands near the bottom-right of the page instead of under the Invite form: `.df-refusal-pop` is absolutely positioned against `.df-refusal-anchor`, and the invite call site is the only one of four that omits the anchor. The message names the wall without naming the seat control that lifts it | `client/src/v2/V2People.tsx:295` | [`UI-FINDINGS.md` F3](../web-app-v2/UI-FINDINGS.md) |
| D2 | The folder preview aside is a fixed 400px with no `flex-shrink`, `max-width` or breakpoint, so it overflows the viewport and slices `Manage access` in half | `client/src/v2/tokens.css:3371` | [`UI-FINDINGS.md` F2](../web-app-v2/UI-FINDINGS.md) |
| D1 | The paying Billing card gives `Cancel at period end` the same weight as `Update payment method`, with no confirmation; the seat form is an orphan between the figures and the actions; the seat input is empty while seats are 1; `Writes allowed.` is helper text for buttons it does not describe; `CONDITION` is not the domain's word for billing state | `client/src/v2/V2Administration.tsx:654-700` | [`UI-FINDINGS.md` F1](../web-app-v2/UI-FINDINGS.md) |

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
| The desktop agent exercised once against the same Workspace — Device paired, Timer run, time and a capture arrived | **Partial** | Device paired (`1ce6ae3a`) and Timer run (`1398e595`) with activity metrics stored. The capture was taken but never stored: object storage here is Replit App Storage and its sidecar is unreachable off-platform. A production credential was refused rather than borrowed (ADR-0018), and a new GCS account asks for a card, so this is left unmet rather than faked |
| **In the parallel environment** | **Not met** | This run is local. See **This run is local** above |

## Window

| | |
| --- | ---: |
| Run started (UTC) | |
| Account created (UTC) | 2026-09-18 10:44:13 |
| `Trialing` entered (UTC) | 2026-09-18 10:44:17 |
| Checkout Session created (UTC) | |
| `billing_state` reached `Active` (UTC) | 2026-09-18 10:51:43 |
| First agent capture taken (UTC) | 2026-09-18 11:24:16 |
| First agent capture **stored** (UTC) | never — see 6g |
| Run ended (UTC) | |
