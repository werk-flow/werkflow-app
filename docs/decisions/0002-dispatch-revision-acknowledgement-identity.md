# 0002 — Dispatch Revision And Acknowledgement Identity

- **Status:** accepted (2026-08-13)
- **Date:** 2026-08-13
- **Owner:** Product owner (Tamay), confirmed via the P1-12 pre-implementation report (items 2, 3, 5, 6)
- **Affects:** Calendar/dispatch (`P1-12`), field work pack (`P1-16`), service dispatch (`P1-19`), mobile shell (`P1-49`), communications (`P1-46`)

## Decision

A dispatch is a **narrow versioned work instruction** with a stable identity and an enforced exclusive target: exactly one `job_visit` planning occurrence (scheduled work) XOR exactly one job without that occurrence (genuinely unscheduled work). It is never a boolean on a job, occurrence, or assignment, and unscheduled work never becomes a schedule-less occurrence.

1. **Identity:** `planning_dispatches` (organization-scoped, `active`/`cancelled`, at most one active dispatch per target, creation idempotency key). The dispatch id is the durable reference; attention items and audit key on it.
2. **Revision = the instruction actually issued:** append-only `planning_dispatch_revisions` snapshot the material facts — target reference, planned instants/dates, location source, dispatch note, recipient employee-record set — under a SQL-computed `material_fingerprint`. Cosmetic job edits are outside the fingerprint and never churn revisions. Retries with an unchanged fingerprint are no-ops.
3. **Recipients are employee records; actors are users.** Recipients key to stable `employee_records` (including non-login personnel, whose acknowledgement state derives to a labeled `nicht möglich`). Every acknowledgement/challenge row records the acting authorized user separately.
4. **Acknowledgement is (revision, recipient)-scoped and append-only:** states `acknowledged`, `challenged` (bounded reason, manager resolution recorded), `carried_forward` (traceable lineage when only the recipient set changed and this recipient's facts did not). Latest row per (revision, recipient) wins; superseded revisions keep their rows verbatim.
5. **Supersession is transactional with the schedule:** deferred, fingerprint-idempotent database triggers on occurrence material columns, status, and assignments guarantee that a materially moved, reassigned, cancelled, or skipped dispatched occurrence supersedes its current revision in the same transaction — no mutation path can leave a stale acknowledged instruction.
6. **Unscheduled → scheduled is a traceable target transition** (`target_scheduled` revision on the same dispatch identity), never a silent meaning change.
7. **Acknowledgement proves only itself:** a specific person confirmed one exact revision at a recorded time. It is not attendance, recorded time, customer agreement, consent, or message delivery, and no surface may present it as such.
8. **Customer commitments are a separate fact** (`planning_customer_commitments`): occurrence-scoped, manually recorded (window, source, optional contact, actor), never rewritten by schedule moves — a mismatch is a visible required action. Delivery of any customer message remains `P1-46`.

## Rejected Alternatives

- Job/assignment-level `acknowledged` booleans — cannot express visit, revision, recipient, challenge, or supersession; overloads `scheduled`.
- Extending `planning_occurrences` to carry unscheduled work — a second occurrence semantics inside the P1-11 model.
- A generic messaging/workflow/approval platform — duplicates P1-07 attention, pre-implements P1-46, and obscures the concrete question: which person acknowledged which current work instruction.

## Revisit Triggers

`P1-16` field work pack (dispatch consumption on mobile), `P1-19` service dispatch (urgency/on-call semantics), `P1-46` (customer-facing delivery of dispatch-adjacent messages), `P1-49` offline acknowledgement queueing.
