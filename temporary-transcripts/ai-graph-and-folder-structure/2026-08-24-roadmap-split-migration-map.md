# Roadmap split migration map (proposal, 2026-08-24)

Status: draft for owner review. Nothing in `docs/` has been changed. Every row of the current `docs/plans/phase-1-build-roadmap.md` (719 lines as of commit `bd1dd05`) has an explicit destination below; every move is a relocation, not a deletion. Redundancy resolutions are flagged as owner decisions, never applied silently.

## Motivation

The roadmap mixes three lifecycles in one 719-line file: durable protocol that agents should read once, hot status that agents must always read fully, and per-slice acceptance records plus a 47-entry append-only progress log that only grow. Because the file is too large to read whole, agents read it partially, and partial reads have already produced drift: the header claims "15 of 56" accepted slices while the checkpoint says `P1-00` through `P1-14` are complete, which is 16 slices. The split gives each lifecycle its own file size and change rate: a small entry file that is always read fully, a protocol file that changes rarely, one record file per slice with a stable address other docs can link to instead of restating evidence, and a log file that is only appended to.

## Target structure

```text
docs/plans/
  phase-1-build-roadmap.md        becomes a short pointer stub (open decision 1)
  phase-1/
    roadmap.md                    hot entry: status header, current-checkpoint table,
                                  thin master slice index (one row per slice), dependency
                                  diagram, links to protocol/gates/coverage/log/slices
    protocol.md                   durable process: authority order, required reading,
                                  vocabulary, slice definition, status model, execution
                                  cautions, cost gates, execution protocol, invariants,
                                  smuggling-ban list, parallel-work rules, slice brief
                                  template, standard prompt, update protocol, acceptance rules
    gates.md                      golden scenario definitions GG-00..GG-16 plus the
                                  run-record requirements
    coverage.md                   routing matrices: starting foundation snapshot,
                                  feature-to-slice coverage, cross-cutting foundation
                                  coverage
    log.md                        the progress log, moved verbatim, still append-only
    slices/
      p1-00-baseline-lock.md
      p1-00a-r2-file-storage.md
      p1-01-customer-contacts-and-sites.md
      p1-02-client-requests.md
      p1-03-employee-records.md
      p1-04-work-schedules-and-holidays.md
      p1-05-scoped-responsibilities.md
      p1-06-vacation.md
      p1-07-attention-pattern.md
      p1-08-sickness.md
      p1-09-teams-and-qualifications.md
      p1-10-customer-relationship-timeline.md
      p1-11-planning-occurrences.md
      p1-12-dispatch.md
      p1-13-work-templates.md
      p1-14-work-lifecycle.md
      (one new file per later slice, created when the slice enters in_progress)
```

Files that stay where they are: `golden-gate-log.md`, `wave-1-audit.md`, `wave-2-audit.md`, `uiux-consolidation.md`, `p1-00-baseline-verification.md`, the `p1-12`/`p1-13`/`p1-14` implementation plans, and `inventory-v1-implementation-plan.md` (open decisions 2 and 6).

Each slice record file gets this fixed skeleton so records stay comparable and linkable by section anchor:

```md
# P1-XX — Slice name

Status: complete (accepted YYYY-MM-DD)

## Bounded outcome
## Direct dependencies
## Primary and connected specs
## Acceptance evidence          <- the full former index-row evidence text, verbatim
## Links                        <- gate-log rows, wave-audit ledger, implementation plan,
                                   decision records, related progress-log dates
```

The thin index row in `roadmap.md` keeps only: ID, status, a one-sentence outcome, direct dependencies, gate, and a link to the record. Planned slices keep their current full row in the index (they are already one compact row each) and get a record file only when work starts, which matches the existing "when a slice starts" protocol step.

## Migration table

Line ranges refer to the current `docs/plans/phase-1-build-roadmap.md` and are inclusive; trailing blank lines are folded into the preceding range so the table covers lines 1-719 with no gaps. Move types:

- verbatim move: content moves unchanged.
- move + relink: content moves; only relative links, file-path self-references, or cross-section references are rewritten to the new addresses. No wording change beyond that.
- merge candidate (owner decision): the move itself is verbatim, but the row also names a proposed canonical-home consolidation that needs the owner's yes.

