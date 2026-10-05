# 0004 — Documentation Structure: Graph Discipline, Not A Knowledge Graph

- **Status:** accepted (2026-08-24) — implemented 2026-08-24
- **Date:** 2026-08-24
- **Owner:** Product owner (Tamay), approved phase by phase during the 2026-08-24 restructure session
- **Affects:** every file under `docs/`, the `.claude/` and `.agents/` skill mirrors, `AGENTS.md` routing, `bun run docs:check`, and the per-slice acceptance protocol
- **Amended 2026-09-03:** one document per slice. The separate per-slice implementation-plan files that eight Wave 1 and 2 slices had grown beside their records were folded into the records and deleted, because the overlap between a slice's plan and its record was never zero. The record now starts as the plan when a slice enters `in_progress` and closes as the acceptance record; `docs:check` rejects any per-slice file outside `plans/phase-1/slices/`. The same pass moved volatile counters out of living docs, normalized every status line to one shape per genre, and taught `docs:check` to verify status shape, link syntax, index prefixes, roadmap invariants, and catalog order.

## Context

By 2026-08-24 the repo carried roughly 36 docs and 149k words, all of it written to make agents work correctly on WerkFlow. The open question was whether to keep investing in markdown or move to a different retrieval model: a typed entity/relationship store queried before the model runs, or a restructure onto the Interpretable Context Methodology (ICM) conventions.

A full audit of the docs, skills, and context surfaces ran the same day and found eight concrete problems, none of which a new retrieval layer would have fixed:

1. **Factual staleness.** The roadmap header said "15 of 56" accepted above 16 listed rows; the Supabase skill (both mirrors) still claimed dev auto-pauses and that the connector cannot see dev, both contradicted by [environments.md](../technical/environments.md); the index tree was missing several files; [coderabbit.md](../technical/coderabbit.md) referenced the removed `.cursor/rules`.
2. **A god-file.** The 18.7k-word Phase 1 roadmap mixed three different change rates in one file: durable protocol, hot status, and immutable history. Partial reads produced the stale-counter class of bug.
3. **No canonical home for acceptance evidence.** Each slice's facts were restated in five to seven places (roadmap row, progress log, gate log, wave audit ledger, slice plan, testing doc, feature baselines).
4. **Link-everything tails.** "Related Docs" sections connected every feature to every feature, a near-complete graph whose edges carried no routing signal.
5. **Three link syntaxes** coexisted, nothing validated reachability, and some records were effectively orphaned.
6. **No lifecycle layering.** Closed ledgers sat beside living docs under three different closure conventions.
7. **Skills duplicated doc facts and drifted.** The Supabase skill was the proof.
8. **The nominal index was unmaintained** and unreferenced from `AGENTS.md`; the de-facto hub was the roadmap.

## Decision

No knowledge graph, and no restructure onto ICM conventions. Apply graph discipline to the markdown tree that already exists, and enforce it with a script.

The six rules that follow from that:

1. **One home per fact.** A changeable fact (project IDs, plan tiers, counters, acceptance evidence) lives in exactly one doc. Everything else links to it. Skills carry procedure and link to the doc that owns the facts.
2. **Typed, sparse links.** A link exists because a reader needs to follow it, not to show that a relationship exists.
3. **Stable IDs stay resolvable.** `P1-XX`, `GG-XX`, flow IDs, and ADR numbers are the node keys; a bare ID gets a real link on first mention in a doc.
4. **Lifecycle layering.** Every doc declares `living` (with a last-reviewed date) or `closed` (with a date and what it remains useful for), directly under its H1.
5. **Line-addressable records.** Split files that mix change rates, so a partial read cannot silently miss the part that moved.
6. **Machine-checked.** Discipline that lives only in prose decays. `bun run docs:check` is the enforcement.

## What was implemented

- `docs/plans/phase-1/` replaced the roadmap god-file: [roadmap.md](../plans/phase-1/roadmap.md) as the hot entry, [protocol.md](../plans/phase-1/protocol.md) for durable process, [gates.md](../plans/phase-1/gates.md), [coverage.md](../plans/phase-1/coverage.md), an append-only [log.md](../plans/phase-1/log.md), and `slices/*.md` as the canonical per-slice acceptance records. The old path is a pointer stub and every inbound reference was rewritten.
- Every doc carries a `Status:` header. [docs/README.md](../README.md) became the exhaustive annotated index with a read-when hint per file, and `AGENTS.md` routes through it instead of leaving agents to glob the tree.
- `bun run docs:check` (`scripts/check-docs.ts`) validates index coverage, relative-link resolution, status headers, and byte-sync between the `.claude/` and `.agents/` skill mirrors.
- Acceptance writes were narrowed to a fixed touch set: roadmap, the slice record, the log, the golden-gate log, and the wave audit doc. Log entries link slice records instead of restating their evidence.
- The CodeRabbit skill was renamed to `coderabbit-review` because its old frontmatter name shadowed the built-in `/code-review` command.

