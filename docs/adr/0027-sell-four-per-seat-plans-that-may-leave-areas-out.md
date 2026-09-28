# Sell four per-seat Plans that may leave areas out

Amends ADR-0010 (#299). ADR-0010 kept every Plan as the complete product and let Plans differ only in capacity. The pricing page sells tiers that differ in what they include, so Plan Registry version 2 has four per-seat Plans, and a Plan may leave areas out:

| Plan | Includes |
| --- | --- |
| Starter | Web timer, timesheets, attendance, the desktop agent, and screenshots on 1 Project. Projects without Clients or Tasks ("light" Projects), tracked directly. |
| Growth | Starter, screenshots on every Project, plus activity and idle detection, payroll-ready exports, Clients and Opportunities, Project management (Tasks, budgets, the Project Dossier) and Knowledge (Documents, Files, transcription, Ask). |
| Business | Growth plus advanced analytics and profitability dashboards. |
| Enterprise | Business plus SSO, SCIM and data residency. Sales-led: assigned with an audited script, never through Checkout. |

There are no storage, AI or Device limits; the public API rate limits are unchanged. The Trial is Business for 14 days with 3 seats and no card.

Entitlements are still DocuFlow's, derived from the registry and never read from Stripe. The server refuses an excluded area on HTTP routes, on Worker jobs (Knowledge embedding and transcription) and in the delivered Tracking Policy, with `code: "plan_upgrade_required"`, the feature, and the cheapest Plan that includes it. After a downgrade, data kept from the higher Plan stays readable but not writable, since refusing the reads would hide a customer's own records; areas with nothing to keep (analytics, Ask, exports, activity capture) are refused outright. v2 navigation shows the Plan an area needs, and a banner on the area says whether it is read-only or needs an upgrade.

Version 1 Workspaces stay pinned: `legacy` and `pro` keep their v1 Entitlements. `PLAN_MIGRATIONS` maps v1 `pro` to v2 `business`, so no feature is lost, and `npm run billing:assign-plan -- --migrate-v1` applies it, audited as the system actor. `legacy` has no successor.

## Stripe

Checkout resolves prices by lookup key rather than by price ID, and a Subscription's Plan is read from its Product's `docuflow_plan` metadata, so a grandfathered or replaced price is still recognised. The billing interval is read from the price's `recurring.interval`. There are no price-ID environment variables.

Set up the same way in test mode and in live mode:

- **Products**: Starter, Growth and Business, each with metadata `docuflow_plan` set to `starter`, `growth` or `business`. The existing v1 Pro Product keeps `docuflow_plan=pro`.
- **Prices**: two recurring, per-seat (licensed, quantity-based) prices per Product, with lookup keys `starter_monthly`, `starter_annual`, `growth_monthly`, `growth_annual`, `business_monthly` and `business_annual`. To change a price, create a new one and move the lookup key onto it (tick "transfer lookup key"); existing Subscriptions keep their old price and are still recognised by their Product.
- Enterprise has no Stripe price: it is agreed with sales and assigned with `npm run billing:assign-plan -- --workspace <id> --plan enterprise --seats <n>`.

A missing lookup key fails the Checkout with a message naming the key, and resolved prices are cached for five minutes.

## Rejected

Keeping every area in every Plan and differing only in seats would not match the pricing page. Reading the Plan from the price ID would lose every grandfathered price the moment a price changes. Hiding the data of a downgraded area would look like data loss, and deleting it would be data loss.
