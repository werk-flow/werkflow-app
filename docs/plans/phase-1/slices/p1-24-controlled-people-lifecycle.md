# P1-24 — Controlled people lifecycle

Status: closed — accepted complete 2026-09-02

## Bounded outcome

Protected personnel documents, bounded onboarding requirements and acknowledgements, organization-scoped access transitions, employment transitions, and explicit responsibility handoff form one controlled people lifecycle around the existing stable personnel identity. The slice preserves operational history and leaves physical asset return, final settlement, immutable retention, legal hold, and full organization export to their owning later slices.

## Direct dependencies

- `P1-03` owns `employee_records`, employment conditions, personnel history, and invite-to-record linking.
- `P1-05` owns fixed approval responsibilities, effective-holder resolution, delegation, previews, and stranded-holder checks.
- `P1-07` owns `/aufgaben`, attention derivation, read state, and its live badge.
- `P1-09` owns teams, qualifications, evidence, and planning assessments.
- `P1-23` owns stable employee identity in time accounts, period versions, statements, and payroll-ready exports.

## Discovery baseline

- Clean local `main` at `96467b7c504620c1acba886895a69156c7745305` matches `origin/partner-preview`; `origin/main` remains at `cdfa47f69e1fe933366f6fae05bc78ccc8cd824c`.
- `P1-23` is accepted complete. All P1-24 direct dependencies are complete, so P1-24 is next in roadmap order; P1-25 is also dependency-ready.
- Documentation checks pass and the retained-world inventory is empty.
- Code, generated types, migration history, and live DEV/PROD database state are being inspected before implementation.
- P1-24 owns Wave 2 audit offsets `+125 … +129`.

## Scope boundaries

- P1-24 must consume the existing personnel, invitation, document, responsibility, attention, qualification, job, time, and Realtime owners instead of duplicating them.
- P1-25 exclusively owns inventory catalog and supplier master data. P1-32 owns asset custody and return. P1-33 owns full offboarding, physical return closure, final time/leave settlement, and replacement of destructive member removal. P1-45 owns immutable retention, legal hold, category-specific retention, external sharing, and complete organization portability.
- No external account, provider, paid resource, storage bucket, delivery channel, generic permission system, workflow engine, HR platform, payroll system, legal claim, or inferred production transition belongs to this slice.
- Product code, schema, migrations, CodeRabbit review, tests, and browser worlds remain paused until the product owner confirms the pre-implementation report.

## Parallel ownership

- P1-25 owns inventory catalog and supplier master data, supplier references, pack and unit conversions, alternatives, versioned costs and prices, import updates, and catalog history.
- P1-24 owns personnel lifecycle, protected personnel documents, onboarding, organization access transitions, responsibility reassignment, and its tests and migrations.
- If both slices require one shared file, ownership must be coordinated before either implementation edits it.

## Decision gate

Closed on 2026-09-02. The product owner confirmed report items 1–14, the 66-flow contract, DEV-first and PROD-second rollout, CodeRabbit CLI review, and the mandatory closing campaign audit before implementation began.

## Accepted decisions