| # | Current section (line range) | Destination | Move type |
| --- | --- | --- | --- |
| 1 | Title and purpose intro, the six implementation questions (1-15) | `phase-1/roadmap.md`, top | move + relink (the `product-capability-map.md` link path gains one `../`) |
| 2 | Status blockquote: established date, current phase, checkpoint one-liner, accepted counter, Phase 2 note (16-21) | `phase-1/roadmap.md`, directly under the intro | move + relink; the counter already reads the corrected "16 of 56" (fixed 2026-08-24, see open decision 5) |
| 3 | Infrastructure-stack pointer paragraph (22-23) | `phase-1/protocol.md`, "Authority and source order" area | move + relink (decision-0001 link path) |
| 4 | Current Checkpoint: narrative, table, update rule (24-41) | `phase-1/roadmap.md`, "Current checkpoint" | move + relink; the update rule's wording changes from "this table" context to naming `roadmap.md` explicitly |
| 5 | Authority And Source Order (42-56) | `phase-1/protocol.md` | move + relink (item 6 "This roadmap" becomes "The phase-1 roadmap entry and slice records") |
| 6 | Required Reading For Phase 1 Tasks (57-70) | `phase-1/protocol.md` | move + relink; item 2 becomes "the roadmap entry (`roadmap.md`), the target slice's record, its direct prerequisites' records, and its golden gate in `gates.md`" |
| 7 | Roadmap Vocabulary (71-83) | `phase-1/protocol.md` | verbatim move |
| 8 | What Counts As A Vertical Slice (84-103) | `phase-1/protocol.md` | verbatim move |
| 9 | Slice Status Model (104-119) | `phase-1/protocol.md` | move + relink ("in the master index" now names `roadmap.md`) |
| 10 | Practical Execution Cautions (120-128) | `phase-1/protocol.md` | verbatim move |
| 11 | External Resources And Cost Gates (129-139) | `phase-1/protocol.md` | verbatim move |
| 12 | Mandatory Execution Protocol: before / during / before-complete (140-186) | `phase-1/protocol.md` | move + relink; the completion checklist items that say "this roadmap records status..." now name the concrete files (see maintenance rule below) |
| 13 | Cross-Cutting Invariants (187-203) | `phase-1/protocol.md` | verbatim move |
| 14 | Starting Foundation Snapshot (204-221) | `phase-1/coverage.md` | verbatim move |
| 15 | Dependency Overview with mermaid spine (222-239) | `phase-1/roadmap.md`, above the slice index | verbatim move |
| 16 | Master Slice Index intro sentence (240-243) | `phase-1/roadmap.md`, index heading | move + relink |
| 17 | Wave 0 heading and table header (244-247) | `phase-1/roadmap.md`, thin index | move + relink (thin column set) |
| 18 | `P1-00` row (248) | `phase-1/slices/p1-00-baseline-lock.md` (full evidence); one thin row in `roadmap.md` | move + relink; merge candidate: also canonical home for the P1-00 facts restated in log entries 2026-08-04 (open decision 3) |
| 19 | `P1-00a` row (249) | `phase-1/slices/p1-00a-r2-file-storage.md`; thin row in `roadmap.md` | move + relink; merge candidate as row 18 |
| 20 | Wave 1 heading and table header (250-254) | `phase-1/roadmap.md`, thin index | move + relink |
| 21 | `P1-01` row (255) | `phase-1/slices/p1-01-customer-contacts-and-sites.md`; thin row | move + relink; merge candidate (open decision 3) |
| 22 | `P1-02` row (256) | `phase-1/slices/p1-02-client-requests.md`; thin row | move + relink; merge candidate |
| 23 | `P1-03` row (257) | `phase-1/slices/p1-03-employee-records.md`; thin row | move + relink; merge candidate |
| 24 | `P1-04` row (258) | `phase-1/slices/p1-04-work-schedules-and-holidays.md`; thin row | move + relink; merge candidate |
| 25 | `P1-05` row (259) | `phase-1/slices/p1-05-scoped-responsibilities.md`; thin row | move + relink; merge candidate |
| 26 | `P1-06` row (260) | `phase-1/slices/p1-06-vacation.md`; thin row | move + relink; merge candidate |
| 27 | `P1-07` row (261) | `phase-1/slices/p1-07-attention-pattern.md`; thin row | move + relink; merge candidate |
| 28 | `P1-08` row (262) | `phase-1/slices/p1-08-sickness.md`; thin row | move + relink; merge candidate |
| 29 | `P1-09` row (263) | `phase-1/slices/p1-09-teams-and-qualifications.md`; thin row | move + relink; merge candidate |
| 30 | `P1-10` row (264) | `phase-1/slices/p1-10-customer-relationship-timeline.md`; thin row | move + relink; merge candidate |
| 31 | `P1-11` row (265) | `phase-1/slices/p1-11-planning-occurrences.md`; thin row | move + relink; merge candidate |
| 32 | `P1-12` row (266) | `phase-1/slices/p1-12-dispatch.md`; thin row; links to `p1-12-dispatch-implementation-plan.md` and decision 0002 | move + relink; merge candidate (open decisions 2 and 3) |
| 33 | Wave 2 heading and table header (267-271) | `phase-1/roadmap.md`, thin index | move + relink |
| 34 | `P1-13` row (272) | `phase-1/slices/p1-13-work-templates.md`; thin row; links to its implementation plan and `wave-2-audit.md` rows | move + relink; merge candidate |
| 35 | `P1-14` row (273) | `phase-1/slices/p1-14-work-lifecycle.md`; thin row; links to its implementation plan and `wave-2-audit.md` rows | move + relink; merge candidate |
| 36 | `P1-15` row, status `ready` (274) | `phase-1/roadmap.md`, thin index, full current row kept (record file is created when P1-15 starts) | verbatim move |
| 37 | `P1-16` through `P1-24` planned rows (275-283) | `phase-1/roadmap.md`, thin index, full current rows kept | verbatim move |
| 38 | Wave 3 heading and table header (284-288) | `phase-1/roadmap.md`, thin index | move + relink |
| 39 | `P1-25` through `P1-34` planned rows, incl. the A1-07 defect note pinned to `P1-33` (289-298) | `phase-1/roadmap.md`, thin index, full rows kept; the `P1-33` defect note moves with its row untouched | verbatim move |
| 40 | Wave 4 heading and table header (299-303) | `phase-1/roadmap.md`, thin index | move + relink |
| 41 | `P1-35` through `P1-43` planned rows (304-312) | `phase-1/roadmap.md`, thin index | verbatim move |
| 42 | Wave 5 heading and table header (313-317) | `phase-1/roadmap.md`, thin index | move + relink |
| 43 | `P1-44` through `P1-52` planned rows, incl. decision-0001 pointers in `P1-44`/`P1-45` (318-326) | `phase-1/roadmap.md`, thin index | move + relink (decision-0001 link paths) |
| 44 | Wave 6 heading and table header (327-331) | `phase-1/roadmap.md`, thin index | move + relink |
| 45 | `P1-53` and `P1-54` rows (332-333) | `phase-1/roadmap.md`, thin index | verbatim move |
| 46 | Golden Scenario Gates intro and the run-record requirements list (334-349) | `phase-1/gates.md`, top | verbatim move |
| 47 | `GG-00` through `GG-16` definitions (350-464) | `phase-1/gates.md` | verbatim move |
| 48 | Feature-To-Slice Coverage (465-482) | `phase-1/coverage.md` | verbatim move |
| 49 | Cross-Cutting Foundation Coverage (483-501) | `phase-1/coverage.md` | move + relink (decision-0001 link path) |
| 50 | Decisions That Must Not Be Smuggled Into A Slice (502-518) | `phase-1/protocol.md` | verbatim move |
| 51 | Parallel Work Rules (519-530) | `phase-1/protocol.md` | move + relink ("update this roadmap" names the concrete files) |
| 52 | Slice Brief Template (531-574) | `phase-1/protocol.md` | verbatim move |
| 53 | Standard New-Task Prompt (575-590) | `phase-1/protocol.md` | move + relink; the prompt's own reading list changes from `docs/plans/phase-1-build-roadmap.md` to `docs/plans/phase-1/roadmap.md` plus the slice record |
| 54 | Roadmap Update Protocol (591-630) | `phase-1/protocol.md` | move + relink; each step now names which of the new files it touches (see maintenance rule) |
| 55 | Progress Log heading, intro, table header (631-636) | `phase-1/log.md`, top | move + relink (intro keeps "newest first, append-only") |
| 56 | All 47 log entries, 2026-08-04 through 2026-08-23 (637-683) | `phase-1/log.md` | verbatim move; existing entries are never rewritten. Merge candidate for FUTURE entries only: shrink them to one line plus a link to the slice record (open decision 3) |
| 57 | Phase 1 Acceptance Rules (684-699) | `phase-1/protocol.md`, end | verbatim move |
| 58 | Related Docs (700-719) | `phase-1/roadmap.md`, end | move + relink (all paths gain one `../`; add links to `protocol.md`, `gates.md`, `coverage.md`, `log.md`, `slices/`) |

