# AGENTS.md

## Purpose Of This File

This file gives coding agents product context before they change WerkFlow. It should help agents understand what the app is for, who it serves, what problems matter most, and which product principles should guide feature work.

Keep this file focused on broad product direction. Technical setup belongs in technical docs and implementation-specific Cursor rules. Deeper business context, such as offer design and acquisition strategy, can live in separate files later and be linked from here.

## App Summary

WerkFlow is intended to become the digital operations backbone for German HVAC / SHK businesses (`Sanitär-Heizungs-Klima`) first. Adjacent trades such as roofing or tiling may become relevant later because they often share similar operational patterns, but the current product focus is SHK.

It is a TypeScript web app today and is expected to have an associated React Native mobile app in the future.

The app should help SHK business owners and their teams save time, reduce paperwork, organize work digitally, and replace slow, outdated software with a fast, modern system tailored to their daily operations. Core product areas include customers/CRM, employee and working-time management, calendar/resource planning, project/job and service management, document management, inventory/procurement, commercial/finance workflows, and later AI-assisted automations.

WerkFlow has two broad product phases. First, build a complete operational core with the depth expected from serious Handwerkersoftware; this is not a bare-minimum MVP. Then use that trustworthy operational data and workflow foundation for differentiated AI assistance, configurable automation, and bounded agents inside and outside the app. The product-wide capability and dependency map lives in `docs/product/product-capability-map.md`. The living implementation order, slice dependencies, current checkpoint, and Phase 1 acceptance gates live in `docs/plans/phase-1-build-roadmap.md`; agents doing Phase 1 feature work must read and update it.

## Target User / Avatar

WerkFlow is a B2B product for German SHK businesses first, with possible future expansion into adjacent trade businesses. The direct customer is usually the business owner, but the whole company becomes the user base: owners, office staff, secretaries, project managers, technicians, workers, apprentices, and other employees.

The buyer is likely an experienced SHK business owner in their late 30s or 40s. They may be familiar with computers and smartphones, but they should not be expected to have technical knowledge about apps, software, or data systems. The same is true for their employees, and the bar for field workers must be especially low: the app should be extremely clear, forgiving, and hard to misuse in practical day-to-day work.

The common denominator is that these businesses often rely on slow legacy software, paper notes, physical folders, scattered documents, and manual coordination. Switching to WerkFlow should feel accessible, fast, and obviously useful rather than like adopting a complicated new software system.

Important user groups include:

- Business owners who buy the app, need oversight, and want to reduce the amount of operational work and stress on their plate.
- Office staff and secretaries who coordinate customers, documents, appointments, projects, workers, and communication.
- Managers or project leads who plan jobs, assign employees, track progress, and need reliable project information.
- Field workers / `Handwerker/in` who need a simple mobile-friendly way to see assigned work, document what happened, track time, and use inventory without friction.
- Apprentices and less experienced employees who need guided workflows with minimal room for mistakes.

## Core Problem

The core problem is that many SHK businesses lose time, focus, and sanity because their operations are buried in unnecessary paperwork, disconnected information, slow legacy tools, and physical notes, documents, and folders.

This creates avoidable work for employees and especially for the business owner, who often becomes the person responsible for keeping everything organized. WerkFlow should become the central digital place where the business can organize its operations instead of relying on scattered tools and paper-based processes.

The app should help answer practical operational questions quickly:

- What work needs to be done?
- Which project or customer does it belong to?
- Who is assigned?
- When is it planned?
- What is planned, in progress, parked, blocked, complete, or still undocumented?
- How much work time was recorded?
- Which documents, photos, offers, contracts, invoices, or parts belong to the work?
- Which inventory items are available, needed, used, or should be reordered?

## Product Purpose

WerkFlow should be powerful but easy to use, work straight out of the box, and feel tailored to SHK businesses. It should reduce paperwork, centralize operational information, and reduce the clutter and stress caused by bad software and unorganized work.

Before designing or adding a feature, agents should ask:

- Does this reduce paperwork inside the business?
- Does this make the business's work more organized?
- Does this save time for employees or the business owner?

If the answer to all three questions is no, think carefully before adding the feature because it may be unnecessary bloat.

## Key Use Cases And Product Scope

Some of these areas already exist in the app, some are only partially implemented, and some are planned product scope rather than current implementation.

- Working-time and employee management: current functionality covers organization membership/roles, employee assignment, clock in/out, breaks, job-linked time, manual entries, weekly overview, and change requests. The complete product should add personnel master data, schedules, skills/certifications, contracts/personnel documents, onboarding/offboarding, vacation, sick leave, time accounts, approvals, period close, and payroll-ready handoffs.
- Customers and CRM: a basic organization-scoped customer area exists. The complete product should add contacts, multiple work sites, operational requests, relationship/communication history, duplicate control, installed-equipment links, and practical follow-up without becoming a bloated generic sales CRM.
- Calendar and resource planning: day/week/month scheduling, job assignment, time context, and parked work exist. The complete product should connect recurring work, employee availability and skills, teams, tools, vehicles, material readiness, routes, and customer commitments while keeping planned and actual time distinct.
- Project and job management: authorized users can create projects and jobs, assign employees, track state and progress, attach photos and documents, and keep all project-related information connected. Offer/contract/invoice entities are not separate modules yet; documents can be categorized and linked operationally.
- Service and maintenance: a dedicated module does not exist yet. It should eventually connect customer sites and installed equipment with reactive service, recurring maintenance, contracts' operational delivery, dispatch, field reports, warranty/return context, and equipment history.
- Commercial and finance workflows: structured offers, contracts, invoices, incoming bills, payments, dunning, and accounting-ready handoffs are not implemented yet. The complete operational core should connect these records to approved work, material, measurements, customer context, and post-calculation. Native double-entry accounting, payroll, or tax filing remain separate strategic decision gates rather than automatic scope.
- Inventory management: a substantial V1 is implemented. The app should continue toward a connected material lifecycle covering catalog, locations, stock movements, job planning and consumption, tools/assets, suppliers, procurement, billability, and reordering without conflating these states. See `docs/features/inventory.md`.
- Mobile inventory workflows: the future mobile app should build on inventory V1 with barcode scanning so employees can quickly identify an item and complete permitted take, return, transfer, count, or receipt actions.
- Inventory onboarding service: part of the surrounding product/service offer may include an initial inventory audit so a customer starts with a usable baseline inventory in WerkFlow from day one.
- Supplier and ordering workflows: the app should extend inventory V1 with demand, approvals, supplier orders, receipts, returns, invoice matching, and reviewed reorder proposals, ideally through relevant German wholesaler standards and APIs where possible.
- Document management: a substantial first implementation exists. Managers (`admin`, `buero`) use a central `/dokumente` library with manual folders, a Drive-like file table, search/filtering by category and linked targets, trash, versioning for business documents, audit history, and server-side storage maintenance helpers. File bytes live in private Cloudflare R2 buckets (EU jurisdiction) with direct signed uploads/downloads; Postgres keeps all metadata (see `docs/decisions/0001-infrastructure-stack.md`). Field workers (`employee`) do not see the library sidebar page; they upload, view, and download documents from assigned job detail pages. Documents are metadata-linked to jobs, projects, customers, or employees rather than auto-creating physical folders when operational records are created. See `docs/features/document-management.md` for the full current model and open decisions.
- AI automations: this is the second broad product phase after the complete operational core is trustworthy. Future capabilities may include assistance, recommendations, product-owned templates, configurable workflows, and bounded agents acting inside WerkFlow or through authorized external email, SMS, calendar, accounting, or supplier connections. Human control, source visibility, permissions, audit, cost limits, and safe failure behavior are required. See `docs/features/ai-automations.md`.

Treat generated Supabase types and live Supabase inspection as more reliable than older architecture documentation when schema details matter. Production (`jbgaqpdjauzoocplgdsn`) is the source of truth for production state; the dev project (`mbkkzuqjbdvzelqvuzcn`) mirrors it via the committed `supabase/migrations/` history and is where development, tests, and schema changes go first (see `docs/technical/environments.md`).