- `employee_records.id` remains the stable organization-specific person identity. Auth users, profiles, organization memberships, personnel records, and invitations remain distinct.
- Organization access uses a separate versioned lifecycle keyed to the personnel record. A missing lifecycle row preserves the existing membership behavior and appears as `Bisheriger Zugang – nicht gesteuert` inside the new workflow.
- Access states are `not_configured`, `scheduled`, `active`, `suspended`, and `ended`. Effective authorization uses the database clock. Immediate suspension is never blocked by unfinished handoff work.
- A future starter may redeem an invite before the start date. Until activation, the person receives only the bounded own-onboarding view.
- The organization owner and the last effective Admin cannot be suspended or ended without a safe successor.
- Employment uses a separate versioned lifecycle with `planned`, `active`, `notice`, `inactive`, and `exited` states. Existing records keep their date-derived presentation until a controlled lifecycle starts.
- P1-24 inventories responsibilities, pending approvals, attention, and active work before an employment transition. It reuses P1-05 configuration and the existing job-assignment owner for explicit reassignment.
- The last effective holder blocks employment-transition completion. Other unresolved work remains a visible reasoned exception. P1-33 owns final settlement, physical return, full revocation closure, and destructive-removal replacement.
- Protected documents reuse `documents`, versions, audit, signed URLs, and private R2. The protected metadata owner is `employee_records.id`; ordinary `document_links.employee_id` rows remain unchanged.
- Protection classes are `personnel_standard`, `admin_restricted`, and `health_evidence`. Admin may inspect every class. Büro may manage standard files and receives status-only projections for restricted files. Affected employees receive only explicit releases or their own requested evidence.
- Protected-document access never follows a responsibility, ordinary document permission, job assignment, or planning role.
- Organizations receive no seeded onboarding template. Published template versions are immutable; instantiated plans remain editable.
- Requirement types are `document`, `qualification`, `employment_condition`, `work_schedule`, `team`, `access`, `acknowledgement`, and `manual`. Requirement states are `missing`, `pending`, `fulfilled`, `blocked`, `waived`, and `cancelled`. Document evidence separately reports `missing`, `pending`, `valid`, `expiring`, and `superseded`.
- Only an explicit access-blocker requirement prevents activation. Missing configuration never appears complete, compliant, available, or zero.
- An acknowledgement proves that the affected person saw or received one exact version at one time. WerkFlow makes no signature or legal-sufficiency claim.
- P1-24 export is a bounded per-person manifest plus existing authorized file downloads. P1-45 owns immutable retention, legal hold, category-specific periods, and complete organization export.
- Deploy-day migrations insert no business rows and infer no lifecycle, plan, requirement, classification, release, acknowledgement, suspension, or exit.

## Accepted flow contract

The owner accepted `P1-24-F01` through `P1-24-F66` from the pre-implementation report. The contract covers these observable groups:

- `F01`–`F06`: honest empty states; linked and no-login manager entry; own-action visibility; employee and outsider denial.
- `F07`–`F21`: protected upload and stable ownership; ordinary-link separation; direct R2 reuse; version replacement; fixed privacy classes; health-evidence restrictions; explicit employee release and upload; exact-version acknowledgement; history; status-only operational projection; protected trash, deletion exception, and bounded export.
- `F22`–`F35`: empty template baseline; organization templates and immutable versions; editable plan instances; typed requirements, owners, dates, blockers and evidence; exact references to existing domains; missing, pending, valid, expiring and superseded document evidence; explicit blocking; acknowledgement; stale and idempotent mutations; `/aufgaben` reuse; no-login behavior.
- `F36`–`F45`: future access start; bounded pre-start self-service; database-clock activation; invite-state separation; immediate and scheduled suspension; active-session denial; multi-organization safety; reactivation; owner and last-Admin protection.
- `F46`–`F56`: planned employment, notice and exit; responsibility, approval, attention and work inventory; explicit P1-05 and job reassignment; last-holder blocking; security-first immediate suspension; retained identity; inactive planning; reversal/reactivation; visible P1-33 handoff.
- `F57`–`F66`: Büro and health boundaries; responsibility-holder denial; atomic validation; stale conflict; Realtime catch-up; zero-change deployment; honest missing configuration; no legal overclaim; no external resource or global Auth ban; no duplicate domain.

The final user-flow catalog and Wave 2 ledger spell out every stable ID and its acceptance evidence.

## Reserved acceptance dates

P1-24 owns Berlin run-day offsets `+125 … +129`. The next unassigned Wave 2 block is `+130 … +134`.

## Acceptance record

Accepted complete on 2026-09-02.

### Delivered boundaries

- `employee_records.id` owns organization-specific lifecycle and protected-document metadata. Existing Auth users, profiles, memberships, invitations, ordinary document links and historical operational references remain separate and unchanged.
- Versioned access and employment roots hold effective state; append-only transitions retain actor, time, reason, prior/new state and operation identity. Existing memberships without a lifecycle remain operational. Immediate suspension is organization-scoped and does not disable global Auth.
- Organization templates have immutable published versions. Editable plan instances contain bounded typed requirements and exact references to existing document, qualification, condition, schedule, team, access or acknowledgement facts without copying those domains.
- Protected metadata reuses `documents`, `document_versions`, `document_audit_events`, signed URLs and the private direct-to-R2 upload path. `personnel_standard`, `admin_restricted` and `health_evidence` are separate from ordinary `document_links`; releases and acknowledgements bind an exact document version.
- The manager lifecycle section, employee `/aufgaben` integration and `/onboarding/meine-aufgaben` surface use the existing component, live-view and pending-action patterns. The transition projection inventories responsibilities, pending approvals, attention and active assignments; P1-05 and job ownership remain authoritative.
- P1-33 retains full offboarding, physical return, final settlement and destructive-removal replacement. P1-45 retains immutable retention, legal hold, category periods and complete organization export. No external resource or canary case was added.

