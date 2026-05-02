2# Realtime Audit Bugs

## Slice 1: Clock State Everywhere

No clock-state propagation bugs were reproduced in the audited surfaces after the baseline/provider fixes.

Notes:

- `clockIn`, `switchJob`, and `clockOut` all propagated across the tested `zeiterfassung`, `kalender`, `auftraege`, `mitarbeiter/[userId]`, and `auftraege/projekt/[projectNumber]` surfaces.
- Remaining clock-related risk is limited to surfaces not yet covered by later slices, especially derived summaries and table-specific active indicators that are handled outside the basic shell/status contract.

## Slice 2: Auftraege Collection Sync

Findings reproduced:

- Fixed: `getNextJobNumber()` surfaced a stale duplicate (`AUF-2026-016`) during the create-job flow because the backing `public.generate_job_number()` function used `COUNT(*) + 1`. The function now derives the next value from the highest canonical `AUF-YYYY-NNN` suffix and was verified to return `AUF-2026-017`.
- Open: the floating clock action overlaps the tiny unassign control in `job-detail-content`, which blocked an explicit browser verification of the `unassign employee` mutation from the page UI.

Verified working paths in this slice:

- project create propagation to overview and project detail
- job create propagation to overview, job detail, and calendar job picker
- moving a job into a project
- assigning an employee to a job
- job delete propagation to project detail, overview, and calendar job picker
- project delete propagation back to the overview

## Slice 3: Detail Pages And Derived Summaries

No blocking derived-summary propagation bug was reproduced in the audited surfaces.

Notes:

- `project-detail` counts, `mitarbeiter/[userId]` embedded auftraege state, and calendar parked/live derivations all responded to the same underlying `jobs` / `projects` / `job_assignments` mutations without manual reload.
- The `kunden/[clientId]` embedded section produced a weaker cleanup signal than the other Slice 3 surfaces during the focused probe: the insert-path update was visible under a pinned search filter, but the delete-path diff was not as visually distinct even though the synthetic project was removed from the database. This did not surface a concrete correctness bug, but it leaves a small residual verification gap for that exact filtered state.

## Slice 4: Remaining Realtime Domains

No remaining-domain realtime bug was reproduced.

Verified working paths:

- `entry_change_requests` propagation to the `zeiterfassung` nav badge, approvals-tab badge, and `mitarbeiter` pending-requests quick-stats link
- `organization_invites` propagation to the `mitarbeiter` invitations tab badge
- auth/session edge protections in `RealtimeProvider` (`getSession`, `onAuthStateChange`, and visibility-based synthetic refresh)

Optional new realtime candidates after correctness restoration:

- `clients` table updates could join the centralized provider if you want customer-name/contact edits to invalidate all linked cards and tables instantly, not just on navigation/manual refresh.
- `organization_members` mutations could join the provider if you want role/member-list changes to propagate with the same consistency as invites and clock-state surfaces.
