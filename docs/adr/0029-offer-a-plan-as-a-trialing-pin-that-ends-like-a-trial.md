# Offer a Plan as a Trialing pin that ends like a Trial

Amends ADR-0010 (#314). Platform Staff can give a Workspace a Plan for a set number of days without charging it: an Offered Plan. The back office decision of 2026-10-05 says it goes only to a Workspace without a paid Subscription, and that it ends like a Trial: the Owner gets the Trial emails three days before the end and on the last day, and the Workspace then becomes read-only until the Owner subscribes.

## Decision

An Offered Plan is not a fifth billing state. It is the billing state `Trialing` on a Plan other than `trial`:

- `plan_key` is the offered Plan, at the current registry version, so Entitlements come from the Plan Registry exactly as for a paying Workspace on that Plan.
- `trial_ends_at` is the end of the offer.
- `purchased_seat_capacity` is the number of seats offered, never below the Billable Seats already consumed or the Plan's minimum.
- `stripe_subscription_id`, the period end and cancel-at-period-end are cleared. The Stripe Customer is kept, so a later Checkout reuses it.

Everything that already keys on `Trialing` and `trial_ends_at` handles the offer without a second code path: the Trial lifecycle tick warns the Owner and enqueues the expiry Job, `expireTrial` moves the Workspace to `ReadOnly` (with reason `offer_expired` rather than `trial_expired`, so the read-only email and the back office say what ended), and a Checkout during the offer replaces it with the paid Subscription.

The offer is refused unless the Workspace is `Trialing` or `ReadOnly`. An `Active` or `PastDue` Workspace either pays through a Subscription or is on a legacy or sales-led Plan, and an offer would end either of those in a read-only Workspace.

Offering a Plan, extending a Trial (or an offer) and cancelling a Subscription at period end, or undoing that, are operator commands. Each changes the billing pin and writes one Audit Event naming the Platform Staff who acted. Cancelling and undoing are sent to Stripe first, through the BillingProvider, so the next webhook projection agrees with the pin.

## Consequences

- The back office tells an Offered Plan from a Trial by the Plan: `Trialing` on `trial` is a Trial, `Trialing` on any other Plan is an Offered Plan.
- The Owner sees the offer as a Trial on that Plan, and receives the Trial emails, as decided.
- An offer is a grant, not a discount: no Stripe Coupon, Price or Subscription is created, and no invoice is issued.
- Revenue figures never count an Offered Plan, because they are computed from Subscriptions in `Active` or `PastDue` with the unit amount, currency and interval Stripe last reported, stored on the pin.

## Rejected

- **A new `Offered` billing state.** Every reader of the billing state (Entitlements, the Trial lifecycle, the write gate, the v2 Billing page, the projection) would need a fourth branch that behaves exactly like `Trialing`.
- **A 100% Stripe Coupon on a real Subscription.** It would put money movement and a card requirement behind something meant to be free, and Stripe would own when it ends instead of DocuFlow.
- **An Entitlement override.** Overrides are sales-led grants with no end date; an offer has to end on its own and make the Workspace read-only.