### Schema and rollout

Twelve additive committed migrations define 14 business tables, typed vocabularies, immutable history, atomic/idempotent RPCs, organization-validation triggers, composite foreign keys, grants and RLS. Seven mutable roots are in `supabase_realtime` with unique `(id, organization_id)` replica indexes and `REPLICA IDENTITY USING INDEX`; transition, version, item, acknowledgement, reference, operation and event children remain unpublished. The protected-document classifier is a caller-independent private helper, while public wrapper checks bind authorization to `auth.uid()`.

All migrations replayed locally and passed `supabase/tests/p1_24_people_lifecycle.sql`. They reached DEV `mbkkzuqjbdvzelqvuzcn` first, followed by generated-type, migration-history and Realtime checks. The identical SQL then reached read-only-discovered PROD `jbgaqpdjauzoocplgdsn`; its historical ledger assigned execution-time versions to the last two statements, so the existing migration preflight refused a false filename-parity assumption and no ledger repair was attempted.

Deploy-day verification found zero rows in every P1-24 business table on DEV and PROD. DEV retained 1 personnel record, 1 membership, 0 invites/conditions/schedules/employee links, 1 document, 2 responsibility configurations, 2 assignments, 0 delegations and 0 capabilities. PROD retained 25 personnel records, 23 memberships, 6 invites, 0 conditions, 1 schedule, 43 documents, 4 employee links, 14 responsibility configurations, 48 assignments, 0 delegations and 0 capabilities. No template, plan, requirement, acknowledgement, lifecycle, transition, classification or release was inferred; no byte path or legacy history changed.

### Review and static verification

`bun run review:doctor` passed. The substantive complete CodeRabbit pass returned 44 findings. Every finding was checked against the accepted design: valid authorization, organization, replay, concurrency, storage-path, document-classification and visible-resolution findings landed; stale/already-fixed findings and proposals that violated historical retention or established layout authorization were rejected with reasons. Five post-fix convergence attempts ended before analysis with the same recoverable `WebSocket closed` transport error and produced no additional findings; they were not treated as a clean review. The accepted review fixes were covered by the checked SQL, unit, affected-scope and final browser evidence.

Final non-browser checks passed:

- `bun run typecheck`
- `bun run lint`
- `bun run test:unit`: 501/501 tests, 893 expectations, 48 files
- `bun run test:sql:p124`
- `bun run types:check`
- `bun run migrations:check`
- `bun run realtime:check`
- `bun run docs:check`: 78 documentation files

### Browser acceptance

| Evidence | Result | Run / world | Build / fingerprint | Duration |
| --- | --- | --- | --- | --- |
| Affected Wave 1 `@AUDIT-W1-A3` | 5/5 | `2026-09-02T131632349Z-67fd1a` / `mtk4e2nn` | `2d29222e…0211b3` | 3m07.239s |
| Affected Wave 1 `@AUDIT-W1-A1` | 28/28 | `2026-09-02T132004783Z-12cc6a` / `mtk4im1x` | `2d29222e…0211b3` | 10m56.144s |
| Affected Wave 1 `@AUDIT-W1-A4` | 6/6 | `2026-09-02T133128135Z-93f49a` / `mtk4x9h6` | `2d29222e…0211b3` | 3m27.700s |
| Affected Wave 1 `@AUDIT-W1-A5` | 4/4 | `2026-09-02T133533200Z-407dea` / `mtk52il8` | `2d29222e…0211b3` | 4m16.139s |
| Final `@AUDIT-W2-P1-24` | 2/2 | `2026-09-02T141923283Z-ef7516` / `mtk6mwbl` | local `lWNyQOU1sRfzV3ouIixuv` / `b0be4201…7c4e` | 42.844s |
| Expanded `@GG-07` | 8/8 | `2026-09-02T142023379Z-4453e4` / `mtk6o690` | local `lWNyQOU1sRfzV3ouIixuv` / `b0be4201…7c4e` | 1m25.717s |
| Exact P1-24 recovery proof | 4/4 | `2026-09-02T142239588Z-b1f4bc` / `mtk6r3pv` | local `lWNyQOU1sRfzV3ouIixuv` / `b0be4201…7c4e` | 1m05.832s |
| Complete local Golden | 142/142 | `2026-09-02T142405848Z-0f71ea` / `mtk6sy8s` | local `lWNyQOU1sRfzV3ouIixuv` / `b0be4201…7c4e` | 28m21.665s |
| Complete DEV canary | 9/9 | `2026-09-02T145603394Z-e62632` / `mtk7y244` | DEV `hIiYJcAZtTVB7JNsvJ0-W` / `b0be4201…7c4e` | 2m29.824s |

