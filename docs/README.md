# WerkFlow docs

Status: living — last reviewed 2026-10-08; update this index when you add, move, close or remove a doc

This index routes a task to the few docs it needs. Start with `AGENTS.md`. Then read only the rows whose "read when" condition applies. Routine reading is `AGENTS.md` and this index in full. Each task adds the **Current Product Baseline** of the feature spec it changes. For each virtue the task touches, it adds the "How to work" procedure and the "Checklist" and "Never" items of that virtue's owner doc. Read the rest of an owner doc, and a spec's planned-scope sections, only when your task reaches them.

## What a doc may contain

A doc holds what the code and the database cannot say. The code, `lib/supabase/database.types.ts` and live Supabase inspection are the source for everything else.

| Belongs in a doc | Does not belong in a doc |
| --- | --- |
| Intent and product behavior: what a feature does for which role | A schema description: tables, columns, enum values |
| A decision and its reason | A list of files, components, route handlers, functions or test groups |
| A rule, and the mechanism that enforces it, named by its real path | A count ("177 tables", "1,406 tests") or a current value that a constant or config file holds |
| A procedure with its exact commands | A report id, a build id, a commit hash |
| A limit the owner accepted | Dated narrative: what happened when, who found what |

Examples. "The migration that creates a table grants explicitly; `sql:security` fails on an automatic grant" is a rule with its mechanism: keep it. "The GET handlers that use the read-request cache are a, b, c" is an inventory: delete it, the code is the list. "On September 12 the membership cache caused a stale cookie" is narrative: the rule that came out of it stays in the owner doc, and the story lives in a closed record or the incident log.

## Add, change and remove docs

- **Add** a doc only when a rule, decision or procedure has no home in the index below. Prefer a section in the owning doc. A new doc gets a status line and an index row in the same change.
- **Change** the owning doc in the same change as the behavior or rule it describes. A fact has one home. Other docs and skills link to it and do not repeat it.
- **Remove** a sentence when it is derivable from code, when its rule no longer holds, or when another doc owns it. Remove a whole doc when nothing in it passes the table above. Deleting is a normal edit, and Git keeps the old text.
- **Close** a plan or record when its work has ended. Before it closes, move every fact a later agent needs into its living home and list the homes under `## Durable homes`. Nobody opens a closed record unprompted.
- **Delete** a closed record once nothing requires it: no living doc or check needs its acceptance evidence, and no fact in it still constrains future work. Slice records and decision records stay. Git keeps everything else.
- **Budget.** Routine reading stays small because a task reads the procedures and items it touches, not whole owner docs. `docs:check` measures the word budget of each living technical doc and of `AGENTS.md`. Feature specs, product docs and plans have no budget: a task reads a spec's Current Product Baseline and only the planned sections it reaches. A budget changes only by the owner's decision, recorded as an amendment to [decision 0004](decisions/0004-documentation-structure.md). A living technical doc states rules as they are now: no dates outside its status line, no counters, no build or report ids. The decision records the reasons.

## Index

### Technical (`docs/technical/`)

| Doc | Read when |
| --- | --- |
| [architecture.md](technical/architecture.md) | You need the runtime shape: app structure, Supabase access model, auth and organization context, deployment. |
| [data-model.md](technical/data-model.md) | You need the conceptual domain model: tenant boundary, roles, concept ownership, history rules. |
| [environments.md](technical/environments.md) | Anything touches Supabase, env files, R2, a migration or a new machine: project identities, tool access, the migration rule. |
| [security.md](technical/security.md) | You add a route handler, Server Action, table, privileged function, storage path or provider setting: invariants, mechanisms and checks. |
| [realtime-and-caching.md](technical/realtime-and-caching.md) | You change a cache tag, a Realtime subscription, a list reader or freshness behavior. |
| [performance.md](technical/performance.md) | You add a step people repeat daily, read a lab table, change a skeleton, or make a flow faster: journeys, lab counts, payload budgets, layout stability. |
| [document-storage-and-access.md](technical/document-storage-and-access.md) | You touch document bytes, signed URLs, storage paths, access classes, trash or versions. |
| [code-quality.md](technical/code-quality.md) | You write or review code: the code-quality checklist, the deletion pass and the independent review. |
| [testing.md](technical/testing.md) | You implement or verify a change, investigate a failed test, or prepare a release. |
| [integrated-test-state.md](technical/integrated-test-state.md) | You seed a test's state, choose fixture dates, or keep a page stable during a browser step. |
| [coderabbit.md](technical/coderabbit.md) | You run a review or record its dispositions. |
| [recovery-and-incidents.md](technical/recovery-and-incidents.md) | Something is lost, leaked or down: backups, restore procedures, incident steps. |
| [standards-audit.md](technical/standards-audit.md) | You accept a rendered design or audit a wave. |
| [enforcement-ladder-backlog.md](technical/enforcement-ladder-backlog.md) | You plan a Tier 1 or Tier 2 conversion, or a finding needs a backlog row. Not part of routine reading. |
| [test-incident-log.md](technical/test-incident-log.md) | A browser failure needs its record, or you investigate a failure from 2026-09-25 on. Not part of routine reading. |

