# Phase 8 Checkout against Stripe in test mode

- **Recorded:** 2026-09-16
- **Ticket:** [#229](https://github.com/Lamakira/docuflow/issues/229) (Spec [#228](https://github.com/Lamakira/docuflow/issues/228), ADR-0010, ADR-0013, ADR-0017, ADR-0018)
- **Verdict:** **run, and it converted.** A Workspace in `Trialing` reached
  `Active` through a real hosted Checkout Session, a real signed webhook, and
  the projection Job, observed in `workspace_billing` rather than inferred from
  the redirect. Every cell below is filled from that run. The seven pre-run
  findings are given verdicts in **Verdicts**; the four defects the run itself
  turned up are all closed.

Checkout was built end to end — `POST /api/billing/checkout` to a hosted
session, `POST /api/billing/webhooks` with signature verification, the
idempotent `billing_webhook_inbox`, the projection Job, and the v2
Administration UI wired to all of it. Until this run it had never talked to
Stripe. What was missing was not code; it was evidence that the code runs
against the real provider.

The machinery was already covered by tests against a fake provider
(`tests/smoke/billing-checkout.test.ts`, `tests/smoke/billing-projection.test.ts`),
so no further local test was written. Only Stripe could retire the remaining
risk: the shape of a real Checkout Session, a real Subscription's status and
period fields, a real signature, and the real order and volume of delivered
events. All four are now recorded, and the third of them nearly stopped the
run — see Defect A.

## What must be true before the run

This machine already had Postgres on 5434 (dev) and 5433 (test), and
`CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` in `.env`. Stripe was the only
part missing, and the `stripe` CLI was installed for this run
(`1.50.11`, into `~/.local/bin`).

| # | Precondition | Why |
| --- | --- | --- |
| 1 | A Stripe account in **test mode** | ADR-0018. No live credential enters this environment |
| 2 | A Product and a **recurring** Price, **with no trial period** | DocuFlow owns the Trial (ADR-0010); `startTrial` sets `trial_ends_at` itself. A Stripe trial period is also a run-stopper — Finding 2 |
| 3 | **Stripe Tax activated**, with an origin address | Checkout always asks for automatic tax, so without it no Session is created — Finding 3 |
| 4 | `STRIPE_SECRET_KEY=sk_test_…` in `.env` | `server/config.ts:552` refuses anything that is not `sk_test_` |
| 5 | `STRIPE_WEBHOOK_SECRET=whsec_…` in `.env` | Printed by `stripe listen` on start. Not the Dashboard endpoint's secret |
| 6 | `STRIPE_PRICE_PRO=price_…` in `.env` | The adapter maps `pro` to this id and back; a Subscription on any other Price fails `planKeyFor` |
| 7 | The `stripe` CLI | `https://docs.stripe.com/stripe-cli` |
| 8 | A Workspace created through [#217](https://github.com/Lamakira/docuflow/issues/217) | `SeededWorkspaceCheckoutError` refuses the seeded Workspace, and `plan_key = legacy` refuses it a second time (`checkout.ts:78`) |
| 9 | **The CLI and `STRIPE_SECRET_KEY` on the same Stripe account** | Cost this run thirty minutes. Since Defect C, a run of rejected signatures with none ever accepted now logs `billing.webhook_secret_mismatch` and names both variables |
| 10 | **Every pending migration applied** (`npm run db:migrate`) | The Worker calls `completeDueAccountDeletions` on its first tick and exits if `account_deletions` is absent |
| 11 | **No stale server holding the port** | Since Defect D, `/health` carries `commit` and `startedAt`, so check those rather than trusting `status: ok` |

`DOCUFLOW_ROLE` is absent from `.env`, so passing it on the command line has
nothing to collide with.

Preconditions 9 to 11 are not deductions from the code. Each one cost this run
real time before it was understood, and each is written here so the next run
does not pay again.

## The run

Three processes, in this order. The order matters: `stripe listen` prints the
webhook secret, and the other two read it from `.env` at boot. This run used
port 5001; substitute your own.

1. The CLI forwarder. **Pin it to the same account as `STRIPE_SECRET_KEY`** —
   `stripe login` may well have paired the CLI with a different sandbox, and
   nothing downstream will tell you (Defect C):

```bash
stripe listen --api-key "$(grep -E '^STRIPE_SECRET_KEY=' .env | cut -d= -f2-)" --forward-to http://localhost:5001/api/billing/webhooks
```

2. Put the printed `whsec_…` in `.env`. Then the application:

```bash
PORT=5001 npm run dev
```

3. And the Worker, in a third terminal:

```bash
DOCUFLOW_ROLE=worker npm run dev
```

Confirm the app you are talking to is the one you just started:

```bash
curl -s localhost:5001/health
```

`commit` and `startedAt` are the answer (Defect D). Before this ticket `/health`
reported liveness only, and a four-hour-old server was indistinguishable.

The Worker returns before it binds a port (`server/index.ts:24`), so the two
`npm run dev` processes do not collide. That script sets
`NODE_ENV=development`, which turns the global `/api/` rate limiter off
(`server/app.ts:73`) — see Finding 6 for what that hides. It also runs the
client through the Vite dev server, and `webAppV2` is a **client** flag keyed on
Vite's own `import.meta.env.PROD` rather than on the server's `NODE_ENV`
(`client/src/lib/featureFlags.ts:49`, `:58`), so the dev server is what puts the
v2 chrome on.

Then, as the Owner of the #217 Workspace:

1. Sign in, open `/administration`, and press **Start Pro**
   (`client/src/v2/V2Administration.tsx:326`). It asks for
   `max(consumedSeatCount, purchasedSeatCapacity, 1)` seats — 1 for a fresh
   Workspace with one Owner — and redirects to the hosted URL.
2. Pay with Stripe's test card `4242 4242 4242 4242`, any future expiry, any
   CVC, and a full billing address: `billing_address_collection: "required"`
   means line 1, city, administrative area and postal code, not just the
   postal code. Stripe may also offer a local presentment currency ahead of the
   Price's own — this run was offered XOF beside CAD.
3. The return lands on `/administration` again — `successUrl` and `cancelUrl`
   are the same URL (`V2Administration.tsx:82`), so the page is not evidence of
   anything. It arrived **before** the Job ran. **Do not read the redirect as
   the result.** Read the projection.
4. Watch the `stripe listen` log and the Worker log. Most event types are
   answered `400` (Finding 1); that is the current behavior, and observing it
   is part of this run.

Do not filter with `--events` on the first pass. The unfiltered stream is what
produced the fourteen-row table in Evidence §5.

**Start Checkout exactly once.** Each call overwrites
`pending_checkout_session_id` and silently orphans the previous Session
(Finding 5). This run created three and paid the third.

### Reading the projection

```sql
SELECT plan_key, billing_state, purchased_seat_capacity, authorization_version,
       stripe_customer_id, stripe_subscription_id, trial_ends_at, period_ends_at,
       cancel_at_period_end, pending_seat_quantity, pending_checkout_session_id
FROM workspace_billing WHERE workspace_id = '<workspace id>';

SELECT provider_event_id, type, object_id, received_at, processed_at
FROM billing_webhook_inbox ORDER BY received_at;

SELECT id, type, attempts, max_attempts, available_at, completed_at, last_error
FROM jobs WHERE type = 'billing.project-webhook' ORDER BY created_at;

-- A Job that exhausts its attempts is DELETED from `jobs` and recorded here
-- (`server/jobs.ts:261`). If the query above returns nothing, look here before
-- concluding the Job was never enqueued.
SELECT job_id, type, attempts, last_error, enqueued_at, recorded_at
FROM dead_letters WHERE type = 'billing.project-webhook' ORDER BY recorded_at;

SELECT action, payload, created_at FROM audit_events
WHERE resource_type = 'workspace_billing' ORDER BY created_at;
```

## Rehearsal

Proved without Stripe, against the harness's disposable Postgres with
`tests/fakes/billingProvider.ts` standing in for the provider:

| Gate | Status | Evidence |
| --- | --- | --- |
| Checkout returns a hosted URL, the Workspace stays `Trialing` until the projection Job runs, then reaches `Active` with purchased seats | **Verified** | `tests/smoke/billing-checkout.test.ts:84` |
| The seeded Workspace is refused Checkout and keeps Plan `legacy` with no Stripe objects | **Verified** | `tests/smoke/billing-checkout.test.ts:58` |
| A wrong signature is rejected and an unknown event type is refused | **Verified** | `tests/smoke/billing-projection.test.ts:81` |
| A replayed event is ingested exactly once | **Verified** | `tests/smoke/billing-projection.test.ts:250` |
| Seat capacity follows the Plan Registry, and a stale provider quantity does not overwrite a local increase | **Verified** | `tests/smoke/billing-checkout.test.ts:361`, `tests/smoke/billable-seats.test.ts` |
| `STRIPE_SECRET_KEY` refuses a non-test key, naming ADR-0018 | **Verified** | `tests/smoke/config.test.ts:729` |
| The Worker survives a handler that outruns its lease and then throws | **Verified** | `tests/smoke/worker-runner.test.ts` — added by this ticket, see Defect B |
| `fetchSubscription` finds the period end on the item, on the Subscription, and refuses when it is on neither | **Verified** | `tests/smoke/billing-provider.test.ts` — added by this ticket, see Defect A |
| The same path against **real Stripe** | **Verified** | this run |

## Window

| | |
| --- | ---: |
| Run started (UTC) | 2026-09-16 13:58 |
| `billing_state` reached `Active` (UTC) | 2026-09-16 14:05:49.300 |
| Operator | @Lamakira, driven by Claude Code |
| Stripe account (test) | `acct_1UGJJcGJ9wdyG8Wi` — sandbox "Docuflow sandbox" |
| Workspace | `6f88e0a5-4d8c-45c0-a1f3-1b380e288c73` "Stripe Run 229", created through #217 |
| Price | `price_1UGJTKGJ9wdyG8WiB4Owk5Qg` — CAD 10.00 per month, recurring, no trial period |
| Stripe API version | `2026-08-26.dahlia` — the CLI's, and `stripe@22.6.0` pins the same one |
| App | `PORT=5001`, `NODE_ENV=development`, commit `2082112` plus the Defect B fix |
| Checkout Sessions created | 3 (see Finding 5) |
| Sessions paid | 1 — `cs_test_a1WQRRsiXQaIwBCWW1jt9BENYWJQhv0fsmbV5cyRGYWfKo4J3WrVrF6Ftn` |
| Re-runs needed | 2 — Defect C, then a failed form submission |

## Evidence

One section per acceptance criterion in
[#229](https://github.com/Lamakira/docuflow/issues/229). Each answer is read
from the projection or the provider, never from the Checkout redirect.

### 1. Does Trialing reach Active through the projection?

Yes.

| Field | Before Checkout | After the Job |
| --- | --- | --- |
| `plan_key` | `trial` | `pro` |
| `billing_state` | `Trialing` | `Active` |
| `purchased_seat_capacity` | 1 | 1 |
| `authorization_version` | 1 | 2 |
| `stripe_customer_id` | `null` | `cus_VGs9ueOVxtLAcw` |
| `stripe_subscription_id` | `null` | `sub_1UGKP5GJ9wdyG8WirxQaUpk9` |
| `trial_ends_at` | `2026-09-30T13:58:13.897Z` | `null` |
| `period_ends_at` | `null` | `2026-10-16T14:05:41.000Z` |
| `cancel_at_period_end` | `false` | `false` |
| `pending_checkout_session_id` | `null` | `null` — cleared by the projection |

- Hosted Session: `cs_test_a1WQRRsiXQaIwBCWW1jt9BENYWJQhv0fsmbV5cyRGYWfKo4J3WrVrF6Ftn`
- `checkout.session.completed` received `14:05:46.134Z`, inbox `processed_at` `14:05:49.328Z` — **3.19 s**
- `billing.project-webhook` Job `376e1b87-b008-4e86-96b0-daa3a0762ab3`: 1 attempt, completed `14:05:49.338Z`, no `last_error`
- `dead_letters` for this type: none
- `audit_events`: `billing.state_transition` (`Trialing` → `Active`, reason `provider_projection`) and `billing.plan_change` (`trial` → `pro`), both at `14:05:49.300Z`. No `billing.seats_change`, because capacity did not move from 1.

The Checkout return landed on `/administration` before the Job had run, which
is exactly why the redirect is not the evidence.

### 2. Signature and replay

| Check | How | Observed |
| --- | --- | --- |
| Wrong signature rejected | `POST /api/billing/webhooks` with `stripe-signature: t=1757000000,v1=deadbeef…` | **`400 {"message":"invalid signature"}`** |
| No new inbox row for the rejected call | `billing_webhook_inbox` count before and after | 2 and 2 — nothing written |
| Replay ingested once | `stripe events resend evt_1UGKP7GJ9wdyG8WiRJLybHZB` | accepted, `200` |
| `billing_webhook_inbox` row count after replay | | **2** — unchanged |
| Second `billing.project-webhook` Job enqueued on replay? | | **No** — still exactly one Job. See Finding 4 |

### 3. Seats

| Fact | Value |
| --- | --- |
| Seat quantity sent to Checkout | 1 |
| Stripe Subscription item quantity after payment | 1 |
| `purchased_seat_capacity` after the projection | 1 |
| `countConsumedSeats()` (`GET /api/billing/subscription` → `consumedSeatCount`) | 1 |
| Active (non-archived) Memberships, counted in SQL | 1 |
| `effectiveEntitlements().seatCapacity` | 1 |

Plan Registry version 1 gives `pro` `seatCapacity: "purchased"` with
`minimumSeatCapacity: 1`, so the expected capacity is `max(1, 1) = 1`. All six
agree.

### 4. Does the test-mode guard still hold?

Yes. Checked with the **fake** string `sk_live_not-a-real-key`. No real live
secret key was typed into this environment at any point, and none exists for
this account.

| Check | Observed |
| --- | --- |
| Boot with `STRIPE_SECRET_KEY=sk_live_not-a-real-key` refuses | **Refused** — config never loads |
| Exact refusal message | `STRIPE_SECRET_KEY must be a test-mode key (sk_test_…) — this environment never holds a live Stripe account (ADR-0018)` |
| No real live credential existed at any point in the run | Confirmed — the sandbox has no live mode in use |

### 5. Every event the run delivered

One conversion, fourteen deliveries, **eleven of them answered `400`**.

| # | Event type | HTTP | Inbox row | Job | `processed_at` |
| --- | --- | --- | --- | --- | --- |
| 1 | `customer.created` | `400` | no | no | — |
| 2 | `customer.updated` | `400` | no | no | — |
| 3 | `payment_method.attached` | `400` | no | no | — |
| 4 | `customer.subscription.created` | `200` | **yes** | **no** | **`null`, permanently** |
| 5 | `charge.succeeded` | `400` | no | no | — |
| 6 | `checkout.session.completed` | `200` | **yes** | **yes** | `14:05:49.328Z` |
| 7 | `invoice.finalized` | `400` | no | no | — |
| 8 | `invoice.paid` | `400` | no | no | — |
| 9 | `payment_intent.succeeded` | `400` | no | no | — |
| 10 | `payment_intent.created` | `400` | no | no | — |
| 11 | `invoice.created` | `400` | no | no | — |
| 12 | `invoice.payment_succeeded` | `400` | no | no | — |
| 13 | `invoice_payment.paid` | `400` | no | no | — |
| 14 | `checkout.session.completed` (replay) | `200` | duplicate | no | unchanged |

Row 4 arrived **before** row 6. At that moment no Workspace carried that
Subscription id, so the event was inboxed with no Job and its `processed_at`
will never be set. That is Finding 7, observed.

## Pre-run findings

Seven findings, read from the code with this run in mind. **None is confirmed
by a run**, and **none is fixed here**: #229 says to fix only what the run
actually breaks, and to write down what is found either way. Each says when it
bites, so the run can confirm or clear it in **Verdicts** below.

**1 — Events outside the projectable set are answered `400`.**
`ingestBillingWebhook` throws `UnknownBillingWebhookError` for any type outside
`checkout.session.completed` and the three `customer.subscription.*` types
(`projectionJobs.ts:54`), and `http.ts:107` turns that into `400`. One Checkout
conversion also emits `customer.created`, `invoice.created`, `invoice.paid`,
`payment_intent.succeeded`, `charge.succeeded` and more, and each gets a `400`.
Under `stripe listen` this is only noise in the CLI log. Against a Dashboard
endpoint subscribed to any of those other types, Stripe treats non-2xx as
failure, retries with backoff for up to three days, and can disable the
endpoint for sustained failure. `tests/smoke/billing-projection.test.ts:112`
pins the *throw* — that `ingestBillingWebhook` refuses an unknown type — so
refusing is a decision rather than an oversight. **Nothing pins the `400`**,
which is the half that would damage a Dashboard endpoint, and the decision only
holds if that endpoint is subscribed to exactly the four projectable types.
Changing the status to 2xx-and-ignore is a design change, not a repair, and
belongs in its own ticket.

**2 — Three Stripe subscription statuses have no mapping.**
`COLLECTION_STATE` (`stripeAdapter.ts:30`) maps `active`, `past_due`, `unpaid`,
`canceled` and `incomplete_expired`. Stripe also emits `trialing`, `incomplete`
and `paused`. `fetchSubscription` throws `Unknown Stripe subscription status X`
for those, the Job fails all five attempts, and the Workspace stays `Trialing`
with a paid Subscription behind it. `trialing` is the realistic one: it is what
a Price with a trial period produces, which is why precondition 2 says not to
configure one.

**3 — `automatic_tax` makes Stripe Tax a hard dependency of Checkout.**
`createCheckout` always sends `automatic_tax: { enabled: true }`
(`stripeAdapter.ts:56`). A test account without Stripe Tax activated and
without an origin address fails at `checkout.sessions.create`, so the run stops
before the hosted page. Precondition 3 covers it; whether the flag should be
unconditional is a separate question.

**4 — A permanently failed projection has no recovery path.**
The webhook answers `200` once the inbox row is inserted, so Stripe will not
redeliver. A replay (`stripe events resend`) hits `onConflictDoNothing`, returns
`duplicate: true`, and **enqueues nothing** (`projectionJobs.ts:190`). If the
projection Job then exhausts its five attempts — Finding 2 is one way — it
becomes a Dead Letter, which keeps the payload and the last error but is not
retried automatically, and this repository implements no replay path out of
`dead_letters` (`server/jobs.ts:261` writes the row; nothing reads it back into
`jobs`). The Workspace is then stuck: `stripe_subscription_id` is still null,
so the drift Job skips it too (`enqueueBillingDriftJobs`), and no operator
action short of SQL brings it back. Evidence §2 asks whether replay enqueues a
second Job precisely because this is where the answer matters.

**5 — Starting Checkout twice orphans the first Session.**
`startCheckout` overwrites `pending_checkout_session_id` with no read of the
previous value and outside any transaction (`checkout.ts:98`). Completing the
*first* Session afterwards leaves `workspaceIdForPendingCheckout` with no
match, so the event is inboxed and dropped: money moved, and the Workspace
never converts. Plausible in a real run — start Checkout, go back, start again,
pay on the older tab.

**6 — The global rate limiter covers the webhook, except in development.**
`app.use("/api/", globalLimiter)` is 120 requests per minute per IP and is
skipped only for `/api/v1` and `/api/auth/config` (`server/app.ts:55`). It is
off entirely under `NODE_ENV=development`, which is what this runbook uses — so
**this run will not exercise it**. In the parallel environment, webhook
deliveries arrive from a small set of Stripe IPs and share that budget with
nothing else, and a burst answered `429` is another non-2xx that Stripe retries.

**7 — Unmatched subscription events leave permanent unprocessed inbox rows.**
When `customer.subscription.created` is delivered before
`checkout.session.completed` — the order is not guaranteed — no Workspace yet
carries that subscription id, so the row is inserted with no Job and
`processed_at` stays null forever (`projectionJobs.ts:193`). Harmless for
correctness, but it means "unprocessed inbox rows" cannot be used as a health
signal without knowing which nulls are expected. Evidence §5 records the real
delivery order, which is the fact this needs.

### Noted, not a defect

`webhookPayload` falls back to `JSON.stringify(req.body)` when `req.rawBody` is
absent (`http.ts:34`). Re-serialized JSON can never match Stripe's signature, so
if the `verify` hook (`server/app.ts:104`) were ever lost, the failure would
present as an invalid signature rather than as itself. The hook is in place and
nothing here is wrong today — recorded only so a future signature failure is
not debugged from the wrong end.

## Verdicts

One row per pre-run finding, decided by the run. A finding the run did not
exercise stays **Open** — it is not downgraded for want of evidence.

| # | Finding | Verdict | What the run showed |
| --- | --- | --- | --- |
| 1 | Non-projectable event types answered `400` | **Confirmed** | 11 of 14 deliveries answered `400`. Evidence §5 |
| 2 | `trialing` / `incomplete` / `paused` unmapped | **Open** | The Subscription was `active` throughout, so the gap was never reached. Precondition 2 is what kept it away |
| 3 | `automatic_tax` requires Stripe Tax | **Confirmed as a precondition** | Stripe Tax was active; `amount_total` came back 1130 on a 1000 Price, 13% Ontario HST. It did not bite because precondition 3 was met first |
| 4 | A permanently failed projection cannot be recovered | **Confirmed** | `stripe events resend` was accepted, hit `onConflictDoNothing`, and enqueued **no** second Job. Evidence §2 |
| 5 | Starting Checkout twice orphans the first Session | **Confirmed** | Three Sessions created against one Workspace; the two earlier ones are still `open` / `unpaid` in Stripe with no way back |
| 6 | The global rate limiter covers the webhook outside development | **Open** | `NODE_ENV=development` disabled the limiter, as the runbook said it would. Not exercised |
| 7 | Unmatched subscription events leave permanent unprocessed inbox rows | **Confirmed** | `customer.subscription.created` arrived first, was inboxed with no Job, and its `processed_at` is still `null` |

### Defects the run found that no finding predicted

| Defect | Where | Fixed here? | Severity |
| --- | --- | --- | --- |
| A — `current_period_end` exists only on the Subscription **item** | `stripeAdapter.ts:98` | **Pinned by tests** | High if ever "simplified" |
| B — a Job that outruns its lease kills the Worker | `server/worker.ts` | **Yes** | High — it stopped this run |
| C — nothing checks that the webhook secret and the secret key belong to the same Stripe account | `server/modules/billing/signatureHealth.ts` | **Yes** | Medium |
| D — a stale server answers `/health` exactly like a fresh one | `server/buildInfo.ts`, `server/app.ts` | **Yes** | Low, but it cost this run the most time |

**A — the period end has moved, and the fallback is load-bearing.**
On API version `2026-08-26.dahlia`, the live Subscription came back with
`current_period_end: null` on the Subscription and the real value only on
`items.data[0]`. `fetchSubscription` reads the item first and the Subscription
second (`stripeAdapter.ts:98`), so it worked — but had it read only the
Subscription, `periodEndsAt` would have been null, `BillingProviderError:
Subscription … has no current period end` would have failed the Job five times,
and the Workspace would have stayed `Trialing` with a paid Subscription behind
it. The fallback looks like defensive clutter and is in fact the only thing
that makes conversion work on a current API version.

Nothing pinned it: `tests/fakes/billingProvider.ts` hands back a
`currentPeriodEnd` already built, so the port fake cannot see this at all.
Three tests were added against the `stripe` fake instead
(`tests/smoke/billing-provider.test.ts`, "Stripe adapter") — the item-only
shape this run actually met, the Subscription-only shape an older API version
returns, and neither, which must refuse. Each half of the fallback was then
deleted in turn to check the tests fail: removing the item read fails two
tests, removing the Subscription read fails the third. The behavior is
unchanged; what changed is that deleting half of it now turns the suite red.
`FakeSubscription` had to make `current_period_end` optional in both places to
express the shapes at all.

**B — a Job that outruns its lease killed the Worker.** Fixed in this ticket.
`createJobRunner.runOne` caught the handler's error and called `jobs.fail`,
which itself throws when the claim is no longer in flight (`server/jobs.ts:208`)
— and that throw was caught by nobody, so it unwound through `startWorkerLoop`
and ended the process. One slow `document.embed` Job from an earlier session was
enough to stop the Worker every time it started, which stopped this run before
Stripe was reached. `fail` now runs through a `recordFailure` helper that logs
`worker.fail_lost_claim` and lets the loop continue; the port already handles
what follows, because the expired lease makes the Job claimable again and a
claim past `maxAttempts` dead-letters it. Covered by
`tests/smoke/worker-runner.test.ts`, which was written red first. The runner had
no tests of its own before this.

**C — the two Stripe accounts were never compared.** `stripe login` had paired
the CLI with sandbox `acct_1UGJJB5M06vXmf7J` while `STRIPE_SECRET_KEY` belonged
to `acct_1UGJJcGJ9wdyG8Wi`. Both are named almost identically in the Dashboard.
The application created Sessions in one account while the forwarder relayed
events from the other, so no webhook could ever match, and the `whsec_` in
`.env` signed for the wrong account too. Nothing in DocuFlow noticed: Checkout
returned a perfectly good hosted URL, and a mismatched secret presents as
`invalid signature`, which is indistinguishable from a forged request.

**Fixed.** The obvious repair — resolve both credentials to an account at boot
and compare — is not available: a `whsec_…` cannot be resolved to an account by
any API, and resolving the secret key needs a network call, which would make
boot depend on Stripe being reachable. So the distinction is drawn from the
shape of the failures instead. An attacker forging events does not stop the
real ones arriving, so something verifies; a wrong secret rejects every single
delivery. `server/modules/billing/signatureHealth.ts` tracks whether any
signature has ever verified and how many have been rejected in a row, and once
three have been rejected with none ever accepted it logs
`billing.webhook_secret_mismatch` naming both variables. Once per process, so
it cannot bury itself. The HTTP contract is unchanged — still `400`. Covered by
`tests/smoke/webhook-signature-health.test.ts`, including the case that must
stay quiet: a secret that has worked before and now sees rejections is the
forged-request case, and must never be reported as configuration.

**D — a stale server is invisible.** Port 5001 was held by a server started at
09:46, four hours before the commit under test. It answered `/health` with
`200 {"status":"ok"}` exactly like a fresh one, and its missing #217 routes
presented as the Vite catch-all returning `200 text/html` — which reads as "no
such route", not as "wrong build". `/health` reports liveness and nothing about
identity; a commit sha or a boot timestamp in that payload would have closed
this in seconds.

**Fixed.** `/health` now carries `commit`, `commitSource` and `startedAt`
beside `status`, and the boot line prints the build too, so neither answer
needs a request to find. `server/buildInfo.ts` resolves the commit offline and
synchronously: `DOCUFLOW_COMMIT` if a build injected one, otherwise `.git/HEAD`
read directly — no `git` subprocess — and `"unknown"` when neither is there,
because a wrong sha is worse than no sha. The production bundle ships without
`.git`, so `script/bundles.ts` bakes the sha in through esbuild's `define`;
that only works because `buildInfo` reads `process.env.DOCUFLOW_COMMIT` as a
static member expression, the same trick and the same reason as
`process.env.NODE_ENV` in `server/config.ts`. Verified against a real build:
the full sha appears in `dist/index.cjs`. Covered by
`tests/smoke/build-identity.test.ts` and
`tests/characterization/health-identity.test.ts`.

**Not a defect, but worth the next operator's time:** `stripe listen` dropped
its websocket mid-run with `ERROR websocket.Client.writePump: Error when writing
ping message: websocket: close sent` and stopped forwarding. Nothing in DocuFlow
can see that. If webhooks stop arriving, check the forwarder is still alive
before suspecting the application.

## Rollback

One production file changed for this ticket: `server/worker.ts` (Defect B).
Rolling it back restores a Worker that dies whenever a handler outruns its
lease, so it is not a change anyone should want back.

The run itself is undone by removing `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_PRO` from `.env` —
`createBillingProvider` then returns `UnconfiguredBillingProvider` and every
billing command answers `400` rather than reaching Stripe
(`createBillingProvider.ts:10`) — and by cancelling `sub_1UGKP5GJ9wdyG8WirxQaUpk9`
in the Stripe test Dashboard.

Workspace `6f88e0a5-…` stays `Active` either way. The projection is DocuFlow's
own state, not a cache of Stripe's, so returning it to `Trialing` is a database
change and not a rollback. The two orphaned Sessions
(`cs_test_a12ZNy…`, `cs_test_a1v3Of81…`) expire on their own.

## Exit

Phase 8 has its evidence. Every acceptance criterion in
[#229](https://github.com/Lamakira/docuflow/issues/229) is answered above from
the run rather than from the source: the conversion was observed in the
projection, the signature was rejected, the replay was ingested exactly once,
the seats agree with the Plan Registry, the test-mode guard held, and the
defects are written down.

Two pre-run findings stay **Open** — 2 and 6 — because this run did not
exercise them, and they are carried rather than closed. Findings 1, 4, 5 and 7
are confirmed and unfixed by choice: each is a design change rather than a
repair, and #229 asks for fixes only where the run breaks. All four defects the
run itself turned up are now closed — B and D outright, C by making the
misconfiguration say its own name, A by pinning behaviour that was already
correct. Defect A is new and now pinned by tests
rather than fixed, since the behavior was already right. Defects B, C and D are
new and fixed. All of them belong on the ticket, and on their own
tickets after that.

The one thing this run cannot speak to is production: `webAppV2` is still off
in `prod`, no live Stripe account exists, and ADR-0018 keeps it that way until
cutover.

## What was not run

- **Production.** Test mode only, one sandbox, one Workspace, one seat.
- **Findings 2 and 6.** No Subscription reached `trialing`, `incomplete` or
  `paused`, and the rate limiter was disabled by `NODE_ENV=development`.
- **The rest of the journey.** Sign-up, the marketing call-to-action, and the
  narrow viewport belong to #230, #231 and #232.
- **Seat changes, payment-method update, and cancel-at-period-end.** Built and
  covered by fake-provider tests; never exercised against Stripe.
