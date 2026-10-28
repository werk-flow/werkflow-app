# WerkFlow docs

This index routes a task to the few docs it needs. Start with `AGENTS.md`. Then read only the rows whose "read when" condition applies. Routine reading is `AGENTS.md` and this index in full. Each task adds the **Current Product Baseline** of the feature spec it changes. For each virtue the task touches, it adds the "How to work" procedure and the "Checklist" and "Never" items of that virtue's owner doc. Read the rest of an owner doc only when your task reaches it.

## What a doc may contain

A doc holds what the code and the database cannot say. The code, `lib/supabase/database.types.ts` and live Supabase inspection are the source for everything else.

| Belongs in a doc | Does not belong in a doc |
| --- | --- |
| Intent and product behavior: what a feature does for which role | A schema description: tables, columns, enum values |
| A decision and its reason | A list of files, components, route handlers, functions or test groups |
| A rule, and the mechanism that enforces it, named by its real path | A count ("177 tables", "1,406 tests") or a current value that a constant or config file holds |
| A procedure with its exact commands | A report id, a build id, a commit hash |
| A limit the owner accepted | Dated narrative: what happened when, who found what |

Examples. "The migration that creates a table grants explicitly; `sql:security` fails on an automatic grant" is a rule with its mechanism: keep it. "The GET handlers that use the read-request cache are a, b, c" is an inventory: delete it, the code is the list. "On September 12 the membership cache caused a stale cookie" is narrative: the rule that came out of it stays in the owner doc, and the story lives in Git or the incident log.

## Add, change and remove docs

- **Add** a doc only when a rule, decision or procedure has no home in the index below. Prefer a section in the owning doc. Give a new doc an index row in the same change, and no status line: Git dates every change.
- **Change** the owning doc in the same change as the behavior or rule it describes. A fact has one home. Other docs and skills link to it.
- **Remove** a sentence when the code says it, its rule no longer holds, or another doc owns it. Remove a doc when nothing in it passes the table above. Git keeps the old text.
- **Budget.** `docs:check` measures the word budget of each technical doc, `AGENTS.md`, this index and each skill file. `lib/docs/doc-policy.ts` is the one home of every budget and exemption. Change one only by the owner's decision. To fit new text, cut text that restates code.

## Index

### Technical (`docs/technical/`)

| Doc | Read when |
| --- | --- |
| [architecture.md](technical/architecture.md) | You need the runtime shape: app structure, Supabase access model, auth and organization context, deployment. |
| [data-model.md](technical/data-model.md) | You need the conceptual domain model: tenant boundary, roles, concept ownership, history rules. |
| [environments.md](technical/environments.md) | Anything touches Supabase, env files, R2, a credential, a migration, a worktree or a new machine: project identities, credentials, tool access, the migration rule. |
| [security.md](technical/security.md) | You add a route handler, Server Action, table, privileged function, storage path or provider setting: invariants, mechanisms and checks. |
| [realtime-and-caching.md](technical/realtime-and-caching.md) | You change a cache tag, a Realtime subscription, a list reader or freshness behavior. |
| [performance.md](technical/performance.md) | You add a step people repeat daily, read a lab table, change a skeleton, or make a flow faster: journeys, lab counts, payload budgets, layout stability. |
| [document-storage-and-access.md](technical/document-storage-and-access.md) | You touch document bytes, signed URLs, storage paths, access classes, trash or versions. |
| [code-quality.md](technical/code-quality.md) | You write or review code: the code-quality checklist, the deletion pass and the independent review. |
| [testing.md](technical/testing.md) | You implement or verify a change, investigate a failed test, or prepare a release. |
| [integrated-test-state.md](technical/integrated-test-state.md) | You seed a test's state, choose fixture dates, or keep a page stable during a browser step. |
| [coderabbit.md](technical/coderabbit.md) | You choose a PR's review level, babysit or merge a PR, handle a review finding or run a local review. |
| [recovery-and-incidents.md](technical/recovery-and-incidents.md) | Something is lost, leaked or down: backups, restore procedures, incident steps. |
| [standards-audit.md](technical/standards-audit.md) | You accept a rendered design or audit a wave. |
| [enforcement-ladder-backlog.md](technical/enforcement-ladder-backlog.md) | You plan a Tier 1 or Tier 2 conversion, or a finding needs a backlog row. Not part of routine reading. |
| [test-incident-log.md](technical/test-incident-log.md) | A browser failure needs its record, or you investigate a recorded failure. Not part of routine reading. |

