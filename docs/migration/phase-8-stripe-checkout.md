# Phase 8 Checkout against Stripe in test mode

- **Recorded:** 2026-09-16
- **Ticket:** [#229](https://github.com/Lamakira/docuflow/issues/229) (Spec [#228](https://github.com/Lamakira/docuflow/issues/228), ADR-0010, ADR-0013, ADR-0017, ADR-0018)
- **Verdict:** **not run.** This document is the runbook and the evidence form,
  prepared by reading the code. Every evidence cell below is blank on purpose
  and is filled by the operator from the real run: no cell is filled from the
  source. The findings in **Pre-run findings** are read from the code and are
  labelled as unconfirmed until a run confirms or clears each one.

Checkout is built end to end — `POST /api/billing/checkout` to a hosted
session, `POST /api/billing/webhooks` with signature verification, the
idempotent `billing_webhook_inbox`, the projection Job, and the v2
Administration UI wired to all of it. It has never talked to Stripe. What is
missing is not code; it is evidence that the code runs against the real
provider.

The machinery is already covered by tests against a fake provider
(`tests/smoke/billing-checkout.test.ts`, `tests/smoke/billing-projection.test.ts`),
so a further local test would prove nothing new. Only Stripe can retire the
remaining risk: the shape of a real Checkout Session, a real Subscription's
status and period fields, a real signature, and the real order and volume of
delivered events.

## What must be true before the run

This machine already has Postgres on 5434 (dev) and 5433 (test), and
`CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` in `.env`. Stripe is the only part
missing. The `stripe` CLI is **not installed** here.

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

`DOCUFLOW_ROLE` is absent from `.env`, so passing it on the command line has
nothing to collide with.

## The run

Three processes, in this order. The order matters: `stripe listen` prints the
webhook secret, and the other two read it from `.env` at boot.

1. The CLI forwarder:

```bash
stripe listen --forward-to http://localhost:5000/api/billing/webhooks
```

2. Put the printed `whsec_…` in `.env`. Then the application:

```bash
npm run dev
```

3. And the Worker, in a third terminal:

```bash
DOCUFLOW_ROLE=worker npm run dev
```

The Worker returns before it binds a port (`server/index.ts:24`), so the two
`npm run dev` processes do not collide. That script sets
`NODE_ENV=development`, which turns the global `/api/` rate limiter off
(`server/app.ts:73`) — see Finding 6 for what that hides. It also runs the
client through the Vite dev server, and `webAppV2` is a **client** flag keyed on
Vite's own `import.meta.env.PROD` rather than on the server's `NODE_ENV`
(`client/src/lib/featureFlags.ts:49`, `:58`), so the dev server is what puts the
v2 chrome on.

Then, as the Owner of the #217 Workspace:

1. Sign in, open `/administration`, and press the Checkout control
   (`client/src/v2/V2Administration.tsx:326`). It asks for
   `max(consumedSeatCount, purchasedSeatCapacity, 1)` seats — 1 for a fresh
   Workspace with one Owner — and redirects to the hosted URL.
2. Pay with Stripe's test card `4242 4242 4242 4242`, any future expiry, any
   CVC, and a billing address in the Stripe Tax origin's country.
3. The return lands on `/administration` again — `successUrl` and `cancelUrl`
   are the same URL (`V2Administration.tsx:82`), so the page is not evidence of
   anything. **Do not read the redirect as the result.** Read the projection.
4. Watch the `stripe listen` log and the worker log. Expect non-projectable
   event types to be answered `400` (Finding 1); that is the current behavior,
   and observing it is part of this run.

Do not filter with `--events` on the first pass. The unfiltered stream is how
Finding 1 gets its evidence.

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

What is already proved without Stripe, against the harness's disposable
Postgres with `tests/fakes/billingProvider.ts` standing in for the provider, so
no run reaches api.stripe.com:

| Gate | Status | Evidence |
| --- | --- | --- |
| Checkout returns a hosted URL, the Workspace stays `Trialing` until the projection Job runs, then reaches `Active` with purchased seats | **Verified** | `tests/smoke/billing-checkout.test.ts:84` |
| The seeded Workspace is refused Checkout and keeps Plan `legacy` with no Stripe objects | **Verified** | `tests/smoke/billing-checkout.test.ts:58` |
| A wrong signature is rejected and an unknown event type is refused | **Verified** | `tests/smoke/billing-projection.test.ts:81` |
| A replayed event is ingested exactly once | **Verified** | `tests/smoke/billing-projection.test.ts:250` |
| Seat capacity follows the Plan Registry, and a stale provider quantity does not overwrite a local increase | **Verified** | `tests/smoke/billing-checkout.test.ts:361`, `tests/smoke/billable-seats.test.ts` |
| `STRIPE_SECRET_KEY` refuses a non-test key, naming ADR-0018 | **Verified** | `tests/smoke/config.test.ts:729` |
| The same path against **real Stripe** | **Open** | the cells below are blank on purpose (ADR-0018) |

The last row is the whole of this ticket. Everything above it is already green
(`npm test`, 116 files / 1046 tests, 2026-09-16) and is why no further
fake-provider test was written here.

## Window

Filled from the real run. Left unrecorded rather than inferred.

| | |
| --- | ---: |
| Run started (UTC) | |
| Operator | |
| Stripe account (test) id | |
| Workspace id | |
| Price id | |
| Stripe API version the SDK negotiated | |
| `billing_state` reached `Active` (UTC) | |
| Re-runs needed | |

## Evidence

One section per acceptance criterion in
[#229](https://github.com/Lamakira/docuflow/issues/229). Each answer is read
from the projection or the provider, never from the Checkout redirect.

### 1. Does Trialing reach Active through the projection?

| Field | Before Checkout | After the Job |
| --- | --- | --- |
| `plan_key` | | |
| `billing_state` | | |
| `purchased_seat_capacity` | | |
| `authorization_version` | | |
| `stripe_customer_id` | | |
| `stripe_subscription_id` | | |
| `trial_ends_at` | | |
| `period_ends_at` | | |
| `cancel_at_period_end` | | |
| `pending_checkout_session_id` | | |

- Hosted Session id:
- Seconds from the Checkout return to `billing_state = 'Active'`:
- `audit_events` rows written (`billing.state_transition`, `billing.plan_change`, `billing.seats_change`):
- `outbox_events` row `billing.entitlements_changed` written:
- `billing.project-webhook` attempts, and any `dead_letters` row with its `last_error`:

### 2. Signature and replay

| Check | How | Observed |
| --- | --- | --- |
| Wrong signature rejected | `curl -X POST localhost:5000/api/billing/webhooks -H 'stripe-signature: t=1,v1=deadbeef' -H 'content-type: application/json' -d '{}'` | |
| No new inbox row for the rejected call | `select count(*) from billing_webhook_inbox` before and after | |
| Replay ingested once | `stripe events resend <event id>` | |
| `billing_webhook_inbox` row count after replay | | |
| Second `billing.project-webhook` Job enqueued on replay? | | |

### 3. Seats

| Fact | Value |
| --- | --- |
| Seat quantity sent to Checkout | |
| Stripe Subscription item quantity after payment | |
| `purchased_seat_capacity` after the projection | |
| `countConsumedSeats()` (`GET /api/billing/subscription` → `consumedSeatCount`) | |
| Active (non-archived) Memberships, counted in SQL | |
| `effectiveEntitlements().seatCapacity` | |

Plan Registry version 1 gives `pro` `seatCapacity: "purchased"` with
`minimumSeatCapacity: 1`, so the expected capacity is
`max(1, purchased_seat_capacity)`.

### 4. Does the test-mode guard still hold?

Use the **fake** string `sk_live_not-a-real-key`. A real live secret key must
never be typed into this environment, even to watch it be refused — precondition
1 and ADR-0018 mean what they say, and `config.ts` rejects on the `sk_live_`
prefix alone, so a fake proves it exactly as well.

| Check | Observed |
| --- | --- |
| Boot with `STRIPE_SECRET_KEY=sk_live_not-a-real-key` refuses, naming ADR-0018 | |
| Exact refusal message | |
| No real live credential existed at any point in the run | |

### 5. Every event the run delivered

| Order | Event type | HTTP status | Inbox row | Job enqueued | `processed_at` |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

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

One row per finding, filled from the run. A finding the run neither confirms
nor clears stays **Open** — it is not downgraded for want of evidence.

| # | Finding | Confirmed / Cleared / Open | What the run showed |
| --- | --- | --- | --- |
| 1 | Non-projectable event types answered `400` | | |
| 2 | `trialing` / `incomplete` / `paused` unmapped | | |
| 3 | `automatic_tax` requires Stripe Tax | | |
| 4 | A permanently failed projection cannot be recovered | | |
| 5 | Starting Checkout twice orphans the first Session | | |
| 6 | The global rate limiter covers the webhook outside development | | |
| 7 | Unmatched subscription events leave permanent unprocessed inbox rows | | |

### Defects the run found that are not listed above

Blank on purpose. #229 requires every defect found to be written down whether
or not it is fixed, so anything the run turns up that no pre-run finding
predicted goes here, and then into the ticket.

| Defect | Where | Fixed here? | Ticket |
| --- | --- | --- | --- |
| | | | |

## Rollback

Nothing to roll back until the run happens: no production code, schema, or
configuration changed for this ticket. The run itself is reverted by removing
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_PRO` from `.env`
— `createBillingProvider` then returns `UnconfiguredBillingProvider` and every
billing command answers `400` again rather than reaching Stripe
(`createBillingProvider.ts:10`) — and by cancelling the test Subscription in
the Stripe test Dashboard. A Workspace already projected to `Active` stays
`Active`: the projection is DocuFlow's own state, not a cache of Stripe's, so
returning it to `Trialing` is a database change and not a rollback.

## Exit

This phase's evidence is complete when the run has filled **Window**,
**Evidence** §1-§5 and **Verdicts** above, and every finding is Confirmed or
Cleared rather than Open. Until then, Phase 8 has a runbook and no evidence,
and [#229](https://github.com/Lamakira/docuflow/issues/229) stays open. The
findings recorded here are reported on that ticket rather than left only in
this file, as #229 requires.

## What was not run

- The Checkout conversion itself. No Stripe test account is configured in this
  environment, the `stripe` CLI is not installed, and neither was created for
  this ticket.
- Everything in **Window**, **Evidence** and **Verdicts** above.
- Any code change. The path was read, not repaired — the seven findings are
  recorded rather than fixed, because #229 asks for fixes only where the run
  breaks, and the run has not happened.
