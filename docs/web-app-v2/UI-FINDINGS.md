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

- **Status:** open — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, Today on the real Workspace (seen in capture)
- **Where:** `client/src/v2/V2Today.tsx:240` (`Resolve approvals`), `client/src/v2/V2ContextPanel.tsx:76`, `client/src/v2/today.ts:352` (`EMPTY_TIMESHEET_APPROVALS`)
- **Severity:** misleading. The only amber button on the page leads nowhere

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

- **Status:** open — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, Today on the real Workspace (seen in capture): four of the five rows read "Don't forget to submit your daily update before you finish your day.", dated Yesterday, 15 Nov, 14 Nov, 13 Nov
- **Where:** `client/src/v2/today.ts:232` (`composeAttention`), `today.ts:223` (`notificationHref`), `server/dailyUpdateNudge.ts:155-163`, `client/src/v2/V2ContextPanel.tsx:269` (the only place a notification is marked read)
- **Severity:** misleading. The queue's five rows are mostly one repeated nag

The scheduler writes one `daily_update_reminder` per workday. Nothing marks it
read when the Daily Update is submitted or when the row is opened from Today —
only a click inside the Notifications panel does — so every past reminder stays
in the queue. `Open` on the 13 Nov row goes to `/daily-update`, today's form, not
13 Nov. A notification with no Project links to `/`, so its `Open` reloads Today.
It would take collapsing the reader's own reminders into one row ("Your Daily
Update for today"), marking them read on submit (server) and on `Open`, and
dropping reminders for past days.

## F16 — Today's header and queue say things the data does not support

- **Status:** open — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, Today on the real Workspace (seen in capture)
- **Where:** `client/src/v2/today.ts:190` (`attentionSubhead`), `client/src/v2/V2Today.tsx:252` (`Sorted by impact`)
- **Severity:** misleading copy

"23 items need you before end of day." counts reminders from 13 Nov, which are
not due today, and counts seven missing team Daily Updates as one item. "Sorted
by impact" is not true: the order is the roll-call row first, then
notifications in the order the API returns them. It would take "23 items need
your attention" (or a count of what is actually due today) and either dropping
the sort label or saying what the order is ("Newest first").

## F17 — Active Projects lists Completed Projects and counts every Project

- **Status:** open — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, Today on the real Workspace (seen in capture): `360 Autowrap` shows `COMPLETED` under Active Projects; the head says `View all 124`
- **Where:** `client/src/v2/today.ts:123` (`LIVE_PROJECT_STATUSES` includes `completed`), `client/src/v2/V2Today.tsx:167` (`projectTotal` is the API total of all Projects)
- **Severity:** misleading

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

- **Status:** open — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, Today on the real Workspace (seen in capture): five rows, all "Project doc · …", three of them titled `Resources`; `View all` with no count
- **Where:** `client/src/v2/V2Today.tsx:437`, `client/src/v2/today.ts:340`, `server/routes.ts:444` (`/api/documents/recent` returns Project Documents)
- **Severity:** misleading

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

- **Status:** open — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, from code
- **Where:** `client/src/v2/V2Today.tsx:114-145` (only `projectsLoading` gates the skeleton; projects and stats `queryFn`s never check `res.ok`)
- **Severity:** misleading for a moment on every load; misleading for good when a read fails

The skeleton waits for Projects only. Notifications, Daily Update status,
users and time stats start empty, so the page can show "Nothing needs
attention" and "0.0 h today" and then jump when they land. The projects and
stats fetches parse whatever comes back, so a 500 renders "No active Projects in
this Workspace yet." — an error that reads as an empty Workspace, with no retry.
`now` is fixed at mount, so a page left open past midnight keeps yesterday's
date and figures. It would take a per-section skeleton tied to each query,
`res.ok` checks with an error line and `Retry`, and refreshing `now` on focus.

## F20 — `Remind` looks larger than `Open`, and its toast always says sent

- **Status:** open — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, Today on the real Workspace (seen in capture: `Remind` is visibly larger than the `Open` links below it)
- **Where:** `client/src/v2/tokens.css:783` (`button.df-cta { font: inherit }` resets the 12px size), `client/src/v2/V2Today.tsx:108,176`, `server/dailyUpdateNudge.ts:155`
- **Severity:** cosmetic for the size; misleading for the toast

`Remind` messages every member missing a Daily Update in one click (seven on
the real Workspace), by notification and email. The server skips anyone
already nudged that workday, often all of them after the scheduled nudge, yet
the toast says "Daily Update reminders sent" whatever `sent` comes back as.
"Reminded" lives in component state, so a reload offers `Remind` again. It would
take restoring `font-size` on `button.df-cta`, a toast built from the response
("Reminded 3 members · 4 already reminded today"), and the reminded state read
from the server.

## F21 — Today's rows read as one run-on link, and two labels fail contrast

- **Status:** open — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, from code and the capture
- **Where:** `client/src/v2/V2Today.tsx:336-393` (register rows), `V2Today.tsx:308` (queue rows), `V2Today.tsx:252,433` (`--df-muted-ink` at 10px), `client/src/v2/tokens.css:263` (focus ring)
- **Severity:** accessibility floor

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

- **Status:** open — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, Today on the real Workspace (seen in capture unless marked)
- **Where:** `client/src/v2/tokens.css:2595` vs `:727`, `tokens.css:752`, `client/src/v2/today.ts:286`, `client/src/v2/V2Today.tsx:349,368,382,415`
- **Severity:** cosmetic

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

- **Status:** open — [#370](https://github.com/Lamakira/docuflow/issues/370)
- **Found:** 2026-11-17, from code, reviewing Today
- **Where:** `client/src/v2/tokens.css:642` (`.df-page { min-width: 1060px }`), `client/src/v2/presentation.ts:19-20`
- **Severity:** accessibility floor (WCAG 1.4.10 reflow), shell-wide

The mobile layout starts at 639px and below; above it every page holds 1060px
of content beside a 240px rail. A 1680px screen at 200% zoom is 840 CSS px wide,
so Today, and every other `df-page`, scrolls sideways. It would take letting
the content shrink between 640px and 1300px (the stacked register already
exists for mobile) or switching to the mobile layout at a wider breakpoint.
