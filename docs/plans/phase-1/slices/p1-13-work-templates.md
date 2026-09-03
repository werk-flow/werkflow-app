# P1-13 — Work templates

Status: closed (2026-08-23) — accepted P1-13 acceptance record; canonical home for the slice's evidence

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

Organizations can create versioned SHK work templates that produce editable job/project tasks, checklists, required evidence, planned roles/material, and dependencies without committing stock or schedule

## Direct dependencies

`P1-02`, `P1-07`

## Primary and connected specs

Jobs/projects; documents; inventory; calendar

## Acceptance evidence

Implemented and accepted 2026-08-23 from baseline `e8bd727`; plan and decisions: [implementation plan below](#implementation-plan-merged-2026-09-03-from-the-former-separate-plan-file). Published versions are immutable; application atomically materializes provenance-bearing rows into the existing instruction/checklist, planned-material, and capability-requirement models, while project instructions use the same extended primitive. Evidence expectations and structural dependencies remain metadata for later slices. No application reserves stock, creates schedule/dispatch/time rows, creates documents, or rewrites earlier work. Managers can create, publish, version, archive/reactivate, inspect history, and apply at every confirmed creation point or afterward; employees retain the existing simple assigned-job checklist and cannot manage templates. Sixteen committed P1-13 migrations were applied DEV-first and PROD-second; production retained zero template/provenance rows on deploy day and the Security Advisor reported no findings. The catalog and Wave 2 ledger close all 27 flows (`27/27 mapped; 27/27 fully evidenced; 0 partial; 0 unmapped`). Evidence: TypeScript/lint/diff clean, unit 200/200, database lint clean except one pre-existing unused parameter, focused Golden 4/4, affected Wave-1 audits A1/A2/A5 green (post-review A1 28/28), CodeRabbit reviewed twice with valid findings fixed, final focused `@AUDIT-W2-P1-13` 6/6 (world `mt53i68y`, 4.7m), then full Golden 97/97 (world `mt53oa0k`, 29.5m), both with zero leftovers on one frozen production build.

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
- Audit ledger rows: [wave-2-audit.md](../../wave-2-audit.md)

## Implementation plan (merged 2026-09-03 from the former separate plan file)

Implementation started on 22 August 2026 from baseline `e8bd727`. The owner gate confirmed items 2 through 8 and the recommended approach on 22 August 2026.

### Bounded outcome

Organizations can create and publish versioned SHK work templates for either an Auftrag or a Projekt. Applying a published version materializes editable rows in the existing instruction, planned-material, and capability-requirement models. Published versions and completed applications retain their historical meaning. The slice does not reserve stock, create planning occurrences, schedule or dispatch work, record actual time, create documents, approve evidence, or enforce task dependencies.

### Domain decisions

- `work_templates` owns the stable organization-scoped identity and archive state.
- `work_template_versions` owns numbered drafts and immutable published versions. A template has at most one draft and one current published version.
- Normalized version rows own task and checklist items, evidence expectations, material plans, capability requirements, and structural dependencies.
- Publishing validates the draft and dependency graph, then makes the version and all its child rows immutable.
- Editing a published template creates a new draft version. Existing published versions and applied work never change.
- `work_template_applications` records the exact version and target. An organization-scoped idempotency key makes retries safe.
- Applying materializes instruction items, evidence expectations, dependencies, material lines, and capability requirements into their existing owning tables.
- The existing `job_instruction_items` table expands to accept exactly one Auftrag or Projekt target. Existing rows keep their old meaning and defaults.
- Capability requirements remain one authoritative set per work target. Applying a template merges duplicates and never weakens `require_confirmation = true`.
- Employees see template-produced Auftrag items through the same checklist they use today. Projekt template content remains manager-only.

### Application rules

- Matching published templates are optional in all shared direct-create forms, customer and employee context creation, project child creation, calendar creation, and request conversion.
- Managers can also apply a matching version after creation while the Auftrag or Projekt is not complete.
- The same version cannot be applied twice to the same target. A different template or newer version is additive after an explicit duplicate-content warning.
- The server reloads organization, version, target, assignments, and reference state at action time.
- Retired material, location, or capability references block the whole application. The target stays unchanged.
- Produced rows remain editable through their owning work-detail sections. Later template edits never overwrite them.
- Qualification assessment includes template capability requirements. Existing assignments require the established fingerprinted reason when coverage is incomplete.
- Request conversion claims and links the request only after work creation and template application succeed. Failures remove the new work.

### Where the confirmed flow contract lives

The 27 confirmed flows `P1-13-F01` through `P1-13-F27` live in the [user-flow catalog](../../../product/user-flow-catalog.md#p1-13--versionierte-arbeitsvorlagen-2026-08-23).

### Data and authorization plan

- Add all schema changes in committed migrations. Apply DEV first with the linked CLI, verify it, regenerate TypeScript types once, and apply the identical SQL to production only after DEV acceptance.
- Enable RLS on every new public table. Authenticated users receive only the reads their role needs. Business writes run through authorized server actions and service-role-only RPCs.
- Use `app_private` SECURITY DEFINER helpers for membership and assigned-job checks. Policies do not query RLS-protected tables directly.
- Publish mutable operational tables through `supabase_realtime` with replica identity full. Keep append-only event tables outside the publication.
- Add work-template cache tags and invalidate the existing jobs, projects, inventory, and qualification tags after application.

### Test and release plan

- Add focused unit tests for draft normalization, publish validation, dependency cycles, merge rules, duplicate application, and qualification input composition.
- Add `tests/golden/p1-13.spec.ts` tagged `@P1-13`.
- Add `tests/audit/wave-2/p1-13.spec.ts` with `@AUDIT-W2 @AUDIT-W2-P1-13`, using only run-day offsets +70 through +74 at 06:00 Europe/Berlin.
- Map every clause of all 27 flows to executable assertions. Assert persisted state, organization isolation, and zero stock, schedule, dispatch, time, document, and attention side effects.
- Rerun affected Wave 1 audit tags `@AUDIT-W1-A1`, `@AUDIT-W1-A2`, and `@AUDIT-W1-A5`.
- Follow the per-slice ladder in `wave-2-audit.md`, including CodeRabbit fixes, re-freeze, a fresh production build and server, focused audit, and one final full Golden run.
- Close the catalog, Wave 2 ledger, both left-behind-state registers, gate log, feature contracts, technical docs, and roadmap before acceptance.