### Feature specifications (`docs/features/`)

Read the spec of the feature you change, plus only the connected specs its slice names. Each spec separates **Current Product Baseline** (implemented) from planned scope.

| Doc | Read when working on |
| --- | --- |
| [customers-and-crm.md](features/customers-and-crm.md) | Kunden, contacts, sites, Anfragen, relationship timeline, communication preferences. |
| [jobs-and-projects.md](features/jobs-and-projects.md) | Aufträge, Projekte, checklists, lifecycle states, Arbeitsvorlagen, handovers. |
| [calendar-and-resource-planning.md](features/calendar-and-resource-planning.md) | Kalender, Plantafel, planning occurrences, series, capacity, Parkplatz, dispatch. |
| [employee-management.md](features/employee-management.md) | Mitarbeiter, personnel records, schedules, responsibilities, Urlaub, Krankmeldung, Qualifikationen. |
| [time-tracking.md](features/time-tracking.md) | Zeiterfassung, clock events, breaks, targets, approvals, corrections, Perioden. |
| [document-management.md](features/document-management.md) | Dokumente, folders, versions, trash, audit. |
| [inventory.md](features/inventory.md) | Lager, catalog, locations, stock movements, job material. |
| [service-and-maintenance.md](features/service-and-maintenance.md) | Anlagen, Servicefälle, Wartungspläne, and the planned contract and on-call scope. |
| [commercial-and-finance.md](features/commercial-and-finance.md) | The planned commercial loop: offers, invoices, payments, accounting handoffs. |
| [ai-automations.md](features/ai-automations.md) | Phase 2 AI direction and the Phase 1 foundations it needs. |

### Product (`docs/product/`)

| Doc | Read when |
| --- | --- |
| [product-capability-map.md](product/product-capability-map.md) | You need the product-wide ownership map, handoff rules, Phase 1 completion criteria or decision gates. |
| [user-flow-catalog.md](product/user-flow-catalog.md) | You touch slice acceptance or coverage: the German flow list with stable `P1-XX-FNN` ids. |
| [competitive-landscape.md](product/competitive-landscape.md) | A decision needs competitor context. Refresh volatile figures first. |
| [offer.md](product/offer.md) | Routing page to the business offer. |
| [acquisition.md](product/acquisition.md) | Routing page to the business acquisition context. |
| [avatar.md](product/avatar.md) | Routing page to commercial targeting and personas. |

### Plans (`docs/plans/phase-1/`)

| Doc | Read when |
| --- | --- |
| [roadmap.md](plans/phase-1/roadmap.md) | Any Phase 1 task: current checkpoint, slice rows, dependencies. |
| [protocol.md](plans/phase-1/protocol.md) | You start, verify or accept a slice. |
| [gates.md](plans/phase-1/gates.md) | You run or extend a golden gate. |
| [coverage.md](plans/phase-1/coverage.md) | You need slice-to-feature routing. |
| [log.md](plans/phase-1/log.md) | You append a progress entry. History. |
| phase-1/slices/ | You work on one slice. One document per slice: its plan while in progress, its acceptance record afterwards. The roadmap links each record. |
| [golden-gate-log.md](plans/phase-1/audits/golden-gate-log.md) | You record a gate run. History. |
| [wave-2-audit.md](plans/phase-1/audits/wave-2-audit.md) | Living — the Wave 2 coverage ledger and its wave-end certification gate. |

Closed record. Open it only to investigate a named decision or claim: [Wave 3, Wave 4 and Phase 2 planning](plans/phase-1/pre-wave-3/04-wave-3-4-and-phase-2-planning.md) holds the research and reasoning behind the Wave 3 and Wave 4 owner decisions and the expert-review agenda that blocks `P1-39` to `P1-43`.

### Decision records (`docs/decisions/`)

A decision record states why a durable choice was made. It is immutable once accepted. Amendments are dated.

