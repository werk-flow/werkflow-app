# Phase 1 Build Roadmap (moved)

Status: pointer stub — do not add content here.

This file was split on 2026-08-24 into `docs/plans/phase-1/` so that hot status, durable protocol, and per-slice history each live at their own change rate:

- [phase-1/roadmap.md](phase-1/roadmap.md) — the entry: current checkpoint, status, and the master slice index. Start here.
- [phase-1/protocol.md](phase-1/protocol.md) — the durable execution protocol (authority order, required reading, status model, checklists, invariants, templates, update protocol, acceptance rules).
- [phase-1/gates.md](phase-1/gates.md) — golden scenario gate definitions `GG-00` through `GG-16`.
- [phase-1/coverage.md](phase-1/coverage.md) — foundation snapshot and feature-to-slice routing matrices.
- [phase-1/log.md](phase-1/log.md) — the append-only progress log.
- `phase-1/slices/` — one record per accepted slice; the canonical home for acceptance evidence.

Why the split happened, and what was rejected instead, is recorded in [decision 0004](../decisions/0004-documentation-structure.md).

Nothing was deleted in the split; every section was relocated — the split commit's diff is the complete evidence. The migration map that guided it lives at `temporary-transcripts/ai-graph-and-folder-structure/2026-08-24-roadmap-split-migration-map.md` (the untracked ideas folder) while it exists.