## Product Principles For Agents

- Optimize for speed, simplicity, and operational clarity. The app should feel fast, modern, and much easier than the legacy tools and paper processes it replaces.
- Keep field-worker (`Handwerker/in`) workflows extremely simple, clear, mobile-friendly, and hard to misuse.
- Keep owner, office, and manager workflows efficient. These users need fast overview, filtering, planning, assignment, document access, and correction flows.
- Preserve organization boundaries. Data and preferences are organization-scoped unless there is a clear reason otherwise.
- Respect role differences. `admin`, `buero`, and `employee` experiences should differ intentionally, not accidentally.
- Prefer German user-facing language that is natural, neutral, and practical. Keep code, identifiers, comments, and developer artifacts in English.
- Favor simple defaults over heavy configuration. The product should work well out of the box.
- Avoid bloat. New features should reduce paperwork, improve organization, or save time.
- Prioritize fast loading and fresh operational data. The app uses Next.js, Partial Prerendering where appropriate, and Supabase Realtime heavily to balance speed with non-stale data.
- Design for excellent UI/UX, not just feature coverage. The app should feel slick, modern, and trustworthy.
- When business context is uncertain, leave a clear TODO or ask the product owner instead of inventing strategy.

## What This App Is Not

WerkFlow should not become a bloated generic business suite where features are added just because similar software has them. It should stay focused on the operational reality of German SHK businesses.

Before adding anything substantial, use the three product-purpose questions:

- Does this reduce paperwork inside the business?
- Does this make their work more organized?
- Does this save time for employees or the business owner?

If none of those are true, the feature probably does not belong in the product yet.

Do not encode acquisition strategy, offer structure, or sales positioning directly into feature logic unless those concepts are explicitly represented in product docs and requirements.

## Domain Language

Use German product language for anything visible to end users. Keep code, database names, identifiers, comments, commits, and developer-facing artifacts in English unless an existing technical convention requires otherwise.

- `SHK`: `Sanitär-Heizungs-Klima`, the target business category.
- `Auftrag`: a work order or job.
- `Projekt`: a larger body of work that can contain multiple jobs.
- `Kunde`: a private or commercial client.
- `Mitarbeiter`: an employee or organization member.
- `Handwerker/in`: the field-worker employee role label used in the UI.
- `Organisation`: the workspace/company boundary.
- `Kalender`: scheduling view for jobs and time entries.
- `Dokumente`: manager-facing document library at `/dokumente`.
- `Dokumente & Bilder`: contextual document section on job, project, customer, and employee detail pages.
- `Zeiterfassung`: time tracking, breaks, entries, corrections, and approvals.
- `Urlaub`: vacation/leave management.
- `Krankheit` / `Krankmeldung`: sick leave and absence management.
- `Arbeitszeitmanagement`: management of working hours, breaks, vacation, sick leave, and related approvals.
- `Lager` / `Inventar`: inventory, materials, parts, and stock.
- `geparkt`: parked work that is intentionally unscheduled or paused.
- `buero`: office/manager role with more permissions than an employee and fewer than an admin.

Keep route names, database enum values, and identifiers aligned with the existing codebase.

## Future Product Context

The following topics should likely become separate docs instead of making this file too large:

- `docs/product/offer.md`: product offer, packaging, pricing assumptions, guarantees, and buying objections.
- `docs/product/acquisition.md`: target channels, funnel, onboarding path, and lead/customer acquisition process.
- `docs/product/avatar.md`: a deeper description of the ideal customer profile and user personas if this outgrows the summary above.

When those files exist, agents should read them for tasks that touch positioning, onboarding, monetization, growth, or sales-driven product changes.

## Repo-Level Rules Mirrored From Cursor

