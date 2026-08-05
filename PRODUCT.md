# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

DocuFlow serves two workspace types:

- Organizations, primarily service businesses, whose owners, operations leaders, managers, and staff need one place to manage client work, people, time, activity, and knowledge.
- Individuals who need the same operational tools without staff-management or organization-administration overhead.

Organization administrators must be able to operate DocuFlow as a complete SaaS workspace: invite, add, edit, archive, or remove staff; assign roles and permissions; manage devices and monitoring policy; manage billing and subscription; and control organization settings. Staff members need a focused workspace for their assigned work, time, updates, documents, and account preferences.

## Product Purpose

DocuFlow is an all-in-one operations platform for service businesses and individuals. It consolidates four connected pillars:

1. **Time** — timers, timesheets, attendance, and payroll-ready exports.
2. **Activity** — desktop-agent screenshots, keyboard/mouse activity levels, idle time, and analytics.
3. **Work and clients** — companies, contacts, pipeline, budgets, client projects, tasks, reminders, members, and daily updates.
4. **Knowledge** — project documentation, company documents, a block editor, media and automatic video transcription, and source-cited AI answers across the knowledge corpus.

The web app is the operating surface where users manage these connected records. Success means that an owner can understand and act on the state of the organization without reconciling separate tools, while an individual contributor can reach their current work quickly without being exposed to irrelevant administration.

## Positioning

Consolidation is the product. DocuFlow is not a time tracker with secondary features; its differentiator is that hours, tasks, screenshots, notes, reminders, members, documents, and budgets attach to the client project. The client project is the unifying object across the product.

## Operating Context

The product is used throughout a working day by organization owners, administrators, managers, and contributors. Users move between client and project records, time and activity evidence, tasks and updates, and documentation. Administrators additionally manage people, access, devices, policies, billing, and subscription state.

The real CRM stages are:

`LEAD → WON → IN PROGRESS → IN REVIEW → COMPLETED`

Approved fictional sample data may use Northwind, Meridian, Kaleido, the project Ledger rebuild, and a $48,000 project budget. These are demonstration fixtures, not customer claims.

## Capabilities and Constraints

- The current product is a React web client backed by an Express API and shared schemas in this repository.
- The redesigned web client remains in this repository and reuses the existing API, authentication, domain model, and business logic.
- The public marketing website remains a separate Astro project in `../docuflow-marketing`.
- The web app gets its own task-oriented navigation; it does not copy the marketing navigation or the desktop agent's four-tab navigation.
- Organization and individual workspaces share core product capabilities, with organization-only administration and billing surfaces shown by entitlement and role.
- Existing product behavior and real data relationships must be preserved unless a later product decision explicitly changes them.
- All on-screen copy is English in the initial redesign. The information architecture must remain compatible with later localization.
- No invented customers, testimonials, usage statistics, subscription prices, or billing claims may appear in production-bound designs.
- Dark mode exists in the incumbent web app, but whether it ships in the first redesigned release is an open implementation decision.

## Brand Commitments

The web app inherits the canonical DocuFlow identity from `../docuflow-marketing/DESIGN.md`, adapted from a persuasive marketing surface to a dense operational product surface.

- Core colors: Case Ink `#0F1524`, Cold Stock `#F3F5F7`, Card White `#FFFFFF`, Amber Tab `#E9A23B`, Signed-Off Green `#1F9D6B`, Archive Slate `#59657A`, and Divider Grey `#D8DEE6`.
- Typefaces: Cabinet Grotesk for product identity and important headings, Switzer for written UI and prose, and JetBrains Mono for recorded values, timestamps, durations, prices, percentages, stages, identifiers, and badges.
- Operational UI is flat, dense, and separated primarily by 1px rules. It uses small 3–8px radii and avoids decorative shadows and gradients.
- Amber means the current state or next primary action. Green means a confirmed result. These meanings must not be exchanged.
- Warm Layered Paper is a marketing illustration language and must not be used as application chrome.
- The desktop agent v2 visual system is not an authority for the web app redesign.

## Evidence on Hand

- Product and positioning authority: `../docuflow-marketing/PRODUCT.md`.
- Canonical ecosystem visual system: `../docuflow-marketing/DESIGN.md`.
- Existing production web-app capabilities and routes: `client/`, `server/`, and `shared/` in this repository.
- Existing desktop-agent workflows: `desktop-agent/src/renderer/app-v2/`; these are functional evidence only, not web-app visual authority.
- There are no approved external customer claims or publishable proof statistics.

## Product Principles

1. **The client project is the spine.** Related work, people, time, activity, and knowledge should feel connected rather than filed in separate products.
2. **The grouping must stay legible.** The four pillars remain balanced; no single capability becomes the entire product identity.
3. **Administration is a first-class product surface.** People, roles, policy, billing, subscription, and workspace controls must be coherent rather than scattered through incidental settings.
4. **Show the right complexity for the role.** Owners and administrators get control and overview; contributors and individuals get a focused daily operating surface.
5. **Recorded state must be trustworthy.** Dense operational information uses explicit labels, consistent status semantics, source context, and predictable navigation.
6. **Only claim what is verifiable.** Demonstration data is clearly synthetic, and commercial facts remain placeholders until approved.

## Accessibility & Inclusion

Target WCAG 2.1 AA for the redesigned web app. Preserve full keyboard operation, visible focus states, semantic status communication that does not rely on color alone, reduced-motion support, robust zoom behavior, and responsive access to all core tasks.