58 rows; lines 1-719 fully covered.

## Inbound reference updates

Assuming open decision 1 lands on "pointer stub", old links keep resolving through the stub, but every reference below should still be rewritten in the same change so nothing depends on the stub long-term. "Entry" means `docs/plans/phase-1/roadmap.md`.

| File | Current reference | New reference |
| --- | --- | --- |
| `AGENTS.md` (line 17) | "The living implementation order ... live in `docs/plans/phase-1-build-roadmap.md`" | `docs/plans/phase-1/roadmap.md` (entry), with a note that protocol/log/slice records live beside it |
| `AGENTS.md` (line 216, maintenance guidance) | "update ... `docs/plans/phase-1-build-roadmap.md` as part of the same change" | "update the affected files under `docs/plans/phase-1/` as part of the same change" |
| `docs/README.md` (folder tree, line 45) | `phase-1-build-roadmap.md` | the `phase-1/` subtree (roadmap.md, protocol.md, gates.md, coverage.md, log.md, slices/) plus the stub if kept |
| `docs/README.md` (line 95) | "`docs/plans/phase-1-build-roadmap.md` is the living execution index ..." | same paragraph rewritten to name the entry file and the split: entry owns status and order, protocol owns process, slice records own evidence, log owns history |
| `docs/product/product-capability-map.md` (lines 42, 364) | link to `../plans/phase-1-build-roadmap.md` | `../plans/phase-1/roadmap.md` |
| `docs/technical/testing.md` (line 5) | "`GG-XX` in `docs/plans/phase-1-build-roadmap.md`" | "`GG-XX` in `docs/plans/phase-1/gates.md`" |
| `docs/technical/testing.md` (rule 12, line 34) | "the roadmap's execution protocol" | "`docs/plans/phase-1/protocol.md`" |
| `docs/technical/testing.md` (line 81) | "the gate spec named by their roadmap row" | "the gate spec named by their slice index row" (wording only; the index row still names the gate) |
| `docs/plans/golden-gate-log.md` (line 3) | "as required by the roadmap's gate protocol" | "as required by `phase-1/gates.md`" |
| `docs/plans/wave-2-audit.md` (line 3) | "the process rules live in the roadmap's execution protocol" | "the process rules live in `phase-1/protocol.md`" |
| `docs/plans/wave-2-audit.md` (line 92) | "roadmap protocol 5a" | "protocol step 5a in `phase-1/protocol.md`" (the step keeps its 5a number; see maintenance rule) |
| `docs/plans/wave-1-audit.md` (line 220) | "the defect is recorded in the `P1-33` roadmap row" | "recorded in the `P1-33` index row in `phase-1/roadmap.md`" (the note moves verbatim with the row) |
| `docs/plans/p1-12-dispatch-implementation-plan.md` (line 3) | "The roadmap row and progress log in `phase-1-build-roadmap.md` hold the authoritative status" | "The slice record `phase-1/slices/p1-12-dispatch.md` and the log in `phase-1/log.md` hold the authoritative status" |
| `docs/decisions/0001-infrastructure-stack.md` (lines 25, 130) | links to `../plans/phase-1-build-roadmap.md` | `../plans/phase-1/roadmap.md` |
| `docs/features/customers-and-crm.md` (305), `jobs-and-projects.md` (314), `service-and-maintenance.md` (243), `calendar-and-resource-planning.md` (252), `employee-management.md` (368), `time-tracking.md` (338), `document-management.md` (640), `inventory.md` (391), `commercial-and-finance.md` (296, 482), `ai-automations.md` (341) | related-docs link to `../plans/phase-1-build-roadmap.md` | `../plans/phase-1/roadmap.md` |
| `playwright.config.ts` (line 7 comment) | "Golden-gate harness (docs/plans/phase-1-build-roadmap.md)" | "Golden-gate harness (docs/plans/phase-1/gates.md)" |
| the roadmap itself (line 581, standard prompt) | tells agents to read `docs/plans/phase-1-build-roadmap.md` | handled by migration row 53 |

