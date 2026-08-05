# Handoff: DocuFlow Marketing Site (Homepage + Pricing)

## Overview
Marketing site for DocuFlow, an all-in-one operations platform for service businesses (time tracking, activity monitoring, CRM/projects, documentation + AI). Two pages: the **homepage** (structured as the lifecycle of a client project, LEAD → COMPLETED) and the **pricing page**. Primary conversion goal: **Start free trial**; secondary: **Book a 15-minute demo**.

Two reference documents are included: `design-brief.md` (original brief, French) and `landing-corrections.md` (a later correction pass that **replaced the homepage's spine**: the page is no longer "a workday", it is "a client project"). Where they conflict, **the corrections file wins**. The HTML files already implement the corrected version.

## About the Design Files
The `.dc.html` files in this bundle are **design references created in HTML** — prototypes showing the intended look and behavior, not production code to copy directly. The task is to **recreate these designs in the target stack: Astro + Tailwind, reusing the product's existing shadcn/ui components** (per the brief §11). Open the files in a browser to see the live design; read their markup/inline styles for exact values. All copy in the prototypes is final unless the documents say otherwise.

## Fidelity
**High-fidelity.** Colors, typography, spacing, copy and interactions are final intent. Recreate pixel-perfectly using Tailwind utilities mapped to the tokens below.

## Core Concept (do not lose this)
- **The page is a client project.** Sections are labeled with the product's real CRM stages in uppercase monospace — `LEAD` (hero), `WON` (client), `IN PROGRESS` (hours; documentation), `IN REVIEW` (AI answer), `COMPLETED` (sectors; the bill) — never `01/02/03` numbering, never clock times.
- A **1px vertical rail** fixed at the left edge (desktop ≥1240px only) fills top-to-bottom with scroll progress; amber dot marks position; the five stage labels sit along it (mono 10px). It is the page's only decorative element. Amber = "current stage".
- Monospace (JetBrains Mono) is used wherever a number, duration, percentage, price or badge appears.
- Section order = project lifecycle, which gives each pillar exactly one section: CRM → time/activity → documentation → AI.

## Screens / Views

### 1. Homepage (`Homepage.dc.html`)

**Nav** — sticky, 64px tall, `paper` bg at 90% opacity + backdrop-blur(8px), 1px bottom border `rule`. Content max-width 1200px, 24px side padding. Logo "DocuFlow" Cabinet Grotesk 800 20px. Links (Product, Solutions, Pricing, Resources) Switzer 500 15px, gap 26px; hidden ≤560px. Right: "Sign in" + "Start free trial" button (ink bg, paper text, 9px×16px padding, radius 6px; hover bg `#1c2740`).

**Hero (LEAD)** — padding 84px 24px 64px. Stage badge: amber 8px dot + `LEAD` mono 13px amber + "— a new client project" slate. H1 "One place for everything a client project leaves behind." Cabinet Grotesk 800, `clamp(38px, 6vw, 66px)`, line-height 1.02, letter-spacing −0.03em, max-width 17ch. Sub: "Contacts, budgets, tasks, hours, screenshots and documents — all attached to the same client project, in one tool. Service teams replace four subscriptions with DocuFlow." (19px/1.55 slate, max 62ch). CTAs: amber primary (hover `#d8912f`), white ghost with `rule` border (hover border ink). Fine print mono 12.5px: "No credit card. Desktop app for Windows, macOS and Linux."

**Hero visual — one client project, everything attached** — white card, 1px `rule` border, radius 8, padding 22/24. Header: `ONE CLIENT PROJECT · EVERYTHING ATTACHED` (mono 11px uppercase) + "hover a layer →". Layers top to bottom:
1. **Identity**: "Northwind · Ledger rebuild" (600 17px) + amber chip `IN PROGRESS` (mono 10px, amber bg, ink text, radius 3).
2. **Stage bar**: LEAD — WON — IN PROGRESS — IN REVIEW — COMPLETED, mono 10px, joined by 1px 44px connectors. Passed stages `slate`, current amber 700, future `rule`; connectors colored to match.
3. **Client record** (hoverable): `paper` strip, radius 5 — three overlapping 26px initial circles (EP ink / RA slate / SD live) + "3 contacts"; budget `$48,000` mono 700 + 4px consumption bar (62%, live green) + "62% used"; two tags `retainer`, `Q2` (mono 10px, `rule` border chips).
4. **Hours per member** (hoverable): three rows — mono initials (AR/JM/KT), 8px bar (widths 100%/55%/32%, colors live/hour/slate), right-aligned mono hours (38.5 h / 21.0 h / 12.2 h). A compact cumulative band, NOT an hour ruler.
5. **Screenshots** (hoverable): 34×26px striped placeholder thumbs (`repeating-linear-gradient(45deg,#F3F5F7 0 4px,#fff 4px 8px)`, `rule` border, radius 3), row label "shots".
6. **Tasks & docs** (hoverable): 7px amber squares (tasks) and live-green circles (docs), row label "tasks · docs".
7. **Inspector**: min-height 58px under 1px `rule` top border — zero layout shift. Default: "Every layer is attached to the same client project — hover to see what the record holds." On hover/focus of a layer: mono amber tag + title + description + right-aligned mono stats:
   - CRM / Client record / Contacts, budget, stage and notes. / `3 contacts · $48,000 budget · 62% used`
   - TIME / Tracked hours / Per member, filed to this project automatically. / `71.7 h this month`
   - ACTIVITY / Screenshots / Captured by the desktop agent while the timer ran. / `53 shots · 84% active this week`
   - TASKS · DOCS / Tasks & documents / Created inside the project, never tagged after the fact. / `12 tasks · 8 documents`

**Proof band** — `ink` bg. Grid 1.3fr/1fr. H2 "Built by an agency that got tired of paying four vendors." + para (`#9AA6B8`). Right: **four** stats in a 2×2 grid (1-col ≤560px), each 2px amber left border; value mono 22px 700, label mono 12px. **Mock values — replace with real DB numbers before launch or remove** (brief forbids invented stats; misleading claims fall under Canada's Competition Act): 184,200 hours tracked · 2.6M screenshots processed · 11,400 documents indexed · 1,340 client projects managed.

**Problem section + fold animation (the page's ONE major animation)** — H2 "Your stack has four logins and no memory." Para: "A CRM that doesn't know the hours. A time tracker that doesn't know the client. A monitoring tool that doesn't know the project. A wiki nobody opens. Four bills, four exports, and a spreadsheet to glue it together." Four absolutely-positioned white cards (22% wide, 220px tall, radius 6, `rule` border) at lefts 2% / 26.3% / 50.6% / 74.9%, **in this order** (must match the receipt): CRM & projects $12 "Clients, but no hours." · Time tracker $7 "Hours, but no client." · Monitoring $9 "Screenshots, but no context." · Wiki & docs $10 "Pages nobody opens." One-shot animation at ≈45% visibility (IntersectionObserver, fires once): cards animate `left → 39%`, `rotate((i−1.5)×3deg) scale(.93)`, `opacity → 0`, 0.9s `cubic-bezier(.4,0,.2,1)`, 90ms stagger (opacity 0.7s, +200ms). DocuFlow result card (300px, ink, radius 8, shadow `0 24px 48px -18px rgba(15,21,36,.5)`) rises in at 550ms: "One login. Every client, hour, screenshot and document on the same project. / $14 /user/mo". Caption flips "Your stack — $38 /user/mo" → "One tool — $14 /user/mo". `prefers-reduced-motion`: static end state.

**WON — the client** (before the hours section) — `paper` band, mono amber label "WON — the client". Visual left / text right (2-col, gap 56, stacks ≤900px). H2 "The client record everything hangs off." Para: "Companies, contacts, budgets, stages and notes live in the CRM. Every project, task, hour, screenshot and document files itself against the right client — not because someone tagged it, but because that's where it was created." Visual = client record card (white, `rule` border, radius 8, padding 20): "Northwind Systems" + amber chip `WON — IN PROGRESS`; three contacts with roles (24px initial circles; Elena Park VP Operations / Raj Anand Finance lead / Sofia Duarte IT contact); $48,000 budget bar 62%; tags retainer/Q2; reminder strip on `#FBF3E6`: amber square + `Apr 12 · Scope review`; one discreet hours line under a `rule` divider: "71.7 h tracked this month" (hours are one attribute among others — not the subject).

**IN PROGRESS — the hours** — `#EAF2ED` band, mono green label. Unchanged from validated version: H2 "What happened, not what was reported." + agent para; visual card with "Northwind · Ledger rebuild / 88% active" header, 4 striped screenshot placeholders (4/3), 26-bar activity histogram (40px, >70% live / >40% hour / else rule).

**IN PROGRESS — the documentation** (new section) — `#FBF3E6` band, mono amber label. Visual left / text right. H2 "Write it where the work is." Para: "The block editor lives inside the client project — specs, meeting notes, statements of work, nested pages, reusable templates. Not a separate wiki nobody opens, because it's already where the work is." Visual = block editor card: breadcrumb mono 11px `Northwind / Ledger rebuild / Technical spec`; page title Cabinet Grotesk 800 20px; paragraph block; a to-do block with **six-dot drag handle in `rule`** (the tell of a real editor) + green checked box + "Migrate ledger entries table"; striped code-block placeholder (64px, labeled "code block").

**IN REVIEW — the answer** — `#FBF3E6` band, mono amber label. Unchanged: H2 "Ask your own company a question." + para; Q&A card (query chip, answer, two live-green source chips "doc · Ledger SOW" / "call · Apr 3").

**Transparency** — unchanged: white card on `paper`, green mono eyebrow, H2 "Monitoring people can live with." + para; 4 ✓ rows (visible timer indicator / blurrable screenshots / working-hours scheduling / self-review).

**COMPLETED — sectors** — H2 "Teams that deliver for clients." Grid 4-col (2 ≤900px, 1 ≤560px). Cards: white, `rule` border, radius 6; mono tag + 600 name; hover amber border + translateY(−2px). Eight sectors → `/solutions/*`: Digital agencies, Development teams, Consulting firms, Accountants, Legal services, BPO teams, Construction, Staffing agencies.

**COMPLETED — the bill** — `ink` band. H2 "Four tools. One bill." + receipt card (`#161D30`/`#2A3348`, mono 14px) with lines **in animation-card order**: CRM & projects $12 · Time tracker $7 · Monitoring $9 · Wiki & docs $10; divider; "Your stack $38 /user/mo"; "DocuFlow $14 /user/mo" (amber 700). "Beta pricing — subject to change" badge + "Compare all plans →". Plan cards: Starter $7, **Growth $14 (highlighted: `paper` bg, 2px amber border, amber button)**, Business $22, Enterprise Custom.

**Final CTA** — amber band, centered: "Start with your next client project." + ink primary / white ghost buttons.

**Footer** — `ink`, 5-col grid. Baseline: "Clients, projects, hours and documentation in one tool. Built and run by TECHMA." Product / Solutions / Compare / Company columns (mono 11px uppercase headers, 14px `#9AA6B8` links, hover paper). Bottom bar: "© 2026 TECHMA · Terms · Privacy · Law 25" + language select (English/Français), mono 12px.

### 2. Pricing page (`Pricing.dc.html`)

Same nav/footer language. Centered header: mono eyebrow "Pricing", H1 "One bill for the whole workday.", subline. **Billing toggle**: pill group (white, `rule` border, radius 8, 4px padding); active tab ink/paper, inactive transparent/slate; "Annual −20%".

**Plan cards** (4-col): white, radius 8; Growth highlighted (2px amber border, `0 20px 44px -22px rgba(233,162,59,.55)` shadow, "MOST TEAMS" amber chip). Price mono 34px 700; monthly $7/$14/$22, annual $6/$11/$18 ("/user/mo · billed yearly"); Enterprise "Custom". Buttons: highlighted amber, others ink. 3 green-✓ bullets each. Beta badge below.

**Comparison table**: sticky header row (top 64px): 2fr + 4×1fr, 2px ink bottom border; plan names mono 13px 700 centered, Growth amber. Four groups (Time / Activity / Clients / Knowledge) with amber mono uppercase labels; rows 12px padding, `rule` dividers. Cells: ✓ green / — gray / mono text ("1 proj"). Exact 14-row matrix in the file.

**FAQ**: max-width 820px accordion (white cards, `rule` border, radius 8): question 600 16px, amber "+" rotating 45° when open; answer 15px/1.6 slate; single-open, first open by default. 5 Q&As in the file.

**CTA band + minimal footer** — same as homepage CTA.

## Interactions & Behavior
- Hero layers: `mouseenter`/`focus` sets the active layer; `mouseleave` on the card clears. Layers focusable (`tabindex=0`, role button). Inspector height reserved — zero CLS.
- Stack fold: IntersectionObserver threshold 0.45, fires once, disconnects. Reduced motion → static end state.
- Rail: rAF-throttled scroll listener writing `height`/`top` % **directly to DOM nodes** (never through framework state — re-rendering on scroll causes page-wide jank).
- Hovers: nav/footer link color shifts; sector cards lift; buttons darken (values above).
- Pricing toggle swaps monthly/annual; FAQ single-open accordion.
- Anchors scroll smoothly (`scroll-behavior: smooth`, off under reduced motion).
- Focus: global `:focus-visible { outline: 2px solid #E9A23B; outline-offset: 2px; }`.

## State Management
Homepage: `activeLayer: 'record' | 'hours' | 'shots' | 'markers' | null`, `folded: boolean`. Rail progress is DOM-only. Pricing: `annual: boolean`, `openFaq: number | -1`. No data fetching; proof-band numbers must come from real internal metrics before launch.

## Design Tokens
Colors (from the brief — keep the names):
- `ink` `#0F1524` — dark bands, headings; `ink-raised` `#161D30`, `ink-border` `#2A3348`
- `paper` `#F3F5F7` — page bg (cool white)
- `hour` `#E9A23B` — primary accent (current stage, badges, highlights); hover `#d8912f`
- `live` `#1F9D6B` — active status, checkmarks, budget bars
- `slate` `#59657A` — body text; `slate-on-ink` `#9AA6B8`
- `rule` `#D8DEE6` — 1px borders, dividers
Band arc stays cool → warm → ink: `paper` → `#EAF2ED` → `#FBF3E6` → `ink`. Solid fills, never gradients.

Type: **Cabinet Grotesk** 700/800 display (tracking −0.02…−0.03em), **Switzer** 400/500/600 body, **JetBrains Mono** 400/500/700 for every number/price/badge/stage label. **Self-host** (brief requires no third-party requests; prototypes use CDN links only for preview).

Scale: content max-width 1200px, 24px side padding; sections 84–92px vertical; radii 4–8px only; 1px `rule` borders instead of shadows (shadows only on the fold result card and Growth plan). Breakpoints: 1240px (rail appears), 900px (grids collapse), 560px (nav links hidden, 1-col, stats 1-col).

Tailwind: `colors: { ink, paper, hour, live, slate, rule }`, `fontFamily: { display, sans, mono }`.

## Quality bar (brief §10)
Responsive to 360px; AA contrast; visible keyboard focus; `prefers-reduced-motion` respected; only ONE major animation (the stack fold) + hover micro-interactions; Lighthouse ≥95, LCP <2s, CLS ≈0; self-hosted fonts.

## Assets
No images. Screenshot/code placeholders are pure CSS diagonal stripes — swap in real product screenshots when available. No icons except text glyphs (✓, +, →, ·).

## Files
- `Homepage.dc.html` — homepage design reference, corrected version (open in a browser)
- `Pricing.dc.html` — pricing page design reference
- `design-brief.md` — original brief (French; §7 lists four further page templates not yet designed)
- `landing-corrections.md` — correction pass that redefined the homepage spine (authoritative where it conflicts with the brief)
- `support.js` — runtime needed to open the `.dc.html` files locally
