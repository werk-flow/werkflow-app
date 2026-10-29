# WerkFlow docs

Start with `AGENTS.md`, then read only the entries whose condition applies. A task adds the **Current Product Baseline** of the spec it changes, and "How to work" and "Never" in each owner doc of a virtue it touches.

## Index

### Technical (`docs/technical/`)

- [architecture.md](technical/architecture.md): runtime shape, Supabase access, auth and organization context, deployment.
- [data-model.md](technical/data-model.md): tenant boundary, roles, concept ownership, history rules.
- [environments.md](technical/environments.md): Supabase, env files, R2, credentials, migrations, worktrees, new machines, releases.
- [security.md](technical/security.md): a new route handler, Server Action, table, privileged function, storage path or provider setting.
- [realtime-and-caching.md](technical/realtime-and-caching.md): cache tags, Realtime, list readers, freshness.
- [performance.md](technical/performance.md): daily journeys, lab tables, skeletons, faster flows.
- [document-storage-and-access.md](technical/document-storage-and-access.md): document bytes, signed URLs, storage paths, access classes, trash, versions.
- [code-quality.md](technical/code-quality.md): writing or reviewing code.
- [testing.md](technical/testing.md): verifying a change, a failed test, a release.
- [integrated-test-state.md](technical/integrated-test-state.md): seeding test state, fixture dates, stable browser steps.
- [coderabbit.md](technical/coderabbit.md): review levels, babysitting and merging a PR, review findings.
- [recovery-and-incidents.md](technical/recovery-and-incidents.md): something lost, leaked or down.
- [standards-audit.md](technical/standards-audit.md): rendered design acceptance, wave audits.
- [enforcement-ladder-backlog.md](technical/enforcement-ladder-backlog.md): planned Tier 1 and 2 conversions.

### Feature specifications (`docs/features/`)

Read the spec you change and the connected specs your change touches. Planned scope lives in `werk-flow/werkflow-planning`.

- [customers-and-crm.md](features/customers-and-crm.md): Kunden, contacts, sites, Anfragen.
- [jobs-and-projects.md](features/jobs-and-projects.md): Aufträge, Projekte, lifecycle, Arbeitsvorlagen, handovers.
- [calendar-and-resource-planning.md](features/calendar-and-resource-planning.md): Kalender, Plantafel, capacity, Parkplatz, dispatch.
- [employee-management.md](features/employee-management.md): Mitarbeiter, schedules, Urlaub, Krankmeldung, Qualifikationen.
- [time-tracking.md](features/time-tracking.md): Zeiterfassung, corrections, Zeitkonto, Perioden.
- [document-management.md](features/document-management.md): Dokumente, folders, versions, trash.
- [inventory.md](features/inventory.md): Lager, stock movements, job material.
- [service-and-maintenance.md](features/service-and-maintenance.md): Anlagen, Servicefälle, Wartungspläne.
- [commercial-and-finance.md](features/commercial-and-finance.md): prices, billable quantities, handover readiness.
- [ai-automations.md](features/ai-automations.md): the AI direction and its foundations.

### Product (`docs/product/`)

- [product-capability-map.md](product/product-capability-map.md): dependencies between feature areas.
- [user-flow-catalog.md](product/user-flow-catalog.md): flow ids that tests cite.

### Decision records (`docs/decisions/`)

- [0001](decisions/0001-infrastructure-stack.md): the infrastructure stack.
- [0002](decisions/0002-dispatch-revision-acknowledgement-identity.md): dispatch revision and acknowledgement identity.
- [0003](decisions/0003-dev-prod-environment-split.md): two Supabase projects, committed migrations.
- [0004](decisions/0004-documentation-structure.md): doc structure and word budgets.
- [0005](decisions/0005-enforcement-ladder.md): the three tiers.
- [0006](decisions/0006-testing-architecture.md): local test backend, cloud canary.
- [0007](decisions/0007-independent-test-groups.md): independent test groups.
- [0008](decisions/0008-development-workflow.md): release by push, superseded by 0009.
- [0009](decisions/0009-pull-requests-and-ci.md): a PR per task, `Check` as the gate.

## How to work

This section owns virtue 6.

### What a doc may contain

A doc holds intent and behavior per role, decisions and their reasons, rules with the path of their mechanism, procedures with exact commands, and limits the owner accepted.

It holds no schema, no list of files, handlers, functions or tests, no count or value a constant holds, no report id, build id or commit hash, and no dated narrative. The code, `lib/supabase/database.types.ts` and live Supabase inspection answer those. Point at them instead.

### Add, change and remove docs

- **Find the one home.** Route the subject through the index and `git grep` a key phrase. Change a statement where it stands; link to it elsewhere.
- **Change** the owning doc with the behavior. Behavior goes in the spec's **Current Product Baseline**, a system rule in its technical doc, a durable choice in a decision record.
- **Add** a doc only when no existing doc can hold the rule, with its index entry in the same change.
- **Remove** a sentence the code says, a rule that no longer holds, or a fact with another home.
- **Budget.** `lib/docs/doc-policy.ts` holds every word budget and exemption. Only the owner changes one. To fit new text, cut text.

### Never

- Add a status line or a review date. Git dates every change.
- Describe what you built file by file.
- Stack a new paragraph under the old one instead of rewriting it.
- Rewrite an accepted decision record.

### Verify your work

Run `bun run docs:check` after every docs edit. If you changed the checker, also run `bun run test:unit lib/docs`.

## Maintenance rules

`docs:check` checks that:

- every Markdown file under `docs/` has an index entry;
- relative links between docs, links from `AGENTS.md` and the skills, and `docs/` paths cited in code resolve, heading anchors included;
- an accepted decision record keeps its metadata block and grows only by sections under `## Amendment YYYY-MM-DD: <title>`;
- `.claude/skills` and `.agents/skills` are identical, except `coderabbit-review`, which Codex ships itself;
- word budgets hold.

No check sees a row of the [enforcement-ladder backlog](technical/enforcement-ladder-backlog.md) close. A release, and a change that lands a mechanism, checks every row against the code.

### Sibling repositories

`docs:check` reads the sibling clones of the [workspace setup](../../werkflow-business/docs/workflow.md#prepare-a-new-machine) beside the main checkout and never edits them. It checks links both ways, a link back from each sibling's `AGENTS.md`, and that each shared skill equals its werkflow-business copy. A missing clone fails once.
