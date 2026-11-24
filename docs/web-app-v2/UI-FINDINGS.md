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

---

The five entries below come from one full UI review of Clients (the register,
its filters and search, New Client, the Client record, Edit Client and Add
contact) on 2026-11-20. The app ran locally on the seeded DocuFlow Workspace
(5 Clients, 110 Opportunities); every dialog was opened and closed without
saving. The real Workspace's shape comes from the cutover rehearsal copy
(`docuflow_rehearsal`): 87 Clients, 50 of them Lead, 23 Client, 9 Client
recurrent, 5 Prospect; Source Fiverr 51, Direct 25, none 10, Zoho 1; a company
on 61, an email on 62, a phone on 15, notes on 70 (up to 1,943 characters), no
Contact at all. Read from code only: the stacked mobile register and record, a
Read-only Workspace, dark mode, and the failed-load state.

## F32 — The Client record lists open and lost sales as Client Projects

- **Status:** closed — fixed 2026-11-20
- **Found:** 2026-11-20, the record of Brightfold Studio (seeded), then counted on the rehearsal copy
- **Where:** `client/src/v2/V2Clients.tsx:588-600` (every `crm_projects` row of the Client), `client/src/v2/clients.ts:419-425` (each shown by its Project Status), `server/modules/postgresStorage.ts:781-788` (the register's count and its Open projects filter)
- **Severity:** misleading

The Client Projects card takes every row filed under the Client, sales
included, and shows each by its Project Status. An open sale therefore reads
`PLANNED` and a lost one `ARCHIVED`, and clicking either opens a Client Project
dossier, with Start Timer, a budget and New Task: Invoice pilot II, at Follow
up on the pipeline, opens as a planned Client Project with a 47-hour plan
(seen). The glossary says the opposite: an Opportunity "is not itself delivery
work". On the real Workspace 29 of the 87 Clients have sales mixed in this way:
7 open sales shown as Planned and 22 lost ones as Archived, beside 68 won
Projects. The register's Projects column counts the same rows, and its `Open
projects: Yes` filter matches a Client whose only open row is a sale. The card
has no cap and no stated order: Brightfold Studio's runs to 27 rows, 1,651px
tall. It would take an Opportunities section on the record (stage pill, link to
the Opportunity) and Client Projects that hold won rows only, the count and
the filter following suit, each capped with a View all. The Projects register
mixes them the same way; that belongs to its own review.

- **Fixed:** 2026-11-20. The record has an Opportunities card (open sales in stage order, then lost ones, each with its stage pill, linking to the Opportunity) and Client Projects holds won rows only, ordered by Project Status; each card shows 8 rows and `Show all N`. The register's Projects column and its Open projects filter count won rows only. Checked on the seeded Brightfold Studio: Opportunities 8 (3 open, 5 lost), Client Projects 19, register 19 instead of 27. Over the rehearsal copy, through the real functions: 29 Opportunities (7 open, 22 lost) and 68 Client Projects across the 87 Clients; 51 Clients have a Client Project, 29 an open one.

## F33 — A Client cannot be renamed, given a new status, deleted, or have a Project linked

- **Status:** closed — fixed 2026-11-20
- **Found:** 2026-11-20, Edit Client opened on Brightfold Studio, then v1 read
- **Where:** `client/src/v2/V2Clients.tsx:286-290` (`DETAIL_FIELDS`: Company, Email, Phone), `:631-639` (the PATCH body), against v1's `client/src/pages/ClientDetailPage.tsx:337` (name and status), `:294` (delete), `:308` and `:322` (unlink and link a Project)
- **Severity:** degrading, a v1 capability lost

Edit Client offers Company, Email, Phone, Source and Notes. The name and the
status are set once, at creation (status always Lead), and nothing in v2
changes them afterwards; v1's editor did both, through the same `PATCH
/api/crm/clients/:id` v2 already calls. On the real Workspace 20 Clients still
read Lead although they already have a won Project, and v2 gives no way to
correct them. v1 could also delete a Client and link or unlink a Project from
its record; v2 has neither. PARITY.md missed this because it compares
endpoints, and both versions call the same one. It would take Name and Status
in Edit Client. Deleting a Client is destructive, so it waits for the v2 modal
pass.

- **Fixed:** 2026-11-20. Edit Client opens on Name (required) and Status, then Company, Email, Phone, Source and Notes; the PATCH carries both. Tested on the dev database: Brightfold Studio saved as Client recurrent, the head followed, then restored. Delete and linking a Project stay out: deleting waits for the v2 modal pass, and an Opportunity already sets its Client in Edit.

## F34 — The Client record's head repeats the details card

- **Status:** closed — fixed 2026-11-20
- **Found:** 2026-11-20, the record of Brightfold Studio
- **Where:** `client/src/v2/V2Clients.tsx:716-738`
- **Severity:** cosmetic

Above the title sit two chips, `Client` and `CLIENT`: the kind of record,
which the breadcrumb already says, then the status. Under the title, the
company, the email, the source, the phone and the Fiverr username are repeated
from the Client details card right below, in the same order. The Opportunity
record dropped both patterns in #377. It would take the status alone beside
the title, and the details left to their card.

- **Fixed:** 2026-11-20. The head holds the title and the status chip beside it; the kind chip and the repeated details are gone.

## F35 — A missing Client says its sentence twice and offers no way back

- **Status:** closed — fixed 2026-11-20
- **Found:** 2026-11-20, `/clients/does-not-exist` (seen); the failed load from code
- **Where:** `client/src/v2/V2Clients.tsx:740-744`, `:762-763`
- **Severity:** degrading

"Client not found" is followed by "This Client is not in this Workspace."
twice, once as the head's subtitle and once in the body, with no link back to
Clients. A failed load reads "This Client could not be loaded." the same way,
with no Try again. The Opportunity record now uses the designed empty state
with `Back to Opportunities` and `Try again` (#377); the Client record would
take the same.

- **Fixed:** 2026-11-20. A missing Client shows the designed empty state, "This Client is not in this Workspace, or it was deleted.", with `Back to Clients`; a failed load adds `Try again` (seen for missing, from code for failed).

## F36 — Clients polish: contacts, type scale, seed

- **Status:** closed — fixed 2026-11-20
- **Found:** 2026-11-20, the register and the record (seen unless marked)
- **Where:** `client/src/v2/V2Clients.tsx` (lines below), `scripts/seed-demo.ts`
- **Severity:** cosmetic

- The contacts card is titled "On this Client" (`:860`), which does not say
  it holds people, and its count sits between the title and `Add contact`.
  No real Client has a Contact (the v1 data holds none), so on every real
  record it reads "No one filed on this Client yet."
- A Contact can be added but never edited or removed, although the server
  has both routes (`PATCH` and `DELETE /api/crm/contacts/:id`,
  `server/routes.ts:1540`, `:1565`; from code).
- The register's Company and Projects cells set `font-size: 13.5px` and `12px`
  inline (`:159`, `:179`), off the type scale.
- The demo seed files its four Clients under the Source "Referral", which the
  Workspace's Source list does not hold, so the seeded register shows a source
  the Source filter cannot select. Real data only uses listed sources.

- **Fixed:** 2026-11-20. The card is titled Contacts, its count beside the title; each contact has an Edit button that opens the dialog prefilled and saves through `PATCH /api/crm/contacts/:id` (tested unchanged on the dev database: "Contact saved"); removing a contact waits for the modal pass. The register's cells use the type scale, and the demo seed files its Clients under Direct (the local dev database keeps "Referral" until it is reseeded).

---

The seven entries below come from one full UI review of the Projects screen
(the register, its filters, sort and paging, the board, and New Project) on
2026-11-20. The Project Dossier (`/projects/:id`) is left to its own review.
The app ran locally on the seeded DocuFlow Workspace (110 rows on
`/projects`); New Project was opened and closed without saving, and nothing
was dropped on the board. What New Project writes was read through the real
create route on the test database. The real Workspace's shape comes from the
cutover rehearsal copy (`docuflow_rehearsal`): 122 rows, 88 of them won (33
Active, 30 Completed, 25 Planned), 12 open sales and 22 lost ones; 25 rows
without a Client; a due date on 113, a budget on 23; no row On hold or In
review. Read from code only: the stacked mobile register, a Read-only
Workspace, an empty Workspace, dark mode, and the failed-load state.

## F37 — The Projects register and board list open and lost sales as Projects

- **Status:** closed — fixed 2026-11-20
- **Found:** 2026-11-20, `/projects` and `/projects?view=board` on the seeded Workspace, then counted on the rehearsal copy
- **Where:** `server/modules/postgresStorage.ts:910-913` (the register's conditions keep every row that is not documentation-only), `client/src/v2/projects.ts:288-322` (`composeProjectRegister`) and `:443-485` (`composeProjectBoard`), `client/src/v2/V2Shell.tsx:113` (the rail's count)
- **Severity:** misleading

The register lists every `crm_projects` row of the Workspace, sales included,
each by its Project Status: an open sale reads `PLANNED` and a lost one
`ARCHIVED`, with the kind "Client project" and a Budget used meter, and the row
opens a Project Dossier. Invoice pilot II, at Follow up on the pipeline, is the
fourth row of the seeded register (seen). On the seed, 37 of the 110 rows are
sales: 16 open, 21 lost. The board draws them in place: 15 of PLANNED's 16
cards and all 21 of ARCHIVED's carry the `OPPORTUNITY` tag and cannot move, so
ARCHIVED holds nothing but lost sales. The rail says `Projects 110` and the
pager `1–50 of 110 projects`. On the real Workspace, 34 of 122 rows are sales
(12 open shown as Planned, 22 lost as Archived) beside 88 won Projects, and the
board's Archived column would again be lost sales only. F32 split the same rows
on the Client record. It would take the register, its count, its filters, the
rail and the board to hold won rows and Internal Projects only, which also
retires the `OPPORTUNITY` tag.

- **Fixed:** 2026-11-20. The register, its pager, its filters, the rail count and the board hold delivery work only: a row with no Opportunity (Internal, documented) or a won one (`isDeliveryProject`; the server's `kind=delivery` filters on the explicit won statuses, never `like 'won%'`). The `OPPORTUNITY` tag is gone. Seeded: `Projects 73` and `1–50 of 73 projects` instead of 110; PLANNED and ARCHIVED on the board hold no sale. Over the rehearsal copy through the real functions: 88 of 122 rows listed (33 Active, 25 Planned, 30 Completed). The Client register's Client Projects count uses the same won list.

## F38 — New Project creates an Opportunity at Lead, which the board then wins by a drag

- **Status:** closed — fixed 2026-11-20
- **Found:** 2026-11-20, New Project read from code, then the create route called as the dialog calls it (test database)
- **Where:** `client/src/v2/projects.ts:634-650` (`newProjectPayload`: name, budget, dates), `server/routes.ts:1772-1808` (no status means `lead`, no type means `one_time`, unless the Plan lacks Clients and Opportunities), `client/src/v2/projects.ts:383-390` (`projectStatusMovable`: no Client counts as Internal)
- **Severity:** misleading, and it writes the wrong record

On a Plan with Clients and Opportunities, New Project posts a name (and a
budget and dates when given). The server stores that as a `one_time` row at
`lead` with no Client: an Opportunity, not a Project. Called the same way on
the test database, it answered `status: lead, projectType: one_time,
clientId: null`. The new row lands on the Opportunities pipeline as a Lead card
and on the Projects register as `PLANNED`. The board treats any row without a
Client as Internal, so that Lead is draggable there, and dropping it on ACTIVE
writes `won_in_progress`: the sale is won from the delivery board, which the
board's own comment (`projects.ts:324-334`) says it must never do. The local dev
database holds two such rows, both named "Project test", one at Lead and one at
Proposal sent, both on the pipeline (seen). On the real Workspace 5 open sales
have no Client (4 Lead, 1 Proposal sent) and are draggable on the board today.
It would take New Project to create an Internal Project (type `internal`,
status `won_in_progress`, as a Plan without Opportunities already does) or to
ask whether the work is for a Client, and the board to read Internal from the
type, not from a missing Client.

- **Fixed:** 2026-11-20. New Project posts `projectType: internal` and `status: won_not_started`: called on the test database, it stores an Internal Project, Planned, with no Opportunity row and no stage history, on a Plan with Clients and Opportunities and on Starter. The board reads Internal from the type, so a sale without a Client is no longer draggable: over the rehearsal copy, no open or lost sale can be moved. The two "Project test" rows of the local dev database stay on the pipeline, where they belong.

## F39 — A Project's Client and type cannot be set anywhere in v2

- **Status:** closed — fixed 2026-11-20
- **Found:** 2026-11-20, New Project and the Dossier read from code, then v1 read
- **Where:** `client/src/v2/V2Projects.tsx:728-800` (New Project: name, budget, dates), `client/src/v2/V2Dossier.tsx:490-531` (the Dossier's writes: name, Project Manager, budget, dates, status), against v1's `client/src/pages/CrmProjectPage.tsx:1380` (the Client picker)
- **Severity:** degrading, a v1 capability lost

Nothing in v2 sets or changes a Project's Client or its type. A Project made
with New Project stays without a Client, so the register calls it Internal
forever; one filed under the wrong Client stays there. The Type filter offers
One-time, Monthly, Hourly and Internal, none of which v2 can give. v1's Project
page did both through the same `PATCH /api/crm/projects/:id` v2 already calls.
On the real Workspace 25 rows have no Client, 20 of them won: each reads
Internal, and v2 gives no way to say otherwise. PARITY.md misses it for the
reason F33 gave: both versions call the same endpoint. It would take Client and
Type in the Dossier's Settings (and, with F38, in New Project).

- **Fixed:** 2026-11-20. A Client Project's Settings take a Client picker (the Workspace's Clients, "Choose a Client" while none is set, no "No Client") and a Type picker (One-time, Monthly, Hourly), each saving at once; an Internal Project reads "None — Internal Project" and keeps its INTERNAL chip. Internal is read from the type, so the 20 real won rows without a Client read Client project and can now be given one. Seen on Inventory rollout: Type saved as Monthly, the header followed, then restored to One-time.

## F40 — The board lags the pipeline: filters, closed work, opening a card, undo

- **Status:** closed — fixed 2026-11-20
- **Found:** 2026-11-20, `/projects?view=board` on the seeded Workspace (seen unless marked)
- **Where:** `client/src/v2/V2Projects.tsx:814` (the filters leave the bar in board view), `:540-562` (`composeProjectBoard` gets the search only), `:207-224` (the card), `:564-600` (a drop: no toast, no undo)
- **Severity:** degrading

- Switching to the board hides Status, Client, Project manager, Tag, Type and
  Due, yet the URL keeps them, and the board ignores them: a register narrowed
  to one Client becomes a board of all 110 rows, and switching back finds the
  filter again. Only the search applies, and on the board it filters in the
  page while the register asks the server.
- COMPLETED holds 41 cards on the seed, scrolling 3,427px inside a 669px
  column; the real Workspace has 30. F25 gave the pipeline's closed columns
  their 10 most recent cards and `Show all`.
- A card is an `<article role="button">`: Enter on a focused card does nothing
  (seen), a middle click opens nothing (from code), and Ctrl-click goes through
  `window.open`. F27 made the pipeline's cards links.
- A drop saves without a word: no `Moved to` toast and no Undo, though a drop
  on ARCHIVED cancels the work. F28 and F31 gave the pipeline both (from code).

It would take the board to apply the register's filters (or keep them
visible), cap the closed columns as the pipeline does, make each card a link,
and toast a move with Undo.

- **Fixed:** 2026-11-20. The board keeps the filter bar and applies every filter as the register does (seen: Client Brightfold Studio gives 19 cards, the Client record's count); COMPLETED and ARCHIVED show their 10 most recently updated cards and `Show all N` (seen: 10 of 41); a card is a link, and Enter on a focused card opens it (seen); a drop toasts `Moved to <Status>` with Undo for 8 seconds (seen: a keyboard move to In review, and Undo moving it back).

## F41 — A passed due date looks like any other

- **Status:** closed — fixed 2026-11-20
- **Found:** 2026-11-20, the register on the seeded Workspace, then counted on the rehearsal copy
- **Where:** `client/src/v2/projects.ts:304` (`due` is the formatted date only), `client/src/v2/V2Projects.tsx:323-330` (the Due cell)
- **Severity:** misleading

The Due column prints the date in the same grey whether it is next month or
last spring; only the `Due: Overdue` filter tells them apart. On the real
Workspace 31 of the 33 Active Projects and 19 of the 25 Planned ones are past
their due date, which suggests the dates came over from v1 and no longer mean
much, and the register gives no sign of it either way. F30 marked a passed
close date on the pipeline's cards in the alert ink. It would take the same on
the Due cell for Projects that are neither Completed nor Archived.

- **Fixed:** 2026-11-20. The Due cell of a Project that is neither Completed nor Archived turns to the alert ink once its day has passed, with "(overdue)" for a screen reader (seen on a demo Project given a past date, then restored). Over the rehearsal copy, 50 Projects are marked: 31 Active and 19 Planned.

## F42 — New Project shows where it cannot be used, and a failed load is a dead end

- **Status:** closed — fixed 2026-11-20
- **Found:** 2026-11-20, from code (no Read-only, empty or failing Workspace was at hand)
- **Where:** `client/src/v2/V2Projects.tsx:715-725` (the header button), `:658-663` (the empty state's button), `:696-706` (the failed state)
- **Severity:** degrading

The header's `New Project` shows in a Read-only Workspace, where pressing
Create only answers with a refusal; the empty state already hides its own
button there. In an empty Workspace the header button sits above the empty
state's, so the page offers `New Project` twice. A failed load prints "Projects
in this Workspace could not be loaded." under the title with no `Try again`.
Opportunities fixed the first two in F31 and the Client record the third in
F35.

- **Fixed:** 2026-11-20. The header's `New Project` leaves a Read-only Workspace and an empty one, where the empty state carries it; a failed load shows the designed empty state with `Try again` (from code and tests; no such Workspace was at hand).

## F43 — Projects polish: dialog copy, type scale, sort, On hold

- **Status:** closed — fixed 2026-11-20
- **Found:** 2026-11-20, the register and New Project (seen unless marked)
- **Where:** `client/src/v2/V2Projects.tsx` (lines below), `server/modules/postgresStorage.ts:982-986`, `client/src/v2/projects.ts:370`

- New Project's description says its budget "can wait for its Dossier's
  Settings, like everything else past its name", above Budget hours, Minutes,
  Start date and Due date fields (`:732`).
- The register sets `font-size: 13.5px`, `11px` and `12px` inline on the
  Project manager, Budget used and Tracked MTD cells (`:285`, `:303`, `:313`),
  off the type scale. F36 fixed the same on Clients.
- Sorting by Status orders the raw values alphabetically: Active, Archived,
  Completed, In review, On hold, Planned, not the lifecycle (from code).
- Sorting by Budget used divides by the budget's hours and drops its minutes,
  while the meter counts both (from code).
- The Status filter offers ON HOLD, which no v2 screen can set
  (`projectStatusChoices` leaves it out) and the board has no column for. No
  real row is On hold.

- **Fixed:** 2026-11-20. New Project describes an Internal Project and says a Client Project comes from a won Opportunity; the three cells use type-scale classes; Status sorts by the lifecycle (Planned to Archived, unknown last); Budget used sorts by hours and minutes; the Status filter leaves out ON HOLD.

---

The eight entries below come from one full UI review of the Project Dossier
(`/projects/:id` and its tabs: Overview, Tasks, Time, Activity, Updates, Notes,
Reminders, Documentation, Files, Settings) on 2026-11-23. The app ran locally
on the seeded DocuFlow Workspace, mostly on Ledger migration (3 Tasks, 10 Time
Entries, 4 Daily Updates, 1 Project Document), Inventory rollout (the only
seeded row with status history) and Fleet telemetry audit (an open sale).
Nothing was written. The real Workspace's shape comes from the cutover
rehearsal copy (`docuflow_rehearsal`): 88 delivery Projects; 111 Tasks on 40
of them (110 open, 1 archived, none done or described); 464 Time Entries
(3,502 h) on 35; 16,441 screenshots on 32; 128 notes; no Daily Update and no
Reminder; 263 status-history rows on 72. Read from code only: Clone Project's
write, a Read-only Workspace, mobile, dark mode.

## F44 — Budget used never counts tracked time

- **Status:** closed — fixed 2026-11-23
- **Found:** 2026-11-23, Ledger migration's header, Overview and Settings, then measured on the rehearsal copy
- **Where:** `client/src/v2/dossier.ts:928-930` (Settings' Consumed) and `:1047`, `:1201-1206` (Overview's Budget & time), all reading `project.actualHours`; `server/modules/postgresStorage.ts:998` (the register's Budget used sort reads the same column)
- **Severity:** misleading

Every budget meter reads `actual_hours`, a number v1 let people type by hand
on the Project page (`client/src/pages/CrmProjectPage.tsx:1435`). v2 has no
field for it and never adds tracked time to it. Ledger migration has 25 h
tracked (20.5 h this month) against an 80 h budget, and the header says
`Budget 0%`, the Overview `Consumed 0.0 h / 80.0 h · 0% used`, and Settings
`0.0 h of 80 h · 0% used` (seen). On the real Workspace, 22 Projects have a
budget. One has 220.4 h tracked on a 40 h budget and reads 0%. Another has 14.1 h
on 10 h, and a third 7.5 h on 10 h; both read 0%. Four others show a typed
figure with nothing tracked. The Projects register's
Budget used column draws the same 0%.

No screen gives a Project's total tracked time either:
- the header pairs `Tracked MTD 20.5 h` with `of 80.0 h plan`, so this month
  reads as if it were the whole budget;
- Filed under this Project prints the month's hours as `20.5 H TIME`.

It would take one consumed figure, the sum of the Project's Time Entries,
shared by every meter (header, Overview, Settings, register), plus a
decision on what happens to the typed v1 figures.

- **Fixed:** 2026-11-23. Every budget meter (header, Overview, Settings, the Projects register and its Budget used sort, Today's Active Projects) reads the Project's tracked time: the server adds `trackedSeconds`, the sum of every Member's Time Entries, to the Project and to each register row. The typed v1 figure is no longer read (decided 2026-11-23: tracked time only). Every user's tracked total is for Owners and Administrators only, as the Time Tracking routes already rule (decided 2026-11-23): a Member gets no `trackedSeconds`, sees `—` on every budget meter, and the Budget used sort falls back to the default order for them. The header reads `Tracked 25.0 h · of 80.0 h budget`. Seen on Ledger migration: `Budget 31%`, `Consumed 25.0 h / 80.0 h`. Over the rehearsal copy through the real list and detail functions: 220.4 h on the 40 h budget, which now sorts first by Budget used (551%).

## F45 — Status history prints raw codes and sales stages

- **Status:** closed — fixed 2026-11-23
- **Found:** 2026-11-23, Inventory rollout's Overview, then counted on the rehearsal copy
- **Where:** `client/src/v2/dossier.ts:968-970` (`lifecycleLabel` upper-cases the stored value), `:987-1010` (`composeHistory`: every row, no filter, no cap)
- **Severity:** misleading

The Overview's Status history shows each stored code upper-cased instead of
its Project Status. Inventory rollout reads `WON IN REVIEW → WON IN PROGRESS`
in pills styled like the header's `ACTIVE` (seen). The real history is worse:
- 37 of the 263 rows on delivery Projects are sales moves, so a Project
  Dossier lists `LEAD → PROPOSAL SENT`;
- 26 rows move between two codes that are both In review
  (`WON IN REVIEW PM → WON IN REVIEW CLIENT`);
- 58 rows go to or from the v1 code `WON`;
- the legacy typo `IN NEGOCIATION` appears as written.

The card lists every row with no cap, up to 25 for one Project. It would take
the history to speak in Project Status (Planned to Archived), drop sales moves
(the Opportunity record keeps them), collapse a move that does not change the
Project Status, and cap the card with a way to the rest.

- **Fixed:** 2026-11-23. Status history speaks in Project Status with the header's labels and colours, leaves sales moves to the Opportunity record, drops a move that keeps the same Project Status, and shows the 5 latest changes with `Show all N` (tests built from the measured codes: `lead → proposal_sent`, `won_in_review_pm → won_in_review_client`, `won → won_in_progress`, `in_negociation → won`). Seen on Inventory rollout: `IN REVIEW → ACTIVE`.

## F46 — Clone Project makes an Opportunity at Lead

- **Status:** closed — fixed 2026-11-23
- **Found:** 2026-11-23, from code (no clone was made)
- **Where:** `client/src/v2/V2Dossier.tsx:737-748` (`cloneProject`: toast "Project duplicated", then the copy's Settings), `server/routes.ts:1894-1946` (the copy gets `status: "lead"` at `:1915`)
- **Severity:** misleading, and it writes the wrong record

Clone Project posts to the v1 clone route. That route resets the copy to
`lead`, so cloning a Client Project creates a sale at Lead, not a Project.
After F37 the copy is absent from the Projects register and board and sits on
the Opportunities pipeline, while the toast says "Project duplicated" and the
app opens the copy's Settings as a Project Dossier. Cloning an Internal
Project gives an Internal row at `lead`, which reads Planned. This is F38's
mistake on another path. It would take the copy to start as a Planned
Project (`won_not_started`) of the source's type.

- **Fixed:** 2026-11-23. Cloning delivery work makes a Planned Project (`won_not_started`) of the source's type, an Internal copy without an Opportunity row; cloning a sale still makes a sale at Lead (tested through the real route on the test database).

## F47 — An open or lost sale opens as a Project Dossier

- **Status:** closed — fixed 2026-11-23
- **Found:** 2026-11-23, `/projects/demo-crm-fleet` (an Opportunity at In negotiation)
- **Where:** `client/src/v2/V2Dossier.tsx:268` (`V2DossierPage` renders any `crm_projects` row), `client/src/v2/dossier.ts:1081-1110` (identity)
- **Severity:** misleading

F37 took sales off the Projects screens, but their Dossier URL still opens a
full Project Dossier. Fleet telemetry audit, a sale at In negotiation, reads
`PLANNED` and offers New Task, Start Timer, Daily Updates, Documentation and a
Budget, with Projects lit in the rail (seen). Clone (F46), an old v1 link or a
bookmark leads there. The real Workspace holds 34 such rows. It would take the
Dossier to send a sale to its Opportunity record, as F32 did on the Client
record.

- **Fixed:** 2026-11-23. A Dossier URL for a row that is not delivery work replaces itself with the Opportunity record. Seen: `/projects/demo-crm-fleet` opens `/opportunities/demo-crm-fleet`.

## F48 — Activity's count is the page size, not the total

- **Status:** closed — fixed 2026-11-23
- **Found:** 2026-11-23, from code, then counted on the rehearsal copy (no seeded Project has evidence)
- **Where:** `client/src/v2/V2Dossier.tsx:379-387` (8 screenshots off the Activity tab, 50 on it), `client/src/v2/dossier.ts:1061-1062` (the tab count is the length of what was fetched), `server/routes.ts:4867` (the route returns `total`, unused)
- **Severity:** misleading

The Activity tab counts the screenshots it fetched: `Activity 8` on every
other tab and `Activity 50` on its own, whatever the Project holds. The route
returns the true `total`, and the Dossier ignores it. The tab shows the 50
most recent with no way past them and no link to the Activity page. On the
real Workspace, 26 of the 32 Projects with evidence have more than 50
screenshots. The largest has 3,598 and would read `Activity 8`. It would take the count from `total`, and a link
from the tab to the Activity page filtered to the Project.

- **Fixed:** 2026-11-23. The Activity tab counts the route's `total`; when the Project holds more than the tiles shown, `See all N in Activity` opens the Activity gallery filtered to the Project over All time (from code and tests; no seeded Project has evidence).

## F49 — A Task can be created and ticked, never renamed or removed

- **Status:** closed — fixed 2026-11-23
- **Found:** 2026-11-23, Ledger migration's Tasks tab and Overview
- **Where:** `client/src/v2/V2Dossier.tsx:1694-1762` (`DossierTasks`: checkbox, status, Start Timer), `:465` and `:477` (the only Task writes: status, create), against `server/routes.ts:4034` (`PATCH /api/tasks/:id`) and `:4052` (`DELETE`), and v1's `client/src/pages/TimeTrackingProjectsPage.tsx:87`, `:96`
- **Severity:** degrading, a v1 capability lost

A Task's name is plain text: no rename, no description, no removal, although
the server has both routes and v1's Time Tracking projects page used them
(seen, and from code). A Task created with a typo keeps it. A Task created by
mistake can only be archived through the status select, and every timer
picker still offers it.

The Overview's Next actions also lists the done Task first, struck through,
under a count of `2 to do · 0 blocked`, while the tab reads `Tasks 3` (seen).

On the real Workspace, 111 Tasks across 40 Projects are all open, none done or
described. It would take rename in place (and the description, if Tasks are
to keep one), Next actions holding open Tasks only, and removal with the
modal pass.

- **Fixed:** 2026-11-23. A Task's name renames in place on the Tasks tab (Enter or leaving the field saves, Escape keeps the name; seen: renamed, then restored). Next actions lists open Tasks only, and says so when every Task is done. Removal waits for the modal pass.

## F50 — The Client card counts Completed Projects as active, and links nowhere

- **Status:** closed — fixed 2026-11-23
- **Found:** 2026-11-23, Ledger migration's and Fleet telemetry audit's Overview, then counted on the dev database
- **Where:** `client/src/v2/V2Dossier.tsx:120` (`LIVE_PROJECT_STATUSES` holds Completed), `:400-403` (every row of the Workspace fetched to count), `:841-843`, `client/src/v2/dossier.ts:1114-1131`
- **Severity:** misleading

The Client card says `Caldera Health · 18 active projects`. Caldera Health has
5 Active and 3 In review Projects; the other 10 are Completed (seen, counted
on the dev database). To count, the Dossier loads up to 500 rows of the
Workspace. The Client's name is plain text both in the header and in the
card, so there is no way from a Project to its Client record. F32 gave the
Client record its Projects; this is the way back. It would take Active and In
review only (or "18 Projects"), counted by the server, with the name linking
to `/clients/:id`.

- **Fixed:** 2026-11-23. The card counts the Client's Active and In review Projects through the server (`projectStatus=active,in_review`, one row fetched). Seen: `Caldera Health · 8 active projects`. The Client's name links to its record in the header and the card.

## F51 — Dossier polish: counts, copy, controls

- **Status:** closed — fixed 2026-11-23
- **Found:** 2026-11-23, the Dossier on the seeded Workspace (seen unless marked)

- Project Documents' chip reads `1 docs` and `0 docs`
  (`client/src/v2/V2Dossier.tsx:1606`).
- Files has an `Upload File` button in its head while its empty state says
  Files come from notes and offers `Attach a File to a note`
  (`client/src/v2/dossier.ts:787`). The tab count leaves the uploaded files
  out while the card counts them (`dossier.ts:1070-1071`; from code).
- The Updates tab drops its count when there are none, while every other tab
  shows `0`.
- Filed under this Project repeats the tab counts and closes on "Every record
  above resolves to this Project in this Workspace" (`V2Dossier.tsx:1685`),
  which is implementation talk.
- `Save name` is always lit, even unchanged, while `Save budget` waits for a
  change.
- The Time tab has no total, and its `STOPPED` chip is drawn as a bordered box
  that reads like an input.
- The breadcrumb ends on the tab (`Projects / Overview`, `Projects /
  Settings`) instead of the Project, and the search field moves sideways as
  that last crumb changes length (shell-wide).
- The demo seed gives Ledger migration the same Daily Update on two days, and
  another one twice.

- **Fixed:** 2026-11-23. `1 doc`; the Files tab counts uploaded Files too, and with Documentation on its empty state offers `Upload File`; Updates shows `0`; Filed under this Project is gone; `Save name` waits for a change; the Time tab ends on a Total and its status is plain text; the breadcrumb ends on the Project's name, as records do, in a crumb of fixed width so the search field holds still; the demo seed no longer repeats a Daily Update. Seen on Ledger migration.

## F52 — Editing a Document can erase someone else's changes

- **Status:** closed — fixed 2026-11-24
- **Found:** 2026-11-24, a Workspace Document on the dev Workspace
- **Where:** `client/src/v2/V2Document.tsx:193-197`, `:225-235`, `:257-266`; `client/src/lib/queryClient.ts` (`staleTime: Infinity`); `server/routes.ts:2935` (no version check)
- **Severity:** loses data

A Document opened a second time is read from the browser's cache, never from
the server, for as long as the cache keeps it. Seen: a Document was opened and
left, its text was replaced from outside that page, and it was opened again
from the register. It showed the old text, and typing one character saved the
old text over the new one. Nothing said so. Every save sends the whole
Document, and the server takes whichever comes last. Project Documents share
this editor (from code, not tried).

An empty title also stops every save. The server refuses the whole request
(`Invalid data`), so the text typed meanwhile is not stored; the header stays
at `Unsaved` (seen: the added word was not on the server). It would take a
fresh read on opening, a save refused when the Document has changed since it
was read, and an empty title that does not hold back the text.

- **Fixed:** 2026-11-24. Opening a Document always reads the server first. A save carries the time of the version it was typed over (`expectedUpdatedAt`); if the Document changed since, nothing is written (409), the typed text stays, and the page offers Load their version or Keep mine. A rename, a move or an access change is not a conflict. Saves never overlap. A blank title no longer holds back the text: the name stays and the page says so. Project Documents share all of it. Seen: the same two-person sequence, now refused, and the first save of all 85 real rows whose time holds microseconds (tested through the real functions on the rehearsal copy).

## F53 — A failed load reads as an empty library

- **Status:** closed — fixed 2026-11-24
- **Found:** 2026-11-24, with the documents routes answering 500
- **Where:** `client/src/v2/V2Documents.tsx:203-222`, `:97-106`
- **Severity:** misleading

When the list cannot be loaded, the page says `No Workspace Documents yet`,
offers to add the first one and counts `0 items · 0 folders` (seen). When one
Folder's list fails, its Documents silently disappear and the rest is shown
(from code). It would take the failed-load state with Try again, as F42 gave
Projects.

- **Fixed:** 2026-11-24. A failed load says so and offers Try again; a failed refresh keeps the list and says it once. One request answers the whole register, so a Folder can no longer go missing on its own. Seen.

## F54 — Documents and Files can never be removed, and an Owner cannot delete a Folder

- **Status:** closed — fixed 2026-11-24
- **Found:** 2026-11-24, the register, the editor and the File viewer; routes read
- **Where:** `client/src/v2/V2Documents.tsx`, `V2Document.tsx`, `V2FileViewer.tsx` (no such control); `server/routes.ts:2736-2756`, `:3128-3160`
- **Severity:** blocks a task

v2 has no way to delete a Document or a File, to rename a File, or to move
either to another Folder. The delete route exists and v1 used it; no route
moves an item.

Deleting a Folder is offered to everyone, but the server only lets a platform
`admin` do it (`user.role`, which no self-service Workspace sets), so a
Workspace Owner is refused. That same check never asks whether the caller can
see the Folder (both from code). On the real Workspace: 10 Documents and Files
in 4 Folders. It would take the Workspace Role on both routes, the
Document Access check on the Folder one, then rename and move. Deletion waits for the
modal pass, as F49's does.

- **Fixed:** 2026-11-24. Deleting a Folder or a Document is the Owner's and Administrators' (Workspace Role), checked after visibility; Delete folder shows only to them. A Document moves between Folders, and a File is renamed or moved, by whoever added it or an Administrator; the move is audited and its search index follows. Move seen on a Document; the rest by tests. A Delete control on Documents and Files waits for the modal pass.

## F55 — The register keeps showing the old list

- **Status:** closed — fixed 2026-11-24
- **Found:** 2026-11-24, the dev Workspace
- **Where:** `client/src/v2/V2Document.tsx:267-270`, `client/src/v2/V2Documents.tsx:203-206`
- **Severity:** misleading

Renaming a Document in the editor leaves its old name and time in the register
until the page is reloaded (seen: saved as `Review check renamed`, listed as
`Review check`). The editor refreshes the Document's own key, not the
register's. Nothing another Member adds shows either until a reload (from
code: the list is never read twice).

- **Fixed:** 2026-11-24. A rename, a move or an upload refreshes the register, and every visit reads it again. Seen.

## F56 — Images in a Workspace Document are refused, attachments are public

- **Status:** fixed 2026-11-24, to check on a running storage
- **Found:** 2026-11-24
- **Where:** `client/src/v2/V2Document.tsx:337-350` (image stored with no access policy), `server/objectAcl.ts:73`; `V2Document.tsx:409-411`, `server/routes.ts:792` (`visibility: "public"`), `server/routes.ts:675`
- **Severity:** broken image; access wider than shown

An image added to a Workspace Document gets no access policy, and a file with
none is refused to every reader, its author included. A File attached to a
Document is made public: whoever has its link reads it without signing in,
even when the Document is Restricted. No Document of the real Workspace holds
an image or an attachment. It would take one rule for both: readable by those
who can read the Document. To check on a running storage first.

- **Fixed:** 2026-11-24, by tests on the fake storage; still to check on a running one. An image or a File added to a Workspace Document is read by whoever reads that Document, and no longer by having uploaded it; its link cannot be re-opened through another route. Files attached before keep their public link, as do audio notes (`/api/audio/upload`) and everything in Project Documents.

## F57 — The library sends each person's full User row

- **Status:** closed — fixed 2026-11-24
- **Found:** 2026-11-24, the responses of both list routes
- **Where:** `server/modules/postgresStorage.ts:1821-1849`, `:1874-1913`, `:1944-2001` (no `toSafeUser`)
- **Severity:** exposes data to every Member

Every Folder and Document carries its creator's whole row: email, platform
role, last sign-in, and the identity provider's id that `SafeUser` exists to
keep out (seen in the answer). The register uses the name. It would take
`toSafeUser` at least, better the name and picture only.

- **Fixed:** 2026-11-24. Folders and Documents carry the person's id, name, email and picture only, and so does the creator of a Project Document (`GET /api/documents/:id`), which had the same leak. Seen in the answer.

## F58 — The Document page does not read as a document

- **Status:** closed — fixed 2026-11-24
- **Found:** 2026-11-24, a Workspace Document, light and dark
- **Where:** `client/src/v2/V2Document.tsx:512-558`, `client/src/v2/presentation.ts`
- **Severity:** reads badly

- The title is drawn at body size above the toolbar, smaller than the headings
  in the text, so `Security baseline` reads twice with the second one as the title.
- Text runs the whole width of the window (about 1,200 px), with no measure.
- Grey and white bands alternate behind the header, the title and the text;
  the white page stops mid-screen.
- The focus ring of the text is a thick line across the page.
- The breadcrumb ends on `Document`, where records end on their name.
- Folder, last change and author appear nowhere.
- A missing Document is one grey line where other records have the designed
  empty state.

- **Fixed:** 2026-11-24. The title is the page title, text and toolbar share an 800 px column on one surface, the thick focus line is gone, the breadcrumb ends on the name, the header says the Folder, who added it and when it changed, and a missing Document has the designed empty state. Seen in light and dark, and in a Project's Documentation tab.

## F59 — Workspace Documents polish

- **Status:** closed — fixed 2026-11-24
- **Found:** 2026-11-24, the dev Workspace (seen unless marked)

- `Last editor` is whoever added the item; editing does not change it. The
  filter calls the same person `Owner`.
- Dates carry no year: two of the ten real items date from 2025 (counted).
- Opening a Folder also opens its preview, which moves New Document 330 px
  left under the pointer.
- A Folder name over 255 characters answers `Failed to create folder`; a name
  of spaces is accepted by the server (both seen).
- `/documents?new=1` stays in the address after closing the dialog, so a
  reload opens it again. `?folder=1` and `?upload=1` share that code.
- A description is never shown; two of the ten real items have one (counted).
- `Invalid data` is the only explanation for a refused save.
- The list makes one request per Folder and loads every Document's full text
  to show its name (from code).

- **Fixed:** 2026-11-24. `Added by` in the column and the filter (Project Documentation keeps `Last editor`, whose rows it does not fit); dates carry their year when it is not this one; the page head spans the page, so opening a Folder no longer moves New Document; Folder names are 1 to 255 characters, trimmed, with a plain message; the address drops `?new=1` when the dialog closes; descriptions show in the Folder preview and on the Document; one request without the texts.
