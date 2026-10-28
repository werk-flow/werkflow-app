# Recovery and incident runbook

What a backup can restore, what loss the owner accepted, and who acts in an incident. [Environments](environments.md) owns provider identities and access paths.

## What is backed up

| Data | Protection | Limit |
| --- | --- | --- |
| Postgres on Supabase PROD | Daily provider backups, seven-day retention | Up to 24 hours of writes can be lost. No point-in-time recovery. |
| File bytes in the production R2 bucket | Durable object storage; the app's trash keeps a deleted document until permanent deletion | No object versioning. A permanently deleted or overwritten object is gone. The database backup holds no bytes. |
| Auth users and sessions | In the database backup | Treat a dump as a credential. A restored session row revokes no issued token. |
| Configuration and secrets | Manual: provider dashboards, the owner's password manager, the gitignored env backups | No automated export. Update the env backups after every provider change. |
| Edge function source | `supabase/functions/` in git | Function secrets exist only in each project's secret store. |

The owner accepted these limits until the point-in-time upgrade below. No restore time is agreed or demonstrated.

## Planned provider upgrades

The owner deferred both until the first paying customer. Whoever performs one completes its checklist in the same task and updates this page.

| Upgrade | Why | Checklist after enabling |
| --- | --- | --- |
| Vercel Pro for the team | Hobby excludes commercial use and Firewall rate limits. | Rate-limit `/login`, `/auth/*`, `/api/*` and Server Action POSTs (`Next-Action` header), sized for shared office IPs. Add runtime-log alerts or a drain. Invite the business partner. Confirm deployment protection. Record the settings in [environments](environments.md). |
| Supabase point-in-time recovery on PROD | Too expensive before revenue. | Enable it on PROD only and record the recovery objectives here. Within a month, rehearse the provider restore in a disposable target, never shared DEV. |

## Recovery rehearsal

Run `bun scripts/rehearse-recovery.ts` quarterly and after every backup or storage change. It needs healthy local containers and `.env.local-stack-backup`, takes the workspace test lock, and backs up and restores a synthetic schema with file bytes in disposable local databases and buckets. It journals each operation to `.agent-logs/recovery/<run-id>/journal.json`.

- A cleanup or journal failure prevents acceptance. After a killed run, reconcile the journal's exact resource names before you run again.
- Never drop a resource by prefix search, remove a shared bucket or database, reset the shared stack, or load a production or DEV dump into it.
- The rehearsal proves mechanics only, not a full-schema or provider restore, recovery time or R2 durability. A production restore needs separate owner authorization.

## Restore procedure (database)

1. Record source, target, backup timestamp, application revision, expected loss and rollback limits. Get the owner's authorization. Never load production material into DEV or the local stack.
2. Stop writes through enforced maintenance or provider controls, and notify the customer. A notice alone stops no direct client, job or session.
3. Follow the provider's current restore procedure. Run only the authorized operation and keep its result. A partial load or a nonzero exit is a failed restore.
4. Compare `supabase_migrations.schema_migrations` on the target with the intended revision. `bun run migrations:check` checks DEV only. For a missing migration, follow [the migration rule](environments.md#the-migration-rule) without relinking the CLI to production.
5. Reconcile current and historical document and version paths against the correct bucket. Metadata without an object means missing bytes. An object uploaded after the backup can survive without metadata. Keep orphan objects for review; never purge them automatically.
6. Check tenant and role access, protected documents and session revocation. A database restore revokes no token.
7. Run the provider canary on cloud DEV; it does not prove production recovery. On production, use metadata and configuration checks and the customer verification the owner agreed before you resume writes. Record unresolved evidence and every loss.

## Restore procedure (files)

Restore a trashed document in the app (`/dokumente`, Papierkorb). A permanently deleted object is gone. If a whole bucket is lost, the database still holds every path and size, so the owner can ask customers to upload again.

## Monitoring

Signals: Vercel deployment logs and runtime errors (no drains or alerts), Supabase logs, advisors and usage pages, and provider e-mail notifications. A notification setting does not prove an outage raises an alert; never provoke an outage to test it. Redact provider details and personal data before you export a log.

## Incident handling

| Step | Who | Action |
| --- | --- | --- |
| Detect | Anyone | Confirm on the dashboards. Capture time, route and error code. Copy no customer data into chat. |
| Contain | Owner, then agent | The owner decides whether to pause the Vercel project when exposure is suspected. Rotate the affected secret in its provider: an agent generates and sets every value it can create; the owner supplies passwords and tokens of the owner's accounts. Update every place that holds it: Vercel env, Supabase function secrets, the env backups, and the owner's password manager. Deleting a leaked value from a file does not revoke it. |
| Revoke access | Owner | Suspend the user's operational access, then revoke Auth sessions and reset the credential. An issued access token or file URL stays valid until it expires. For a leaving admin, transfer the organization first. |
| Preserve evidence | Agent or owner | Export the relevant log excerpts, identifiers redacted, into `.agent-logs/incidents/<date>/`. |
| Restore | Owner with agent | Follow the restore procedures above. |
| Verify | Agent | Follow step 7 of the database restore before writes reopen. |
| Communicate | Owner | Inform the beta customer. If personal data was exposed, assess the GDPR notification duty with an advisor. |

## Recover an uncertain email change

The email wizard keeps a completion claim when an Auth request times out or answers ambiguously, and refuses a second destination. A refresh reconciles a change Auth completed. For a claim that stays pending, inspect privately the challenge generation, completion token and current Auth email:

- Auth has the requested address: invoke `transition_email_change` with `complete` and the matching generation and token. It consumes the claim without a second Auth write.
- Auth still has the old address: first establish that no request is outstanding and that the provider rejected or did not apply the change. Then invoke `abandon_rejected_completion` with the same values.
- The outcome is unknown: keep the block and escalate through provider support.

Never clear a claim because of its age, replay an Admin email update, or choose another address as a shortcut. Elapsed time cannot classify an ambiguous external write.
