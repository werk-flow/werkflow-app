# AGENTS.md

## Purpose Of This File

This file gives coding agents product context before they change WerkFlow. It should help agents understand what the app is for, who it serves, what problems matter most, and which product principles should guide feature work.

Keep this file focused on broad product direction and the always-on repository rules. Technical setup lives under `docs/technical/`, routed through `docs/README.md`. Deeper business context, such as offer design and acquisition strategy, lives in `docs/product/`.

## App Summary

WerkFlow is intended to become the digital operations backbone for German HVAC / SHK businesses (`Sanitär-Heizungs-Klima`) first. Adjacent trades such as roofing or tiling may become relevant later because they often share similar operational patterns, but the current product focus is SHK.

It is a TypeScript web app today and is expected to have an associated React Native mobile app in the future.

The app should help SHK business owners and their teams save time, reduce paperwork, organize work digitally, and replace slow, outdated software with a fast, modern system tailored to their daily operations. Core product areas include customers/CRM, employee and working-time management, calendar/resource planning, project/job and service management, document management, inventory/procurement, commercial/finance workflows, and later AI-assisted automations.

WerkFlow has two broad product phases. First, build a complete operational core with the depth expected from serious Handwerkersoftware; this is not a bare-minimum MVP. Then use that trustworthy operational data and workflow foundation for differentiated AI assistance, configurable automation, and bounded agents inside and outside the app. The product-wide capability and dependency map lives in `docs/product/product-capability-map.md`. The living implementation order, slice dependencies, and current checkpoint live in `docs/plans/phase-1/roadmap.md` (the entry file; the execution protocol, gate definitions, progress log, and per-slice acceptance records live beside it under `docs/plans/phase-1/`); agents doing Phase 1 feature work must read and update it. The annotated index of every doc — one line each with a read-when hint and status — is `docs/README.md`; route through it instead of globbing the docs tree.

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

Implementation status is owned by each feature spec's **Current Product Baseline** section and by the slice index in `docs/plans/phase-1/roadmap.md`. Read those before making a status claim; this list only orients. As of 2026-09-02, Waves 0 to 2 of Phase 1 (`P1-00` through `P1-24`) are accepted and Wave 3 has not started.

- Working-time and employee management: personnel records with date-effective employment conditions, work schedules and holiday calendars, scoped responsibilities with delegation, vacation, sickness, teams and qualifications, explicit time segments, one correction and approval flow, time accounts with period close and payroll-ready export, and a controlled onboarding, access, and employment lifecycle with protected personnel documents. Full offboarding closure with asset return is `P1-33`.
- Customers and CRM: customer identity with contacts and work sites, operational requests (`Anfragen`) converted exactly once into work, a relationship timeline with owned follow-ups and communication preferences, and installed-equipment context per site. Duplicate control and outbound messaging are later slices. It must not become a generic sales CRM.
- Calendar and resource planning: day/week/month scheduling, recurring and multi-visit planning occurrences, capacity and qualification checks, dispatch with acknowledgement, parked work, and customer commitments kept distinct from internal plans. Tools, vehicles, and routes are Wave 3 and later.
- Project and job management: projects and jobs with assignment, versioned work templates, an explicit execution lifecycle with blockers and dependencies, structured site evidence (reports, measurements, defects, signatures), a focused field work pack, and office-reviewed handover packages. Offers, contracts, and invoices are not separate modules yet.
- Service and maintenance: installed equipment per customer site, reactive service cases with triage and dispatch, and maintenance plans with operational coverage that generate due work. On-call planning, customer messaging, and telemetry are later scope or decision gates.
- Commercial and finance workflows: not implemented yet (Wave 4). Structured offers, contracts, invoices, incoming bills, payments, dunning, and accounting-ready handoffs must connect to approved work, material, measurements, customer context, and post-calculation. Native double-entry accounting, payroll, or tax filing remain separate strategic decision gates rather than automatic scope.
- Inventory management: a substantial V1 is implemented. The app should continue toward a connected material lifecycle covering catalog, locations, stock movements, job planning and consumption, tools/assets, suppliers, procurement, billability, and reordering without conflating these states. See `docs/features/inventory.md`.
- Mobile inventory workflows: the future mobile app should build on inventory V1 with barcode scanning so employees can quickly identify an item and complete permitted take, return, transfer, count, or receipt actions.
- Inventory onboarding service: part of the surrounding product/service offer may include an initial inventory audit so a customer starts with a usable baseline inventory in WerkFlow from day one.
- Supplier and ordering workflows: the app should extend inventory V1 with demand, approvals, supplier orders, receipts, returns, invoice matching, and reviewed reorder proposals, ideally through relevant German wholesaler standards and APIs where possible.
- Document management: a substantial first implementation exists. Managers (`admin`, `buero`) use a central `/dokumente` library with manual folders, a Drive-like file table, search/filtering by category and linked targets, trash, versioning for business documents, audit history, and server-side storage maintenance helpers. File bytes live in private Cloudflare R2 buckets (EU jurisdiction) with direct signed uploads/downloads; Postgres keeps all metadata (see `docs/decisions/0001-infrastructure-stack.md`). Field workers (`employee`) do not see the library sidebar page; they upload, view, and download documents from assigned job detail pages. Documents are metadata-linked to jobs, projects, customers, employees, requests, installed equipment, service cases, or maintenance coverage rather than auto-creating physical folders when operational records are created. Protected personnel documents (`P1-24`) are a separate access class outside the ordinary library. See `docs/features/document-management.md` for the full current model and open decisions.
- AI automations: this is the second broad product phase after the complete operational core is trustworthy. Future capabilities may include assistance, recommendations, product-owned templates, configurable workflows, and bounded agents acting inside WerkFlow or through authorized external email, SMS, calendar, accounting, or supplier connections. Human control, source visibility, permissions, audit, cost limits, and safe failure behavior are required. See `docs/features/ai-automations.md`.

