# Recovery and incident runbook

Status: living — last reviewed 2026-09-07

What exists today, what it can and cannot restore, and who does what when something breaks. Provider identities and access paths live in [environments](environments.md); security invariants in [security](security.md).

## What is backed up

| Data | Where | Protection | Limit |
| --- | --- | --- | --- |
| Postgres (metadata, business records, time history) | Supabase PROD (project ID in [environments](environments.md#the-two-cloud-backends)) | Daily automatic backups, 7-day retention (Pro plan) | Up to 24 hours of writes can be lost. Point-in-time recovery is not enabled (owner decision, paid add-on). |
| File bytes | Cloudflare R2 `werkflow-documents-prod` (EU) | Durable object storage; the app's trash keeps deleted documents until permanent deletion | No object versioning. A permanently deleted or overwritten object is gone. R2 objects are not part of the database backup. |
| Auth users and sessions | Supabase Auth in the same project | Included in the database backup | Treat dumps as credentials. Restoring session rows does not revoke every previously issued access token; reconcile revocation and token lifetime before reopening access. |
| Configuration and secrets | Vercel project settings, Supabase dashboard, owner password manager, gitignored env backups on the workstation | Manual | No automated export. Keep the env backups current after any provider change. |
| Edge function source | `supabase/functions/` in git | Deployed per project with the CLI | Function secrets (Resend keys) exist only in each project's secret store. |

## Planned provider upgrades

Decided on 2026-09-06 but deliberately deferred until the first paying customer. Whoever performs the upgrade completes the matching checklist in the same task and updates this section.

| Upgrade | Trigger | Checklist after enabling |
| --- | --- | --- |
| Vercel Pro for team `werkflows-projects` | First actual customer; the hobby plan excludes commercial use and has no Firewall rate limiting | Add Firewall rate-limit rules for `/login`, `/auth/*`, `/api/*`, and Server Action POSTs (identify by the `Next-Action` header), sized for shared office IPs. Turn on runtime-log alerts or a log drain to the owner. Invite the business partner as a team member instead of sharing the owner login. Re-check deployment protection stays "all except custom domains". Record the settings and date in [environments](environments.md). |
| Supabase point-in-time recovery on PROD | Same trigger; too expensive before revenue | Enable PITR on the PROD project only. Record the agreed recovery objectives below. Rehearse the provider restore in a separately provisioned disposable target within the first month. Check current provider support and cost for that target first; never overwrite shared DEV. |

## Recovery rehearsal

Run `bun scripts/rehearse-recovery.ts` from the repository root, with healthy local Supabase containers and the gitignored `.env.local-stack-backup` credentials available. The script acquires the workspace test lock. It accepts no target or backup-file argument and ignores cloud environment selection. It requires the inspected local Docker socket and Storage endpoint. Coordinate its execution with other workspace operations; do not reset the shared local stack.

The rehearsal creates two uniquely named disposable databases and three private local Storage buckets. Its purpose-built schema models two organizations, document metadata and three version paths. It backs up real PostgreSQL schema/data and file bytes through the supported S3 interface, removes only its synthetic source data, then restores both from those backups. Acceptance requires exact row counts, restored file hashes and sizes, valid document/version relationships, foreign-key rejection, tenant-scoped RLS reads, signed downloads, unsigned/tampered download denial, and cleanup. It does not copy business records, auth sessions, production dumps, or cloud objects.

Each operation is recorded in `.agent-logs/recovery/<run-id>/journal.json`; resource intent is persisted before creation. A failed stage stops subsequent restore work and attempts cleanup of resources whose creation completed. A cleanup or journal failure prevents acceptance. If the process is killed or a creation response is uncertain, keep the journal, inspect only its exact resource names against its run ID, and reconcile those resources before rerunning. Never drop a resource by a prefix search or remove a shared bucket/database. Provider response bodies, credentials, database dumps and signed URLs are not written to the evidence log.

This proves coordinated recovery mechanics on a synthetic schema and the local S3-compatible service. It does not prove a complete application schema restore, provider snapshot/PITR restore, recovery time at customer scale, production R2 durability, or the app's complete document authorization rules. The future isolated provider rehearsal must cover those additional boundaries, configuration/secrets, auth revocation, current and historical file paths, protected documents, and application access checks. Rehearse quarterly and after backup/storage changes. Any production restore remains a separately authorized destructive operation.

| Date | Source and target | Outcome |
| --- | --- | --- |
| 2026-09-06 | Historical DEV data dump loaded into the shared local stack | Failed partial import: the log records a duplicate `storage.buckets` key and load exit 3, with zero storage objects and zero documents with an object. This is not a successful coordinated restore. The previous success wording was withdrawn during the Step 1 review. The dump included auth material and was reported deleted. Preserve the evidence in `.agent-logs/restore-rehearsal-2026-09-06/rehearsal.log`; do not repeat this procedure. |
| 2026-09-07 | Isolated synthetic PostgreSQL databases and private local S3 buckets | Passed: journal `.agent-logs/recovery/d5fcbf309eae4d31a632a57336193e04/journal.json` records schema/data and file backup, source removal, restore, exact counts (2 organizations, 2 documents, 3 versions), all file hashes/sizes/paths, foreign-key and tenant-RLS checks, signed access and unsigned/tampered denial. Both databases and all three buckets were cleaned. The initial attempt `eca71e78c6714fb6873b70674f41cf55` failed during service startup and cleaned its databases; its uncreated bucket was confirmed absent. The runner now holds the existing WSL lease and waits for healthy services. Provider snapshot and full application-schema recovery remain outside this proof. |

## Recovery objectives

The owner accepted up to 24 hours of database write loss until the PITR upgrade trigger in the hardening plan. A target time to restore has not been agreed or demonstrated. No file-recovery guarantee exists for permanently deleted bytes without an independent backup. Record an explicit recovery-time objective and measured provider rehearsal when the upgrade is performed.

## Restore procedure (database)

1. Record the exact source project, restore target, backup timestamp, application revision, file-backup availability, expected loss and rollback limits. Prepare the destructive operation for owner authorization. Do not load production material into shared DEV or the ordinary local stack.
2. Stop application writes through enforced maintenance/provider controls and notify the customer. A notice alone does not stop requests; consider direct clients, background jobs and existing sessions.
3. Recheck the provider's current restore procedure for the selected project and backup type. Execute only the authorized target operation and preserve its completion/error result. A partial SQL load or nonzero exit is a failed restore.
4. Inspect `supabase_migrations.schema_migrations` on the actual restored target and compare with the intended application revision. `bun run migrations:check` is explicitly DEV-only; it cannot validate a restored production/disposable project. Follow [the migration rule](environments.md#the-migration-rule) for any missing committed migration, without relinking the CLI to production.
5. Reconcile both current and historical document/version paths against the correct bucket. Metadata with no object means missing file bytes; objects uploaded after the database backup may instead survive without metadata. Use authorized HEAD/content checks for known paths and a bounded inventory of orphan candidates. `scripts/check-r2.ts` is a write/read/delete connectivity probe, not a reconciliation tool. Preserve orphan objects for review; never purge them automatically during recovery.
6. Check tenant/role access, protected documents, file hashes where a trusted backup manifest exists, and auth/session revocation. Restoring a database is not token revocation; use the current provider procedure for any compromised credential.
7. Run the relevant application tests on synthetic local data and provider canary on cloud DEV. The canary is DEV-only and does not establish production recovery. On production, use metadata/configuration checks and the separately agreed minimal customer verification before resuming writes. Record unresolved evidence and any loss explicitly.

## Restore procedure (files)

Trashed documents are restored inside the app (`/dokumente`, Papierkorb). Permanently deleted objects cannot be recovered. If a whole bucket is lost, the database still holds every path and size, which bounds the loss and lets the owner ask customers to re-upload.

## Monitoring

Currently available signals:

- Vercel deployment logs and runtime errors (dashboard, hobby plan: no log drains, no alert rules).
- Supabase project logs, adviser reports, and usage pages; e-mail alerts for project health can be enabled by the owner.
- The repaired mail paths log fixed error classifications and provider status numbers. Other application errors still use `console.error`; review and redact provider details before exporting logs. This pass does not certify every log record as free of personal data. There is no correlation ID yet.

The owner confirmed Vercel e-mail notifications enabled and Supabase notifications already on on 2026-09-06. Configuration confirmation is separate from delivery evidence; record a received deployment/provider notification with timestamp and signal type, without copying the recipient's address. A deployment-success e-mail does not prove runtime-outage alert delivery.

## Incident handling

| Step | Owner | Action |
| --- | --- | --- |
| Detect | Owner, business partner, or beta customer report | Confirm on the dashboards; capture time, route, and error code. Do not copy customer data into chat. |
| Contain | Owner | Pause the Vercel project if data exposure is suspected. Rotate the affected secret in its provider: Supabase service key (dashboard → API keys, then update Vercel env and every gitignored env backup), Resend keys (Resend dashboard, then Supabase function secrets), R2 tokens (Cloudflare dashboard, then Vercel env). Deleting a leaked value from a file does not revoke it. |
| Revoke access | Owner | Suspend the affected user's operational access, then revoke Auth sessions and reset the compromised credential. An already-issued access token can remain valid until expiry; signing out alone is not immediate revocation. Check RLS, server reads, and Realtime separately. Already-issued file URLs remain bearer capabilities until their bounded expiry. For a leaving admin, transfer the organization first. |
| Preserve evidence | Agent or owner | Export the relevant Supabase and Vercel log excerpts with identifiers redacted into `.agent-logs/incidents/<date>/`. |
| Restore | Owner with agent support | Follow the restore procedures above. |
| Verify | Agent | Run affected local groups and DEV provider checks. Verify production metadata and the agreed customer check on the actual restored target before reopening writes; DEV results are not production recovery proof. |
| Communicate | Owner | Inform the beta customer of impact and, if personal data was exposed, assess the GDPR notification duty with the owner's advisor. |

Alert delivery and runtime-outage detection remain separate evidence items. Do not provoke a real customer outage to test them.

## Recover an uncertain email change

The email wizard keeps a completion claim if an Auth request times out or returns an ambiguous server error. It shows a pending status and refuses a second destination. Refreshing the page reconciles a change that Auth already completed.

For a claim that remains pending, inspect the exact user's challenge generation, completion token, and current Auth email privately. If Auth has the requested address, invoke `transition_email_change` with operation `complete` and the matching generation and token. This consumes the claim without repeating the Auth write. If Auth still has the old address, establish that no request remains outstanding and that the provider rejected or did not apply it before invoking `abandon_rejected_completion` with those exact values. Do not clear a claim because of its age. If the outcome cannot be established, retain the block and escalate through provider support. Never replay an Admin email update or choose another address as a recovery shortcut.

This is Tier 3 because an ambiguous external write cannot be classified safely from elapsed time alone. The claim and refusal of competing changes are enforced in Tier 1, with concurrency and denial tests in Tier 2.
