# DocuFlow Web App v2 — Flow specifications

Status: confirmed for high-fidelity generation, alongside `CLAUDE-DESIGN-HANDOFF.md`.

The handoff specifies the visual system and the five anchor screens. It deliberately specifies no flows. This document fills that gap for the flow families whose branching is already decided by ADR, so a generator does not improvise steps at exactly the points where a wrong guess is expensive.

Read the handoff first for tokens, shell, vocabulary, and the synthetic dataset. Everything here inherits it: the same Workspace (**Keystone Studio**), the same people, the same typographic voices, the same amber allowance rule.

## Authority

Where this document and the handoff disagree, this one wins **on sequence, branching, and division of responsibility**; the handoff wins on everything visual. Where either disagrees with `docs/adr/`, the ADR wins.

## The seam — who renders what

This is the rule most likely to be got wrong, and the one that costs the most to unwind. Three parties, three responsibilities, no overlap.

| Party | Owns | Renders |
| --- | --- | --- |
| **Clerk** (ADR-0007) | Credentials, authentication flows, MFA enrolment and challenge, session issuance and rotation, password reset | Every screen where a credential is typed, chosen, or changed |
| **Stripe** (ADR-0010) | Checkout, payment-method capture and update, card details, invoices as PDFs | Its own hosted surfaces, reached by redirect and returned from |
| **DocuFlow** | Users, Workspaces, Memberships, Workspace Roles, Capabilities, Service Accounts, Devices, Subscriptions as local projections, seat counts, entitlements, and **every authorization decision** | Everything else, including all plan and seat changes |

Three prohibitions follow, and they are absolute:

- **Never design a DocuFlow-branded password field**, password-strength meter, MFA code input, or "forgot password" form. Those are Clerk surfaces. DocuFlow's sign-in screen is a frame around Clerk's, plus DocuFlow's own branding and its post-authentication decisions.
- **Never design a DocuFlow-native card form**, CVC field, or billing-address form for payment. Checkout and payment methods are hosted Stripe surfaces reached by redirect.
- **Never design a plan or seat change on a Stripe surface.** Plan changes and seat changes live only in DocuFlow's UI. Stripe is told afterwards; it is never the place the decision is made.

Under ADR-0021 the Clerk tenant may end up managed by Replit or owned directly by DocuFlow. **The seam is identical either way** — this document does not change based on that outcome.

## Vocabulary these flows use

**Billing states** are DocuFlow-owned (ADR-0010): `Trialing`, `Active`, `PastDue`, `ReadOnly`, plus the `cancel-at-period-end` flag. They are not Stripe's states; they are computed from a local projection of Stripe objects.

**A Billable Seat** is consumed by an accepted, active Membership only. Pending Invitations and Archived Memberships consume nothing.

**Read-only Workspace** is an entitlement outcome enforced centrally by capability write-classification. It is a Workspace-wide condition, not a per-button disabled state, and it never withholds viewing, export, or recovery.

**Active Workspace** scopes search and all operational data. Notifications are global and always name their originating Workspace.

---

## Flow 1 — Sign up and create the first Workspace

**Entry points:** marketing site call-to-action; a shared link to a Workspace the visitor has no Membership in; direct navigation to the app while signed out.

**Steps**

1. **Identity.** Clerk's sign-up surface. DocuFlow provides the frame and the brand; Clerk provides the fields, the provider buttons, and any verification step.
2. **Return.** DocuFlow receives an authenticated identity, links or creates its own `User`, and takes over.
3. **Name the Workspace.** One field, one action. Offer a sensible default derived from the person's name so a solo user can pass through without inventing anything.
4. **Workspace created.** The creator gets an Owner Membership. The Workspace enters `Trialing` (Flow 5 — it starts here, it is not a separate decision the user makes).
5. **Land on Today**, empty-state variant.

**Branches**

- **The person already has a Membership somewhere.** Do not force Workspace creation. Send them to Workspace selection (Flow 4) with "create a new Workspace" as a secondary action.
- **They arrived from an Invitation.** Acceptance takes precedence — Flow 6, step 4. They do not create a Workspace.
- **Identity exists but no Membership anywhere.** Show Workspace creation, with no list to select from.

