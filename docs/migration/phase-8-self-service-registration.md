# Phase 8 self-service registration reopened

- **Recorded:** 2026-09-17
- **Ticket:** [#230](https://github.com/Lamakira/docuflow/issues/230) (Spec [#228](https://github.com/Lamakira/docuflow/issues/228), ADR-0002, ADR-0004, ADR-0007)
- **Reverses:** the closure recorded in [`phase-5-web-auth-cutover.md`](phase-5-web-auth-cutover.md) under [#110](https://github.com/Lamakira/docuflow/issues/110)
- **Verdict:** open. A visitor with no account and no Invitation signs up at
  Clerk, becomes a DocuFlow `User`, names their first Workspace, and enters
  `Trialing` — Flow 1 end to end, with no Administrator anywhere in it.

## What was closed, and why it no longer holds

The Phase 5 cutover closed self-service registration and wrote down the reason:

> The sign-in page hides Clerk's sign-up link for the same reason — an account
> created there would be a dead end. **Disable sign-up on the Clerk instance
> itself** (#107) so the hosted pages agree with the embedded one.

That was true when it was written. A Clerk subject with no linked `users` row
resolved to nobody, every `/api/*` route answered `401`, and the only screen
DocuFlow could show was "Clerk knows you, but DocuFlow has no matching User.
Sign out." New Users came from an Administrator plus the #108 import.

**[#217](https://github.com/Lamakira/docuflow/issues/217) removed the dead end.**
It built the room behind the door: a User who holds no Membership is not an
error state any more. They are shown **Name your Workspace** — one field, one
action, a default derived from their own name — and creating it makes them its
Owner and starts the Trial without a card (Flow 1 steps 3–4, Flow 5). What #217
did not build is the step between Clerk and that screen, because nothing reached
it: Flow 1 step 2, where DocuFlow *"receives an authenticated identity, links or
creates its own `User`, and takes over"*. #230 is that step, and the door.

## What changed

| Surface | Before | After |
| --- | --- | --- |
| `POST /api/auth/user` | — | The User behind the presented provider session: `201` when created, `200` when it already existed |
| `GET /api/invitations` | `isAuthenticated` — a Membership required | `isIdentified` — the invitee has no Membership yet, and this list is by address across Workspaces |
| Clerk's sign-up link on `/auth` | Painted out (`footerAction: display none`) | Shown, pointing at `/sign-up` |
| `/sign-up`, `/signup` | Fall through to sign-in | Clerk's `<SignUp>` in the DocuFlow frame |
| Clerk instance sign-up | Asked to be disabled (#110/#107) | **Open** — `sign_up.mode: "public"`, verified 2026-09-17 |
| `IdentityProvider.findIdentityBySubjectId` | — | Added: a session token carries only the subject, and the User needs an address |

No DocuFlow credential field was added anywhere. Clerk provides the fields, the
provider buttons, and any verification step; DocuFlow provides the frame, the
brand, and the one screen Clerk cannot — the moment after it hands back an
identity (ADR-0007, `FLOWS.md` Flow 1 step 1).

### The Clerk instance setting (#107)

[#107](https://github.com/Lamakira/docuflow/issues/107) provisioned the
DocuFlow-owned Hobby application, and the Phase 5 cutover asked for sign-up to
be **disabled** on it so the hosted pages agreed with the embedded one. **That
instruction is withdrawn.**

The setting was read rather than assumed, and the reading is the thing worth
recording, because it is not what the instruction expected:

| | |
| --- | --- |
| Instance | DocuFlow-owned Clerk Hobby application (#107), `pk_test_…`, frontend API `allowing-termite-8045.clerk.accounts.dev` |
| Setting, as read | **`sign_up.mode: "public"`** — open |
| Read | 2026-09-17, from the live `userSettings` the SPA's Clerk instance loaded |
| What changed today | The written instruction, not the dashboard |
| Reason | #217 removed the dead end the disable was protecting against |
| Agreement | The embedded surface and the hosted pages both offer sign-up |

**The disable was never applied.** Nothing in this repository records it having
been done — the Phase 5 "Window" table is still blank and says so — and the
instance is public today. So the disagreement #110 warned about has existed
since the cutover, with the hosted pages open and the embedded link painted
out. #230 ends it by opening the embedded surface, which is the direction #217
made safe; no dashboard change was needed, and none was made.

`docs/CONFIGURATION.md` carries the same record next to the credential names.

### Registration is a step, not a screen

`POST /api/auth/user` takes no body. The address, given name and family name are
read from the IdentityProvider for the subject the session names, never from the
request — the caller proves who they are with a session, and the session is the
only thing the route believes. Posting `{"email": "someone@else"}` changes
nothing.

It is idempotent. A reload, a second tab, and a retry all arrive at the same
row, and only the first gets `201`.

**The new User joins no Workspace.** `storage.createUser` seeds a Membership in
the seeded Workspace, which for a stranger off the internet is somebody else's
data, so the row is written directly — exactly as Invitation acceptance writes
its own. That is what leaves them in the state #217 is waiting for, and it is
characterized: a registrant's `/api/projects` is `401` and the seeded Workspace
gains nobody.

### What the route does with a session it has seen before

| The session's subject | What happens |
| --- | --- |
| Already on a `users` row | `200` with that User. Nothing is written, and the provider is not asked — the `identitySession` middleware has already resolved it |
| New, and the address is free | `201` with a new row and no Membership |
| New, and the address is a `users` row — **linked or not** | `409` |

**An address this DocuFlow already holds is refused either way, and nothing is
adopted.** The tempting behaviour is the one Invitation acceptance has: find an
unlinked row on a matching address and link it. Acceptance can do that, because
possession of the token sent to that address is proof of control over it. A
sign-up is not — the provider reports an address this side never challenged, and
Clerk's first listed address is neither guaranteed primary nor guaranteed
verified. Adopting on a match would therefore hand a stranger an existing User,
its Memberships and its `role` included, for the cost of claiming an address.

The cost of refusing is a legacy account whose owner signs up and is told to sign
in instead or ask an Administrator, which is where Phase 5 put that job: the
[#108](https://github.com/Lamakira/docuflow/issues/108) import links existing
Users, and self-service registration creates new ones.

### The race the second tab makes

`registerIdentity` is idempotent, and two first requests from the same browser
can still miss the same `SELECT`. The insert carries `onConflictDoNothing`, so
the loser writes nothing rather than crashing on the unique address, and reads
the winner's row back by subject. Both callers get the same `users.id`; only one
gets `201`.

### Invitation acceptance still takes precedence

Two branches had to keep working, and both are characterized in
`tests/characterization/self-service-registration.test.ts`:

- An invitee reaching the app **through their link** accepts a Membership and
  creates no Workspace (Flow 6, step 4) — whether or not they ever called
  registration, since `POST /api/invitations/accept` has always created the
  invitee's `User` itself.
- An invitee who lands on `/` instead sees the waiting Invitation rather than
  Workspace creation: `workspaceEntry` puts a pending Invitation ahead of
  first-run, which is why `GET /api/invitations` had to stop requiring a
  Membership.

A User whose every Membership was archived is unaffected — Flow 2's "your
account is fine" screen shipped with #217 and is reached the same way.

**One state this ticket makes more reachable, deliberately.** `resolveInvitee`
has always refused a subject whose address is not the invited one
(`InvitationEmailMismatchError`, `403`, "a different email address" — one of the
three distinct Invitation states Flow 6 asks for). Registration gives a person a
`users` row before they accept, so somebody who signs up under their own address
and *then* opens a link sent to a different one now meets that rule where before
they would have been given a second row on the invited address. DocuFlow holds
one address per User, so a match is not something this ticket can invent; the
condition is stated rather than papered over, and it is characterized. Arriving
through the link first — what the Invitation email actually tells them to do —
never reaches it.

## Rehearsal

Against the harness's disposable Postgres, with the Clerk SDK aliased to
`tests/fakes/clerk.ts` so no run reaches api.clerk.com:

- A provider session naming a subject with no `users` row was `null` at
  `GET /api/auth/user`, `201` at `POST /api/auth/user`, and then held a User
  with **no** Membership and an empty `GET /api/memberships`.
- That User posted `/api/workspaces` and got an Owner Membership on a Workspace
  in `Trialing` with a trial end date, and a Workspace-scoped read answered.
- A second `POST` was `200` and wrote no second row.
- No session, and an unverifiable token, were both `401 { message }`, and
  neither created a `users` row.
- A body carrying somebody else's address, another given name and `role: admin`
  was ignored in all three: the row came back with the provider's address, the
  provider's name, and `role: "user"`.
- An existing `users` row on the same address was `409` whether or not it was
  linked, the row was untouched, and the session stayed unknown.
- Two requests carrying the same session at once both answered with the same
  `users.id`, and one row was written.
- A registrant's `/api/projects` and `/api/admin/users` were both `401`, and the
  seeded Workspace's Membership list did not contain them.
- An invited registrant saw one pending Invitation, accepted it, and held
  exactly one Membership — in the inviting Workspace, not one of their own.
- A registrant opening a link sent to a *different* address was `403` "a
  different email address", with no Membership and the Invitation still standing.

## Walked in the browser

Against the development server on `localhost:5000`, signed out, at the narrow
viewport the pane gives (≈397px wide):

- `/auth` painted Clerk's sign-in inside the DocuFlow frame, and the card footer
  read **"Don't have an account? Sign up"**, linking to `/sign-up`. That link is
  the one #110 painted out.
- `/sign-up` painted Clerk's **"Create your account"** — provider button, given
  and family name, address — under the DocuFlow wordmark and "Start your
  Workspace". No DocuFlow field appears on either page.
- The console carried no errors on either.

Completing a sign-up is [#232](https://github.com/Lamakira/docuflow/issues/232)'s
job, in the parallel environment, with a real address — not this repository's,
and not against a developer's machine.

## Two departures, recorded rather than hidden

- **`GET /api/invitations` moved from `isAuthenticated` to `isIdentified`.** It
  is an auth-boundary change this ticket was not asked to make, and it is the
  one that makes "an Invitation takes precedence" true for a registrant who
  lands on `/`: they hold no Membership, so `isAuthenticated` would refuse them
  the list that is supposed to outrank Workspace creation. The read is by the
  caller's own address across Workspaces and carries no `inWorkspace()` clause,
  so it neither needs nor gains Workspace context.
- **The SPA seeds `["/api/auth/user"]` from the POST answer instead of
  invalidating it**, against `PROJECT_CONTEXT.md` §8's "`apiRequest` for
  mutations + explicit invalidation". An invalidate unmounts the component the
  moment its refetch starts; if that refetch came back null the router would
  mount it again and it would POST again. The route returns the same `SafeUser`
  the `GET` would, so there is nothing to go and ask for.

## What this ticket does not reach

**v1 chrome has no Flow 1 step 3.** "Name your Workspace" is `V2FirstWorkspace`,
gated inside `V2Shell`, and `webAppV2` is `prod: false`. A registrant in a
flag-off deployment therefore becomes a `User` with no Membership and lands on
v1 `Home`, whose Workspace-scoped reads all answer `401`. That is #217's
boundary, not something #230 changed — #217 scoped Flow 1 to the flagged chrome
and #228 says plainly that this spec "does not turn `webAppV2` on in
production". The journey [#232](https://github.com/Lamakira/docuflow/issues/232)
walks is walked with the flag on. It is recorded here because reopening the door
is what makes a stranger able to reach that fall-through at all.

## Still true after this ticket

- **Clerk owns every credential surface** (ADR-0007). Reopening sign-up means
  showing Clerk's, never building one.
- **Test mode only** (ADR-0018). `server/config.ts` still refuses a
  `CLERK_SECRET_KEY` that is not test-mode, and `webSignInAvailable()` still
  decides whether the SPA offers a box at all. A deployment with no keys refuses
  registration the same way it refuses sign-in: `401`, not a half-made account.
- **The marketing site grows no credential page** (ADR-0002,
  [#231](https://github.com/Lamakira/docuflow/issues/231)). `/signup` is served
  by the application, which is why the app answers that spelling as well as
  `/sign-up`.
- `webAppV2` is not turned on in production by this ticket.

## Rollback

Two steps, because the instance is not currently doing half the work:

1. Redeploy the previous image — the sign-up link goes back behind
   `footerAction: display none`, `/sign-up` falls through to sign-in, and
   `POST /api/auth/user` is a 404.
2. Set `sign_up.mode` to `restricted` on the Clerk instance, which #110 asked
   for and nobody did. Without this the hosted pages still take sign-ups, and a
   subject created there reaches the dead end again.

Nothing is written when either moves in either direction, and no migration is
involved.

Accounts created while it was open keep working: they are ordinary Users with
ordinary Memberships, and nothing about them depends on registration being open.
