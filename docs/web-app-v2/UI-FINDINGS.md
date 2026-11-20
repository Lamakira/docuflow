# v2 UI findings — a running list

**Read this before changing any v2 screen, and add to it whenever you find
something while using the product.** This is the standing list of v2 interface
defects found by using DocuFlow rather than by reviewing a mockup. It feeds the
v1 → v2 parity spec; nothing here is fixed by the ticket that recorded it.

A finding belongs here when the screen works but reads badly, misleads, or
gives a dangerous action the same weight as a safe one. A finding that stops a
user belongs in an issue, not here.

Each entry: what was seen, where it lives, why it is wrong, and what it would
take. No entry is deleted — it is marked **Fixed** with the change that fixed
it, so the next reader can tell a live problem from a settled one.

Related: [`PARITY.md`](PARITY.md) for what v2 still owes v1,
[`DESIGN-BRIEF.md`](DESIGN-BRIEF.md) for the intent,
[`AMENDMENTS.md`](AMENDMENTS.md) for the token decisions,
[`FLOWS.md`](FLOWS.md) for the journeys.

---

## F1 — Administration → Billing, the `Active` card

- **Status:** closed — [#245](https://github.com/Lamakira/docuflow/issues/245)
- **Found:** 2026-09-18, walking [#232](https://github.com/Lamakira/docuflow/issues/232) as a new customer, immediately after the Workspace reached `Active`
- **Where:** `client/src/v2/V2Administration.tsx:654-700`, classes `df-admin-form df-inline-form df-daily-form`, `df-billing-actions`, `df-ghost-btn`, `df-ink-btn`
- **Severity:** degrading, not blocking. Every control works

What the card shows once a Workspace is paying: a figure band (PLAN, CONDITION,
BILLABLE SEATS, RENEWS), then a seat form, then a row carrying "Writes
allowed.", "Update payment method" and "Cancel at period end".

Five things are wrong with it, in the order they hurt.

**1. `Cancel at period end` has the same weight as everything else.** It ends
the customer's subscription. It sits in a row of neutral buttons, last, styled
like "Update payment method" next to it. A destructive action must not be
reachable by the same visual reflex as a routine one, and it currently has no
confirmation distinguishing it either. This is the finding that matters; the
other four are polish.

**2. The seat form is an orphan.** `Seat quantity` and `Change seats` float
between the figure band and the action row, centred while everything around
them is not, belonging to no group and separated from the `BILLABLE SEATS`
figure they actually change. The number and the control that edits it should be
one thing.

**3. The seat input is empty while seats are 1.** `seatQuantity` starts blank
rather than seeded from the current capacity, so the field disagrees with the
figure two inches above it, and the submit button is disabled until the user
retypes a value the system already knows. Seed it from
`page.billing.purchasedSeatCapacity`.

**4. `Writes allowed.` is a bare sentence with no home.** It is rendered as
`df-form-note` inside `df-billing-actions`, so a statement about the Workspace's
entitlements is laid out as if it were helper text for the buttons beside it. It
is a status, and it belongs with the other statuses in the figure band.

**5. `CONDITION` is not a word for this.** The band reads PLAN `Pro`,
CONDITION `Active`. The domain language calls this the billing state, and the
chip in the card header already says `Active` — so the label is both unusual and
redundant with something eight inches away.

**What it would take:** group the seat figure with its control, seed the input,
move the entitlement line into the band, rename the label, and give
`Cancel at period end` a destructive treatment plus a confirmation. No new
component; the pieces exist.

---

## F2 — Workspace Documents, the folder preview panel is cut off

- **Status:** closed — [#245](https://github.com/Lamakira/docuflow/issues/245)
- **Found:** 2026-09-18, walking [#232](https://github.com/Lamakira/docuflow/issues/232), at a normal desktop width
- **Where:** `client/src/v2/tokens.css:3371` (`.df-folder-preview { width: 400px; }`), used by `client/src/v2/V2Documents.tsx:350`
- **Severity:** degrading. The panel works; part of it is unreachable

Selecting a folder opens the `FOLDER PREVIEW` aside, and it overflows the
viewport. The access paragraph is clipped mid-sentence — "Restricted items never
appear in this register," and the rest is gone — and `Manage access` is sliced
vertically, so one of the panel's two actions cannot be read or, at that width,
reliably pressed.

The rule is the whole style: a fixed `width: 400px` with no `flex-shrink`, no
`max-width`, no `min-width: 0` on the register beside it, and no breakpoint. The
register takes the width it wants, the aside adds 400px on top, and the row
exceeds the container instead of the aside shrinking or moving. Nothing in the
style says what should give.

Worth checking at the same time whether the aside should become a drawer below
some width rather than a column at all — a 400px panel next to a register is
most of a phone screen.

**What it would take:** give the row a `minmax()` or flex basis that lets the
register shrink, cap the aside with `max-width` and a percentage, and decide the
narrow behaviour. The clipping is a symptom of the row having no rule, not of
400 being the wrong number.

---

## F3 — People, the invite refusal floats loose in the page

- **Status:** closed — [#245](https://github.com/Lamakira/docuflow/issues/245)
- **Found:** 2026-09-18, walking [#232](https://github.com/Lamakira/docuflow/issues/232), inviting a second person into a 1-seat Workspace
- **Where:** `client/src/v2/V2People.tsx:295`, style `.df-refusal-pop` at `client/src/v2/tokens.css:1593`
- **Severity:** degrading. The message is correct and reachable; it is in the wrong place and says too little

Inviting someone when all seats are consumed refuses correctly. The refusal then
appears as a bare white box near the bottom-right of an otherwise empty page,
hundreds of pixels from the Invite form that raised it, reading
"All 1 purchased seats are consumed." above a `Close` button.

**The cause is one missing wrapper.** `.df-refusal-pop` is
`position: absolute; right: 0; top: calc(100% + 8px)` — it is written to hang
from `.df-refusal-anchor`, which is `position: relative`. Three of the four
places that render it wrap it in that anchor (`V2FileViewer.tsx:158`,
`V2People.tsx:506`, `V2Today.tsx:273`). The invite one at `V2People.tsx:295`
does not, so the absolute position resolves against a distant ancestor and the
popover lands wherever that ancestor ends. It is not a layout to redesign; it is
a wrapper that was left off.

Two things beyond the position:

- **The message names the wall, not the way out.** "All 1 purchased seats are
  consumed." is true and leaves the reader to work out that the Billing card,
  on another screen, has a seat control. The refusal already knows the Workspace
  is `Active` and the person is the Owner — it can say what to do.
- **It is styled as neutral.** A refusal and a confirmation currently look the
  same: white box, `df-ghost-btn`. `role="status"` is right for politeness, but
  nothing visually separates "this did not happen" from "this happened".

**What it would take:** wrap the invite popover in `.df-refusal-anchor` like its
three siblings, then decide whether the seat refusal earns a link to the seat
control. The first is a one-line fix.

---

## F4 — Project Documentation calls a Project a folder

- **Status:** partly closed — [#245](https://github.com/Lamakira/docuflow/issues/245) took the vocabulary: the screen says Project, `New folder` reads `New project`, the TYPE column reads `PROJECT`, the register foot counts PROJECTS, and the internal names follow. **The expensive half stays open**: `projects` is still doing two jobs, and whether this screen should have real folders of its own is undecided
- **Found:** 2026-09-18, walking [#232](https://github.com/Lamakira/docuflow/issues/232)
- **Where:** `client/src/v2/V2ProjectDocumentation.tsx`, fed by `/api/projects/documentable`
- **Severity:** degrading, and it costs debugging time rather than clicks

`New folder` on this screen creates a row in `projects`. The register then lists
it with `TYPE: FOLDER`, an item count, and a path — so a Project is presented as
a folder everywhere on the page, and the word Project appears nowhere.

`GLOSSARY.md` has no **Folder** term at all. It has **Workspace**, **Project**
(through `crm_projects`, the pivot the whole product hangs off) and
**Document**. The screen introduces a fourth word for the second one.

Two costs, both paid during this run:

- An operator asked to "open a File" created a folder instead, because the
  prominent control offers one and the vocabulary gives no hint that a folder
  here is a Project.
- Diagnosing the cross-Workspace leak took a detour through `documents` and
  `company_documents` before the leaked `Folder 1` turned out to be a row in
  `projects`. The label sent the search to the wrong two tables.

**What it would take:** decide whether this screen groups by Project — in which
case say Project, and let `New folder` read `New project` — or whether it has
real folders, in which case they need a table of their own. Renaming the label
is the cheap half; the expensive half is that `projects` is currently doing two
jobs.

---

## F5 — Administration → Billing, the cancel confirmation lands away from its button

- **Status:** closed — [#249](https://github.com/Lamakira/docuflow/issues/249)
- **Found:** 2026-09-20, using the Billing card after [#245](https://github.com/Lamakira/docuflow/issues/245) fixed F1
- **Where:** `client/src/v2/tokens.css` (`.df-billing-confirm`), `client/src/v2/V2Administration.tsx` (`CancelControl`)
- **Severity:** degrading. The guard works — one press no longer cancels — but the guard reads badly
- **Fixed:** 2026-09-20. `Cancel at period end` opens `alert-dialog.tsx`. The confirmation is a modal on the control, not an inline block against the card's far corner.

Arming `Cancel at period end` opens the consequence and its two buttons hard
against the bottom-right corner of the card, the full width of the card away
from `Update payment method`, which is left stranded on the left. At 1400px the
row reads as two unrelated groups rather than one control and its question.

This is **F3's defect, reproduced**: a message that floats away from what
raised it. `.df-billing-confirm` carries `margin-left: auto` in the
`.df-billing-actions` flex row, which is what pushes it. The shape was copied
from `RevokeControl` in `V2Devices.tsx`, where it works because it lives inside
a narrow register row; a 1400px card is not that.

The owner's verdict on seeing it: it should be a modal. v2 has no overlay of
any kind today, and `client/src/components/ui/alert-dialog.tsx` has never been
used here — so the first destructive confirmation to become a modal sets the
pattern for every one after it. That is a decision about the chrome, not about
this button, which is why it is deferred rather than patched.

**What it would take:** the modal standardisation pass. Until then the cheap
half is dropping `margin-left: auto` so the confirmation sits under the control
that armed it. Worth checking in the same pass whether `.df-danger-btn`'s red
is actually reaching the label, which is not obvious on screen.

---

## F6 — The rail offers a Member a destination the Workspace Role cannot reach

- **Status:** open
- **Found:** 2026-09-20, auditing every destination while fixing [#250](https://github.com/Lamakira/docuflow/issues/250)
- **Where:** `client/src/v2/presentation.ts:195` (`V2_NAV`), rendered whole at `client/src/v2/V2Rail.tsx:126`; the refusal it leads to at `client/src/v2/administration.ts:411`
- **Severity:** degrading, not blocking. The refusal is correct, the server refuses too, and nothing leaks

`V2_NAV` is a constant. The rail renders every section and every item, with no
filter on the Workspace Role or on anything else. A Member therefore sees
`Administration` in the rail, clicks it, and reads:

> Administration is open to the Owner and Administrators. Your Workspace Role is Member. Sam Lee (Owner) can change it.

The sentence is right. The rail entry above it is not. ADR-0025 draws the line
this breaks: "a Capability governs destinations and actions **within** a
Workspace Role's reach; the Role itself decides which destinations are in reach
at all." Administration is out of a Member's reach, so the rail is advertising a
place that does not exist for this reader.

**This is one destination, not a pattern.** All twelve were checked:

| Destination | Reachable by a Member | What refuses, and where |
| --- | --- | --- |
| Today | yes | nothing |
| Opportunities | yes | writes, on the control (`opportunityWriteRefusal`) |
| Clients | yes | writes, on the control (`clientWriteRefusal`) |
| Projects | yes | rows filtered by `projectVisibleTo`; writes on the control |
| Workspace Documents | yes | rows filtered by Document Access; writes on the control |
| Project Documentation | yes | writes, on the control |
| Time Tracking | yes | the Workspace-wide breakdown and the MEMBER filter are hidden |
| Activity | yes | own evidence only; reviewing others is hidden |
| People | yes | invite and edit, on the control |
| **Administration** | **no** | **the whole page** |
| Devices | yes | revoke, on the control |
| Help Center | yes | nothing |

Every `GET` behind the other eleven is `isAuthenticated` and nothing more. So
Administration is the only entry that could be filtered out, and the fix is
worth exactly one line of the rail — not a visibility system.

**Do not extend this to Capabilities.** A Member sees Clients because reading
the register is theirs; only `Create Clients` refuses. Hiding Clients would take
away a read they hold. That is the mistake this finding invites and must not
cause.

**There is already a precedent for hiding.** Team Daily Updates (`/daily-updates`)
is the one genuinely Capability-gated destination — `canViewTeamDailyUpdates`
takes the Workspace Role or `view_daily_updates`. It is not in `V2_NAV` at all,
and the Today row that links to it (`today.ts:208`) only appears on data the
screen fetches when the reader can view team updates. A Member never meets it.
Administration is the outlier.

**What it would take:** a `reach` predicate on `V2NavItem`, carried by the
`administration` entry alone, and one filter where the rail maps `V2_NAV`.
`/administration` typed by hand must still land on the refusal page — the URL
has to explain itself, and the page already does. Worth deciding in the same
pass whether the rail should say anything at all about a hidden destination, or
simply not draw it.

---

## F7 — Devices, revoking a Device still confirms inline, not in a modal

- **Status:** closed
- **Found:** 2026-10-27, by the owner, on the first day of the v1 → v2 cutover
- **Where:** `client/src/v2/V2Devices.tsx` (`RevokeControl`, used twice at the row and on the stacked mobile row), `client/src/v2/tokens.css` (`.df-devices-confirm`)
- **Severity:** degrading. The guard works (one press does not revoke), but the confirmation looks unlike every other destructive one in v2
- **Fixed:** 2026-10-27. Revoke now opens `alert-dialog.tsx` like the other destructive confirmations; the inline confirming state, `revokeKey` and `.df-devices-confirm` are gone.

Pressing `Revoke` on a Device row swaps the button for a sentence and two
buttons inside the row: "Revoke this Device Enrollment? It ends access to the
Workspace.", then `Revoke` and `Cancel`. The question wraps over two lines in the
action column and pushes the row taller. Both buttons are the same outline
style, so the destructive one does not read as destructive.

F5 called this the pattern that "works because it lives inside a narrow register
row". That stopped being true: since F5 was fixed, the destructive confirmations
in Administration, Workspace Documents, the Project Dossier, Opportunities and
the back office all open `alert-dialog.tsx`. Devices is now the one left behind,
and the owner noticed the difference at once.

**What it would take:** replace `RevokeControl`'s inline state with the same
`AlertDialog` the other screens use. `Revoke` opens it, and the dialog carries
the consequence and a destructive `Revoke` action. Drop `.df-devices-confirm`
and the `revokeKey` state that only the inline shape needs. The stacked mobile
row gets the same dialog for free.

---

## F8 — Opportunities, the search field takes a row of its own

- **Status:** closed
- **Found:** 2026-10-28, by a colleague, in the first days after the v1 → v2 cutover
- **Where:** `client/src/v2/V2Opportunities.tsx` (the `df-filter-bar` under the header), and the free-text field on every v2 list page
- **Severity:** degrading. The field works; it wastes a row and is misnamed
- **Fixed:** 2026-10-28. The field moved into the header's actions, left of `New Opportunity`, with the search icon. Every v2 list field now reads "Search …" instead of "Filter …", and Clients, People and Projects got the icon Documents already had.

On Opportunities the filter bar held nothing but the text field, so it took a
whole row under the header for one 250px input. The field matches free text
across the pipeline: people read it as a search, and "Filter" made them look for
selects that are not there.

**What it would take:** put the field in `.df-library-actions` beside the
button, give it the shared control height, and call it Search everywhere. The
other lists keep it in their filter bar, where it sits next to real filters.

---

## F9 — Workspace Documents, the folder preview stretches past the screen

- **Status:** closed
- **Found:** 2026-10-28, by a colleague, in the first days after the v1 → v2 cutover
- **Where:** `client/src/v2/tokens.css` (`.df-folder-preview`), used by `client/src/v2/V2Documents.tsx`
- **Severity:** degrading. The panel's footer action is out of reach until you scroll the whole register
- **Fixed:** 2026-10-28. The panel is sticky at the top of the scrolling area and holds the visible height under the command bar, so its footer always shows. Its `Open folder` button is gone: selecting the folder in the register already opens it.

The aside is a flex sibling of the register, so it stretched to the register's
height. With a long library the panel grew with it and `Open folder` /
`Manage access` sat far below the fold, with an empty column above them. F2 fixed
the panel's width; nothing fixed its height.

**What it would take:** `position: sticky; top: 0; align-self: flex-start` and
a height of the viewport under the 62px command bar; the panel's own scroll area
already takes the overflow.

---

## F10 — Action buttons are words only

- **Status:** closed
- **Found:** 2026-10-28, by a colleague, in the first days after the v1 → v2 cutover
- **Where:** the item actions across `client/src/v2/` (Dossier, Opportunities, Clients, Documents, Project Documentation, Devices, Administration, Time, Activity, the file viewer, Support access)
- **Severity:** cosmetic. Every action works; a row of text buttons is slow to scan
- **Fixed:** 2026-10-28. Item actions carry a leading icon: pencil for Edit and Rename, trash for Delete and Remove, ban for Revoke, plus for New and Add, and Download, Upload, Copy, Reopen, Manage access and New code their own. Dialog housekeeping (Cancel, Save, Close, Keep …, Create …) stays text only, and row menus are unchanged.

Delete is a trash can, not the X the colleague first suggested: X already means
close on every panel and dialog in v2, so on a delete it would read as
"dismiss".

---

## F11 — Opening a Document waits with a fake title and two different loading lines

- **Status:** closed
- **Found:** 2026-10-28, using the app after the v1 → v2 cutover
- **Where:** `client/src/v2/V2Document.tsx` (`EditorLoading`), `client/src/v2/V2FileViewer.tsx` (the previews)
- **Severity:** cosmetic. Nothing is lost; the page just jumps and reads twice
- **Fixed:** 2026-10-28. A Document waits with its real header (Back to … and a bar for the name and meta line) over a page-shaped skeleton, and a File preview waits with the same page; the words are left to a screen reader.

The header said "Document" until the content landed, then jumped to Back and the
real name. The file viewer then showed a second, different line ("Loading this
File…") for the same wait. Every other destination already waited with the
skeleton: the real frame, bars where the values go.

## F12 — A list empty for its Range shows a bare line instead of the designed state

- **Status:** closed
- **Found:** 2026-10-31, Activity → Gallery on Today with no capture yet
- **Where:** `client/src/v2/V2EmptyState.tsx` (`V2RecordEmpty`, the `range` case), and the four record lists that reach it: Time Tracking's register, Activity Evidence, Activity Gallery, team Daily Updates
- **Severity:** cosmetic. Nothing is lost; the screen reads as unfinished
- **Fixed:** 2026-10-31. A record list empty for its Range shows the designed state like every other empty list — icon, "No … today", one line saying only this Range is shown, and a button that widens the Range one step (Today → This week → …). Dashboard sections (Today, Analytics) keep the compact line, as #325 set.

#325 gave a short Range its own case: rows may exist outside it, so the list
must not invite a first use, and it chose the dashboard's one-line `df-empty`
for it. In a record list that line sits alone under a card head and filter row
built for rows, where every other empty list in v2 shows the designed panel, so
the owner read it as a screen nobody had designed. The case is kept — the copy
still says earlier rows exist rather than inviting a first one — but it now
takes the designed panel, and its action is the way out the line only named.

The same pass fixed two defects on that screen. The empty Gallery still offered
`Select all` and a disabled `Download 0 captures` with nothing to act on; they
now show only when the Gallery holds a capture. The Tracking Policy card's
footnote ("You can inspect Activity Evidence…") sat flush against the last
policy line and 4 px left of it, borrowed from the empty-line class `df-empty`;
it is now a hint inside the policy block, on the same left edge, a step below.

## F13 — Today lists every row in its sections

- **Status:** closed
- **Found:** 2026-11-05, Today on the real Workspace: 11 rows in Needs attention, 123 in Active Projects
- **Where:** `client/src/v2/today.ts` (`composeToday`, `composeProjects`), `client/src/v2/V2Today.tsx`
- **Severity:** cosmetic. Nothing is lost; everything below Active Projects sits far out of reach
- **Fixed:** 2026-11-05. Needs attention, Active Projects and Recent knowledge changes show five rows each, keep the real total in the count, and offer `View all` when there are more. Projects are ordered by Tracked MTD, so the five shown are the ones being worked on. Workday stays whole: it has no fuller page to send anyone to.

`View all` on Needs attention opens the Notifications panel rather than a page,
so it is a Button, not the quiet `.df-ghost-link` the other two use.

---

The ten entries below come from one full UI review of Today on 2026-11-17, from
two captures of the real Workspace by the owner (the whole page) and from the
code. Keyboard, dark mode, 200% zoom and the mobile layout were read from code
only.

## F14 — Today's one primary action opens a panel that is always empty

- **Status:** closed — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, Today on the real Workspace (seen in capture)
- **Where:** `client/src/v2/V2Today.tsx:240` (`Resolve approvals`), `client/src/v2/V2ContextPanel.tsx:76`, `client/src/v2/today.ts:352` (`EMPTY_TIMESHEET_APPROVALS`)
- **Severity:** misleading. The only amber button on the page leads nowhere
- **Fixed:** 2026-11-18, [#370](https://github.com/Lamakira/docuflow/issues/370). `Resolve approvals` and the Approvals panel are gone (header, mobile action bar, context panel, `V2CommandPanel`). Today has no header action; the top Needs attention row carries its own.

`Resolve approvals` is the page's one filled amber button, top right. It opens
the context panel, which can only ever say "Timesheets are not a product record
yet." Nothing in the product creates an approval, so the most prominent control
on the home screen is a dead end, and it pulls the eye away from the 23 rows
that do need the owner. The brief (Screen 02) asks for one clear action:
"create a client project or resolve the highest-priority exception, depending
on state." It would take removing the button until Timesheets exist and, if
the header needs an action, making it the top Needs attention row's own action
or `New Project`.

## F15 — Needs attention fills with the same Daily Update reminder, one per day

- **Status:** closed — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, Today on the real Workspace (seen in capture): four of the five rows read "Don't forget to submit your daily update before you finish your day.", dated Yesterday, 15 Nov, 14 Nov, 13 Nov
- **Where:** `client/src/v2/today.ts:232` (`composeAttention`), `today.ts:223` (`notificationHref`), `server/dailyUpdateNudge.ts:155-163`, `client/src/v2/V2ContextPanel.tsx:269` (the only place a notification is marked read)
- **Severity:** misleading. The queue's five rows are mostly one repeated nag
- **Fixed:** 2026-11-18, [#370](https://github.com/Lamakira/docuflow/issues/370). The reader's unread reminders collapse into one row, "Submit your Daily Update". `POST /api/daily-updates` marks them read. A notification with no Project opens the Notifications panel instead of reloading Today.

The scheduler writes one `daily_update_reminder` per workday. Nothing marks it
read when the Daily Update is submitted or when the row is opened from Today —
only a click inside the Notifications panel does — so every past reminder stays
in the queue. `Open` on the 13 Nov row goes to `/daily-update`, today's form, not
13 Nov. A notification with no Project links to `/`, so its `Open` reloads Today.
It would take collapsing the reader's own reminders into one row ("Your Daily
Update for today"), marking them read on submit (server) and on `Open`, and
dropping reminders for past days.

## F16 — Today's header and queue say things the data does not support

- **Status:** closed — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, Today on the real Workspace (seen in capture)
- **Where:** `client/src/v2/today.ts:190` (`attentionSubhead`), `client/src/v2/V2Today.tsx:252` (`Sorted by impact`)
- **Severity:** misleading copy
- **Fixed:** 2026-11-18, [#370](https://github.com/Lamakira/docuflow/issues/370). The subhead reads "N items need your attention". "Sorted by impact" is gone; the queue reads roll-call, own reminder, then newest first.

"23 items need you before end of day." counts reminders from 13 Nov, which are
not due today, and counts seven missing team Daily Updates as one item. "Sorted
by impact" is not true: the order is the roll-call row first, then
notifications in the order the API returns them. It would take "23 items need
your attention" (or a count of what is actually due today) and either dropping
the sort label or saying what the order is ("Newest first").

## F17 — Active Projects lists Completed Projects and counts every Project

- **Status:** closed — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, Today on the real Workspace (seen in capture): `360 Autowrap` shows `COMPLETED` under Active Projects; the head says `View all 124`
- **Where:** `client/src/v2/today.ts:123` (`LIVE_PROJECT_STATUSES` includes `completed`), `client/src/v2/V2Today.tsx:167` (`projectTotal` is the API total of all Projects)
- **Severity:** misleading
- **Fixed:** 2026-11-18, [#370](https://github.com/Lamakira/docuflow/issues/370). Active, In review and On hold Projects with hours this month only; the count chip is that set. `View all` opens `/projects`, which takes one status and has no hours sort, so the link cannot carry the same filter.

The section is called Active Projects and shows Active, In review, On hold and
Completed. The `View all 124` count is every Project in the Workspace, not the
ones this section selects, and the link opens `/projects` unfiltered, so the
number never matches what the reader finds. Two of five columns (Project
manager, Budget used) are empty on all five rows of the real Workspace, and
the fifth row, Landy's Pro, has 0.0 h this month: the list pads itself with
Projects nobody is working on. It
would take either renaming the section to what it is ("Worked on this month")
or filtering to the statuses its name promises, and counting and linking the
same set.

## F18 — Recent knowledge changes sends `View all` to the wrong destination

- **Status:** closed — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, Today on the real Workspace (seen in capture): five rows, all "Project doc · …", three of them titled `Resources`; `View all` with no count
- **Where:** `client/src/v2/V2Today.tsx:437`, `client/src/v2/today.ts:340`, `server/routes.ts:444` (`/api/documents/recent` returns Project Documents)
- **Severity:** misleading
- **Fixed:** 2026-11-18, [#370](https://github.com/Lamakira/docuflow/issues/370). `View all` opens Project Documentation. Each row names the document's creator (`documents` keeps no last editor). No total: the endpoint returns ten at most.

Every row is a Project Document and says so ("Project doc · …"), but `View all`
opens Workspace Documents (`/documents`, company documents), which lists none
of them. When a document's Project is not in the first 500 loaded, the meta
reads "Project doc · Project". The section shows no count, unlike the other two
capped sections (F13), and its "Access-filtered" note is internal vocabulary.
The section is called *changes* but no row says who changed the document; with
three rows titled `Resources`, the Project name in the meta is the only thing
telling them apart. The API returns ten at most (`getRecentDocuments(userId,
10, …)`), so a total would need its own count. It would take linking to
`/project-documentation`, showing the total, naming who last edited each
document, and dropping the note.

## F19 — Today shows empty sections before their data arrives, and errors as empty

- **Status:** closed — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, from code
- **Where:** `client/src/v2/V2Today.tsx:114-145` (only `projectsLoading` gates the skeleton; projects and stats `queryFn`s never check `res.ok`)
- **Severity:** misleading for a moment on every load; misleading for good when a read fails
- **Fixed:** 2026-11-18, [#370](https://github.com/Lamakira/docuflow/issues/370). Each card loads, fails and retries on its own; reads check `res.ok`, so an error shows "Couldn't load …" with Retry, never the empty line. `now` refreshes on focus and on return to the tab.

The skeleton waits for Projects only. Notifications, Daily Update status,
users and time stats start empty, so the page can show "Nothing needs
attention" and "0.0 h today" and then jump when they land. The projects and
stats fetches parse whatever comes back, so a 500 renders "No active Projects in
this Workspace yet." — an error that reads as an empty Workspace, with no retry.
`now` is fixed at mount, so a page left open past midnight keeps yesterday's
date and figures. It would take a per-section skeleton tied to each query,
`res.ok` checks with an error line and `Retry`, and refreshing `now` on focus.

## F20 — `Remind` looks larger than `Open`, and its toast always says sent

- **Status:** closed — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, Today on the real Workspace (seen in capture: `Remind` is visibly larger than the `Open` links below it)
- **Where:** `client/src/v2/tokens.css:783` (`button.df-cta { font: inherit }` resets the 12px size), `client/src/v2/V2Today.tsx:108,176`, `server/dailyUpdateNudge.ts:155`
- **Severity:** cosmetic for the size; misleading for the toast
- **Fixed:** 2026-11-18, [#370](https://github.com/Lamakira/docuflow/issues/370). `button.df-cta` takes the link CTA's 12px/500 back. The toast is built from the response ("Reminded 3 members · 4 already reminded today"), and Reminded comes from the server's `remindedToday`.

`Remind` messages every member missing a Daily Update in one click (seven on
the real Workspace), by notification and email. The server skips anyone
already nudged that workday, often all of them after the scheduled nudge, yet
the toast says "Daily Update reminders sent" whatever `sent` comes back as.
"Reminded" lives in component state, so a reload offers `Remind` again. It would
take restoring `font-size` on `button.df-cta`, a toast built from the response
("Reminded 3 members · 4 already reminded today"), and the reminded state read
from the server.

## F21 — Today's rows read as one run-on link, and two labels fail contrast

- **Status:** closed — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, from code and the capture
- **Where:** `client/src/v2/V2Today.tsx:336-393` (register rows), `V2Today.tsx:308` (queue rows), `V2Today.tsx:252,433` (`--df-muted-ink` at 10px), `client/src/v2/tokens.css:263` (focus ring)
- **Severity:** accessibility floor
- **Fixed:** 2026-11-18, [#370](https://github.com/Lamakira/docuflow/issues/370). Row links and buttons carry one-sentence `aria-label`s; the two muted labels are gone. The focus ring pairs the amber with a 2px case-ink band (`tokens.css`, `.df-v2 :focus-visible`); rows draw it inside.

The Active Projects register is a grid of `<span>`s inside one `<a>` per row,
with no table or header association, so a screen reader announces "Innover
l'administration béninoise! — · Internal IN REVIEW — — 66.3 h". "Sorted by
impact" and "Access-filtered" are 10px in `--df-muted-ink` (#8a94a6), 3.1:1 on
white, under the 4.5:1 floor. Shell-wide, not Today's: the 2px amber focus ring
(#e9a23b) is 2.2:1 on white, under 3:1; AMENDMENTS keeps the amber ring, so the
fix is the token (a darker amber step, or an inner dark ring), not Today. It
would take an `aria-label` per row link naming the Project, status and hours (or
real table semantics), and `--df-archive-slate` for the two labels.

## F22 — Today polish: alignment, casing, placeholders

- **Status:** closed — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, Today on the real Workspace (seen in capture unless marked)
- **Where:** `client/src/v2/tokens.css:2595` vs `:727`, `tokens.css:752`, `client/src/v2/today.ts:286`, `client/src/v2/V2Today.tsx:349,368,382,415`
- **Severity:** cosmetic
- **Fixed:** 2026-11-18, [#370](https://github.com/Lamakira/docuflow/issues/370). Register heads align with their rows; kind labels are sentence case; one dash for every empty cell; inline sizes moved onto the ramp; the count shows once; the date is plain text. Workday puts the reader first, then missing in the alert ink, takes initials from the shown name, and notes a Timer left open since an earlier day. Workday still lists every member beside a five-row Knowledge card: F13 kept it whole, since it has no fuller page to send anyone to.

- The register head pads 20px left and right, its rows 16px, so every column
  head sits 4px off its values (`Project / client` at 284px, the names at 280px).
- The queue's kind label `UPDATE` is uppercase with letter-spacing, which
  Amendment 6 retired for small labels, and the same word covers the team
  roll-call and the reader's own reminder.
- A Project with no client reads "— · Internal"; it should read "Internal".
  Project manager and Budget used use two different dashes for the same
  emptiness.
- Inline sizes 11px and 13.5px sit off the type ramp (`--df-text-*`).
- The Needs attention head gives the count twice (`23 items`, `View all 23`).
- The date chip is boxed like a control and does nothing.
- Workday shows `UPDATE MISSING` in slate while `UPDATE POSTED` is green; the
  state that needs action has the weaker tone.
- Workday lists its ten members in no order: missing and posted interleave, and
  the reader's own row (ninth of ten) is marked only by a darker
  avatar. Missing first, or the reader first, would make it scannable.
- Initials come from first and last name, else the email's first letter, so
  "Kevin LINHOUNHINTO" gets `L` beside rows with two letters. Deriving them
  from the displayed name keeps them consistent.
- Workday says "0.0 h today" for everyone while the command bar shows a paused
  timer at 26:48:59; nothing on Today points out a timer left open for a day.
- The Workday card runs ten rows; Recent knowledge changes beside it stops at
  five, leaving a tall empty block under it.

## F23 — v2 pages scroll sideways at 200% zoom

- **Status:** closed — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, from code, reviewing Today
- **Where:** `client/src/v2/tokens.css:642` (`.df-page { min-width: 1060px }`), `client/src/v2/presentation.ts:19-20`
- **Severity:** accessibility floor (WCAG 1.4.10 reflow), shell-wide
- **Fixed:** 2026-11-18, [#370](https://github.com/Lamakira/docuflow/issues/370). No page holds the 1060px floor; Today stacks its register and folds its split under 900px; the command bar drops its words under 760px and keeps every control. Checked at 600px of content on 17 v2 pages: no page scrolls sideways; the Kanban pipeline, the Projects table and the tab strips scroll inside themselves.

The mobile layout starts at 639px and below; above it every page holds 1060px
of content beside a 240px rail. A 1680px screen at 200% zoom is 840 CSS px wide,
so Today, and every other `df-page`, scrolls sideways. It would take letting
the content shrink between 640px and 1300px (the stacked register already
exists for mobile) or switching to the mobile layout at a wider breakpoint.

---

The eight entries below come from one full UI review of Opportunities (the
pipeline, New Opportunity, the Opportunity record and its won and lost dialogs)
on 2026-11-18. The app ran locally on the seeded DocuFlow Workspace, which
holds two Opportunities; the dialogs were opened and cancelled, nothing was
saved. The real Workspace's shape came first from the cutover rehearsal of
2026-10-26 (`docuflow_rehearsal`, the v1 export with the v2 migrations applied,
122 rows), passed through the real client functions. The same day the owner
sent two captures of the real Opportunities page, and its pipeline was then
read in production (columns, cards, pill colours; nothing clicked). Read from
code only: dark mode, the stacked mobile board, a live drag, a
Read-only Workspace, 200% zoom, a notes thread with notes in it, a card with an
Estimated value and the column totals, and the loading and error states.

## F24 — Two v1 stages become open pipeline columns, and their won Projects can be dragged back to Lead

- **Status:** closed — [#372](https://github.com/Lamakira/docuflow/issues/372), confirmed on the real Workspace
- **Found:** 2026-11-18, from the cutover rehearsal run through `composeOpportunityPipeline`, then on the real Workspace (captures by the owner, pipeline read in production)
- **Where:** `shared/projectLifecycle.ts:25` (`OPPORTUNITY_STAGE_BY_COMBINED`), `client/src/v2/opportunities.ts:199` (`stageOptionsFromFieldOptions`), `opportunities.ts:224` (`composeOpportunityStages`), `client/src/v2/V2Opportunities.tsx:1218` (`onStageChange`), `shared/opportunityFields.ts:48` (the server's only stage rule is about entering Won)
- **Severity:** misleading on sight; damaging if anyone drags one
- **Fixed:** 2026-11-18, [#372](https://github.com/Lamakira/docuflow/issues/372). `shared/projectLifecycle.ts` reads `won_in_review_pm` and `won_in_review_client` as stage Won and Project Status In review, and `in_negociation` as `in_negotiation`: on the cutover rehearsal the pipeline draws seven columns, Won 83, Lost 22, twelve draggable cards. A PATCH that moves a won Opportunity out of a won status, Lost included, is refused, as `/lost` already refused it. `npm run db:backfill:legacy-statuses` rewrites the stored Project Status and Opportunity stage of those rows (16 and 16 on the rehearsal copy); it has to be run on production. `crm_projects.status` keeps v1's values, so the PM / Client distinction survives. A status that is neither in the lifecycle map nor in the Workspace's stage list still gets its own column, so no card vanishes, but that column is locked: nothing is dragged out of it or dropped into it. A rule on the `won_` prefix was not taken, because an Administrator may name an open stage `Won - Paid`, which a test pins.

The rehearsal's stage list still carries v1's labels: `In Negociation`,
`Won - In Review (PM)` and `Won - In Review (Client)`, and 18 rows carry the
matching statuses. The labels become the ids `in_negociation`,
`won_in_review_pm` and `won_in_review_client`, which the lifecycle map does not
know (it knows `in_negotiation` and `won_in_review`), so each is read as an
open stage. With the 122 rows the pipeline draws nine columns: Lead 4,
Discovering Call Completed 1, Proposal Sent 1, Follow Up 4, In Negociation 2,
**Won - In Review (PM) 5, Won - In Review (Client) 9**, Won 69, Lost 22. The
fourteen cards in the two Won - In Review columns are won Client Projects in
review, yet they are draggable: dropping one on Lead sends `status: "lead"`,
and the PATCH handler has no rule against leaving a won status, so it would
un-win it. New Opportunity offers both as a starting stage. Their stored
Project Status is Planned in the rehearsal. No code or migration renames these
values; migration 0012 maps only the exact v2 statuses.

The real Workspace shows the same nine columns, 119 cards: Lead 5, Discovering
Call Completed 1, Proposal Sent 1, Follow Up 4, In Negociation 2, **Won - In
Review (PM) 4, Won - In Review (Client) 9**, Won 71, Lost 22. Won and Lost are
locked (93 cards); the thirteen won Projects in the two Won - In Review columns
are not. Because a drop writes at once, this stops being a findings entry and
has its own issue, #372 (see the rule at the top). It would take
mapping the three v1 ids in `shared/projectLifecycle.ts`
(`won_in_review_pm` and `won_in_review_client` to Won / In review,
`in_negociation` to `in_negotiation`), or a data migration that renames them,
and never treating an unknown id as an open stage.

## F25 — Won and Lost sit off-screen with no scrollbar, and the board is mostly closed history

- **Status:** closed — fixed 2026-11-19
- **Found:** 2026-11-18, the pipeline in a 1680px window (measured), and the cutover rehearsal (counted)
- **Where:** `client/src/v2/tokens.css:2466-2483` (`.df-opportunity-pipeline`, `scrollbar-width: none`), `client/src/v2/opportunities.ts:275` (`composeOpportunityPipeline` keeps every terminal card)
- **Severity:** misleading. Won and Lost are invisible and nothing says so
- **Partly fixed:** 2026-11-18, as on Trello. The board fills the page below its head, every column is the board's height, and a column with more cards than fit scrolls inside itself (`.df-opportunity-pipeline[data-stacked="false"]` and its `.df-opportunity-drop`, `overflow-y: auto`), during a drag too; the stacked layout keeps columns at their own height, one under the other. Measured on the DocuFlow Workspace seeded with `npm run db:seed:demo` (110 Opportunities, 1680px window): every column 7495px tall before, 710px after; Won scrolls 7419px of cards inside 634px, Lost 2143px; the page itself no longer scrolls and "110 Opportunities" stays in view. A keyboard drag between columns still works. Still open: Won and Lost off-screen with no visible scrollbar.

Seven 280px columns need 2032px; the pipeline shows 1392px. In Negotiation
loses its right edge and its count chip, and Won and Lost are entirely
off-screen, with the scrollbar hidden on purpose, so nothing tells the reader
the board goes on. From code: the board does not turn a vertical wheel into a
sideways scroll, so a plain mouse wheel never reaches them. On the real
Workspace the board is nine columns, 2616px wide in a 1392px view, and the two
hidden columns hold 93 of 119 cards (Won 71, Lost 22): the sales pipeline is
thirteen cards at the front of a long archive. Every column stretches to the
Won column's height, 6558px, so the board ends in eight tinted columns that
are empty for some 6000px, and "119 Opportunities" sits at the very bottom of
the page (seen in the owner's captures). It would take a visible scrollbar (or
edge fades with scroll buttons), and terminal columns that show a count and the
most recent few with a way to the rest, as F13 did for Today.

- **Fixed:** 2026-11-19. Won and Lost show their 10 most recently updated cards and `Show all N` / `Show fewer`; the count chip and the page count keep the totals, and a search never hides a match behind the cap. The board's horizontal bar is visible (thin, no arrows, no track: the owner's choice over the columns' hover-only bar), and the edge that still has columns beyond the window fades over 48px. Measured on the seeded DocuFlow Workspace (110 Opportunities, 1680px window): Won 10 of 73 shown, Lost 10 of 21; the right edge fades until the board is scrolled to Lost, then the left one does.

## F26 — Winning or losing an Opportunity from its record takes Edit → Stage → Save changes

- **Status:** closed — fixed on the record, 2026-11-19
- **Found:** 2026-11-18, the record of `Az` (DocuFlow Workspace)
- **Where:** `client/src/v2/V2Opportunities.tsx:1012-1055` (the Stage card), `V2Opportunities.tsx:856-882` (`finish`, the form path that opens the outcome dialog)
- **Severity:** degrading. The sale's two decisive actions are hidden behind the form

#307 chose this: "The stage changes in Edit mode, with the other fields. Won
and Lost still open the existing outcome dialog." In use it costs this: the
Stage card holds one row, the stage pill the header already shows, and a
sentence, "Edit changes the stage." To close a sale you open Edit, pick Won in
the Stage select, and press `Save changes`, which saves nothing (with no other
change there is no PATCH) and opens the Mark as won dialog instead. Cancelling
that dialog drops the choice and closes the form. My suggestion, not #307's:
`Mark as won` and `Mark as lost` buttons in the Stage card of an open
Opportunity, in place of the repeated pill, each opening its dialog directly;
Edit keeps the stage for the other moves.

- **Fixed:** 2026-11-19. The record's Stage card of an open Opportunity holds `Mark as won` and `Mark as lost`, each opening its dialog directly; the repeated stage row is gone. A won record says it is now a Client Project; a lost one keeps its Lost reason. Edit still moves the stage between open stages.

## F27 — A pipeline card cannot be opened from the keyboard or in a new tab

- **Status:** closed — fixed 2026-11-19
- **Found:** 2026-11-18, the pipeline: Enter on a focused card did nothing (tested)
- **Where:** `client/src/v2/V2Opportunities.tsx:216-283` (`OpportunityCardView`)
- **Severity:** accessibility floor

The card is an `<article>` that the drag library turns into `role="button"`
with `tabindex="0"`. It opens only from a mouse click (`onClick` checks the
pointer did not move), so Enter on a focused card does nothing: a keyboard user
can reach every card and open none. Space lifts the card for a drag instead.
There is no link either, so a middle click does nothing and Ctrl-click works
only through `window.open`. It would take making the card's drag handle a real
`<a href>` to the record: the drag library blocks drags from buttons and inputs
but not from links, and its click threshold already tells a click from a drag.
Enter, middle click and a screen reader's link list then work, with Space left
to the drag.

- **Fixed:** 2026-11-19. The card is a link (`<a href>` to the record) and still the drag handle; the library's `role="button"` is dropped so it reads as a link, and its lift instructions stay in `aria-describedby`. Enter opens the record, Space still lifts it, Ctrl-click opens a new tab and the board stays put (tested); middle click is the browser's own link behaviour (not tested). A keyboard focus shows the shared focus ring.

## F28 — Mark as won and Mark as lost cannot be undone, and neither dialog says so

- **Status:** closed — fixed 2026-11-19
- **Found:** 2026-11-18, both dialogs opened from the record and cancelled
- **Where:** `client/src/v2/opportunities.ts:253` (`canChangeOpportunityStage` refuses any move out of Won or Lost), `client/src/v2/V2Opportunities.tsx:443,528` (the dialog descriptions), `V2Opportunities.tsx:896` (the Stage select is disabled once terminal)
- **Severity:** misleading for an irreversible action

Once Won or Lost, the card is locked on the pipeline and the record's Stage
select is disabled; nothing in v2 reopens it (the server would accept a move
out of Lost; the lock is the client's). Mark as lost says "Losing Az closes
it", and Mark as won says it "makes it a Client Project", but neither says the
stage cannot be changed afterwards, and both submit with the amber primary
button. A drop onto Lost by mistake ends in a reason select, not a warning. It
would take one sentence in each dialog ("This cannot be undone"). My
suggestion, beyond that: a way to reopen a Lost Opportunity, since the server
already allows it.

- **Partly fixed:** 2026-11-19. Both dialog descriptions end with "It cannot be moved back to an open stage afterwards.", and the record's Stage card says it before either is opened. Still open: no way to reopen a Lost Opportunity, which the server would allow.

- **Fixed:** 2026-11-19. A Lost record's Stage card holds `Reopen`: a dialog offers the open stages, preselecting the one held before the loss (from Stage history; the first open stage when there is none), and the server clears the Lost reason. Won stays final; the Lost dialog now says it can be reopened later. Tested on the dev database: the PATCH was accepted, `lost_reason` went to null, and a `lost → lead` Stage history row was written.

## F29 — Stage pills fail contrast at 10px

- **Status:** closed — fixed 2026-11-19
- **Found:** 2026-11-18, the pipeline heads (measured locally and on the real Workspace)
- **Where:** `client/src/v2/stageColor.ts:41` (`WHITE_MIN_CONTRAST = 3`), `client/src/v2/tokens.css:6948` (`.df-stage-pill`, `--df-text-1` = 10px, 600)
- **Severity:** accessibility floor

The pill takes white text whenever white clears 3:1, a threshold `stageColor.ts`
chose on purpose. The text is 10px, so it owes 4.5:1. White on Lead (#ec4899)
measures 3.53:1, on In negotiation (#3b82f6) 3.68:1, on Lost (#ef4444) 3.76:1,
on Discovering call completed (#8b5cf6) 4.23:1. Dark ink would clear the first
three (5.16, 4.95, 4.84) but not Discovering (4.30), which needs a darker fill.
An Administrator's own stage colour goes through the same rule. On the real
Workspace, whose stages carry v1's colours, three pills fail: Discovering Call
Completed 4.23:1, In Negociation 3.68:1, Lost 3.76:1 (Lead is slate there,
4.76:1). Lead and Won - In Review (Client) also share one slate (#64748b), so
two columns wear the same colour. Amendment 6
keeps the capitals; only the contrast is at fault. It would take a 4.5:1
threshold that falls back to dark ink, and a darker step where neither ink
clears. The record and Stage history wear the tinted swatch style instead,
which clears 4.5:1 by design.

- **Fixed:** 2026-11-19. A pill takes white when white clears 4.5:1, dark ink when only dark ink does, and otherwise its fill steps darker until white does (`stagePill`, `stageColor.ts`). Lead, In negotiation and Lost now wear dark ink; Discovering's #8b5cf6 and Planned's #6366f1 (Projects board) step darker. An Administrator's stored colour is never changed, only what the pill wears. Since #377 the record header and Stage history wear the same filled pill, so the rule covers them too.

## F30 — A card says nothing about who owns the sale or when it should close

- **Status:** closed — fixed 2026-11-19
- **Found:** 2026-11-18, the pipeline, and the real Workspace (counted)
- **Where:** `client/src/v2/V2Opportunities.tsx:278-280`, `client/src/v2/opportunities.ts:315` (the card model)
- **Severity:** degrading. The board cannot be triaged without opening each card

A card shows the name, the Client and the Estimated value. On the real
Workspace none of the 119 cards has an Estimated value, so every card is a
name and a Client, and no column shows a total. The fields that make a pipeline scannable, the Owner
and the Expected close, are on the record only; nothing marks a card whose
close date has passed or that has sat in its stage for weeks. It would take the
Owner's initials and the Expected close on the card, the date in the alert ink
once passed.

- **Fixed:** 2026-11-19. A card shows the Owner's initials (name on hover and to screen readers) and `Close <date>`, in the alert ink once the date has passed (open stages only). Nothing shows for a missing value. On the real Workspace this means 11 of the 12 open cards show a passed date, and 1 an Owner.

## F31 — Opportunities polish: labels, repetition, states

- **Status:** closed — fixed 2026-11-19
- **Found:** 2026-11-18, the pipeline and the record (seen unless marked)
- **Where:** `client/src/v2/V2Opportunities.tsx` (lines below), `client/src/v2/tokens.css:2500` and `:3475`, `client/src/v2/emptyState.ts:40`
- **Severity:** cosmetic

- The breadcrumb ends in "Record", not the Opportunity's name.
- The header reads `OPEN` or `TERMINAL` beside the Client (`:972`). Terminal is
  an internal word, and it is a small label in capitals, which Amendment 6
  retired outside chips. The boxed `OPPORTUNITY` chip beside it repeats the
  breadcrumb and looks like a control.
- The stage appears three times on the record (header pill, Stage card row,
  latest Stage history row), in two styles: the pipeline's filled pill and the
  record's tinted swatch.
- Stage sits alone at half width on the edit form's first row; in New
  Opportunity it sits near the bottom, under Currency. Same field, two orders.
- `Edit` vanishes while editing and the header chips jump right.
- `.df-opportunity-column` names both the pipeline column and the record's two
  layout columns, so the record's columns inherit `overflow: hidden` and
  `flex: 0 0 280px` (measured). Nothing is clipped today; anything that pokes
  out of a card there will be.
- In a Read-only Workspace the empty state hides `New Opportunity` but the
  header keeps it (`:1290` vs `:1351`); the refusal arrives after the form is
  filled (from code).
- The filtered empty state says "No Opportunities match these filters." and
  `Clear filters`, but the page has one search field and no filters. The copy
  is shared (`emptyState.ts:40`), so every list with search alone says it.
  Under the line the board still draws seven empty columns and "0
  Opportunities".
- An empty Workspace shows `New Opportunity` twice (header and empty state)
  and a search field with nothing to search.
- A stage drop gives no sign while it saves: `card.changing` is computed and
  never rendered, and the stage-change motion is declared with no rule behind
  it. An accidental drop has no undo; Stage history records it (from code).
- Cards have no hover state, only the pointer cursor (from code).
- Estimated value's placeholder "Not set" reads like a value in the field.
- The Notes head shows a `0` chip above the "No notes yet" panel.
- A failed load reads "This Opportunity could not be loaded." with no retry
  and no way back; a missing Opportunity and a failed request share the line
  (from code).

- **Fixed on the record, 2026-11-19:** the breadcrumb ends in the Opportunity's name (the Client record's in the Client's name); the header drops `OPEN`/`TERMINAL`, the `OPPORTUNITY` chip and the lone "—" when there is no Client; the stage is the pipeline's filled pill in the header and in Stage history, and no longer repeats in the Stage card; `Edit` stays in place, disabled, while editing; Stage sits right after Client in both the edit form and New Opportunity; the read view says "Not set" for all four empty fields and Estimated value's placeholder is `e.g. 4 500`; the Notes head hides its count at zero; the record's layout columns are `.df-opportunity-record-column`, no longer the pipeline's class; a missing Opportunity and a failed load say which it is, with `Try again` and a way back. Still open: the Read-only header button, the filtered empty state's copy, the empty Workspace's double `New Opportunity`, no saving sign or undo on a drop, and no card hover state.

- **Fixed on the pipeline, 2026-11-19:** `New Opportunity` leaves the header of a Read-only Workspace; an empty Workspace's header shows neither the search nor the button (the empty state carries it); a search that matches nothing says "No Opportunities match your search." with `Clear search` and no board under it, and every list whose only control is a search now says the same (Projects board, the Time Tracking Projects card); a card being moved dims while it saves, and an open-stage move toasts `Moved to <stage>` with Undo for 8 seconds; cards take the register-row hover.
