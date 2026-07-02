# AGENTS.md

## Purpose Of This File

This file gives coding agents product context before they change WerkFlow. It should help agents understand what the app is for, who it serves, what problems matter most, and which product principles should guide feature work.

Keep this file focused on broad product direction. Technical setup belongs in technical docs and implementation-specific Cursor rules. Deeper business context, such as offer design and acquisition strategy, can live in separate files later and be linked from here.

## App Summary

WerkFlow is intended to become the digital operations backbone for German HVAC / SHK businesses (`Sanitär-Heizungs-Klima`) first. Adjacent trades such as roofing or tiling may become relevant later because they often share similar operational patterns, but the current product focus is SHK.

It is a TypeScript web app today and is expected to have an associated React Native mobile app in the future.

The app should help SHK business owners and their teams save time, reduce paperwork, organize work digitally, and replace slow, outdated software with a fast, modern system tailored to their daily operations. Core product areas include employee and working-time management, project/job management, document management, AI-assisted automations, and inventory management as a major near-term planned module.

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

- Working-time and employee management: employees can clock in and out, track working hours and breaks, plan vacation, track sick days, and see day/week/month work time. Owners and office staff can manage employee working times, vacation, sick leave, assignments, and job/project allocation.
- Project and job management: authorized users can create projects and jobs, assign employees, track state and progress, attach photos and documents, and keep all project-related information connected. Offer/contract/invoice entities are not separate modules yet; documents can be categorized and linked operationally.
- Inventory management: this is a major near-term planned module and is not currently implemented. The app should digitize the business inventory down to specific parts and materials, track what is available, what is used for which job, what should be invoiced, and what needs reordering.
- Mobile inventory workflows: once inventory exists, the future mobile app should support barcode scanning so employees can quickly add or remove inventory items by scanning a part and entering the quantity.
- Inventory onboarding service: part of the surrounding product/service offer may include an initial inventory audit so a customer starts with a usable baseline inventory in WerkFlow from day one.
- Supplier and ordering workflows: once inventory exists, the app may support ordering or automated reordering of parts when stock drops below configured thresholds, ideally through German wholesaler APIs where possible.
- Document management: a substantial first implementation exists. Managers (`admin`, `buero`) use a central `/dokumente` library with manual folders, a Drive-like file table, search/filtering by category and linked targets, trash, versioning for business documents, audit history, and private Supabase Storage maintenance helpers. Field workers (`employee`) do not see the library sidebar page; they upload, view, and download documents from assigned job detail pages. Documents are metadata-linked to jobs, projects, customers, or employees rather than auto-creating physical folders when operational records are created. See `docs/features/document-management.md` for the full current model and open decisions.
- AI automations: future workflows may allow businesses to create automations such as automatic part ordering, invoice sending, or customer review-link follow-ups after work is completed. These need more product thinking before implementation.

Treat generated Supabase types and live Supabase inspection as more reliable than older architecture documentation when schema details matter.

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

## Codex Repo-Level Rules Mirrored From Cursor

This section mirrors the Cursor rules that were marked as always apply in `.cursor/rules`. The `.cursor` folder remains Cursor-specific; Codex expects durable repository-level agent guidance in `AGENTS.md`, so these rules live here to make Codex follow the same always-on project expectations.

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

### Styling And Brand Color Rules

- WerkFlow uses orange as the primary action color and purple as the secondary/supporting brand color.
- Use orange (`#ff7900`) for submit buttons, CTAs, important links, success states, and elements that should draw immediate attention.
- Use purple shades for navigation highlights, non-critical hover states, borders, dividers, background tints, secondary buttons, tags, badges, and general UI polish.
- Never mix purple and orange in the same component in a way that places purple text on an orange background or orange text on a purple background.
- Valid pairings include orange background with white/neutral text, purple background with white/neutral/purple text, and neutral background with orange or purple text.
- Apply the same color pairing rules in dark mode.
- Use slightly desaturated purples in dark mode backgrounds and make the orange primary color bright enough for visibility.
- Logo usage: light mode should use `/logo-text-light.svg` or `/logo-icon-light.svg`; dark mode should use `/logo-text-dark.svg` or `/logo-icon-dark.svg`.
- Use `dark:hidden` and `hidden dark:block` when swapping light/dark logo assets.

## Maintenance Guidance

Update this file when the product direction changes, not for every implementation detail. Keep it concise enough that an agent can read it quickly at the start of a task.

If a future task needs exact database state, inspect Supabase directly through the available MCP/plugin workflow before making schema-specific claims.
