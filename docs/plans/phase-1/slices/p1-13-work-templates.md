# P1-13 — Work templates

Status: complete (accepted 2026-08-23)

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

Organizations can create versioned SHK work templates that produce editable job/project tasks, checklists, required evidence, planned roles/material, and dependencies without committing stock or schedule

## Direct dependencies

`P1-02`, `P1-07`

## Primary and connected specs

Jobs/projects; documents; inventory; calendar

## Acceptance evidence

Implemented and accepted 2026-08-23 from baseline `e8bd727`; plan and decisions: [`p1-13-work-templates-implementation-plan.md`](../../p1-13-work-templates-implementation-plan.md). Published versions are immutable; application atomically materializes provenance-bearing rows into the existing instruction/checklist, planned-material, and capability-requirement models, while project instructions use the same extended primitive. Evidence expectations and structural dependencies remain metadata for later slices. No application reserves stock, creates schedule/dispatch/time rows, creates documents, or rewrites earlier work. Managers can create, publish, version, archive/reactivate, inspect history, and apply at every confirmed creation point or afterward; employees retain the existing simple assigned-job checklist and cannot manage templates. Sixteen committed P1-13 migrations were applied DEV-first and PROD-second; production retained zero template/provenance rows on deploy day and the Security Advisor reported no findings. The catalog and Wave 2 ledger close all 27 flows (`27/27 mapped; 27/27 fully evidenced; 0 partial; 0 unmapped`). Evidence: TypeScript/lint/diff clean, unit 200/200, database lint clean except one pre-existing unused parameter, focused Golden 4/4, affected Wave-1 audits A1/A2/A5 green (post-review A1 28/28), CodeRabbit reviewed twice with valid findings fixed, final focused `@AUDIT-W2-P1-13` 6/6 (world `mt53i68y`, 4.7m), then full Golden 97/97 (world `mt53oa0k`, 29.5m), both with zero leftovers on one frozen production build.

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
- Implementation plan (confirmed contract, flow list, execution ledger): [p1-13-work-templates-implementation-plan.md](../../p1-13-work-templates-implementation-plan.md)
- Audit ledger rows: [wave-2-audit.md](../../wave-2-audit.md)
