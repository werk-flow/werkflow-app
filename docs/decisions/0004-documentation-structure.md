# 0004 — Documentation Structure: Graph Discipline, Not A Knowledge Graph

- **Status:** accepted (2026-08-24) — implemented 2026-08-24
- **Date:** 2026-08-24
- **Owner:** Product owner (Tamay), approved phase by phase during the 2026-08-24 restructure session
- **Affects:** every file under `docs/`, the `.claude/` and `.agents/` skill mirrors, `AGENTS.md` routing, `bun run docs:check`, and the per-slice acceptance protocol
- **Amended 2026-09-03:** one document per slice. The separate per-slice implementation-plan files that eight Wave 1 and 2 slices had grown beside their records were folded into the records and deleted, because the overlap between a slice's plan and its record was never zero. The record now starts as the plan when a slice enters `in_progress` and closes as the acceptance record; `docs:check` rejects any per-slice file outside `plans/phase-1/slices/`. The same pass moved volatile counters out of living docs, normalized every status line to one shape per genre, and taught `docs:check` to verify status shape, link syntax, index prefixes, roadmap invariants, and catalog order.

## Context

By 2026-08-24 the repo carried roughly 36 docs and 149k words, all of it written to make agents work correctly on WerkFlow. The open question was whether to keep investing in markdown or move to a different retrieval model: a typed entity/relationship store queried before the model runs, or a restructure onto the Interpretable Context Methodology (ICM) conventions.

A full audit of the docs, skills, and context surfaces ran the same day and found eight concrete problems, none of which a new retrieval layer would have fixed:

1. **Factual staleness.** The roadmap header said "15 of 56" accepted above 16 listed rows; the Supabase skill (both mirrors) still claimed dev auto-pauses and that the connector cannot see dev, both contradicted by [environments.md](../technical/environments.md); the index tree was missing several files; `coderabbit.md` referenced the removed `.cursor/rules`.
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

- `docs/plans/phase-1/` replaced the roadmap god-file: [roadmap.md](../plans/phase-1/roadmap.md) as the hot entry, `protocol.md` for durable process, `gates.md`, `coverage.md`, an append-only `log.md`, and `slices/*.md` as the canonical per-slice acceptance records. The old path is a pointer stub and every inbound reference was rewritten.
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