This section mirrors the Cursor rules that were marked as always apply in `.cursor/rules`. The `.cursor` folder remains Cursor-specific; Codex and Claude expect durable repository-level agent guidance in `AGENTS.md`, so these rules live here to make Codex and Claude follow the same always-on project expectations.

### Language And Coding Standards

- Apply these standards across the Next.js and TypeScript app.
- Use natural, neutral German for all user-facing UI text, examples, labels, aria labels, tooltips, and error messages.
- Use proper German characters such as umlauts and `ß` in user-facing copy. Use ASCII replacements only when required for identifiers, slugs, env vars, URLs, or another technical constraint.
- Keep code, identifiers, APIs, comments, commands, commit messages, PR text, developer logs, and developer-facing artifacts in English.
- Ask concise clarifying questions before coding when requirements are ambiguous, especially around scope, inputs and outputs, acceptance criteria, edge cases, performance, security, UI states, accessibility, internationalization, and integration points.
- For non-trivial uncertain tasks, briefly restate the intended solution and request confirmation when key details are still unclear.
- Use descriptive full-word names. Avoid unclear abbreviations and one- or two-letter identifiers.
- Explicitly type public TypeScript function signatures and APIs. Avoid `any`; prefer precise types, discriminated unions, and utility types.
- Prefer guard clauses and early returns. Avoid deep nesting and broad try/catch blocks without meaningful handling.
- Write the smallest amount of quality code that clearly and maintainably delivers the confirmed outcome. This is not code golf: readability, maintainability, correctness, and explicit business meaning take priority over the raw line count, but unnecessary code is still a cost.
- Before and during implementation, ask whether the same outcome can be reached more directly with fewer branches, helpers, state variables, effects, wrappers, layers, dependencies, or duplicated paths. Prefer straightforward code, explicit state transitions, and direct data flow over clever indirection, premature generalization, speculative flexibility, or scaffolding for possible future scope.
- Reduce incidental complexity before adding an abstraction: reuse the existing source of truth and established patterns, keep related behavior together, and do not create parallel models or frameworks for a problem the current domain already owns. Extract a helper or abstraction only when it removes real duplication, makes a complex rule materially easier to understand and test, or enforces a necessary boundary.
- Simplicity and fewer lines are never reasons to omit safeguards. Preserve authorization, organization isolation, validation, data integrity, historical meaning, accessibility, auditability, failure visibility, and recovery. When a business rule is inherently complex, contain it in a focused, clearly named domain module with precise types, explicit invariants, and focused tests so its callers stay small and readable.
- Keep comments concise and purposeful. Explain non-obvious rationale, invariants, edge cases, or security/performance caveats.
- Match existing formatting and project conventions. Keep related logic close together and extract helpers only when they improve clarity.
- Do not leave linter or type errors. Add focused tests when the change has non-trivial risk.
- Preserve accessibility with ARIA where appropriate, keyboard/focus behavior, visible focus states, and sufficient contrast. Localize user-facing accessibility text in German.
- Keep UI text centralized where practical for future translation management. Avoid burying hardcoded user-facing strings deep in logic.
- Validate inputs at boundaries, avoid leaking PII in logs, and follow least-privilege handling for keys and tokens.
- Avoid unnecessary renders, large client bundles, and expensive un-memoized React computations. Prefer streaming and Suspense patterns where they fit the app.

### Bun-First Local Development

- Prefer Bun for package management, script execution, dependency installation, one-off binaries, and local command examples.
- Use `bun install` for installs.
- Use `bun run <script>` for package scripts.
- Prefer `bunx <tool>` over `npx <tool>`.
- Preserve Bun as the package manager of record and keep `bun.lock` / `bun.lockb` when present.
- Do not introduce or regenerate `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`.
- Documentation and shell examples should default to Bun commands.
- Allowed exceptions: the user explicitly requests another tool, a tool/platform clearly requires another command, or deployment/runtime discussion needs to mention Node.js.
- Also important: this app uses bun for local development but is hosted on Vercel and uses the node runtime on Vercel so the existance of a package-lock.json file is completely fine.
- Windows workstation note: the repository path contains spaces and Next.js route folders contain parentheses (`app/(app)/...`). In PowerShell, always quote such paths or use `-LiteralPath`; unquoted `(app)` is parsed as a subexpression and fails. Prefer Bash/`bunx` invocations for anything path-heavy.

