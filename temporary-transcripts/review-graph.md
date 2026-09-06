# Context architecture considerations

Reviewed on 2026-09-06. These sources concern developer context management, with cost and security overlaps. Statuses follow [README.md](README.md). The two August research notes are historical source material and contain their own stale claims; their draft recommendations do not govern current work.

## GRAPH-001

Source: [Folders as architecture](ai-graph-and-folder-structure/2026-06-15-folder-structure-as-agent-architecture.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | documentation | Candidate | Use clear folder ownership, Markdown, optional structured metadata, and explicit routing where they help agents find the actual source of truth. |
| 02 | evidence-quality | Verify | The named 21-page research, Google comparison, hundreds of workspaces, and efficiency claims need primary-method evidence before adoption. |
| 03 | evidence-quality | Not applicable | The caption retracts a literal theft allegation. Collaboration requests, audience size, and Unix-history framing do not establish technical superiority. |
| 04 | developer-tools | Deferred | Explore the researchers' tools only if current retrieval fails on a measured task. |

## GRAPH-002

Source: [API cost control](ai-graph-and-folder-structure/2026-08-12-api-cost-control-behind-a-public-tool.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | cost-controls | Candidate | Inspect provider spend controls and request limits independently of whether context retrieval is efficient. |
| 02 | ai-security | Deferred | A shared paid API key behind many users needs per-user/tenant attribution and quotas before product AI release. |
| 03 | documentation | Deferred | Structured datasets and fewer unnecessary agent calls may reduce repeated work; benchmark a concrete retrieval task before adding machinery. |
| 04 | evidence-quality | Verify | 484M tokens, $30/day, user counts, 90–96% savings, unchanged accuracy, and compounded savings need model/token/cache accounting and original evaluations. |

## GRAPH-003

Source: [Wiki links versus graphs](ai-graph-and-folder-structure/2026-08-15-obsidian-and-graphify-are-not-a-graph.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | documentation | Candidate | Distinguish useful file links from an explicitly modeled entity/relationship store with traversal. Names do not prove retrieval quality. |
| 02 | architecture | Deferred | Ontology, logical constraints, identities, and multi-hop queries need a concrete retrieval problem before adding a graph. |
| 03 | maintainability | Candidate | Automatically generated YAML and links can drift; enforce source ownership and resolve contradictions where current docs use structured metadata. |
| 04 | evidence-quality | Verify | Obsidian/Graphify behavior, fifteen-year expertise, model/context-cost claims, and claims about researchers lacking practical tests need actual sources. |
| 05 | product-scope | Not applicable | Personal disagreements and invitations to contact a creator do not justify adopting graph infrastructure. |

## GRAPH-004

Source: [Graph implementation demonstration](ai-graph-and-folder-structure/2026-08-16-implementing-a-real-knowledge-graph.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | architecture | Deferred | A modeled, deterministically retrieved context store is a possible solution only after a demonstrated multi-hop retrieval need. |
| 02 | agent-security | Candidate | Any automatic prompt hook must preserve source trust and distinguish retrieved content from higher-priority instructions. |
| 03 | evidence-quality | Verify | Two milliseconds, near-zero tokens, infinite scaling, and weak-model parity are demo claims. Retrieval time is not full response cost or general correctness. |
| 04 | developer-tools | Deferred | Inspect the promised artifact/repo/evals if evaluating this approach; their presence in a caption is not permission to install or run them. |
| 05 | evidence-quality | Not applicable | The creator's implementation tiers do not map to WerkFlow's enforcement tiers. |

## GRAPH-005

Source: [Graph versus no-graph demonstration](ai-graph-and-folder-structure/2026-08-16-knowledge-graph-made-haiku-match-fable.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | architecture | Deferred | Refund amount → required role → person → dated absence → cover illustrates temporal relationship retrieval. Equivalent business reasoning must remain grounded in authoritative records. |
| 02 | security-tests | Deferred | Compare identical questions, decoys, cleared contexts, retrieval and generation costs, and baseline routing before judging a graph experiment. One crafted question cannot establish model parity. |
| 03 | agent-security | Candidate | A UserPromptSubmit hook can preselect data outside the model, but still needs safe scope, freshness, provenance, and authority handling. |
| 04 | evidence-quality | Verify | Eight facts, 2 ms versus 20 s/4,000 tokens, zero tool calls, and Fable/Haiku comparisons require original reproducible evidence. The transcript alternates 2 ms/2 seconds and pounds/dollars. |
| 05 | developer-tools | Verify | Current Codex/Claude hook support and compatibility need current product docs, not this video's assertion. |
| 06 | architecture | Deferred | Pull-versus-push, ontology, logical model, setup, and eval guidance are evaluation inputs if the retrieval need appears. |
| 07 | source-completeness | Verify | Auto-caption errors and unavailable original audio/screens prevent exact reproduction of the demonstrated configuration from this file alone. |

## GRAPH-006

Source: [When folders win](ai-graph-and-folder-structure/2026-08-17-when-folders-and-keyword-search-win.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | documentation | Candidate | Maintain folder ownership, useful indexes, sparse links, and current content before adding a new retrieval store. |
| 02 | architecture | Deferred | Semantic retrieval needs a question that keyword/index routing cannot answer efficiently; graph modeling has additional cost and identity maintenance. |
| 03 | architecture | Deferred | Embedding likely questions alongside entries is an experiment for a real semantic retrieval need, not a current repo requirement. |
| 04 | performance | Deferred | Compare embedding models and reranking against a representative evaluation set if RAG is adopted. A smaller model can only be chosen on measured outcomes. |
| 05 | evidence-quality | Verify | Claims about every frontier lab, Cerebras's 15,000 daily questions, 3.1x improvement, universal graph speed, and removing rerankers require original benchmark details. |
| 06 | documentation | Candidate | Preserve the video's own caveat that graph complexity often makes folders preferable; do not quote only its speed claims. |

## GRAPH-007

Source: [Entity duplication](ai-graph-and-folder-structure/2026-08-21-duplicate-and-fabricated-entities.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | data-integrity | Deferred | Define entity types, stable identities, aliases, and relationship constraints before a graph import. Dave/David/Sherlock examples illustrate ambiguity, not an identity-resolution algorithm. |
| 02 | agent-security | Deferred | Review model-extracted facts and control updates before treating them as stored authority. |
| 03 | maintainability | Deferred | Incremental ingest of new meetings/documents requires conflict, supersession, and duplicate handling; a static demo does not solve maintenance. |
| 04 | evidence-quality | Verify | Microsoft GraphRAG issue status, maintenance mode, Neo4j/Mem0 behavior, and industry retreat claims require current primary sources. |
| 05 | evidence-quality | Not applicable | Calling deterministic retrieval solved does not prove that upstream extraction or downstream answers are correct. |

## GRAPH-008

Source: [Central context store](ai-graph-and-folder-structure/2026-08-23-a-central-context-store-not-a-second-brain.txt)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | documentation | Candidate | Specify the questions a context store should answer before selecting a tool or schema. |
| 02 | architecture | Deferred | Model entities, connections, temporal facts, and retrieval mechanics only for a demonstrated need. |
| 03 | maintainability | Candidate | Watch automatically generated frontmatter/link drift and duplicated source ownership. |
| 04 | evidence-quality | Not applicable | Grep can support multi-document reasoning; it does not inherently stop after one file or require full-file reads. The refund example identifies a reasoning need, not proof of failure. |
| 05 | product-scope | Not applicable | "Second brain" marketing and broadcast-channel promotion do not define an application feature. |

## GRAPH-009

Source: [Historical research synthesis](ai-graph-and-folder-structure/2026-08-24-research-synthesis.md)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | documentation | Candidate | Finite context, progressive disclosure, scoped pointers, and indexes are useful design questions; exact token limits require evidence. |
| 02 | architecture | Deferred | Typed entities/relationships, ontology, pull/push retrieval, aliases, and GraphRAG should be evaluated only for an actual retrieval gap. |
| 03 | documentation | Candidate | Preserve one authoritative home per fact, stable IDs, useful sparse links, and current/historical separation. |
| 04 | developer-tools | Verify | The referenced ICM skill's MIT license, 45 KB size, forms, ten invariants, token budgets, and workflow claims are historical research, not current verified facts. |
| 05 | architecture | Deferred | System-map object cards and an effects index need explicit maintenance and demonstrated value beyond code references and current test input scope. |
| 06 | architecture | Verify | UUID5 normalized names, three SQLite tables, recursive traversal, aliases, lexical seeding, top-k crowding, collisions, and supersession are a specific starter design with limitations. They do not establish a need to install it. |
| 07 | evidence-quality | Verify | Recheck all linked papers/research and quoted percentages, instruction ceilings, graph accuracy, token inflation, and lab behavior before citing conclusions. |
| 08 | documentation | Not applicable | The August doc counts and stale roadmap counter are historical snapshots; current status lives in current docs. |
| 09 | documentation | Candidate | The listed environment-skill, CodeRabbit, feature-baseline, inventory, and data-model drift examples suggest checking current owners rather than replaying the old edits. |
| 10 | documentation | Candidate | Separate stable protocol, live status, and append-only history by update needs. |
| 11 | documentation | Candidate | Avoid repeating acceptance evidence across roadmap, logs, ledgers, plans, and feature specs; link owning records. |
| 12 | documentation | Candidate | Check related-doc tails route by actual relevance instead of linking every feature to every other feature. |
| 13 | documentation | Candidate | Validate links/IDs and avoid orphan decision records or plans. |
| 14 | documentation | Candidate | Preserve explicit lifecycle/status and readable records instead of giant one-line tables. |
| 15 | documentation | Candidate | Inspect skill mirrors, naming collisions, and duplicated mutable facts where these remain current concerns. |
| 16 | documentation | Candidate | Ensure the canonical docs index is discoverable and maintained. |
| 17 | evidence-quality | Verify | Immutable decision history can still contain superseded assumptions; it is not intrinsically free of staleness. |
| 18 | architecture | Not applicable | A parallel graph/ICM rewrite is not authorized by this historical conclusion. Current repository routing should determine whether any unmet need remains. |

## GRAPH-010

Source: [Historical roadmap split proposal](ai-graph-and-folder-structure/2026-08-24-roadmap-split-migration-map.md)

| Aspect | Topic | Status | Consideration |
| --- | --- | --- | --- |
| 01 | documentation | Not applicable | This map describes an old 719-line file at bd1dd05, not a current migration instruction. Consult current phase-1 docs before deciding any work remains. |
| 02 | documentation | Candidate | Its proposed distinct owners for roadmap, protocol, gates, coverage, log, and slice records illustrate lifecycle-based organization; verify actual current owners rather than duplicate them. |
| 03 | documentation | Candidate | Slice records need outcome, dependencies, specs, evidence, and links when used as acceptance addresses. Exact historical template is not current authority. |
| 04 | documentation | Candidate | Thin current index rows and separate historical evidence avoid live-status claims hidden in old narratives. |
| 05 | documentation | Not applicable | Migration rows 1–17 cover title/status/checkpoint, stack routing, authority, reading order, vocabulary, slice definition/status, cautions, costs, execution, invariants, foundation, dependencies, and index headers. Each is historical move/relink scope, not new work. |
| 06 | documentation | Not applicable | Rows 18–35 assign accepted P1-00/P1-00a/P1-01 through P1-14 evidence to records and retain wave headings. They do not establish today's acceptance state. |
| 07 | documentation | Not applicable | Rows 36–45 cover planned P1-15 through P1-54 and Waves 3–6, including P1-33's pinned defect and P1-44/45 infrastructure references. Verify current slice status and constraints before reuse. |
| 08 | documentation | Not applicable | Rows 46–50 move run requirements, GG-00–GG-16 definitions, feature/foundation coverage, and decisions barred from silent adoption. Current gates/protocol supersede this proposed placement. |
| 09 | documentation | Not applicable | Rows 51–58 move parallel-work rules, brief/new-task templates, update rules, log headers/47 entries, acceptance rules, and related links. They remain historical migration instructions. |
| 10 | documentation | Candidate | Inbound references span AGENTS, docs index, capability map, testing, gate/wave logs, dispatch plan, infrastructure decision, feature docs, Playwright comment, and new-task prompt. Recheck affected links when moving an owner, not merely the moved file. |
| 11 | documentation | Not applicable | Old-path stub versus old-path entry was an owner decision in that proposal. Do not reopen it because the source still says draft. |
| 12 | documentation | Candidate | Keep implementation contracts and acceptance records distinct when their content/lifecycle differ; the old merge recommendation is not a new instruction. |
| 13 | documentation | Candidate | Canonical acceptance evidence can coexist with append-only historical logs; future logs should link rather than copy. |
| 14 | documentation | Candidate | Create future slice records when useful instead of generating empty placeholders solely for symmetry. |
| 15 | documentation | Not applicable | The resolved "16 of 56" counter correction is historical, not a current accepted-slice count. |
| 16 | documentation | Candidate | Moving gate/wave logs and splitting gate/coverage files each have independent locality, link, and change-rate tradeoffs. Current owners control future changes. |
| 17 | documentation | Candidate | Acceptance maintenance should update affected slice, roadmap, log, gate evidence, and audit records, with protocol/gate/coverage changes only when their meaning changes. Current decision 0007 governs test execution. |
| 18 | documentation | Candidate | Preserve referenced step numbers or update callers, carry pinned notes with their records, and distinguish historical future-looking statements from current scheduling. |
| 19 | documentation | Candidate | Source-range coverage is useful for a move, but does not prove semantic consistency or justify copying this obsolete map into durable policy. |
