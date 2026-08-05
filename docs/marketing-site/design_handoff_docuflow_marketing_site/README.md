# Handoff: DocuFlow Marketing Site (Homepage + Pricing)

## Overview
Marketing site for DocuFlow, an all-in-one operations platform for service businesses (time tracking, activity monitoring, CRM/projects, documentation + AI). Two pages: the **homepage** (structured as a workday, 08:12 → 18:00) and the **pricing page**. Primary conversion goal: **Start free trial**; secondary: **Book a 15-minute demo**.

The full product/design brief is included as `design-brief.md` (in French; all on-screen copy is English). Read it — it defines the concept, constraints and forbidden patterns (§9).

## About the Design Files
The `.dc.html` files in this bundle are **design references created in HTML** — prototypes showing the intended look and behavior, not production code to copy directly. The task is to **recreate these designs in the target stack: Astro + Tailwind, reusing the product's existing shadcn/ui components** (per the brief §11). Open the files in a browser to see the live design; read their markup/inline styles for exact values. All copy in the prototypes is final unless the brief says otherwise.

## Fidelity
**High-fidelity.** Colors, typography, spacing, copy and interactions are final intent. Recreate pixel-perfectly using Tailwind utilities mapped to the tokens below.

## Core Concept (do not lose this)
- The page is a workday. Sections are labeled with **real clock times in monospace** (08:12 hero, 09:40 work, 12:15 clients, 15:30 knowledge, 17:45 sectors, 18:00 pricing) — never `01/02/03` numbering.
- A **1px vertical rail** fixed at the left edge (desktop ≥1240px only) fills top-to-bottom with scroll progress; amber dot marks position; monospace time ticks along it. It is the page's only decorative element.
- Monospace (JetBrains Mono) is used wherever an hour, duration, percentage or price appears.

## Screens / Views

### 1. Homepage (`Homepage.dc.html`)

**Nav** — sticky, 64px tall, `paper` bg at 90% opacity + backdrop-blur(8px), 1px bottom border `rule`. Content max-width 1200px, 24px side padding. Logo "DocuFlow" Cabinet Grotesk 800 20px. Links (Product, Solutions, Pricing, Resources) Switzer 500 15px, gap 26px; hidden ≤560px. Right: "Sign in" link + "Start free trial" button (ink bg, paper text, 9px×16px padding, radius 6px; hover bg `#1c2740`).

**Hero (08:12)** — padding 84px 24px 64px. Time badge: amber 8px dot + `08:12` JetBrains Mono 13px amber + "— the workday begins" slate. H1 "See the whole workday, not slices of it." Cabinet Grotesk 800, `clamp(38px, 6vw, 66px)`, line-height 1.02, letter-spacing −0.03em, max-width 15ch. Sub-para Switzer 19px/1.55 slate, max 62ch. CTAs: amber primary (13px×22px, radius 6, hover `#d8912f`), white ghost with `rule` border (hover border ink). Fine print JetBrains Mono 12.5px slate: "No credit card. Desktop app for Windows, macOS and Linux."

**Hero timeline visual** — white card, 1px `rule` border, radius 8, padding 22/24. Represents one day 08:00–18:00; all horizontal positions are `(time − 8) / 10 × 100%`.
- Hour ruler: mono 10px labels 08…18.
- Segment strip: 66px tall, `paper` bg, radius 5. Six absolutely-positioned interval blocks (data below), each with mono 9.5px client label and a 4px activity bar at bottom (width = activity %, color: ≥75% `live`, ≥50% `hour`, else `slate`; idle `rule`). Block bg: idle `#ECEFF3`, highlighted block `rgba(31,157,107,.14)`, others `rgba(15,21,36,.05)`. 1px white right border between blocks. A 2px amber "now" line at 08:12 extends 4px past top/bottom.
- Screenshot layer: 34×26px striped placeholder thumbs (`repeating-linear-gradient(45deg,#F3F5F7 0 4px,#fff 4px 8px)`, 1px `rule` border, radius 3) at 9.1, 10.3, 11.4, 13.3, 14.6, 16.1, 17.2 h. Row label "shots" mono 9px uppercase.
- Marker layer: 7px squares (radius 1px, amber = tasks at 9.66, 12.9, 15.5, 17.8 h) and 7px circles (live green = docs at 8.5, 13.4, 15.9, 16.8 h). Row label "tasks · docs".
- Inspector: min-height 58px area under a 1px `rule` top border. Default helper text (slate 14px). On hover/focus of a segment: `08:12–09:35` (mono amber 13px) · label (600 15px) · client (slate 14px) · right-aligned stats mono 12px ("41% active · 6 shots · 1 docs · 2 tasks"). Reserve the space — zero layout shift.