| Doc | Decision |
| --- | --- |
| [0001-infrastructure-stack.md](decisions/0001-infrastructure-stack.md) | The stack: Supabase, Vercel, Cloudflare R2 EU, Railway deferred, AI through provider APIs. |
| [0002-dispatch-revision-acknowledgement-identity.md](decisions/0002-dispatch-revision-acknowledgement-identity.md) | The dispatch revision and acknowledgement identity model. |
| [0003-dev-prod-environment-split.md](decisions/0003-dev-prod-environment-split.md) | Two Supabase projects and committed migrations. |
| [0004-documentation-structure.md](decisions/0004-documentation-structure.md) | Why the docs look as they do: one home per fact, no restating of code, size budget, what agent memory may hold. |
| [0005-enforcement-ladder.md](decisions/0005-enforcement-ladder.md) | The three tiers: unwritable, checked, judgment. |
| [0006-testing-architecture.md](decisions/0006-testing-architecture.md) | Local backend for tests, cloud canary for providers. Decision 0007 supersedes its execution rules. |
| [0007-independent-test-groups.md](decisions/0007-independent-test-groups.md) | Independent test groups, selection by scope, repair mode, release mode, the publication gate. |
| [0008-development-workflow.md](decisions/0008-development-workflow.md) | Local `main`, local gates, partner preview on DEV, release by pushing `main`. |

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

## Maintenance rules

`bun run docs:check` enforces the mechanical part of these rules. Run it after every docs change.

