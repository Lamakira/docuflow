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

Related: [`DESIGN-BRIEF.md`](DESIGN-BRIEF.md) for the intent,
[`AMENDMENTS.md`](AMENDMENTS.md) for the token decisions,
[`FLOWS.md`](FLOWS.md) for the journeys.

---

## F1 — Administration → Billing, the `Active` card

- **Status:** open
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

- **Status:** open
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

- **Status:** open
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

- **Status:** open
- **Found:** 2026-09-18, walking [#232](https://github.com/Lamakira/docuflow/issues/232)
- **Where:** `client/src/v2/V2ProjectDocumentation.tsx`, fed by `/api/projects/documentable`
- **Severity:** degrading, and it costs debugging time rather than clicks

`New folder` on this screen creates a row in `projects`. The register then lists
it with `TYPE: FOLDER`, an item count, and a path — so a Project is presented as
a folder everywhere on the page, and the word Project appears nowhere.

`CONTEXT.md` has no **Folder** term at all. It has **Workspace**, **Project**
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