### Product Context Reminder

- Before making product-facing changes, use this `AGENTS.md` file as the current broad product context.
- WerkFlow is a German-language operations app for German SHK businesses first.
- Product-facing changes should reduce paperwork, make work more organized, or save time for employees or the business owner.
- Keep workflows practical for non-technical German SHK users.
- Keep field-worker (`Handwerker/in`) flows extremely simple, clear, mobile-friendly, and hard to misuse.
- Keep owner, office, and manager flows efficient for planning, assignment, documents, inventory, time, and operational oversight.
- Preserve organization boundaries and intentional role-specific behavior.
- Prefer speed, simple defaults, excellent UI/UX, and operational usefulness over broad generic SaaS features.
- Distinguish current implementation from planned scope, especially for inventory and AI automation work.
- Do not invent offer, pricing, acquisition, or deeper avatar details; ask or leave TODOs until product docs exist.
- When schema details matter, treat live Supabase inspection and generated types as more reliable than older architecture documentation.
- The infrastructure stack is a settled decision (`docs/decisions/0001-infrastructure-stack.md`): Supabase Postgres/Auth/Realtime, Vercel (Frankfurt), Cloudflare R2 EU for file bytes via direct signed uploads, Railway workers only when a real long-running workload exists, Phase 2 AI via provider APIs. Do not propose provider migrations or route file bytes through Server Actions without a superseding decision record.

### Styling And Brand Color Rules

- WerkFlow looks calm, professional, and deliberately understated. Clarity and trust beat visual excitement; the Aufträge and Dokumente tables show the intended feel.
- Source of truth for all theme values is `app/globals.css` (tokens + `@theme inline`). Change the look by editing tokens there; never hardcode hex values, radii, or one-off styles in components. The full design language lives in the `werkflow-design` skill (`.claude/skills/` mirrored in `.agents/skills/`).
- Orange (`primary`, `#ff7900`) is the only attention color. Use it selectively and functionally: submit/CTA buttons, focus rings, selection states, important links. If orange stops being rare, it stops working.
- Purple is a soft, desaturated undertone via the `--brand-purple*` tokens and purple-tinted neutrals — never a loud accent. Do not reintroduce vivid violet in UI; only the logo SVGs keep vivid purple. Purple also semantically marks parked/planning entities (`geparkt`, Kalender blocks).
- Status colors stay semantic (green success, red destructive, yellow warning) — never rebrand them orange or purple.
- Never place purple text on an orange background or orange text on a purple background. Valid pairings: orange background with white/neutral text, purple background with white/neutral/purple text, neutral background with orange or purple text. Same rules in dark mode.
- Shape and depth: modest radius (containers `rounded-lg`, controls `rounded-md`, never `rounded-2xl`+), cards as `border` + `shadow-xs`, heavy shadows only on floating elements, 2px focus rings without offsets, Lucide icons at the global 1.75 stroke (no `strokeWidth` props).
- Keep controls slim (tabs `h-9`, sidebar items `py-1.5`, quiet neutral active states) and prefer sections with headings/dividers over wrapping every block in a card.
- Logo usage: light mode should use `/logo-text-light.svg` or `/logo-icon-light.svg`; dark mode should use `/logo-text-dark.svg` or `/logo-icon-dark.svg`.
- Use `dark:hidden` and `hidden dark:block` when swapping light/dark logo assets.

## Maintenance Guidance

Update this file when the product direction changes, not for every implementation detail. During Phase 1 implementation, update the affected feature specifications and `docs/plans/phase-1-build-roadmap.md` as part of the same change. Keep this file concise enough that an agent can read it quickly at the start of a task.

If a future task needs exact database state, inspect Supabase directly through the available MCP/plugin workflow before making schema-specific claims.