1. **Status line.** Line 3 of every doc, under the H1 and one blank line, is its status. A living doc uses `Status: living — last reviewed YYYY-MM-DD`, optionally followed by `; <clause>`. A closed doc uses `Status: closed (YYYY-MM-DD) — <what it remains useful for>`. A decision record uses its metadata block that starts with `- **Status:** accepted (YYYY-MM-DD)`.
2. **One home per fact.** See "Add, change and remove docs" above.
3. **Link syntax.** A reference from one doc to another inside `docs/` is a relative markdown link, so that the check can resolve it. Backtick paths are for code and config files and for references from outside `docs/`. A bare id ("decision 0002") carries a link on its first mention in a doc.
4. **The index is exhaustive.** Every Markdown file under `docs/` has a row above, except this index and the slice records, which the roadmap links.
5. **Where a doc goes.** `technical/` holds system rules. `features/` holds product behavior. `product/` holds capability, flow and market context. `plans/phase-1/` holds sequencing, with one document per slice under `slices/` and cross-slice records in `audits/` and `pre-wave-3/`. `decisions/` holds numbered decision records.
6. **A closed record is history.** A slice record or a cross-slice record is read again only when someone is sent there. A bare "see the record" pointer is not a home: the living doc states the substance. `docs:check` rejects a record closed from 2026-09-17 on without a `## Durable homes` section.
7. **Sibling repositories.** `docs:check` needs the sibling clones of the [workspace setup](../../werkflow-business/docs/workflow.md#prepare-a-new-machine). It reads them and never edits them. A missing clone fails the check once, with the number of links it left unchecked.

`docs:check` cannot judge meaning. Whether a sentence is derivable from code, whether a fact has a second home, and whether a living doc carries history are review judgments under virtue 6 in `AGENTS.md`.

## How to work

### Decide whether a sentence belongs in a doc

1. Ask whether the code, the generated types or a command answers it. If one does, write nothing, or point at the file.
2. Check the sentence against [what a doc may contain](#what-a-doc-may-contain).

Wrong turn: describing what you built, file by file. The code already says it, and the description goes stale with the next change.

### Find the one home

1. Route the subject through the index above to its owning doc, and `git grep` a key phrase to find an existing statement.
2. If a statement exists, change it there and link to it from elsewhere.
3. Put product behavior into the spec's **Current Product Baseline**, a system rule into its technical doc, a durable choice into a decision record, and history into the slice record or the incident log.

Wrong turn: a new section or a new doc for one change. The fact gets a second home, and the two drift.

### Change the doc with the behavior

1. Edit the owning doc in the same change as the code, and name the mechanism of every new rule.
2. For each sentence you add, delete or shrink one in the same doc that restates code, holds history or has another home.
3. Run `bun run docs:check` after each docs edit.

Wrong turn: a new paragraph under the old one. The doc grows a layer per change until nobody finds the current rule.

## Checklist

This page owns virtue 6 in `AGENTS.md`. The tag after each item names its mechanism. A `[judgment]` item is a Tier 3 default: diverge only with the note that `AGENTS.md` describes under "How to read the virtues".

- Every sentence holds something the code and the database cannot say: intent, a decision, a rule with its mechanism, a procedure, or an accepted limit. [judgment]
- Each fact has one home. Other docs and skills link to it. [judgment]
- The owning doc changes in the same change as the behavior or rule it describes. [judgment]
- Every doc under `docs/` has its status line on line 3 in its genre's shape (maintenance rule 1). [script `docs:check`]
- Every doc has an index row on this page (maintenance rule 4). [script `docs:check`]
- A reference between docs is a relative markdown link that resolves, including its heading anchor (maintenance rule 3). [script `docs:check`, test `lib/docs/heading-anchors.test.ts`]
- `AGENTS.md` and the skills link only to files that exist. [script `docs:check`, test `lib/docs/living-doc-rules.test.ts`]
- A `docs/` path that a code comment, a lint message or a thrown string cites names a document and heading that exist. Applied migrations are exempt. [script `docs:check`, test `lib/docs/code-citations.test.ts`]
- A living technical doc carries no date outside its status line and stays at or under 4,000 words. `AGENTS.md` stays at or under 2,800 words. [script `docs:check`, test `lib/docs/living-doc-rules.test.ts`]
- Each virtue's owner doc carries "How to work", "Checklist", "Never", "Verify your work" and "Examples", each with at least one list item. Every checklist and "Never" item ends with a mechanism tag that names something real. Every custom lint rule, every selector set in `eslint.config.mjs` and every test under `lib/conventions/`, `lib/ui/` and `lib/security/`, and every rule test under `lib/testing/`, is named by `AGENTS.md` or an owner doc. [test `lib/docs/virtue-standards.test.ts`]
- The "Enforced by" lines of `AGENTS.md` name paths, lint rules, groups and scripts that exist. [test `lib/docs/virtue-standards.test.ts`]
- A slice has one document, under `slices/`. [test `lib/docs/slice-records.test.ts`]
- A closed slice record carries its deletion pass and review, and a closed plan record names its durable homes. [script `docs:check`]
- The roadmap counter, the ready set and the record links agree, and the flow catalog's ids are unique and sequential. [script `docs:check`]
- A roadmap row uses a status of the protocol's status model, and every accepted slice has its entry in the progress log. [script `docs:check`, test `lib/docs/roadmap-rules.test.ts`]
- A feature spec's status line is dated on or after the acceptance of every slice that names it as primary spec. The date lives only in the status line. [script `docs:check`, test `lib/docs/roadmap-rules.test.ts`]
- Every closed record opens with the fixed history banner under its status line, so an agent does not carry out an old instruction. [script `docs:check`, test `lib/docs/closed-records.test.ts`]
- In living docs, `AGENTS.md` and the skills, a backticked route handler names a folder under `app/api/`, and a repository path in a skill resolves. [script `docs:check`, test `lib/docs/reference-rules.test.ts`]
- Every incident-log entry names the tier where its prevention landed. [script `docs:check`]
- In living docs, `AGENTS.md` and the skills, a German quotation that opens with „ closes with “. [script `docs:check`, test `lib/docs/living-doc-rules.test.ts`]
- Links between the app and its sibling clones resolve in both directions, each sibling's `AGENTS.md` links back to the app's, and every copy of a shared skill equals its canonical copy in the business repository. [script `docs:check`, test `lib/docs/workspace-links.test.ts`]
- The `.claude` and `.agents` skill trees are byte-identical, except `coderabbit-review`. [script `docs:check`]
- Agent-facing instructions route CodeRabbit through `bun run review`. [test `lib/testing/publication/coderabbit-review-command.test.ts`]
- Prose follows the `unslop` skill, and the `technical-writing` or `writing-for-agents` skill for its genre. [judgment]
- A divergence from a Tier 3 default is recorded where `AGENTS.md` says. [judgment]

## Never

- Restate a schema, a file list, a handler list, a function inventory, a count or a current value. [judgment]
- Write dated narrative, report ids or build ids into a living doc. [test `lib/docs/living-doc-rules.test.ts`, judgment]
- Copy a rule into a second doc. [judgment]
- Reference a doc inside `docs/` by a backticked path instead of a link. [script `docs:check`]
- Cite a rule by a number ("testing rule" with a number) in a living doc, a skill or code. Only this index numbers its rules; link the heading that states the rule. [script `docs:check`, test `lib/docs/reference-rules.test.ts`]
- Change a word budget without the owner's decision recorded as an amendment to [decision 0004](decisions/0004-documentation-structure.md). To fit new text, cut text that restates code. [judgment]
- Create a report or summary file that nobody asked for. [judgment]
- Store repository facts in agent memory. [judgment]

## Verify your work

1. Run `bun run docs:check`. A pass prints `docs:check passed` with the number of docs.
2. If you changed the checker, run `bun run test:unit lib/docs` and lint `scripts/check-docs.ts` and `lib/docs` with ESLint.
3. Read each changed sentence against "What a doc may contain" above. Delete a sentence that restates code, carries history or has another home.
4. Record a judgment call (a kept sentence you were unsure about, a divergence from a default) in the slice record, or in the commit message outside a slice.

## Examples

- `docs/technical/security.md`: invariants and rules, each with the mechanism and the check that fails on a regression, and no inventory of handlers.
- `docs/decisions/0005-enforcement-ladder.md`: a decision with its reason, amended by dated sections instead of rewritten.
- `docs/technical/environments.md`: the migration rule lives here once, and the skills and decisions link to it.