**Design the empty first-run Today.** It is a real screen with real work: nothing to approve, no Projects, no tracked time. It must read as a beginning, not as a failure. This is the one place in the product where an empty state is the expected state.

**Do not design:** an onboarding wizard with progress dots, a product tour, a "choose your role" step, or a team-size question. ADR-0004 is explicit — a one-member Workspace grows into a team without migrating, so there is no fork here to design.

**Binds:** ADR-0004, ADR-0007.

---

## Flow 2 — Sign in

**Steps**

1. Clerk's sign-in surface inside the DocuFlow frame, including MFA challenge where enrolled.
2. DocuFlow resolves the identity to its `User` and enumerates active Memberships.
3. Route by Membership count — see Flow 4.

**Branches**

- **No active Membership.** The account is valid but belongs nowhere: every Membership was archived, or the only Workspace was deleted. Do not show an error. Show a stated condition with two ways out — create a Workspace, or wait for an Invitation — and make it clear the account itself is fine.
- **Sole Membership is in a Read-only Workspace.** Sign-in succeeds normally. The Workspace condition is announced on Today, not at the door.
- **Session expired mid-work.** Re-authenticate and return to the exact place, preserving unsaved input. This is a returning-user product used daily; losing a half-written Daily Update to a session boundary is a real failure.

**Do not design:** "remember me", password reset, or session-length controls. All Clerk.

**Binds:** ADR-0007.

---

## Flow 3 — A legacy account's first sign-in after cutover

Migration-only and time-boxed, but it is the first thing every existing user meets on the new stack, so it is not optional to design.

**Context.** ADR-0017 Phase 5 imports existing accounts into Clerk by bcrypt hash. Accounts that only ever authenticated through Replit OIDC have no password to import and need a password-set invitation.

**Steps**

1. The person arrives at the new sign-in with credentials they already had, or with a password-set link sent ahead of cutover.
2. **Password imported:** they sign in normally and never learn anything moved.
3. **OIDC-only account:** they follow the password-set invitation, which is a Clerk surface. Frame it with DocuFlow copy that says plainly why a password is being asked for now.
4. Memberships, Roles, and Capabilities are already seeded — they land in a populated Workspace with their history intact.

**Design:** the explanatory frame around step 3, and the state where a stale password-set link is used after expiry.

**Do not design:** a data-migration progress screen, a "welcome to the new DocuFlow" tour, or anything implying the user must act to preserve their data. Under ADR-0018 the migration is rehearsed and completed inside a freeze window before anyone signs in.

**Binds:** ADR-0017, ADR-0018, ADR-0007.

---

## Flow 4 — Choose and switch the Active Workspace

**On sign-in**

- **Exactly one active Membership:** enter it directly. No chooser.
- **More than one:** show the chooser. Each row names the Workspace, the person's Role in it, and any condition that will greet them — `Trial`, `Read-only`, `Past due`. Do not hide a condition behind the click.
- Remember the last Active Workspace and offer it first on subsequent sign-ins.

