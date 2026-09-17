# Pre-Wave-3 step 5: beta acceptance and the production rollout

Status: living — last reviewed 2026-09-18; starting brief written at the close of Step 3, not a complete plan; runs only after steps 1 to 4 are closed and on the owner's explicit request

## Read this first

This brief is a starting point, not a finished plan, and it is the one step in this folder that touches production. It runs after the four earlier pre-Wave-3 steps are closed and only when the owner asks for the release; nothing here authorizes a commit, a push or a production change by itself. Before doing anything, read `AGENTS.md` (Infrastructure, Branches, And Deployment), [environments.md](../../../technical/environments.md) including the migration rule, [security.md](../../../technical/security.md), [testing.md](../../../technical/testing.md), [decision 0007](../../../decisions/0007-independent-test-groups.md), the [owner decisions](../hardening-2026-09/07-step-3-final-beta-acceptance.md#owner-decisions-required-before-or-at-release) in the Step 3 record (the rollout checklist itself is below, in this file), and the [recovery and incident](../../../technical/recovery-and-incidents.md) reference. Fill the deep-dive section, then agree the exact sequence with the owner before the first irreversible action.

Handoff prompt for the agent that takes this step:

> Read `AGENTS.md`, then `docs/plans/phase-1/pre-wave-3/05-beta-acceptance-and-production-rollout.md` and everything it links. This step carries the working tree of Steps 1 to 3 and the pre-Wave-3 work into beta acceptance and production: a fresh full local release verification and cloud canary on the final tree, the commit and push to `partner-preview` for the owner's review, then, on the owner's explicit go, the coordinated rollout to the PROD Supabase project and the push of `main`. Verify every fact of the brief against the live projects first, confirm each irreversible action with the owner before performing it, and record the exact evidence in this file. The owner's rule for PROD data: everything that does not belong to the Willert Haustechnik organization is disposable test data.

## What "beta acceptance" means here

The owner decided on 14 September that beta acceptance comes after the four pre-Wave-3 steps. The acceptance evidence is a fresh, single local release-mode verification (`bun run test:verify --mode release --jobs 2`) that passes all 40 groups on the final tree, plus the cloud canary (`bun run test:server cloud`, `bun run test:verify --target cloud`) against DEV. The Step 3 campaign's reports are history, not acceptance for this tree: every step since changed inputs, and the local proofs of 14 September were invalidated by a WSL address change anyway (see the testing brief).

## The coordinated rollout

Moved here from the Step 3 record on 2026-09-14; the record keeps a pointer. This is the single living checklist for the release.

Inventory of the candidate, to be executed only on the owner's explicit release instruction:

1. Application: the local `main` working tree after Step 3, committed as one or more reviewed commits on top of `d51988e`. Publish first to `partner-preview`. `origin/main` advances only with the production release request.
2. Database: eight migrations already on DEV and local, absent on PROD, applied in commit order: `20260907010000_atomic_email_change_challenges`, `20260907010100_protect_existing_event_ledgers`, `20260907010200_private_realtime_deletions`, `20260908120000_preserve_email_change_send_windows`, `20260908192618_paginate_operational_lists`, `20260908193550_paginate_inventory_overview`, `20260908210716_preserve_job_list_sort_order`, `20260912210500_return_customer_page_rows`. Apply through MCP `apply_migration` against PROD with the identical committed SQL and align the ledger keys to the committed filenames afterwards, per the [migration rule](../../../technical/environments.md#the-migration-rule).
3. Edge functions: deploy `send-invite-email` and `send-email-change-current-otp` from `supabase/functions/` to PROD with the shared `_shared` boundary; verify the Resend secret exists in the PROD function store.
4. Compatibility order. Old app on new schema: the five `list_*_page` RPCs, the email-change tables and the ledger guards are additive; the old app keeps working. The private deletion transport is the exception: disabling raw DELETE publication removes deletion refresh from the old app, so migration 3 must be applied inside the cutover window, not ahead of it. New app on old schema: the new app calls the list RPCs and `transition_email_change` and would fail on a PROD without them, so the app must not go live before the migrations. Sequence: announce the maintenance window to the beta business, pause writes and drain requests, apply migrations 1 to 8, deploy both functions, promote the app, require open tabs to reload, then verify.
5. Verification before reopening writes: `migrations:check`-equivalent ledger inspection on PROD (the script itself is DEV-only), the five list RPCs deny `anon`/`authenticated` on PROD, an authorized receiver observes a real deletion through the new transport, a login and one customer-list page load succeed, and the security headers are present on the deployed origin. The DEV canary is not PROD proof.
6. Backups and rollback: take a PROD backup immediately before the window (daily backups with 7-day retention exist; PITR is deferred by decision). Rollback keeps app and database compatible: roll the app back only together with re-enabling raw DELETE publication, or keep the new app. Rolling back only the app after migration 3 is unsafe. New data written by the new app in the list, email-change and ledger tables stays valid under the old app.
7. Monitoring: Vercel runtime errors and Supabase logs for the first hour; the Step 1 recovery runbook owns incident steps.
8. Deployed checks that require the deployment and stay open as a final gate with the owner: the report-only script policy (SEC-08 option 3) and a two-organization confidentiality spot check of the deployed shells through the CDN.

### Production document storage

PROD still serves documents from the retired Supabase bucket: 40 objects and 43 `documents` rows (41 trashed) reference `organization-documents`, while the application writes and reads R2 only. Before the cutover, either run `scripts/migrate-documents-to-r2.ts` against PROD (dev-first rehearsal on DEV is impossible there, DEV is empty; rehearse on the local stack with seeded rows) or discard those rows and objects if the owner confirms they are test uploads. Ownership inspected live on 2026-09-14: "Organisation 1" (a test organization; members at coban.cc, example.com, fabaos.com) owns 40 of the documents, 39 in the trash; "Willert Haustechnik", the actual beta customer, owns 3 (`image.jpg` and `Willert-Icon email.jpg` from 2026-07-17, both trashed; one live photo from 2026-07-21); the other organizations own none. Owner's rule (2026-09-14): everything that does not belong to the Willert Haustechnik organization is disposable test data and is deleted; the Willert documents are migrated to R2 with the script (the owner decides whether the two trashed images go too). Only then retire the bucket, its storage policies and the script (CL-D1).

### Order of execution

1. Steps 1 to 4 of this folder are closed with evidence.
2. The [signed-download tightening](#signed-download-tightening-before-the-release-run) and the [OTP hashing](#email-change-otp-hashing-before-the-release-run) below were implemented on 2026-09-18 at the close of step 4 (their unit tests, the account-boundaries fixture, typecheck, lint and knip pass; [security.md](../../../technical/security.md) and the backlog are updated); the release run of this step is their browser and canary proof. No further code change precedes the release run.
3. The fresh local release verification and the cloud canary pass on the final tree (see "What beta acceptance means here"); the reports are recorded in this file. Its four performance groups also supply the samples for the [reference recalibration](#performance-reference-recalibration), which happens right after the passing report and before the push.
4. Before the push: the Vercel variables are scoped per environment since 2026-09-18 (done by the owner, the target state is in [environments.md](../../../technical/environments.md); `EMAIL_OTP_HASH_SECRET` is set on both sides and in the three local backup files). The agent verifies on the new preview deployment that its Supabase URL is the DEV project, that the dev R2 bucket's CORS allows the branch URL `https://werkflow-app-git-partner-preview-werkflows-projects.vercel.app` (the owner adds it in the Cloudflare dashboard and removes it from the prod bucket; otherwise the agent runs `scripts/setup-r2-cors.ts` after extending it with the origin), and that DEV's auth redirect list allows that origin with `/**` (Supabase dashboard, Authentication, URL Configuration; or the Management API with `SUPABASE_ACCESS_TOKEN`). Then inventory item 1: push to `partner-preview` (steps 1 to 4 are already committed as `16fbc3a` and `f929a8d`); the owner reviews the preview on synthetic DEV data; the script policy runs in report-only mode there first (SEC-08) and its reports are read before the nonce decision.
5. Inventory items 6 then 2 to 4: backup, the migrations in order with migration 3 inside the cutover window, the edge functions, the compatibility order.
6. Production document storage: delete every document and object that is not Willert Haustechnik's, migrate the Willert documents with the script, re-verifying counts live first.
7. Push `main` on the owner's explicit go; inventory items 5, 7 and 8 against the production domain.
8. Retire the `organization-documents` bucket, its storage policies and the migration script (CL-D1) in a follow-up commit once PROD holds no reference (`profile-avatars` stays; it is in use).
9. Wave 3 resumes on `partner-preview`.

## Signed-download tightening before the release run

The CodeRabbit review of the pre-Wave-3 step 1 files on 2026-09-17 raised one major finding in `lib/storage/r2.ts`: `createSignedDownloadUrl` signs whatever object key it receives. Today no client value reaches it (each of the three callers passes the `storage_path` of a document row it has already authorized for the actor's organization), so it is not an open hole, but the owner decided on 2026-09-17 that a security finding is scheduled, not parked. It lands here, before the release run, so the beta candidate carries it and the release run proves it:

- Every storage key starts with the organization id (`buildDocumentStoragePath`, `buildDocumentVersionStoragePath` in `lib/documents/storage-path.ts`; the payroll export in `lib/time-accounts/actions.ts` writes `${orgId}/lohnexporte/...`). `createSignedDownloadUrl` takes `organizationId` next to `path` and refuses a path that does not start with `${organizationId}/`, contains a `..` segment or an empty segment; the same check guards `createSignedUploadUrl` and `headStorageObject` if they accept a caller-built key. Tier 1: the signer cannot produce a URL for another organization's object even if a caller is wrong.
- The three callers (`lib/documents/actions.ts`, `lib/personnel/lifecycle-actions.ts`, `lib/time-accounts/actions.ts`) pass the organization id they already hold. Two of them are capped legacy modules that may only shrink; fold the added property into an existing line.
- Tier 2: a unit test in `lib/storage/` proves the refusal for a foreign prefix, a traversal segment and an empty organization id, and the acceptance of a document, version and export key; `lib/documents/upload-targets.test.ts` and the storage-import boundary test stay green. Update the "Files" row of [security.md](../../../technical/security.md) with the mechanism and the test.
- Evidence: `unit:all`, and in the release run the document groups (`audit:wave-1:a2`, `audit:wave-2:p1-15`, `audit:wave-2:p1-24`, `golden:integrated`) and canary C2 exercise real downloads through the tightened signer. Record the report id in this file and remove the row from the [enforcement backlog](../../../technical/enforcement-ladder-backlog.md).

## Email-change OTP hashing before the release run

The CodeRabbit review of the pre-Wave-3 step 2 files on 2026-09-17 raised a second security finding, in `lib/settings/email-change-actions.ts`: `hashOtpCode` stores an unsalted SHA-256 of the six-digit code. The stored hash never leaves the server (the challenge table is service-role only since the Step 1 hardening), so this is not an open hole, but a leaked table would let anyone recover every live code with a million hashes. Scheduled here beside the signed-download tightening, before the release run:

- `hashOtpCode(code, userId)` computes HMAC-SHA256 with a server secret over `${userId}:${code}`; the digest stays 64 hex characters, so the `transition_email_change` RPC's format check (`^[a-f0-9]{64}$`) needs no migration. The secret is `EMAIL_OTP_HASH_SECRET`, declared beside the other server secrets in `lib/env/server.ts`, generated once per backend (32 random bytes, hex) and set in `.env.local` for the local stack, in the DEV and PROD Vercel environments, and in the recorded test environment; [environments.md](../../../technical/environments.md) gains the row. Tier 1: a stored hash is useless without the secret, and a hash for one user cannot verify another user's code.
- Every challenge is short-lived (five minutes), so no stored hash is migrated: a challenge created before the deploy fails verification and the user requests a new code. Deploy the secret before the code in every environment.
- Tier 2: a unit test proves that the same code hashes differently for two users and without the secret the action refuses to run; `lib/security/mail-handlers.test.ts` and the SQL group `sql:security` stay green. The canary's email-change check (C2) exercises the real path on DEV.
- Evidence: `unit:all`, `sql:security`, `audit:security:account` in the release run, and canary C2. Record the report id here and remove the row from the [enforcement backlog](../../../technical/enforcement-ladder-backlog.md).

## Performance reference recalibration

Decision D6 of the [testing-system review](01-testing-system-review.md#decisions), owner said yes on 14 September. The eleven performance references in `lib/testing/performance-baselines.json` were never remeasured after their first review on 8 to 12 September; they were copied forward seven times (five context-only transfers in Step 3, two in the review) each time a helper or its module identity changed, with a script proving the executed measurement unchanged. The file holds 108 entries for eleven scenarios. This step ends that chain with fresh numbers from the real beta candidate. Since 2026-09-17 all eleven scenarios are `calibrating` in `lib/testing/measured-scenarios.ts`: pre-Wave-3 steps 2 and 3 edited six digest inputs after the last transfer, so no reference matches the current digest and a `required` comparison would fail every measured group (`lib/testing/performance-references.test.ts` now refuses that state). The release run therefore records every scenario as `unverified`, which is allowed for calibrating scenarios, and supplies the samples:

1. The passing release report's four measured groups (`audit:performance:calendar`, `audit:performance:lists`, `audit:performance:calendar-live`, `audit:performance:planning`) each recorded three samples per scenario on the final build. Draft new references from those runs only: `bun scripts/calibrate-performance.ts --runs <calendar-run>,<lists-run>,<planning-run> --reason "Recalibration on the beta candidate <build id>; retires the Step 3 and pre-Wave-3 transfer chain (decision D6)"`. The command refuses failed, uncleaned, diagnostic or stale-input runs and writes a draft under `.agent-logs/performance-calibration/`; it activates nothing.
2. The owner reviews the draft: every scenario's three samples, the median that becomes the reference, and the comparison with the transferred reference it replaces (the report's `measurements` show both). A reference that is slower than the old one is a finding to explain, not a number to accept.
3. Replace the file: keep the draft's eleven entries, delete every older entry (the transferred copies and their originals), keep `tolerance` and `measurementVersion`, set every scenario back to `comparison: "required"` in `lib/testing/measured-scenarios.ts`, and run `bun test lib/testing/performance-baselines.test.ts lib/testing/performance-references.test.ts`; the validators reject a reference that is not its samples' median, an over-budget sample, and a required scenario without a reference at the current digest.
4. Rerun the four measured groups once on the same build (`bun run test:verify --group audit:performance:calendar,audit:performance:lists,audit:performance:calendar-live,audit:performance:planning`) to prove the required-comparison path against the new references; all comparisons must be `within` or `improved`. Record the report id here.
5. From then on a helper repair that changes a measurement digest needs a new calibration from real samples, never another transfer; the transfer scripts under `.agent-logs/step3-repairs/` and `.agent-logs/pre-wave-3-review/` are history.

## Owner decisions this step needs at the time

Given in advance on 2026-09-18 so the step can run end to end without the owner present (the owner's standing authorization for this one release; the agent still records every action with its timestamp, verification and rollback point):

- The go for every irreversible action is granted: the push to `partner-preview`, each PROD migration batch in the compatibility order, the edge-function deployments, the production document deletion and migration, and the push of `main`. Any number of `bun run review` passes is authorized. A failed gate, a failed PROD verification, or any unexplained state still stops the step; the agent then records the stop and waits, it never improvises a fix on production.
- The maintenance window is the night of the run: the beta business does not work at night, so no announcement precedes it; the agent still pauses and drains writes as item 4 describes and verifies before reopening.
- The two trashed Willert images are migrated with the live photo (three objects; the trash stays the user's to empty).
- The script policy stays report-only for this release (SEC-08 option 3); the nonce decision is taken after the owner has read the reports, as a later change, not tonight.
- The reference recalibration: the agent drafts and activates the references from the release run's samples; a scenario whose new median is slower than the transferred reference is recorded as a finding for the owner, not as a reason to stop.

## Heads-up from step 3 (2026-09-15): the clock flows and the calendar's reads changed

[Step 3](03-clock-fab-and-calendar-ux.md) landed with the static groups, `unit:all`, `ui:contracts`, `golden:p1-21` and `audit:performance:calendar-live` only; complete browser proof of these areas is this step's release run. Treat a failure in any of them as a likely consequence of that work before suspecting older code:

- The clock button opens a sheet of next actions instead of the activity form; two hot keys sit above it while clocked in; the dialog headings changed ("Laufende Zeiterfassung", "Aktivität wählen"); the job picker shows "Heute geplant" first. The shared helpers in `tests/golden/support/steps.ts` (`clockInOnJob`, `clockOut`, `startClockBreak`, `endClockBreak`, `switchClockJob`, `openActivityDialogFromSheet`) and `clockInConfirmationButton` in `tests/audit/support/a1-steps.ts` were repointed; `tests/audit/wave-2/p1-21.spec.ts` opens the full dialog through "Weitere Aktivitäten …". Every group that clocks in (A1, P1-06, P1-08, P1-16, P1-21, P1-22, the canary) exercises the new sheet.
- The clock state carries `resumeActivity` and `resumeJobInfo`; the canonical and legacy readers, the client schema and the optimistic echo changed.
- Fifteen surfaces read through `GET /api/background-read` instead of Server Actions (the Zeiterfassung page, the job page, member status); `POST /api/time-entries` is gone. A freshness regression on those pages belongs here first.
- The focus catch-up fires only after a 30-second absence (D5); a test that relied on a focus switch to refresh a receiver now needs the ordinary event path or a reconnect.
- `DialogBody` gained a 4 px vertical inset, `DialogContent` a `placement="anchored"` variant, and the global border-color rule moved into `@layer base`, so every `border-<color>` utility in the app renders for the first time (selected job filters, instruction items, drag targets, invalid inputs, warning blocks). A changed screenshot or contrast finding in either theme belongs here.
- The component-contract runner compiles the app's stylesheet (`WERKFLOW_UI_CONTRACT_CSS`); a harness failure at that step is a Tailwind compile problem, not a product one.
- `audit:performance:calendar-live` owes this tree a fresh pass: it failed twice in pre-Wave-3 step 3 on a cold local Realtime tenant (incident of 2026-09-15), `bun run test:server local` now warms the tenant before serving, and the stage measured within target on that warm server in a focused diagnostic. Run the release verification only from a `test:server` start that logged "Realtime tenant is warm".

## Heads-up from step 2 (2026-09-15): changes the full suite has not seen

The owner chose on 2026-09-15 to land the following in [step 2](02-code-quality-regression-proofing.md#owner-decisions-of-2026-09-15) with only the static groups, the unit group, the component contracts, and one Golden smoke group, and to leave complete browser proof to this step's release run. Treat a failure in any of these areas as a likely consequence of that work before suspecting older code:

- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on; about 1,200 sites across `app/`, `components/`, `hooks/`, `lib/`, `scripts/`, and `tests/` were narrowed or restructured. Watch for a value that used to flow as `undefined` and is now omitted, and for a missing-row case that now returns early.
- Every exported function under `lib/` declares explicit parameter and return types.
- Status colors moved from raw palette classes to the semantic tokens in `app/globals.css` in 49 component files; a visual regression (a badge, a dot, a calendar block, a banner) in either theme belongs here. The component contracts and the contrast contract passed; rendered screens did not get a full pass.
- Type-only exports are now part of the knip gate and the unused ones were removed.

## Deep-dive findings (the taking agent writes this before implementing)

Fill these three lists before any implementation; the step is not closed without them.

- Verified: facts of this brief you confirmed in the code, the docs or the live state, with where you looked.
- Contradicted or outdated: statements of this brief that are wrong or no longer true, with the evidence, and what replaces them.
- Added: findings this brief lacked, each with evidence and a proposed tier.

## Acceptance for this step

- The final local release report and the cloud canary report are recorded here with build ids and results.
- Every production action is recorded with its timestamp, the owner's go, the verification that followed and the rollback point it had.
- The roadmap's production-release row and the Step 3 record's pointer are updated to "released" with links to the evidence, and the beta-acceptance decision (decision 8) is recorded.