Treat generated Supabase types and live Supabase inspection as more reliable than older architecture documentation when schema details matter. WerkFlow runs a production and a dev Supabase project plus a local test stack; the project IDs, the dev-first migration rule, and which tool reaches which backend live in `docs/technical/environments.md`.

## Product Principles For Agents

- Optimize for speed, simplicity, and operational clarity. The app should feel fast, modern, and much easier than the legacy tools and paper processes it replaces.
- Keep field-worker (`Handwerker/in`) workflows extremely simple, clear, mobile-friendly, and hard to misuse.
- Keep owner, office, and manager workflows efficient. These users need fast overview, filtering, planning, assignment, document access, and correction flows.
- Preserve organization boundaries. Data and preferences are organization-scoped unless there is a clear reason otherwise.
- Respect role differences. `admin`, `buero`, and `employee` experiences should differ intentionally, not accidentally.
- Prefer German user-facing language that is natural, neutral, and practical. Keep code, identifiers, comments, and developer artifacts in English.
- Favor simple defaults over heavy configuration. The product should work well out of the box.
- Avoid bloat. New features should reduce paperwork, improve organization, or save time.
- Prioritize fast loading and fresh operational data. The app uses Next.js Cache Components, Suspense streaming, cache tags, and Supabase Realtime to balance speed with non-stale data (`docs/technical/realtime-and-caching.md`).
- Design for excellent UI/UX, not just feature coverage. The app should feel slick, modern, and trustworthy.
- When business context is uncertain, leave a clear TODO or ask the product owner instead of inventing strategy.

## What This App Is Not

WerkFlow should not become a bloated generic business suite where features are added just because similar software has them. It should stay focused on the operational reality of German SHK businesses.

Before adding anything substantial, apply the three product-purpose questions above. If none of them holds, the feature probably does not belong in the product yet.

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
- `Anfrage`: an operational customer request captured at intake (`/anfragen`), converted exactly once into work.
- `Ansprechpartner` / `Einsatzort`: a customer's contact person / a customer's durable work site.
- `Kalender`: scheduling view for planning occurrences, dispatch, absences, and time context.
- `Einsatz`: a dispatched work instruction; `Mein Einsatz` is the field worker's view.
- `Arbeitsvorlage`: a versioned work template (`/arbeitsvorlagen`).
- `Arbeitsnachweis`: a structured site-evidence artifact (report, measurement, defect, signature).
- `Übergabe`: the office-reviewed handover package (`/auftraege/uebergaben`).
- `Aufgaben`: the one role-aware task, approval, and notification surface (`/aufgaben`).
- `Qualifikationen`: teams, skills, and certifications (`/qualifikationen`).
- `Anlage`, `Servicefall`, `Wartungsplan`: installed equipment, reactive service case, maintenance plan (`/service/...`).
- `Dokumente`: manager-facing document library at `/dokumente`.
- `Dokumente & Bilder`: contextual document section on job, project, customer, and employee detail pages.
- `Zeiterfassung`: time tracking, activity segments, corrections, and approvals.
- `Zeitkonto` / `Perioden`: time accounts and balances / period close and payroll export.
- `Urlaub`: vacation/leave management.
- `Krankheit` / `Krankmeldung`: sick leave and absence management.
- `Arbeitszeitmanagement`: management of working hours, breaks, vacation, sick leave, and related approvals.
- `Lager` / `Inventar`: inventory, materials, parts, and stock.
- `geparkt`: parked work that is intentionally unscheduled or paused.
- `buero`: office/manager role with more permissions than an employee and fewer than an admin.

