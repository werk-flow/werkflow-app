# AGENTS.md

Read this file at the start of every task. It gives the product context, the six virtues that define quality in this repository, and the rules that apply to every change. Everything else is reached through [the docs index](docs/README.md). Do not glob the docs tree.

## Workspace

The parent `Code` directory holds three independent Git repositories, not a monorepo.

| Repository | Owns | Read when |
| --- | --- | --- |
| [werkflow-app](docs/README.md) | The product: web app, future mobile app, implementation, tests, infrastructure, release evidence | Building or checking app behavior |
| [werkflow-business](../werkflow-business/docs/README.md) | Avatar, offer, acquisition, beta relationship, customer research, Hormozi library | Making business decisions or checking commercial promises |
| [werkflow-website](../werkflow-website/AGENTS.md) | Public website, campaign pages and their integrations | Building or checking marketing pages |

Open the repository that owns the task. Read a sibling's AGENTS.md and index before using its context. Reading a sibling never authorizes changing it. Report missing sibling context; never invent it. The business [workspace workflow](../werkflow-business/docs/workflow.md) owns source freshness and new-machine setup.

For substantive business work, use the [Hormozi advisor](../werkflow-business/.agents/skills/hormozi-advisor/SKILL.md) and its [reasoning baseline](../werkflow-business/docs/library/baseline.md). For customer-facing sales or marketing copy, also use [copywriting](../werkflow-business/.agents/skills/copywriting/SKILL.md) and its [fifth-grade standard](../werkflow-business/docs/copy-standard.md). Routine engineering does not load the business library.

## Product

WerkFlow is the digital operations backbone for German SHK businesses (`Sanitär-Heizungs-Klima`). Adjacent trades may follow later. It is a TypeScript web app today, with a React Native app planned.

The buyer is the business owner. The users are the whole company: owners, office staff, project leads, field workers (`Handwerker/in`) and apprentices. The commercial target is medium-to-large SHK businesses whose leadership wants to modernize. Nobody needs technical knowledge. The bar for field workers is the lowest: clear, forgiving, hard to misuse.

These businesses lose time to paperwork, scattered information, slow legacy software and physical folders, and the owner holds it all together. WerkFlow is the one place that answers: what work is due, for which customer or project, who is assigned, when, in which state, how much time was recorded, and which documents and materials belong to it.

The product has two phases. Phase 1 builds a complete operational core with the depth of serious Handwerkersoftware. Phase 2 builds AI assistance and automation on that data. [The capability map](docs/product/product-capability-map.md) owns the dependency model. [The roadmap](docs/plans/phase-1/roadmap.md) owns the order of work and the current checkpoint. Each feature spec's **Current Product Baseline** owns implemented behavior. A planned capability is not an implemented feature.

Before you add a feature, ask three questions. Does it reduce paperwork? Does it make the work more organized? Does it save time for employees or the owner? If all three answers are no, it is probably bloat: raise it with the owner.

## The six virtues

These six virtues define quality in WerkFlow and apply to every change, whatever its size. Each rule names its mechanism by tier ([decision 0005](docs/decisions/0005-enforcement-ladder.md)): Tier 1 makes the mistake unwritable, Tier 2 is an automated check that fails on it, Tier 3 is judgment that a reviewer exercises and records.

### How to read the virtues

**The owner docs.** Each virtue's owner doc holds five sections: "How to work" (a procedure per recurring task, with each step's fast check and the wrong turn it prevents), "Checklist" (every item a new implementation ticks, with its mechanism), "Never" (the prohibitions and what catches each), "Verify your work" (the commands at the end) and "Examples" (real files to copy).

**Order of use.** Before you write, read the "How to work", "Checklist" and "Never" sections of every virtue your task touches and build from their defaults. While you work, run each step's fast check. At the end, run the Verify commands.