## Rejected alternatives

**A SQLite entity graph with a pre-prompt injection hook.** The mechanism is real and coherent: entities, relations, and aliases in three tables, identity as `uuid5(type:normalized_name)` so re-runs merge instead of duplicating, recursive SQL traversal, and roughly 400 tokens of retrieved facts injected before the model thinks. The evidence behind it is not. Every headline number comes from one three-hop question over eight to twelve short documents written by the graph's own builder and engineered to defeat keyword search. Against that sits a structural argument: a code repo already is a knowledge graph, where files are nodes, imports and references are typed edges, git history is the temporal metadata, and grep traverses it natively. A parallel entity store is a second source of truth that has to be kept in sync by hand, which is where the documented failures live: duplicate and fabricated entities, lexical seeding misses, and stale facts that never get superseded.

**An ICM restructure** (the methodology in arXiv:2603.16021). The tree already satisfies most of its invariants: one folder one job, a small routing entry file, one home per fact, templates over blank pages. Converting to its conventions would be churn without gain. The one genuinely novel piece, an agent-written system map plus a change-impact index, is parked below as a revisit trigger.

**RAG or vector search over the repo.** Anthropic removed vector search from Claude Code because agentic grep outperformed it by a wide margin, and Cursor, Windsurf, Cline, and Devin moved the same way. GraphRAG's demonstrated wins (arXiv:2404.16130) are global sensemaking questions over large unstructured corpora, never code navigation, and its entity extraction runs at 60 to 85 percent accuracy with three to five times the token cost.

**Auto-generated wiki-links and YAML frontmatter across every doc.** That is not a graph. It is more text for the model to read through.

**Writing more overview prose.** Two 2026 ablation studies say it does not pay. ETH Zurich (arXiv:2602.11988) found context files did not generally improve task success while adding over 20 percent inference cost, with repository-overview content specifically unhelpful and LLM-generated files sometimes harmful. The second (arXiv:2607.27250) found correctness unmoved but roughly 29 percent runtime and 17 percent token savings. Context files are an efficiency tool, not a correctness tool. Only concrete, non-inferable instructions reliably change behavior, and instruction-following degrades past roughly 150 to 200 total instructions, so a bloated `AGENTS.md` costs more than it buys.

## Consequences

- `bun run docs:check` is part of the definition of done for any change that touches `docs/`, not an optional cleanup step.
- Skills describe procedure. A skill that states a fact drifts from the doc that owns it, so it links instead.
- **Agent memory follows the same rule.** Per-agent memory stores (Claude Code, Codex) are not a place to restate repo facts. They rot silently because nothing validates them, and an agent that trusts a stale memory over a checked doc is worse off than one that read nothing. Memory holds only what the repo cannot: workstation quirks, harness configuration, and machine-local environment state. This record replaced one such memory file on 2026-08-25.
- Decision records are the one doc genre with no drift problem, because decisions are immutable and amendments are dated. Durable rationale belongs here rather than in a living overview doc.

## Revisit triggers

- Recurring cross-feature regressions, which would justify an ICM-style change-impact index ("touching time entries hits RLS, calendar realtime, these tests"). Only worth it if map maintenance joins the same-change definition of done, since an unmaintained map is worse than none.
- The docs corpus growing well past its current size, or a split into multiple repos, which is the point where a per-folder index stops being enough.
- Agents demonstrably failing multi-hop questions that grep plus the roadmap's reading protocol answers today.

## Amendment 2026-09-25: sibling ownership and bounded context

WerkFlow now has independent app, business and website repositories. Each AGENTS.md routes to the other owners; each CLAUDE.md imports its local AGENTS.md. Business facts and the Hormozi library live in werkflow-business. App offer/avatar/acquisition paths remain thin routes. The website owns page implementation. The parent Code folder has no Git repository or shared deployment. The business [workspace workflow](../../../werkflow-business/docs/workflow.md) owns synchronization and cross-repository maintenance. App engineering skills remain separate from the five business/website skill mirrors.

Use current feature contracts and narrowly selected technical references for implementation. Read a closed record for a specific decision or evidence question, not as a mandatory tour of all previous work. Documentation routing helps retrieval; it does not define a good screen or replace rendered review.

