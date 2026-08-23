# AI knowledge graphs and folder structure: research synthesis

Date: 2026-08-24
Status: research synthesis, no decisions made yet. Produced from the seven transcripts in this folder, the two linked resources (icm-architect repo, Glitch Cat Club artifact), lab-grade web research, and a full audit of this repo's docs/skills/context surfaces.

## 1. The vocabulary, in plain words

- **Context engineering**: curating the smallest set of high-signal tokens in an agent's context window. Anthropic frames context as a finite "attention budget"; performance degrades as it fills.
- **Knowledge graph**: a database of typed entities (nodes) and typed relationships (edges), e.g. `Refund policy —approved_by→ Ops Manager —held_by→ Sarah`. Answering a question means traversing edges, not reading documents.
- **Ontology**: the upfront decision about what kinds of things exist in your world and how they may connect. Entity types (PERSON, POLICY, ROLE...) and relationship types (approved_by, delegates_to...). Kem's core point: this modeling is the hard part and cannot be outsourced to a "vibe coded repo."
- **"Second brain"**: marketing. Kem's own correction: it is a *central context store*, and the entire value is retrieval.
- **Pull vs push**: pull = the model searches (grep, read, reason). Push = code retrieves facts deterministically *before* the model runs and injects them (e.g. via a `UserPromptSubmit` hook). Push is what made Haiku match Fable in the demo.
- **Progressive disclosure**: give the agent lightweight pointers (index lines, file paths) and let it load detail on demand. This is how Claude Code skills work (~80 tokens of name+description until triggered).
- **MOC / index file**: a "map of content" file per folder with one line per item, so an agent can route without reading everything.
- **GraphRAG**: Microsoft's technique, LLM-extracted entity graph over a big unstructured corpus. Wins for "global sensemaking" questions over ~1M-token corpora. Documented failure mode: duplicate/fabricated entities (Sherlock Holmes became four entities); repo went maintenance mode.

## 2. What each source actually says

### The transcripts (Jake Van Clief vs Kem)

Not a contradiction, a spectrum. Van Clief: folders + YAML frontmatter + markdown route agents better than agentic frameworks; Google researchers published the same conclusion. Kem agrees for most cases and adds an escalation ladder:

1. Folders + keyword search (grep) wins for most systems.
2. Corpus grows → add an index file per folder/subfolder.
3. Fuzzy semantic questions → RAG (his Cerberus-style "distill each entry into the questions you'll ask" variant tested well).
4. Only with tons of files AND willingness to do full ontological modeling → a real graph.

He explicitly says frontier labs benchmarked this and ship grep-based retrieval, not graphs, at scale. His "real graph" videos are about doing tier 4 *properly* if you go there, not a claim that everyone should.

Kem's other durable points: Obsidian wiki-links + auto-generated YAML are not a graph, just a mess the model reads through. Graphs fail upstream at entity resolution (duplicates, fabricated names). The real work in a folders+grep system is maintenance: rules for where files go, staleness removal, treating it as a system.

### The icm-architect repo (RinDig, MIT)

Not a scanner tool and not a skill collection. One Claude Code skill (~45 KB of markdown, zero code) encoding the "Interpretable Context Methodology" from the Van Clief & McDermott paper (arXiv:2603.16021). Ten invariants: one folder one job; small stable entry file (<60 lines, routing only); numbered stages; per-folder CONTEXT.md contracts (inputs/process/outputs/human check); factory vs product separation; 2k–8k tokens per step; one home per fact, a link beats a copy; templates over blank pages. Six "forms"; the relevant one for a codebase is **System map**: agent-written object cards per domain noun (with `path:line` citations, live/leftover/ghost universes, verified/stale status) plus an `effects/` change-impact index ("if you change X, open these cards; hits / does not hit"). Honest about its limits and repeatedly warns against over-application. No enforcement tooling; staleness control is purely procedural.

Verdict for WerkFlow: our docs tree already satisfies most invariants. Restructuring to ICM conventions would be churn without gain. The only genuinely novel piece is the System-map/effects-index idea, and only if map maintenance joins the same-change definition of done. Local copies of all its files were saved during research; re-fetch from github.com/RinDig/icm-architect if needed.

### The Glitch Cat Club artifact ("Applying Knowledge Graphs")