**Mid-session switching** happens from the Workspace switcher in the rail (see the handoff's canonical shell).

**The rule that must survive the switch:** search and operational data are scoped to the Active Workspace, but **the Timer and Notifications are not**. A Member switching Workspaces still sees a Timer running in the Workspace they left, still labelled with the Workspace it belongs to. Notifications remain global and always name their originating Workspace. Design the switch so neither is lost, and so the running Timer never reads as belonging to the newly-entered Workspace.

**Branches**

- Pending Invitation to another Workspace: surface it in the chooser as an accept action, not as an existing Membership.
- Archived Membership: absent from the chooser entirely.
- Read-only Workspace: selectable, entered normally, condition announced inside.

**Binds:** ADR-0004, ADR-0006.

---

## Flow 5 — Start the Trial

**There is no payment step to design.** Trials carry no card and create no Stripe objects. The Trial begins when the Workspace is created (Flow 1, step 4). It is a DocuFlow state, not a Stripe subscription.

**Design**

- The persistent Trial indicator, with days remaining. `[Trial duration is an open decision — use a labelled placeholder.]`
- The full-capability Trial experience: a Trial is not a degraded product, and entitlements come from the Plan Registry, not from the absence of a card.
- The conversion path from Trial to paid, reachable without hunting, at least from Administration and from the Trial indicator itself.
- The approaching-expiry state, escalating in prominence but never blocking work.

**Do not design:** a card-capture step, a "start your trial" button on a pricing table inside the app, a feature-locked Trial, or a trial-extension request form.

**Binds:** ADR-0010.

---

## Flow 6 — Invite a Member, and acceptance

**The seat rule is the thing to get right.** An Invitation consumes no seat. A seat is consumed when the Invitation is accepted and the Membership becomes active. Owners routinely assume the opposite and over-buy, so the interface must say it.

**Inviter's steps**

1. From People, invite by email address. Choose the Workspace Role.
2. Show the seat consequence **before** sending, stated in terms of capacity: seats purchased, seats consumed, and what this Invitation will consume **if accepted**.
3. Send. The Invitation appears in People as `Invitation pending`, explicitly marked as consuming no seat.

**Invitee's steps**

4. The invitation link resolves to acceptance. If they have no identity yet, Clerk's sign-up runs first (Flow 1, steps 1–2), then acceptance — they do **not** create a Workspace.
5. Membership becomes active, the seat is consumed, and they land on Today in that Workspace.

**Branches**

- **No seat capacity left.** Block at step 2, not at acceptance — never let an invitee hit a wall the inviter could have seen. Offer increasing seats inline; the increase applies immediately with proration (ADR-0010).
- Invitation expired, revoked, or already accepted: three distinct states, three distinct messages.
- The email already holds a Membership in this Workspace: state it, do not create a duplicate.
- **Workspace is Read-only:** inviting is a write. Blocked, with the Workspace condition as the stated reason.

**Also design:** revoking a pending Invitation, resending it, and archiving an active Membership — archiving releases the seat at period end, floored at active consumption, and preserves the person's recorded time, Activity Evidence, and Daily Updates.

**Binds:** ADR-0010, ADR-0004, ADR-0015 (membership lifecycle is audited).

---

## Flow 7 — Subscribe, and change plan or seats

**The division of labour is the whole flow.** Plan and seat decisions are made in DocuFlow's UI. Money is moved on Stripe's hosted surfaces.

**Subscribing from Trial**

1. In DocuFlow: choose the Plan, choose seat capacity. Show what the entitlements become, derived from the Plan Registry.
2. Redirect to hosted Stripe Checkout.
3. Return to DocuFlow on a landing state that does **not** promise the subscription is live yet — it becomes live when the webhook is processed, the projection is refreshed, and entitlements are recomputed. Design the short pending state honestly rather than optimistically.
4. Confirmed: `Active`, entitlements updated, authorization version bumped.

**Changing seats**

- **Increase:** applies immediately, prorated. Confirm the proration before committing.
- **Decrease:** applies at period end, and is floored at active Billable Seat consumption. Design the state where an owner tries to drop below what is currently consumed: it is not an error, it is a floor — say which Memberships would need archiving first.

**Changing plan** follows the same shape: decided in DocuFlow, entitlements derived from the registry, grandfathering by version pinning where it applies.

**Payment methods** are managed only on hosted Stripe surfaces. DocuFlow shows the current method as a read-only fact — brand and last four — with a link out.

**Do not design:** an in-app pricing page with marketing copy, a card form, an invoice renderer, or a plan comparison table with prices. `[Plan names, prices, and limits are open decisions — labelled placeholders only.]`

**Binds:** ADR-0010.

---

## Flow 8 — Trial expiry, cancellation, and dunning

**All three roads end in the same place: a Read-only Workspace.** None of them ends in a lockout, and none withholds data.

**Dunning.** A failed payment moves the Workspace to `PastDue`. **`PastDue` retains full access** until the terminal outcome — it is not a degraded interface. Design it as a prominent, honest condition with a clear way to fix the payment method, not as a paywall.

**Terminal outcomes** — Trial expired without conversion, subscription cancelled at period end, or dunning exhausted — all produce `ReadOnly`.

**Designing Read-only**

- Announce it **once**, Workspace-wide, at the top of the shell. It is a centrally enforced condition, so it must not read as a page full of individually broken buttons.
- Viewing, **export**, and recovery stay available. Say so in the announcement — this is the single most reassuring sentence in the product, and the one an anxious owner is looking for.
- Writes are refused with the Workspace condition as the reason, never with a generic permission error. A Member who lacks a Capability and a Member in a Read-only Workspace are two different situations and must read differently.
- The path back — reactivate, update payment, choose a plan — is reachable by anyone holding the billing Capability, from the announcement itself.

**Also design:** the cancel flow with `cancel-at-period-end` shown as a date and a reversible decision, not an immediate cutoff.

**Binds:** ADR-0010, ADR-0015.

---

## Flow 9 — Enrol a desktop Device

The desktop agent is a first-class client, and enrolment is where web and desktop meet.

**Steps**

1. The person signs in on the desktop agent through the same identity.
2. The Device registers against the Active Workspace and receives a token signed by the versioned signing key.
3. The Device appears in **two** places, and they are not the same screen: **Personal Settings** shows the person's own Devices; **Administration** shows the Workspace's Devices. The handoff fixes this split — do not merge them.
4. Enrolment is an audited event (ADR-0015).

**States to design**

- Device online, offline with a last-seen timestamp, and syncing with a queued-item count.
- Revoking a Device, from either surface, with the consequence stated: queued evidence not yet uploaded.
- Tracking Policy version in force on that Device, since capture fails closed on a stale policy cache while leaving the Timer open (ADR-0009).

**Do not design:** a device-approval queue or per-device permission grid. Neither is in the architecture.

**Binds:** ADR-0009, ADR-0015, ADR-0011.

---

## Flow 10 — Delete an account

Guided, reversible for a window, and specified in unusual detail by ADR-0015 — which means a generator will otherwise get it wrong.

**Steps**

1. **Every owned Workspace must be transferred or deleted first.** This is a precondition, not a warning. List them with the choice per Workspace.
2. A **cancelable grace window** begins. State the date it completes and how to cancel.
3. On completion: controller-side data is erased; Memberships are **pseudonymized in place** so operational and audit records keep referential integrity; each affected Workspace is notified.

**Say plainly what survives and why.** Recorded time, Activity Evidence, and Daily Updates remain with the Workspaces they belong to — DocuFlow is processor for Workspace content and the customer is its controller. An owner deleting their account does not delete their colleagues' operational history.

**Do not design:** an immediate irreversible delete, or a flow that offers to purge Workspace content the person does not control.

**Binds:** ADR-0015.

---

## Cross-cutting states every flow must carry

The handoff's *Required states and ranges* applies here too. Additionally, each flow above needs:

- **Loading and pending** where a webhook, a redirect return, or a job stands between the user's action and the truth. Never claim success before the projection is refreshed.
- **Capability-denied**, distinct in wording from **Read-only Workspace**, distinct again from **seat capacity exhausted**. Three different causes, three different remedies, three different messages.
- **The Timer running throughout.** Every one of these flows can happen while a Timer runs in this or another Workspace. The amber allowance rule from the handoff applies: when the Timer holds amber, the flow's primary action is Case Ink.
- **Long values.** Workspace names, email addresses, and person names truncate with ellipsis; recorded values — seat counts, dates, amounts — never truncate.

## Not specified here

Out of scope for this document, and not to be invented:

- The remaining batch-2 families: contributor Today, Opportunities, Clients and Projects, Project Dossier depth, Time and Timesheets, Activity and Tracking Policy, Documents and Ask DocuFlow, People administration beyond invitation and archival.
- Plan names, prices, limits, and Trial duration.
- Production domain, dark-theme tokens, guest and client portals, cross-Workspace record transfer.
- Service Account and API-key issuance flows (ADR-0011), and Support Access Grants (ADR-0015) — both real, both later.
- Whether the Clerk tenant is Replit-managed or DocuFlow-owned (ADR-0021). It does not change any flow above.