The earlier research rationale contains broad benchmark and tool-market claims. Treat them as dated rationale, not universal conclusions or an instruction-count limit. [Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988) reports worse average success and higher cost in its tested settings; it does not show that useful repository rules should be removed. [ICM](https://arxiv.org/abs/2603.16021) proposes filesystem context organization; it does not certify WerkFlow design quality. [Anthropic's context guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) supports selective retrieval and concrete examples. None proves that a folder restructure, graph database or paid community would repair this calendar. Evaluate any retrieval change on actual WerkFlow tasks before replacing the present structure.

## Amendment 2026-10-01: docs hold only what code cannot say, with a size budget

The owner decided this on 2026-10-01 and authorized restructuring the docs and earlier records.

Measured before the change: `docs/` held 447,000 words, three times the size this record names in its context. A routine task loaded between 26,000 and 76,000 words. About 63 percent of the standards audit was dated checkpoint narrative. The migration rule lived in five places and had drifted in two. The list of read-request handlers lived in three places, all different. The docs said "four" quality areas in one place and "six" in another. 38 of 47 rules in `AGENTS.md` named no mechanism. The incident log and the backlog sat on the default reading path. No rule covered removing a doc. `docs:check` verified form, not duplicates, counters or freshness.

Decided:

1. A doc never restates what the code or the database can say: schema, file inventories, handler lists, function names used as description, counts, current values. A doc holds intent, product decisions, rules, reasons, procedures, and a pointer to the mechanism that enforces a rule. [The docs index](../README.md#what-a-doc-may-contain) owns the rule and its examples.
2. Every fact has exactly one home. Dated incident narrative and evidence do not belong in a rule document. They live in closed records and in the incident log.
3. Six virtues define quality and live in `AGENTS.md`, each with its rules, its mechanisms by tier, its commands and its owner doc. The standards audit keeps only the two procedures the virtues refer to. An agent who finds a missing, wrong or outdated rule changes the virtue in the same change, so that separate audits become unnecessary.
4. Size budget: the required reading of a routine task stays under 10,000 words. That reading is `AGENTS.md`, the docs index, the Current Product Baseline of one feature spec and one technical doc. A living technical doc contains no dated narrative, no counters, no build ids and no report ids.
5. Removing is a normal edit. [The docs index](../README.md#add-change-and-remove-docs) owns the rules for adding, changing, closing and removing docs.
6. History leaves the reading path. Incident entries before 2026-09-25 moved to a closed archive. The backlog lists open candidates only. Finished hardening and pre-Wave-3 records are closed.

This amendment supersedes rule 1 of the original decision where that rule allowed counters and acceptance evidence as "changeable facts" inside living docs.

Enforcement. `docs:check` (`scripts/check-docs.ts`) is the Tier 2 mechanism. Beside links, index coverage, status lines, skill mirrors and record sections, it rejects a date in a living technical doc outside its status line (the incident log and closed docs are exempt, and a link target may name a dated heading), a living technical doc over 3,300 words, an `AGENTS.md` over 2,800 words, and a link or backticked docs path in `AGENTS.md` or a skill that resolves to nothing. `lib/docs/living-doc-rules.test.ts` tests the rules. Whether a sentence restates code, and whether a fact has a second home, stay Tier 3 judgments under virtue 6.

## Amendment 2026-10-03: "How to work" procedures and the word budget

The owner asked on 2026-10-03 that each virtue show an agent how to reach good work while it builds, not only what good work looks like afterwards. Agents had slowed the app and left the docs messier, and fixed half of what they built after the checks ran. Each virtue's owner doc therefore opens with a "How to work" section: one short procedure per recurring task, with the file to start from, the decisions in order, the fast check to run at each point and the wrong turn it prevents.

The procedures needed room that cuts could not give without removing rules. The owner's request is the reason the living technical doc budget rises from 3,300 to 4,000 words. Folding the old procedural sections of the Realtime doc into its procedures and merging the table-migration steps of the security checklist recovered part of the space. The `AGENTS.md` budget stays at 2,800 words.

Open conflict. The routine reading of rule 4 (`AGENTS.md`, the docs index, one Current Product Baseline and one technical doc) already exceeded 10,000 words for the larger specs before this change, and the new budget widens the gap. `docs:check` does not measure that sum. The owner decides whether the routine reading may exclude the parts of a technical doc a task does not touch, or whether the 10,000-word limit changes.

## Amendment 2026-10-03: routine reading by procedure

The owner resolved the open conflict above on 2026-10-03. The owner asked for procedures that steer the work, and those procedures made the owner docs longer on purpose. A word cap on the sum of whole docs would force out the procedures the owner asked for.

Decided:

1. Routine reading is `AGENTS.md` and the docs index in full. Each task adds the Current Product Baseline of the feature spec it changes and, for each virtue it touches, the "How to work" procedure and the "Checklist" and "Never" items of that virtue's owner doc. An agent reads the rest of an owner doc only when the task reaches it.
2. The 10,000-word limit on the routine reading of rule 4 is removed. No check could measure it per task, and a number that nothing measures decays. The per-doc budgets stay, and `docs:check` measures them.
3. A budget changes only by the owner's decision, recorded as a dated amendment to this record.

[The docs index](../README.md) owns the reading rule. This amendment supersedes the reading definition and the 10,000-word limit of rule 4 in the 2026-10-01 amendment.