### Feature specifications (`docs/features/`)

Read the spec of the feature you change, plus only the connected specs your change touches. Each spec holds a short goal and its **Current Product Baseline**: what exists, for which role, and its rules. Planned scope lives in `werk-flow/werkflow-planning`.

| Doc | Read when working on |
| --- | --- |
| [customers-and-crm.md](features/customers-and-crm.md) | Kunden, contacts, sites, Anfragen, relationship timeline, communication preferences. |
| [jobs-and-projects.md](features/jobs-and-projects.md) | Aufträge, Projekte, checklists, lifecycle states, Arbeitsvorlagen, handovers. |
| [calendar-and-resource-planning.md](features/calendar-and-resource-planning.md) | Kalender, Plantafel, planning occurrences, series, capacity, Parkplatz, dispatch. |
| [employee-management.md](features/employee-management.md) | Mitarbeiter, personnel records, schedules, responsibilities, Urlaub, Krankmeldung, Qualifikationen. |
| [time-tracking.md](features/time-tracking.md) | Zeiterfassung, clock events, breaks, targets, approvals, corrections, Perioden. |
| [document-management.md](features/document-management.md) | Dokumente, folders, versions, trash, audit. |
| [inventory.md](features/inventory.md) | Lager, catalog, locations, stock movements, job material. |
| [service-and-maintenance.md](features/service-and-maintenance.md) | Anlagen, Servicefälle, Wartungspläne. |
| [commercial-and-finance.md](features/commercial-and-finance.md) | Prices, billable quantities or handover readiness, and what the commercial loop does not do yet. |
| [ai-automations.md](features/ai-automations.md) | The AI direction and the Phase 1 foundations it builds on. |

### Product (`docs/product/`)

| Doc | Read when |
| --- | --- |
| [product-capability-map.md](product/product-capability-map.md) | You need the product-wide ownership map, handoff rules, Phase 1 completion criteria or decision gates. |
| [user-flow-catalog.md](product/user-flow-catalog.md) | You change user-visible behavior or its coverage: the German flow list with stable `P1-XX-FNN` ids. |
| [competitive-landscape.md](product/competitive-landscape.md) | A decision needs competitor context. Refresh volatile figures first. |
| [offer.md](product/offer.md) | Routing page to the business offer. |
| [acquisition.md](product/acquisition.md) | Routing page to the business acquisition context. |
| [avatar.md](product/avatar.md) | Routing page to commercial targeting and personas. |

### Decision records (`docs/decisions/`)