Prose references in log entries, gate-log rows, and slice evidence that mention "this roadmap" historically stay untouched; they describe what happened at the time and history is not rewritten.

## Open decisions for the owner

1. Old path handling. Option A: `docs/plans/phase-1-build-roadmap.md` becomes a five-line pointer stub ("moved to `phase-1/`; entry is `roadmap.md`, protocol is `protocol.md`, ..."). Option B: keep the old path as the entry file itself and put only protocol/gates/coverage/log/slices under `phase-1/`. A gives a clean folder where everything about phase 1 lives together; the cost is one extra hop for stale links and the risk that an agent edits the stub. B keeps every existing entry-file link working with zero hops, but splits the phase-1 docs across two locations and keeps the misleading name (the "roadmap" file would no longer contain the protocol most references mean). Recommendation: A, with all inbound references rewritten in the same commit so the stub is a safety net, not a dependency.

2. Existing per-slice plan files (`p1-12-dispatch-implementation-plan.md`, `p1-13-work-templates-implementation-plan.md`, `p1-14-work-lifecycle-implementation-plan.md`, `inventory-v1-implementation-plan.md`, `p1-00-baseline-verification.md`). Option A: merge each into its slice record. Option B: leave them where they are and link them from the record's Links section. Merging would give one file per slice, but these plans are large owner-confirmed contracts with running ledgers and their own inbound links, and the roadmap already treats them as a separate document class ("create a slice-specific implementation plan when the work spans multiple sessions"). Recommendation: B. A slice record is the address for acceptance facts; the plan stays the address for the confirmed contract and execution ledger.