Correction to expectations: it is not about markdown folder structure. It is a Tier-1 knowledge graph build: three SQLite tables (entities, relations, aliases), identity computed as `uuid5(type:normalized_name)` so re-runs merge instead of duplicating, a recursive SQL traversal (seed on the question's words via aliases, walk edges hop by hop), and a Claude Code `UserPromptSubmit` hook that injects the retrieved facts (~400 tokens) before the model thinks. Repo: github.com/Glitch-Cat-Club/graph-memory-starter. Prescriptive recipe: derive entity/relationship types from the questions you want answered, keep both lists small and closed, let the AI extract every doc against that vocabulary.

Assessment: mechanism is real and the design is coherent, but every headline number (Haiku matching Fable, 2 ms, zero tool calls) comes from one 3-hop question over 8–12 tiny documents authored by the graph's own builder, engineered to defeat keyword search. A plausibility demo, not an evaluation. The artifact itself lists the open problems: lexical seeding misses, top-k crowding, name collisions, supersession of stale facts.

### Lab-grade evidence (web research)

- Anthropic removed vector search from Claude Code because agentic grep "outperformed everything. By a lot." Cursor, Windsurf, Cline, Devin moved the same way.
- Two 2026 ablation studies on context files: ETH Zurich (arXiv 2602.11988) found AGENTS.md files did not generally improve task success while adding >20% inference cost; repository-overview content (the most popular kind) was not helpful; LLM-generated files sometimes hurt. The second study (arXiv 2607.27250) found correctness unmoved but ~29% runtime and ~17% token savings. Context files are an efficiency tool, and only concrete non-inferable instructions reliably change behavior.
- Instruction-following ceiling ~150–200 total instructions; bloated CLAUDE.md causes instruction loss. What works: exact commands, machine-checkable "done", task-scoped sections. What gets ignored: prose overviews, vague directives.
- GraphRAG wins are demonstrated for global questions over large unstructured corpora, never for code navigation. Entity extraction runs 60–85% accuracy with 3–5x token inflation.
- Key structural insight: a code repo already is a knowledge graph. Files are nodes, imports/references are typed edges, git history is temporal metadata, and grep traverses it natively. A parallel markdown entity graph is a second source of truth that must be kept in sync by hand, which is exactly where the documented failure modes live.
- The one doc genre with no drift problem: decision records, because decisions are immutable.

Best sources: Anthropic "Effective context engineering for AI agents"; agents.md spec; arXiv 2602.11988; arXiv 2607.27250; arXiv 2404.16130 (GraphRAG); jxnl.co "Why grep beat embeddings"; humanlayer.dev "Writing a good CLAUDE.md"; lirantal.com "The practical second brain" (best pro-graph case, honest failure modes).

## 3. Where WerkFlow stands (audit highlights)

Full audit ran 2026-08-24. ~36 docs, ~149k words. The structure is already close to the evidence-backed ideal: CLAUDE.md → AGENTS.md routing entry, pull-based feature specs with a uniform template kept fresh by the acceptance protocol, immutable ADRs, stable ID vocabularies everywhere (P1-XX, GG-XX, flow IDs, ADR numbers) that are ready-made node keys.

Concrete problems found:

1. Factual staleness: roadmap header says "15 of 56" accepted but lists 16; supabase-live-workflow skill (both mirrors) still claims dev auto-pauses and that the connector can't see dev, both contradicted by environments.md; docs/README.md folder tree missing environments.md, ADRs 0002/0003, p1-13/p1-14 plans; coderabbit.md references removed `.cursor/rules` and an unverified "free plan" claim; time-tracking.md baseline header says "through P1-06" above P1-07/P1-08 content; inventory-v1 plan still reads as a live plan though V1 shipped; data-model.md tenant list says "Future inventory."
2. The roadmap is an 18.7k-word god-file mixing three lifecycles: durable protocol, hot status, immutable history. Partial reads cause the stale-counter class of bug.
3. Acceptance evidence has no canonical home: each slice's facts are restated in 5–7 places (roadmap row, progress log, gate log, wave audit ledger, slice plan, testing.md, feature baselines).
4. "Related Docs" tails link every feature to every feature: a near-complete graph whose edges carry no routing signal.
5. Three link syntaxes coexist (relative md links, backtick paths, bare IDs like "decision 0002"); nothing validates reachability; ADR 0002 and the p1-12 plan are effectively orphaned.
6. No temporal layering: closed ledgers sit beside living docs with three different closure conventions; giant single-row tables (gate log: 11k words in 51 lines) defeat partial reads.
7. Skills duplicate doc facts and drift (the supabase skill is the proof); the coderabbit-review skill is unmirrored and its frontmatter name shadows the built-in /code-review.
8. docs/README.md is the nominal index but unreferenced from AGENTS.md and unmaintained; the de-facto hub is the roadmap.

## 4. Conclusion

For a single product repo with ~40 docs, the evidence and both creators converge on the same tier: folders + per-folder index + disciplined linking + grep, treated as a maintained system. That is what WerkFlow already has in outline. The win is not adding a graph; it is applying graph *discipline* to the existing structure: one home per fact with links instead of copies, typed sparse links instead of link-everything tails, stable IDs made resolvable, lifecycle layering (living vs closed), line-addressable records, and staleness fixed at the source. A SQLite entity graph or ICM restructure would add a second source of truth that rots, for multi-hop questions our agents don't actually fail at (grep + the roadmap's reading protocol already answers them).

The optional experiment worth keeping in the back pocket: an ICM-style change-impact index ("touching time entries hits RLS, calendar realtime, these tests") if cross-feature regressions become a recurring pain. Only with map-maintenance wired into the acceptance protocol.
