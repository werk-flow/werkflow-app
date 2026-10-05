# Recovery and incident runbook

Status: living — last reviewed 2026-10-01

This runbook states what a backup can restore, what loss the owner accepted, and who acts in an incident. [Environments](environments.md) owns provider identities, plans and access paths.

## What is backed up

| Data | Protection | Limit |
| --- | --- | --- |
| Postgres on Supabase PROD: metadata, business records, time history | Daily automatic provider backups with seven-day retention | Up to 24 hours of writes can be lost. Point-in-time recovery is not enabled. |
| File bytes in the production R2 bucket | Durable object storage. The app's trash keeps a deleted document until permanent deletion. | No object versioning. A permanently deleted or overwritten object is gone. The database backup holds no file bytes. |
| Auth users and sessions | Included in the database backup | Treat a dump as a credential. A restored session row revokes no issued access token. |
| Configuration and secrets | Manual: provider dashboards, the owner's password manager, and the gitignored env backups | No automated export. Update the env backups after every provider change. |
| Edge function source | `supabase/functions/` in git | Function secrets exist only in each project's secret store. |

## Recovery objectives

The owner accepted the limits above until the point-in-time recovery upgrade below. No restore time is agreed or demonstrated. When the upgrade happens, record a recovery-time objective and a measured provider rehearsal here.

## Planned provider upgrades

The owner deferred both upgrades until the first paying customer. Whoever performs an upgrade completes its checklist in the same task and updates this section.

| Upgrade | Why | Checklist after enabling |
| --- | --- | --- |
| Vercel Pro for the team | The hobby plan excludes commercial use and has no Firewall rate limiting. | Add Firewall rate-limit rules for `/login`, `/auth/*`, `/api/*`, and Server Action POSTs (the `Next-Action` header), sized for shared office IPs. Turn on runtime-log alerts or a log drain to the owner. Invite the business partner as a team member. Confirm that deployment protection still covers everything except custom domains. Record the settings in [environments](environments.md). |
| Supabase point-in-time recovery on PROD | It is too expensive before revenue. | Enable it on the PROD project only. Record the agreed recovery objectives above. Within the first month, rehearse the provider restore in a separately provisioned disposable target. Check provider support and cost for that target first. Never overwrite shared DEV. |

## Recovery rehearsal

To rehearse, run `bun scripts/rehearse-recovery.ts` from the repository root. The local Supabase containers must be healthy and `.env.local-stack-backup` must be present. The script takes the workspace test lock. Do not reset the shared local stack. Rehearse quarterly and after every backup or storage change.

The rehearsal backs up and restores a synthetic schema and its file bytes in disposable local databases and buckets. It writes each operation to `.agent-logs/recovery/<run-id>/journal.json`.

- A cleanup failure or a journal failure prevents acceptance.
- If the process is killed, keep the journal. Reconcile the exact resource names in that journal before you run the script again.
- Never drop a resource by a prefix search. Never remove a shared bucket or database.
- Never load a production or DEV dump into the shared local stack.

The rehearsal proves recovery mechanics only. It does not prove a restore of the complete application schema, a provider snapshot or point-in-time restore, the recovery time at customer scale, or production R2 durability. The provider rehearsal that follows the upgrade must cover those boundaries, plus secrets, auth revocation, historical file paths and protected documents.

A production restore needs separate owner authorization.

## Restore procedure (database)

1. Record the source project, the restore target, the backup timestamp, the application revision, the expected loss and the rollback limits. Get the owner's authorization. Do not load production material into shared DEV or the local stack.
2. Stop application writes through enforced maintenance or provider controls, and notify the customer. A notice alone does not stop requests from direct clients, background jobs and existing sessions.
3. Read the provider's current restore procedure for the selected project and backup type. Execute only the authorized operation and keep its completion or error result. A partial SQL load or a nonzero exit is a failed restore.
4. Inspect `supabase_migrations.schema_migrations` on the restored target and compare it with the intended application revision. `bun run migrations:check` checks DEV only and cannot validate a restored project. For a missing committed migration, follow [the migration rule](environments.md#the-migration-rule) without relinking the CLI to production.
5. Reconcile current and historical document and version paths against the correct bucket. Metadata with no object means missing file bytes. An object uploaded after the database backup can survive without metadata. `scripts/check-r2.ts` is a connectivity probe, not a reconciliation tool. Preserve orphan objects for review. Never purge them automatically.
6. Check tenant and role access, protected documents, and session revocation. A database restore revokes no token. Use the provider's current procedure for a compromised credential.
7. Run the provider canary on cloud DEV. It does not prove production recovery. On production, use metadata and configuration checks and the customer verification that the owner agreed, before you resume writes. Record unresolved evidence and every loss.

## Restore procedure (files)

Restore a trashed document in the app (`/dokumente`, Papierkorb). A permanently deleted object cannot be recovered. If a whole bucket is lost, the database still holds every path and size, so the owner can ask customers to upload the files again.

## Monitoring

The signals are:

- Vercel deployment logs and runtime errors in the dashboard, without log drains or alert rules.
- Supabase project logs, adviser reports and usage pages.
- Provider e-mail notifications from Vercel and Supabase, which the owner enabled.

A confirmed notification setting does not prove that a runtime outage raises an alert. Do not provoke a real customer outage to test alerts. Redact provider details and personal data before you export a log.

## Incident handling

| Step | Who | Action |
| --- | --- | --- |
| Detect | Anyone | Confirm on the dashboards. Capture the time, the route and the error code. Do not copy customer data into chat. |
| Contain | Owner | Pause the Vercel project if data exposure is suspected. Rotate the affected secret in its provider, then update every place that holds it: Vercel env, Supabase function secrets and the gitignored env backups. Deleting a leaked value from a file does not revoke it. |
| Revoke access | Owner | Suspend the affected user's operational access, then revoke the Auth sessions and reset the compromised credential. An issued access token and an issued file URL stay valid until they expire, so a sign-out alone is not immediate revocation. For a leaving admin, transfer the organization first. |
| Preserve evidence | Agent or owner | Export the relevant Supabase and Vercel log excerpts, with identifiers redacted, into `.agent-logs/incidents/<date>/`. |
| Restore | Owner with agent | Follow the restore procedures above. |
| Verify | Agent | Follow step 7 of the database restore procedure before writes reopen. |
| Communicate | Owner | Inform the beta customer. If personal data was exposed, assess the GDPR notification duty with an advisor. |

## Recover an uncertain email change

The email wizard keeps a completion claim when an Auth request times out or returns an ambiguous error. It shows a pending status and refuses a second destination. A page refresh reconciles a change that Auth already completed.

For a claim that stays pending, inspect privately the user's challenge generation, completion token and current Auth email.

- If Auth has the requested address, invoke `transition_email_change` with the operation `complete` and the matching generation and token. This call consumes the claim without a second Auth write.
- If Auth still has the old address, first establish that no request is outstanding and that the provider rejected or did not apply the change. Then invoke the operation `abandon_rejected_completion` with the same values.
- If you cannot establish the outcome, keep the block and escalate through provider support.

Do not clear a claim because of its age. Never replay an Admin email update and never choose another address as a shortcut.

This recovery stays manual because elapsed time cannot classify an ambiguous external write.