A decision record states why a durable choice was made. It is immutable once accepted and grows only by dated amendments ([maintenance rules](#maintenance-rules)).

| Doc | Decision |
| --- | --- |
| [0001-infrastructure-stack.md](decisions/0001-infrastructure-stack.md) | The stack: Supabase, Vercel, Cloudflare R2 EU, Railway deferred, AI through provider APIs. |
| [0002-dispatch-revision-acknowledgement-identity.md](decisions/0002-dispatch-revision-acknowledgement-identity.md) | The dispatch revision and acknowledgement identity model. |
| [0003-dev-prod-environment-split.md](decisions/0003-dev-prod-environment-split.md) | Two Supabase projects and committed migrations. |
| [0004-documentation-structure.md](decisions/0004-documentation-structure.md) | Why the docs look as they do: one home per fact, no restating of code, size budget, what agent memory may hold. |
| [0005-enforcement-ladder.md](decisions/0005-enforcement-ladder.md) | The three tiers: unwritable, checked, judgment. |
| [0006-testing-architecture.md](decisions/0006-testing-architecture.md) | Local backend for tests, cloud canary for providers. Decision 0007 supersedes its execution rules. |
| [0007-independent-test-groups.md](decisions/0007-independent-test-groups.md) | Independent test groups, selection by scope, repair mode, release mode; decision 0009 retires its publication gate. |
| [0008-development-workflow.md](decisions/0008-development-workflow.md) | Local `main`, local gates, partner preview on DEV, release by pushing `main`. Decision 0009 supersedes it. |
| [0009-pull-requests-and-ci.md](decisions/0009-pull-requests-and-ci.md) | A worktree, a branch and a PR per task; CI's `Check` as the gate; `main` as staging on DEV; `production` released by the owner's workflow. |

## Skills

Skills live in `.claude/skills/` and are mirrored byte for byte in `.agents/skills/` (`docs:check` fails on a difference). `coderabbit-review` exists only under `.claude`, because Codex ships its own. Load a skill at the start of the matching task.

| Skill | Load when |
| --- | --- |
| `unslop` | Always, for every piece of prose. |
| `writing-for-agents` | You write anything an agent consumes: a skill, a prompt, `AGENTS.md`, a routing doc. |
| `technical-writing` | You write or review developer documentation, decision records, plans or commit messages. |
| `werkflow-design` | Any UI work. The design language and the component registry. |
| `typescript-best-practices` | You design types, validation boundaries or non-trivial logic. |
| `diagnosing-bugs` | A non-trivial defect or performance regression needs diagnosis. |
| `grilling` | You resolve open product or design decisions with the owner. |
| `supabase-live-workflow` | Any Supabase work: schema, SQL, RLS, storage, edge functions, migrations, generated types. |
| `coderabbit-review` | The owner asks for a CodeRabbit review or a fix-and-review cycle. |
| `sol-loop` | The owner says "sol loop", or a level 1 or 2 PR needs review. |
| `full-send`, `full-stop` | The owner says "full send" or "full stop". |
| `file-pr` | You open a PR. |
| `leaving-pr-comments` | You comment on GitHub. |

## Maintenance rules

Run `bun run docs:check` after every docs change. It checks the index, the links, the decision records, the budgets and the sibling repositories.

1. **Index.** Every Markdown file under `docs/` has a row above, except this index.
2. **Links.** A reference between docs is a relative markdown link, so the check resolves it and its heading anchor. Backticked paths are for code and config files. Links in `AGENTS.md` and the skills name files that exist. A `docs/` path that code cites resolves to a doc and heading.
3. **Where a doc goes.** `technical/` holds system rules. `features/` holds product behavior. `product/` holds capability, flow and market context. `decisions/` holds numbered decision records.
4. **Decision records.** An accepted record keeps its metadata block and changes only by a section appended at its end under `## Amendment YYYY-MM-DD: <title>`. The check fails while the committed or the published text is not a prefix of the current text.
5. **Backlog audit.** No check sees a gap in the [enforcement-ladder backlog](technical/enforcement-ladder-backlog.md) close. A release, and a change that lands a mechanism, checks every row against its code and deletes or corrects a stale one.

### Sibling repositories

`docs:check` reads the sibling clones of the [workspace setup](../../werkflow-business/docs/workflow.md#prepare-a-new-machine) and never edits them. It looks for them beside the main checkout, so a worktree may sit in any folder. It checks links in both directions, a link back from each sibling's `AGENTS.md`, and that every copy of a shared skill equals its canonical copy in werkflow-business. A missing clone fails once, with the number of links it left unchecked.

`docs:check` cannot judge meaning. Whether a sentence restates code, has a second home or carries history is review under virtue 6.

## How to work

### Decide whether a sentence belongs in a doc

1. Ask whether the code, the generated types or a command answers it. If one does, write nothing, or point at the file.
2. Check the sentence against [what a doc may contain](#what-a-doc-may-contain).

Wrong turn: describing what you built, file by file. The code already says it, and the description goes stale with the next change.

### Find the one home

1. Route the subject through the index above to its owning doc, and `git grep` a key phrase to find an existing statement.
2. If a statement exists, change it there and link to it from elsewhere.
3. Put product behavior into the spec's **Current Product Baseline**, a system rule into its technical doc and a durable choice into a decision record. Leave history to Git.

Wrong turn: a new section or a new doc for one change. The fact gets a second home, and the two drift.

### Change the doc with the behavior

1. Edit the owning doc in the same change as the code, and name the mechanism of every new rule.
2. For each sentence you add, delete or shrink one in the same doc that restates code, holds history or has another home.
3. Run `bun run docs:check` after each docs edit.

Wrong turn: a new paragraph under the old one. The doc grows a layer per change until nobody finds the current rule.

## Checklist

This page owns virtue 6 in `AGENTS.md`. A `[judgment]` item is a Tier 3 default: [how to read the virtues](../AGENTS.md#how-to-read-the-virtues) says how to diverge.

- Every sentence holds what the code and the database cannot say. [judgment]
- Each fact has one home; other docs and skills link to it. [judgment]
- The owning doc changes in the same change as the behavior it describes. [judgment]
- Every doc under `docs/` has an index row. [script `docs:check`, test `lib/docs/doc-index.test.ts`]
- Links between docs resolve with their heading anchors. [script `docs:check`, test `lib/docs/doc-links.test.ts`, test `lib/docs/heading-anchors.test.ts`]
- Links from `AGENTS.md` and the skills name files that exist. [script `docs:check`, test `lib/docs/living-doc-rules.test.ts`]
- A `docs/` path that a code comment, a lint message or a thrown string cites resolves. [script `docs:check`, test `lib/docs/code-citations.test.ts`]
- A decision record grows only by dated amendments. [script `docs:check`, test `lib/docs/decision-records.test.ts`]
- The `.claude` and `.agents` skill trees are byte-identical, except `coderabbit-review`. [script `docs:check`, test `lib/docs/skill-mirror.test.ts`]
- Links to and from the sibling repositories resolve, and each shared skill equals its canonical copy. [script `docs:check`, test `lib/docs/workspace-links.test.ts`]
- Technical docs, `AGENTS.md`, this index and every skill file stay within their word budgets. [script `docs:check`, test `lib/docs/doc-policy.test.ts`]
- Prose follows `unslop`, and `technical-writing` or `writing-for-agents` for its genre. [judgment]
- A divergence from a Tier 3 default is recorded where `AGENTS.md` says. [judgment]

## Never

- The prohibitions of virtue 6 in `AGENTS.md`, which owns their wording. [judgment]
- Add a status line or a review date to a doc. [judgment]
- Change a word budget or an exemption without the owner's decision. [judgment]
- Rewrite an accepted decision record in place. [script `docs:check`, test `lib/docs/decision-records.test.ts`]

## Verify your work

1. Run `bun run docs:check`. A pass prints `docs:check passed`.
2. If you changed the checker, run `bun run test:unit lib/docs` and `bun run lint`.
3. Read each changed sentence against [what a doc may contain](#what-a-doc-may-contain). Delete a sentence that restates code, carries history or has another home.
4. Record a judgment call where `AGENTS.md` says.

## Examples

- [technical/security.md](technical/security.md): invariants and rules, each with the mechanism and the check that fails on a regression, and no inventory of handlers.
- [decisions/0005-enforcement-ladder.md](decisions/0005-enforcement-ladder.md): a decision with its reason, amended by dated sections instead of rewritten.
- [technical/environments.md](technical/environments.md): the migration rule lives here once, and the skills and decisions link to it.