3. Canonical home for acceptance evidence. Today each accepted slice's facts are restated in the index row and again in one to three progress-log entries (and partially in the gate log and audit ledgers). Proposal: the slice record becomes the single canonical home; existing log entries stay verbatim (append-only history); future log entries shrink to one or two sentences plus a link to the record; gate log and audit ledgers keep owning their own row types (run records, flow coverage) and link rather than restate. This is a deduplication of future writing, not a deletion of anything existing. Recommendation: adopt.

4. Record files for planned slices. Option A: create all 40 remaining record files now as thin stubs. Option B: keep planned slices as full rows in the thin index and create the record when the slice enters `in_progress` (extending the existing "when a slice starts" protocol step). Recommendation: B; 40 stub files would be empty addresses nobody links to yet, and the index row already carries everything a planned slice has.

5. ~~Fix the stale accepted counter during migration.~~ Already resolved: the counter was corrected to "16 of 56" directly in the current roadmap on 2026-08-24 as part of the pre-split staleness fixes, before this map is executed. No migration-time action needed.

6. Location of `golden-gate-log.md` and the wave audit docs. They could move into `phase-1/` for locality. Recommendation: leave them at `docs/plans/` in this change; they have many inbound references, their append-only format is orthogonal to this split, and moving them can be its own small follow-up if the owner wants the folder complete.

7. Whether `gates.md` and `coverage.md` are separate files or sections of `protocol.md`. Gate definitions change when slices extend a gate (GG-02 changed twice in Wave 1), while the protocol should almost never change, so mixing them re-creates a file with two change rates. The coverage matrices are routing aids, not rules. Recommendation: keep both as separate files as drawn above.

## Proposed maintenance rule (per-slice acceptance touches)

To be written into the migrated update protocol in `protocol.md`, replacing the current "this roadmap records status, completion date, evidence ..." items:

Per slice, acceptance must touch exactly these files:

- `phase-1/slices/p1-XX-<name>.md`: create at `in_progress` (or promote the index row), close with full acceptance evidence at `complete`. This is the canonical home for the slice's facts.
- `phase-1/roadmap.md`: update the checkpoint table, the slice's index-row status, the accepted counter, and recompute which slices are `ready`. This file must stay small enough to always read fully; evidence text never lands here.
- `phase-1/log.md`: append one entry (short, linking the slice record, per open decision 3).
- `docs/plans/golden-gate-log.md`: record the gate runs, unchanged location and format.
- The wave's audit doc: close the slice's ledger rows, unchanged.

Touched only when their content actually changes, never routinely: `protocol.md` (process changes need an explicit log entry naming the change), `gates.md` (only when a slice's acceptance extends a gate definition), `coverage.md` (only when slice scope or feature routing changes). A slice acceptance that edits `protocol.md` without a named process decision is a review flag.

## Things that did not fit cleanly

- The status blockquote (lines 16-21) duplicates the checkpoint table's content in prose. Both move to `roadmap.md`; whether to collapse them into one block is a cosmetic call the migration does not need to make.
- Protocol step 5a and the numbered before-starting steps are referenced by number from `wave-2-audit.md`. The migration must preserve the step numbering inside `protocol.md` exactly, including the awkward 5/5a sequence, or update the audit doc's reference in the same commit.
- The `P1-33` row carries a pinned defect note that `wave-1-audit.md` points at. It moves verbatim with the row into the thin index, and the audit doc's pointer is updated (see the reference table). If `P1-33` later gets a record file, the note moves again; the protocol's "when a slice starts" step should say pinned notes travel with the row into the record.
- Some completed-slice rows contain forward-looking scheduling statements ("`P1-13` remains `ready` and must not start concurrently") that were true at acceptance time. They move verbatim into the slice records as historical evidence; only the index rows and checkpoint carry current truth.