Keep route names, database enum values, and identifiers aligned with the existing codebase. The route name is the German term; the owning feature spec defines it.

## Future Product Context

These topics live in separate docs so this file stays small. All three exist today as thin placeholders that will grow as the business decisions are made:

- `docs/product/offer.md`: product offer, packaging, pricing assumptions, guarantees, and buying objections.
- `docs/product/acquisition.md`: target channels, funnel, onboarding path, and lead/customer acquisition process.
- `docs/product/avatar.md`: a deeper description of the ideal customer profile and user personas if this outgrows the summary above.

Agents should read them for tasks that touch positioning, onboarding, monetization, growth, or sales-driven product changes, and should still ask or leave TODOs instead of inventing details the placeholders do not yet contain.

## Always-On Repository Rules

These rules apply to every task in this repository. They originated as Cursor rules; the `.cursor` folder was removed on 2026-08-20 (Cursor is no longer used), and this file is now their sole source for all agents (Claude reads it via `CLAUDE.md`, Codex reads it directly).

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
- Apply the `unslop` skill (`.claude/skills/unslop`, mirrored in `.agents/skills/unslop`) to every piece of prose you produce — chat responses, documentation, commit/PR text, and user-facing copy alike. Load it at the start of a task that will produce prose; do not wait to be asked.
- Push every learned lesson up the enforcement ladder before letting it rest as prose ([decision 0005](docs/decisions/0005-enforcement-ladder.md)): first try to make the mistake unwritable (a wrapper, a type, removing the raw primitive from reach), then to make a check catch it (lint rule, unit test, runner/preflight, `docs:check`), and only park it in docs, skills, or comments when you can state why neither rung is reachable. When you fix a diagnosed defect or keep a review finding, name the tier your prevention landed on; open conversions live in `docs/technical/enforcement-ladder-backlog.md`.
- Route tasks through the matching skill instead of working unaided; the full skill inventory with use-when hints lives in `docs/README.md`. The load-bearing pairings: any prompt, meta prompt, skill, or other agent-consumed document → `writing-for-agents` plus `unslop`; writing or restructuring developer documentation → `technical-writing`; designing TypeScript types or validation boundaries → `typescript-best-practices`; diagnosing a non-trivial defect → `diagnosing-bugs`; resolving open product or design decisions with the owner → `grilling`; UI work → `werkflow-design`; Supabase work → `supabase-live-workflow`.
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
- Preserve Bun as the package manager of record and keep `bun.lock`.
- A committed `package-lock.json` is expected because Vercel builds on the Node runtime. Do not regenerate it, and do not introduce `yarn.lock` or `pnpm-lock.yaml`.
- Documentation and shell examples should default to Bun commands.
- Run CodeRabbit only through `bun run review` (or `bun run review:doctor` for a prerequisite check). Never infer that CodeRabbit is missing from a failed native PowerShell or WSL PATH lookup, and never install or reinstall it; the repository wrapper owns the configured WSL binary path and reports genuine host problems.
- Allowed exceptions: the user explicitly requests another tool, a tool/platform clearly requires another command, or deployment/runtime discussion needs to mention Node.js.
- Windows workstation note: the repository path contains spaces and Next.js route folders contain parentheses (`app/(app)/...`). In PowerShell, always quote such paths or use `-LiteralPath`; unquoted `(app)` is parsed as a subexpression and fails. Prefer Bash/`bunx` invocations for anything path-heavy.

### Infrastructure, Branches, And Deployment

- The infrastructure stack is a settled decision (`docs/decisions/0001-infrastructure-stack.md`): Supabase Postgres/Auth/Realtime, Vercel (Frankfurt), Cloudflare R2 EU for file bytes via direct signed uploads, Railway workers only when a real long-running workload exists, Phase 2 AI via provider APIs. Do not propose provider migrations or route file bytes through Server Actions without a superseding decision record.
- Work on local `main`. Publish with `git push origin main:partner-preview`; every push there builds a Vercel preview deployment that the business partner reviews. `origin/main` is the production deploy branch and advances only when the owner explicitly asks for a production release. Commit and push only when the user asks.
- Schema changes are committed migration files applied dev-first, prod-second; browser certification runs against the local Supabase stack, and only the canary suite and wave-end runs touch cloud dev (`docs/technical/environments.md`, `docs/technical/testing.md`).

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

Update this file when the product direction changes, not for every implementation detail. During Phase 1 implementation, update the affected feature specifications and the affected files under `docs/plans/phase-1/` as part of the same change. Keep this file concise enough that an agent can read it quickly at the start of a task.

If a future task needs exact database state, inspect Supabase directly through the available MCP/plugin workflow before making schema-specific claims.