Segment data: Standup + inbox / Internal / 8.2–9.58 / 41% · Ledger rebuild / Northwind / 9.66–12.0 / 88% · Lunch / Idle / 12.0–12.75 · Client calls + CRM / Meridian / 12.75–15.33 / 63% · Spec + documentation / Kaleido / 15.5–17.5 / 74% · Daily update + invoicing / Internal / 17.75–18.0 / 52%.

**Proof band** — `ink` bg. Grid 1.3fr/1fr, gap 48. H2 26px 700 "Built by an agency that got tired of paying four vendors." + para (`#9AA6B8`). Right: three stats, each 2px amber left border, 14px padding-left; value JetBrains Mono 24px 700, label mono 12px `#9AA6B8`. **Values are mock placeholders** (184,200 hours tracked · 2.6M screenshots processed · 11,400 documents indexed) — replace with real numbers from the DB. Brief forbids invented stats in production.

**Problem section + fold animation (the page's ONE major animation)** — heading "Your stack has four logins and no memory." + paragraph. Below, a 300px-tall relative container with four absolutely-positioned white cards (22% wide, 220px tall, radius 6, `rule` border) at lefts 2% / 26.3% / 50.6% / 74.9%: Time tracker $7, Monitoring $9, Project management $12, Wiki/docs $10 (name 600 16px, note slate 13px, price mono 15px). One-shot animation when the section is ≈45% in view (IntersectionObserver, fires once):
- Cards animate `left → 39%`, `rotate((i−1.5)×3deg) scale(.93)`, `opacity → 0`; 0.9s `cubic-bezier(.4,0,.2,1)`, staggered 90ms per card; opacity 0.7s with +200ms delay.
- DocuFlow result card (300px, ink bg, radius 8, shadow `0 24px 48px -18px rgba(15,21,36,.5)`, centered, top 40px) fades/rises in: opacity 0→1, translateY 30px→0, scale .92→1, 0.7–0.8s, 550ms delay. Copy: "DocuFlow / One login. Every hour, screenshot, client and document on the same timeline. / $14 /user/mo" (price mono amber).
- Caption beneath flips "Your stack — $38 /user/mo" → "One tool — $14 /user/mo" (mono 14px, price amber 700).
- `prefers-reduced-motion`: skip straight to end state, no transitions.

**Pillar sections (09:40 / 12:15 / 15:30)** — identical scaffold: full-width band bg (`#EAF2ED` mint for 09:40, `paper` for 12:15, `#FBF3E6` warm for 15:30 — the cool→warm day arc; solid fills, never gradients), padding 88px 24px, mono time label (green for 09:40, amber otherwise), 2-col grid (1fr/1fr, gap 56, stacks ≤900px). H2 Cabinet Grotesk 800 `clamp(28px,4vw,42px)`; para 18px/1.55 slate max 52ch. Copy per brief §6.5–6.7. Visual cards (white, `rule` border, radius 8, padding 20):
- 09:40: header row "Northwind · Ledger rebuild" / "88% active" (mono 12px, green), 4 striped screenshot placeholders (aspect 4/3), activity bar chart (26 bars, 40px tall, 3px gap; >70% live, >40% hour, else rule).
- 12:15 (visual on the left): client table rows — Northwind 38.5h "62% used" (live) · Meridian 21.0h "91% used" (hour) · Kaleido 12.2h "104% over" (slate).
- 15:30: AI Q&A card — query in mono 13px on `paper` chip, answer para 15px, two source chips (mono 11px, live-green border/text, radius 3): "doc · Ledger SOW", "call · Apr 3".

**Transparency section** — white card (radius 8, `rule` border, padding 48) on `paper`, 2-col. Mono uppercase green eyebrow "Transparency"; H2 "Monitoring people can live with." + brief §6.8 para. Right: 4 rows on `paper` (radius 6): green 18px ✓ circle + 15px text (visible timer indicator / blurrable screenshots / working-hours scheduling / self-review of data).

**Sectors (17:45)** — H2 "Teams that bill for their time." Grid 4-col (2-col ≤900px, 1-col ≤560px), gap 16. Cards: white, `rule` border, radius 6, padding 20; mono 11px slate tag + 600 16px name. Hover: amber border + translateY(−2px), .12s. Eight sectors → `/solutions/*`: Digital agencies, Development teams, Consulting firms, Accountants, Legal services, BPO teams, Construction, Staffing agencies.

**The bill (18:00)** — `ink` band, padding 92px. Amber mono "18:00 — the bill". 2-col: H2 "Four tools. One bill." (`clamp(34px,5vw,56px)`) + receipt card (`#161D30` bg, `#2A3348` border, radius 8, mono 14px): four line items ($7/$9/$12/$10, `#9AA6B8`), 1px divider, "Your stack $38 /user/mo" (white 500), "DocuFlow $14 /user/mo" (amber 700). Below: "Beta pricing — subject to change" badge (mono 12px, amber border/text, radius 3) + "Compare all plans →" link. Plan cards 4-col: Starter $7, **Growth $14 (highlighted: `paper` bg, 2px amber border, amber button)**, Business $22, Enterprise Custom; dark cards `#161D30`/`#2A3348` with ghost buttons.

**Final CTA** — amber band, centered. H2 "Start tracking tomorrow morning." + the two CTAs (ink primary, white ghost).

**Footer** — `ink`. 5-col grid (1.4fr + 4×1fr; 2-col ≤900px, 1-col ≤560px): brand blurb + Product / Solutions / Compare / Company link columns (mono 11px uppercase headers, 14px `#9AA6B8` links, hover paper). Bottom bar above `#2A3348` border: "© 2026 TECHMA · Terms · Privacy · Law 25" + language select (English/Français), all mono 12px.

### 2. Pricing page (`Pricing.dc.html`)

Same nav/footer language. Centered header: mono eyebrow "Pricing", H1 "One bill for the whole workday.", subline. **Billing toggle**: pill group (white, `rule` border, radius 8, 4px padding); active tab ink bg/paper text, inactive transparent/slate; "Annual −20%".

**Plan cards** (4-col): white, radius 8, padding 26/22; Growth highlighted (2px amber border, `0 20px 44px -22px rgba(233,162,59,.55)` shadow, "MOST TEAMS" amber chip mono 10px uppercase). Price mono 34px 700; monthly $7/$14/$22, annual $6/$11/$18 ("/user/mo · billed yearly"); Enterprise "Custom". Buttons: highlighted amber, others ink. 3 feature bullets each with green ✓. Beta-pricing badge centered below.

**Comparison table** — white band. Sticky header row (top 64px, below nav): 2fr + 4×1fr columns, 2px ink bottom border; plan names mono 13px 700 centered, Growth in amber. Four groups with amber mono uppercase group labels (Time / Activity / Clients / Knowledge); rows 12px vertical padding, 1px `rule` dividers. Cells: ✓ green 700 / — `rule` gray / text values mono 12px (e.g. "1 proj"). See file for the exact 14-row matrix.

**FAQ** — max-width 820px. Accordion cards (white, `rule` border, radius 8): question button 600 16px with amber "+" that rotates 45° when open (.15s); answer 15px/1.6 slate. One item open at a time; first open by default. 5 Q&As in the file (replace-four-tools, what the agent records, Law 25 compliance, after-trial, why beta pricing).

**CTA band + minimal footer** — same as homepage CTA; footer is a single bar.

## Interactions & Behavior
- Timeline segments: `mouseenter`/`focus` sets active segment; `mouseleave` on the card container clears it. Segments are focusable (`tabindex=0`, role button).
- Stack fold: IntersectionObserver threshold 0.45, fires once, then disconnects. Reduced motion → static end state.
- Rail: scroll listener throttled with `requestAnimationFrame`, writes `height`/`top` % **directly to DOM nodes** (do not route through framework state — it re-renders the page and causes jank).
- Hovers: nav/footer links color shifts; sector cards lift; buttons darken (values above).
- Pricing toggle swaps monthly/annual prices; FAQ is a single-open accordion.
- Anchors: nav links scroll to sections (`scroll-behavior: smooth`, disabled under reduced motion).
- Focus: global `:focus-visible { outline: 2px solid #E9A23B; outline-offset: 2px; }`.

## State Management
Homepage: `activeSegment: number | null`, `folded: boolean`. Rail progress is DOM-only. Pricing: `annual: boolean`, `openFaq: number | -1`. No data fetching; proof-band numbers should eventually come from real internal metrics.

## Design Tokens
Colors (from the brief — keep the names):
- `ink` `#0F1524` — dark bands, headings; `ink-raised` `#161D30`, `ink-border` `#2A3348` (dark-surface card bg/border)
- `paper` `#F3F5F7` — page bg (cool white)
- `hour` `#E9A23B` — primary accent (times, "now", highlights); hover `#d8912f`
- `live` `#1F9D6B` — active status, checkmarks, proof
- `slate` `#59657A` — body text; `slate-on-ink` `#9AA6B8` (muted text on dark)
- `rule` `#D8DEE6` — 1px borders, dividers

Type: **Cabinet Grotesk** 700/800 display (tracking −0.02…−0.03em), **Switzer** 400/500/600 body, **JetBrains Mono** 400/500/700 for every time/number/price/badge. All on Fontshare/JetBrains — **self-host** them (brief requires no third-party requests; prototypes use CDN links only for preview).

Scale: content max-width 1200px, 24px side padding; section padding 84–92px vertical; radii 4–8px only (5–6 buttons/cards, 8 large cards, 3 chips); shadows only on truly floating elements (fold result card, Growth plan); everywhere else 1px `rule` borders. Body 15–19px, fine print mono 11–13px. Breakpoints used: 1240px (rail appears), 900px (2-col→1-col, 4-col→2-col), 560px (nav links hidden, 1-col).

Tailwind: map these as `colors: { ink, paper, hour, live, slate, rule }`, `fontFamily: { display, sans, mono }` in the config; keep the brief's §5 names.

## Quality bar (brief §10)
Responsive to 360px; AA contrast; visible keyboard focus; `prefers-reduced-motion` respected; only ONE major animation (the stack fold) + hover micro-interactions; Lighthouse ≥95, LCP <2s, CLS ≈0 (note the reserved inspector height); self-hosted fonts.

## Assets
No images. Screenshot placeholders are pure CSS diagonal stripes — swap in real product screenshots when available. No icons except text glyphs (✓, +, →, ·).

## Files
- `Homepage.dc.html` — homepage design reference (open in a browser)
- `Pricing.dc.html` — pricing page design reference
- `design-brief.md` — original client brief (French; §6 contains the canonical copy, §7 lists four further page templates not yet designed)