All accepted worlds tore down. The final run inventory reports `Open retained worlds: 0`. No complete audit battery ran because P1-24 is a per-slice gate, not the Wave 2 end gate. The affected tags were A1 for membership/document boundaries, A3 for personnel/time history, A4 for health-evidence privacy, and A5 for responsibilities, attention and qualifications.

### Catalog closure

`P1-24-F01` through `P1-24-F66` are stable in the user-flow catalog. The Wave 2 ledger closes at `66/66 mapped; 66/66 fully evidenced; 0 partial; 0 unmapped`.

## Post-implementation campaign audit

The audit reviewed every P1-24 runner manifest, retained-world classification and cleanup, the gate and incident logs, SQL/migration evidence, CodeRabbit output, detached-command logs and the commands that created no manifest. This includes the failed focused/diagnostic runs, the 140/142 certification, the exact recovery proofs, the successful complete certification and canary, a pre-world retry-budget refusal, the DEV verification query that named the wrong responsibility table, the production migration dry-run refusal and the CodeRabbit transport failures.

### Durable findings

| Finding | Recurrence judgment and tier | Change | Verification |
| --- | --- | --- | --- |
| Protected upload cleanup named a second service-role environment variable. | Repeatable product-boundary error. Tier 1 makes it unwritable. | Cleanup uses `getSupabaseSecretKey()`; no parallel credential source remains. | Retained upload diagnostic passed, followed by P1-24, GG-07, SQL and full Golden proof. |
| Authorization helpers accepted caller-supplied identities, and protected version/history checks could depend on caller-visible classifier rows. | Repeatable security class. Tier 1 moves identity/classification to trusted database boundaries; Tier 2 SQL pins it. | Auth-bound wrapper helpers, private caller-independent classification, exact released-version checks, organization predicates and revoked unsafe grants landed in migrations 11–12. | Local replay, checked SQL, DEV/PROD inspection, affected A1/A4 and final acceptance passed. |
| Realtime/remount-aware searchable selection began before its semantic trigger existed. | Repeatable shared harness race. Tier 2 is the least invasive effective control. | `selectFromSearchable` waits for visible and enabled before bounded remount retries. | Final A3 5/5 and A1 28/28 passed. |
| The A3 leave-only holder assertion conflated the unified approvals entry with time-approval authority. | Repeatable authorization-test ambiguity. Tier 2 pins the narrower contract. | A3 uses the existing unavailable assertion for the time panel. | Final A3 passed 5/5. |
| The P1-24 transition stage read before Server Action completion and did not rehydrate its personnel ID when isolated. | Repeatable staged-test error. Tier 2 belongs at the stage boundary. | Each submission waits for dialog closure; each later stage reloads and asserts its persisted identity/precondition. | Exact P1-24 4/4 and complete Golden 142/142 passed. |

The missing audit import was statically detectable and the existing Tier 2 type checker caught it; no duplicate check was added. Development HMR/memory events are already excluded by the fresh-build certification protocol. The production ledger mismatch was stopped by the existing migration preflight, and the wrong read-only table name changed no state. CodeRabbit's repeated transport closure is outside repository control; the wrapper surfaced a terminal failure before findings, so retries were recorded but no rule was invented. The P1-23 Tier 3 serialization boundary remains: reset, SQL and unit processes ran serially because another host process cannot be controlled here.

No enforcement-backlog item is needed. Every credible repeatable class landed at Tier 1 or Tier 2, or was already enforced. A final inspection of the verification runs found no further durable prevention candidate.
