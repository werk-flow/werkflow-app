# P1-05 — Scoped responsibilities

Status: closed (2026-08-06) — accepted P1-05 acceptance record; canonical home for the slice's evidence

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

Default roles gain clear scoped responsibilities, approvers, substitutes, and date-effective delegation without exposing a generic unsafe role builder

## Direct dependencies

`P1-03`

## Primary and connected specs

Employee management; time; calendar; all approval consumers

## Acceptance evidence

Implemented and accepted 2026-08-06. Migrations `add_scoped_responsibilities`, `guard_responsibility_snapshot_on_org_delete`, and `index_scoped_responsibility_foreign_keys` add the fixed `time_approval`/`leave_approval` vocabulary, append-only effective configuration/assignment/event history, inclusive Berlin-date substitutes, self-or-manager RLS via `app_private` SECURITY DEFINER helpers, owner/admin and sole-selected-holder backstops, Realtime publication, replica identity full, and indexed foreign keys. Existing organizations received role-default snapshots, preserving Admin/Büro behavior until an owner selects named holders. One pure resolver returns `role_default`, `direct_assignment`, or `delegation`; live time approval consumes it at action time, ordinary selected employees gain only approval scope, self-approval is always denied, Büro-owned new manual entries become pending, admin-owned additions remain the recovery default, and expired/ended substitutes are denied even from stale UI. UI includes owner-only preview/confirmation and substitute maintenance, Büro read-only settings, affected-person self visibility, member-detail summaries, understandable stranding errors, and no role builder. Live inspection verified all organizations had consistent `admin_id`/sole-admin membership, all three operational tables were published, RLS isolation worked with real credentials, and database advisors showed no new security or unindexed-FK findings. `@P1-05` covers preview, holder/non-holder action behavior, four eyes, substitute window/end at the action boundary, owner/last-holder protection, self-read RLS, and organization isolation; post-review full suite 50/50 on a fresh production build, unit suite 35/35. CodeRabbit reviewed committed slice `7424fc8`: 31 findings, 27 fixed (calendar/range validation, future-exit inclusion, deterministic anomalous-overlap resolution + regression, action promise errors, authorized-before-profile reads, complete stranding diagnostics, UI states, and harness hardening), 4 skipped: (1) cross-request responsibility caching would violate the explicit action-time expiry invariant; (2) the proposed component-level `history` tab clamp is redundant because the server page already maps every URL value except `approvals` to `overview`; (3) sharing the denial-copy constant with Playwright would couple the independent acceptance assertion to the client implementation and make it tautological; (4) resetting the pending count to zero on a transient failure would violate the documented keep-last-known rule. Ownership transfer, vacation workflow, complete correction requests, inbox/notifications, privacy tiers, teams/skills, and offboarding reassignment remain in their owning slices.

## Known consequences (recorded 2026-09-03)

- Ownership transfer and emergency owner recovery do not exist. The last effective Admin and the organization owner are protected by P1-24; transferring ownership itself remains open (employee-management open decisions).

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