**Hard rules and defaults.** A Tier 1 or Tier 2 rule is a hard rule: a mechanism enforces it, and you never break it. To change one, change its mechanism in the same change, with the owner. Every security rule is hard, even where only review enforces it, except the two defaults of virtue 3. Every other Tier 3 rule and every procedure step is a verified default, not a law. Diverge when it clearly does not fit, for example in a Phase 2 AI feature whose interface differs from the rest of the app. Record every divergence in one place: a `Divergences` note in the slice record, or, outside a slice, the commit message body. The note names the default, why it does not fit here, what you did instead, and whether the default should change; if so, change the owner doc in the same change.

**Improve the virtues.** The virtues evolve, testing system and docs rules included. When a rule is missing, wrong, outdated or costs more than it protects, raise it with the owner and change the rule with its mechanism in the same change. A new rule comes with its mechanism at the highest reachable tier and a plan for the existing code: fix it now, or add a row to the [enforcement-ladder backlog](docs/technical/enforcement-ladder-backlog.md). When you fix a diagnosed defect or keep a review finding, name the tier where its prevention landed.

A change is done when its Verify commands pass and its Tier 3 points have a recorded answer.

### 1. UI and UX

- **Good.** Build from the component registry: a page is `PageShell`, `PageHeader`, `PageBody`, a field is a `Field`, an empty list is `EmptyState`. Every route has a `loading.tsx` skeleton, and a failed region shows a retry. A submit button stays enabled, and a submit with missing input marks the fields and focuses the first (`focusFirstInvalidField`). German copy addresses the user with "du" and reads naturally.
- **Never.** Hardcode a hex value, a radius or a numbered palette class. Write a raw `<button>`, a raw text `<input>`, a native date, time or select control, a raw `<h1>`, or a `max-w-*` class on `DialogContent`. Use orange as decoration, or purple as a loud accent. Disable a submit or an action button to express validation. Keep a design the owner rejected as a test baseline.
- **Enforced by.** Tier 1: the registry in `components/ui/` and `components/shared/` and the tokens in `app/globals.css`. Tier 2: `static:lint` (`ui/no-raw-controls`, `ui/submit-disabled-only-while-pending`, `ui/action-disabled-only-while-pending`, `ui/pending-reset-on-failure`, `ui/dialog-pending-while-waiting`, `ui/global-key-handler-respects-consumed`, `ui/icon-button-needs-name`, `ui/label-in-spaced-container`, `ui/no-lucide-stroke-width`, `ui/no-block-in-paragraph`, and the selector sets in `eslint.config.mjs`), the contracts under `lib/ui/`, `lib/conventions/german-copy.test.ts`, `lib/conventions/route-loading.test.ts`, `lib/conventions/status-colors.test.ts`, `ui:contracts`, `audit:layout`, `audit:visual` (release, image and text references).
- **Defaults (Tier 3).** Hierarchy, density, shadows, natural German and fit for the role, through [rendered design acceptance](docs/technical/standards-audit.md#rendered-design-acceptance).
- **Verify.** `bun run lint`, `bun run test:unit`, `bun run test:ui`. Then look at the screen: both themes, 375 px and desktop, keyboard path, empty, loading and error states.
- **Owner doc.** The `werkflow-design` skill (`.claude/skills/werkflow-design/SKILL.md`). Start from its [How to work](.claude/skills/werkflow-design/SKILL.md#how-to-work).

### 2. Performance and immediate feedback

- **Good.** Every action shows feedback in its first frame, before the network answers (`useServerAction`, `useOptimisticList`). Saved results reach every affected view, and other sessions within the live target. A list reads completely in pages and reports an overflow instead of truncating (`readAllRows`). An organization-sized id list goes through `readInBatches`.
- **Never.** Wait for the network before you acknowledge an action. Truncate a list silently. Pass an organization-sized list to `.in()`. Call `updateTag` or `revalidateTag` on a tag that no cached reader carries. Use `useTransition`, polling or a toast in product code. Raise a budget, a reference or a timeout to make a slow build pass.
- **Enforced by.** Tier 1: `hooks/use-server-action.ts`, `hooks/use-optimistic-list.ts`, `lib/supabase/query-batches.ts`. Tier 2: `lib/conventions/server-action-feedback.test.ts`, `ui/no-derived-state-effect`, `lib/conventions/id-list-batches.test.ts`, `lib/conventions/id-list-string-filters.test.ts`, `lib/conventions/cache-tags.test.ts`, `lib/conventions/route-render-owner.test.ts`, `lib/attention/count-reads.test.ts`, `tests/golden/route-renders.json`, `sql:list-pagination`, `ui:contracts` and `audit:layout` (a loaded page settles), `bun run realtime:check`, the Realtime, transition and polling selector sets in `eslint.config.mjs`, and in release mode the `audit:performance:*` groups and the latency deadlines.
- **Defaults (Tier 3).** Whether a new flow needs a measured scenario, and whether a new reader may be cached across requests.
- **Verify.** `bun run test:unit`, `bun run test:ui`. To prove a performance repair: `bun run test:verify --group audit:performance:<name>`.
- **Owner doc.** [Realtime and caching](docs/technical/realtime-and-caching.md). Start from its [How to work](docs/technical/realtime-and-caching.md#how-to-work).

### 3. Security

- **Good.** The server establishes identity, organization, role and object permission before every protected operation, and a test drives the real action with a foreign id. The migration that creates a table enables RLS, adds policies and grants explicitly. An identity check that cannot complete is a failure, never a sign-out and never access.
- **Never.** Restrict only in the UI. Trust an id, an organization or a role that the client sent. Grant to `anon`. Export a helper from a `'use server'` module. Log personal data, codes or provider bodies. Send file bytes through a Server Action. Write to PROD outside a release the owner requested.
- **Enforced by.** Tier 1: RLS, revoked default grants, `server-only` modules, `lib/org/action-context.ts`, `lib/storage/r2.ts`, `lib/logging.ts`. Tier 2: the tests under `lib/security/`, `lib/conventions/tenant-scope.test.ts`, `lib/conventions/server-action-input.test.ts`, `lib/conventions/zod-entry.test.ts`, the auth-scope, production-ref, `htmlSinkSelectors` and `console` rules in `eslint.config.mjs`, `sql:security`, `sql:closed-period-writes`, `canary:security`, `static:dependencies`, `auth:check`, `advisors:check`.
- **Defaults (Tier 3).** Whether the permission check is the right one for the operation, and every accepted residual exposure.
- **Verify.** `bun run test:unit`, `bun run test:verify --group sql:security`.
- **Owner doc.** [Security](docs/technical/security.md). Start from its [How to work](docs/technical/security.md#how-to-work).

### 4. Code quality and maintainability

- **Good.** Write the smallest amount of clear code that delivers the confirmed outcome. A domain rule has one owner module with precise types and focused tests. Rows that change together change in one database function call. Use descriptive full-word names and guard clauses. Type every exported signature under `lib/`. End each task with a deletion pass.
- **Never.** Use `any`, a `!` assertion, a double cast through `unknown`, or `undefined` in an optional property. Declare a helper name that another product file already declares. Write related rows in separate statements. Leave dead code, an unused export or an unused dependency. Suppress a rule without a reason. Add an abstraction for possible future scope. Remove authorization, validation, audit history or failure visibility to save lines. Rename existing short identifiers in passing (owner decision).
- **Enforced by.** Tier 1: strict compiler flags in `tsconfig.json`. Tier 2: `static:typecheck`, `static:lint` (type, cast, size-limit, layering, escape and suppression rules), `static:unused`, `static:format`, `lib/conventions/duplicate-helpers.test.ts`, `lib/conventions/module-caps.test.ts`, `lib/conventions/business-date.test.ts`, `lib/conventions/collection-keys.test.ts`, `lib/conventions/action-failure-shape.test.ts`, `lib/conventions/failure-messages.test.ts`, `lib/action-messages.test.ts`, `lib/conventions/read-error-visibility.test.ts`, `lib/conventions/detail-loader-failures.test.ts`, `lib/conventions/status-guarded-writes.test.ts`, `lib/conventions/dependency-denylist.test.ts`, `quality/no-silent-catch`, `timeOfDaySelectors`, `sql:job-plan-bridge`, `sql:user-preference-writes`.
- **Defaults (Tier 3).** Whether an abstraction earns its place, naming, and the deletion pass with its independent review.
- **Verify.** `bun run typecheck`, `bun run lint`, `bun run unused:check`, `bun run test:unit`.
- **Owner doc.** [Code quality](docs/technical/code-quality.md), with the `typescript-best-practices` skill for types. Start from its [How to work](docs/technical/code-quality.md#how-to-work).

### 5. Testing and review

- **Good.** Put each rule at the cheapest boundary that can expose its failure: a unit test for a calculation, SQL for permissions, a component contract for a shared control, a browser journey for a connected outcome. A test fails when the behavior breaks and names the broken invariant. Diagnose a failure before you run again. Review every change through `bun run review` and record a disposition for each finding.
- **Never.** Retry until green. Weaken an assertion, skip a test, add a fixed sleep or raise a timeout to pass. Treat a review score or an old report as acceptance. Call the CodeRabbit CLI directly, or install it. Push without the publication gate.
- **Enforced by.** Tier 1: `.githooks/pre-push` refuses a push without a passing verification report and review records whose per-file digests cover the tree, `scripts/guard-edits-during-verification.ts` refuses edits to proof inputs during a run, `scripts/unit-test-preload.ts` bounds every unit run, `lib/testing/runs/incident-record.ts` writes the incident row, and `tests/golden/support/db/shared.ts` brands a persisted row. Tier 2: the selection and proof rules in `scripts/verify.ts`, `lib/testing/runner/backend-health.test.ts`, `lib/testing/runner/workspace-lock-coverage.test.ts`, `lib/testing/runs/replay-checkpoint.test.ts`, `lib/testing/runs/incident-record.test.ts`, `lib/testing/performance-reference-carryover.test.ts`, `lib/docs/slice-browser-proof.ts`, `static:coverage`, the rule tests under `lib/testing/spec-support/`, the rules in `eslint-rules/playwright-spec-rules.mjs` and the spec selector set in `eslint.config.mjs`.
- **Defaults (Tier 3).** Whether an assertion proves its catalog clause, the classification of a failure, and the disposition of each review finding.
- **Verify.** `bun run test:plan`, `bun run test:verify`, `bun run review`. A wave end or a release adds `bun run test:verify --mode release` and the cloud canary.
- **Owner doc.** [Testing](docs/technical/testing.md), with [CodeRabbit](docs/technical/coderabbit.md) for reviews. Start from its [How to work](docs/technical/testing.md#how-to-work).

### 6. Documentation

- **Good.** A doc holds what the code and the database cannot say: intent, decisions, rules, reasons, procedures, and a pointer to the mechanism that enforces a rule. Every fact has one home, and other places link to it. Change the owning doc in the same change as the behavior.
- **Never.** Restate a schema, a file list, a handler list, a function inventory, a count or a current value. Write dated narrative, report ids or build ids into a living doc. Copy a rule into a second doc. Create a report or summary file that nobody asked for. Store repository facts in agent memory.
- **Enforced by.** Tier 2: `bun run docs:check` (`scripts/check-docs.ts`, rules in `lib/docs/`), including the required sections of every owner doc, the mechanisms they name, and the sibling links and skill copies.
- **Defaults (Tier 3).** Whether a sentence is derivable from code, whether a fact has a second home, and whether undated narrative or a counter sits in a living doc.
- **Verify.** `bun run docs:check`.
- **Owner doc.** [The docs index](docs/README.md), with the `writing-for-agents`, `technical-writing` and `unslop` skills for the prose. Start from its [How to work](docs/README.md#how-to-work).

### Keep the blocks and the owner docs in step

When an owner doc's checklist gains, loses or renames a mechanism, change the block's "Enforced by" line in the same change.

## How to work

A rule below without a named mechanism is a Tier 3 default.

- Route every task through the matching skill. [The docs index](docs/README.md) lists all skills. The fixed pairings: all prose uses `unslop`; anything an agent consumes uses `writing-for-agents`; developer documentation uses `technical-writing`; types and validation use `typescript-best-practices`; a non-trivial defect uses `diagnosing-bugs`; open decisions with the owner use `grilling`; UI uses `werkflow-design`; Supabase uses `supabase-live-workflow`.
- Ask a short clarifying question before you code when scope, acceptance or an edge case is ambiguous. When business context is uncertain, ask the owner or leave a clear TODO; never invent strategy.
- Phase 1 feature work follows [the protocol](docs/plans/phase-1/protocol.md) and updates the roadmap and the affected feature spec in the same change. Mechanism: `docs:check` validates the roadmap and the slice records.
- Generated types (`lib/supabase/database.types.ts`) and live Supabase inspection outrank every description of the schema. Mechanism: `bun run types:check`.
- Preserve organization boundaries and intentional role differences (`admin`, `buero`, `employee`). Keep field-worker flows simple and mobile-friendly; favor defaults over configuration. Mechanism: virtue 3 for the boundaries.

## Language

- Everything a user sees is natural German with real umlauts and `ß`: labels, messages, tooltips, aria labels. Mechanism: `lib/conventions/german-copy.test.ts` for spelling, address, ellipsis and quotes.
- Code, identifiers, comments, commits and developer documents are English. Route names and database values keep the German domain terms of the codebase.
- Keep user-facing strings out of deep logic where practical.

Domain terms: `Auftrag` (work order), `Projekt` (contains several jobs), `Kunde`, `Mitarbeiter`, `Handwerker/in` (field-worker role label), `Organisation` (the company boundary), `Anfrage` (customer request, converted once into work), `Ansprechpartner` and `Einsatzort` (a customer's contact and work site), `Kalender`, `Einsatz` (dispatched work; `Mein Einsatz` is the worker's view), `Arbeitsvorlage`, `Arbeitsnachweis` (site evidence), `Übergabe` (office-reviewed handover), `Aufgaben` (the one task and approval list), `Qualifikationen`, `Anlage`, `Servicefall`, `Wartungsplan`, `Dokumente`, `Zeiterfassung`, `Zeitkonto`, `Perioden`, `Urlaub`, `Krankmeldung`, `Lager`, `geparkt` (intentionally unscheduled work), `buero` (office role between employee and admin). The owning feature spec defines each term.

## Tools, branches and releases

- Use Bun: `bun install`, `bun run <script>`, `bunx <tool>`. Keep `bun.lock`. Keep `package-lock.json` as is; add no other lockfile. Mechanism: `vercel.json` installs from the frozen `bun.lock`.
- On Windows, quote paths: the repository path has spaces and route folders have parentheses. Prefer Bash there.
- The infrastructure stack is settled ([decision 0001](docs/decisions/0001-infrastructure-stack.md)). Propose no provider migration without a superseding decision.
- Work on local `main`. There are no feature branches, pull requests or CI ([decision 0008](docs/decisions/0008-development-workflow.md)). Commit and push only when the owner asks; publish with `git push origin main:partner-preview`. `origin/main` is production and advances only on the owner's explicit release request. Mechanism: `.githooks/pre-push` for the gate.
- Schema changes follow [the migration rule](docs/technical/environments.md#the-migration-rule). Mechanism: `bun run migrations:check`, `bun run types:check`, `sql:security`.

## Brand

The `werkflow-design` skill owns the design language: tokens, the orange and purple rules, the logo per theme and the component canon.

## Business context

Tamay owns product and offer. John owns leads, marketing, sales and customer work. The business repository owns the [offer](../werkflow-business/docs/offer.md), the [avatar](../werkflow-business/docs/avatar.md), [acquisition](../werkflow-business/docs/acquisition.md) and the [beta partnership](../werkflow-business/docs/beta-partnership.md) with Willert Haustechnik. A business ambition never adds a feature, an entitlement or analytics by itself. Resolve scope changes with Tamay. Do not encode sales positioning into feature logic.

## Maintain this file

Change this file when the product direction or a virtue changes. `CLAUDE.md` imports it, and Codex reads it directly.
