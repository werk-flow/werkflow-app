# Recovery and incident runbook

Status: living — last reviewed 2026-09-06

What exists today, what it can and cannot restore, and who does what when something breaks. Provider identities and access paths live in [environments](environments.md); security invariants in [security](security.md).

## What is backed up

| Data | Where | Protection | Limit |
| --- | --- | --- | --- |
| Postgres (metadata, business records, time history) | Supabase PROD `jbgaqpdjauzoocplgdsn` | Daily automatic backups, 7-day retention (Pro plan) | Up to 24 hours of writes can be lost. Point-in-time recovery is not enabled (owner decision, paid add-on). |
| File bytes | Cloudflare R2 `werkflow-documents-prod` (EU) | Durable object storage; the app's trash keeps deleted documents until permanent deletion | No object versioning. A permanently deleted or overwritten object is gone. R2 objects are not part of the database backup. |
| Auth users and sessions | Supabase Auth in the same project | Included in the database backup | Sessions issued after the backup point are invalid after a restore. |
| Configuration and secrets | Vercel project settings, Supabase dashboard, owner password manager, gitignored env backups on the workstation | Manual | No automated export. Keep the env backups current after any provider change. |
| Edge function source | `supabase/functions/` in git | Deployed per project with the CLI | Function secrets (Resend keys) exist only in each project's secret store. |

## Planned provider upgrades

Decided on 2026-09-06 but deliberately deferred until the first paying customer. Whoever performs the upgrade completes the matching checklist in the same task and updates this section.

| Upgrade | Trigger | Checklist after enabling |
| --- | --- | --- |
| Vercel Pro for team `werkflows-projects` | First actual customer; the hobby plan excludes commercial use and has no Firewall rate limiting | Add Firewall rate-limit rules for `/login`, `/auth/*`, `/api/*`, and Server Action POSTs (identify by the `Next-Action` header), sized for shared office IPs. Turn on runtime-log alerts or a log drain to the owner. Invite the business partner as a team member instead of sharing the owner login. Re-check deployment protection stays "all except custom domains". Record the settings and date in [environments](environments.md). |
| Supabase point-in-time recovery on PROD | Same trigger; too expensive before revenue | Enable PITR on `jbgaqpdjauzoocplgdsn` only. Record the agreed recovery objectives below. Change the restore procedure to prefer a point-in-time restore over the daily snapshot. Run one rehearsal into DEV within the first month and note it here. |

## Recovery rehearsal

Restore the latest production backup into DEV (Supabase dashboard, Database → Backups → restore to the DEV project, or download and load it into the local stack), then verify that `documents` rows still resolve to R2 objects with `bun scripts/check-r2.ts`-style head requests. Do this quarterly and after any change to backups or storage; note each rehearsal with date and outcome here.

| Date | Source and target | Outcome |
| --- | --- | --- |
| 2026-09-06 | Logical data dump of DEV (`supabase db dump --linked --data-only`, run from WSL) loaded into the freshly reset local stack with foreign-key triggers disabled during load, the same way a provider snapshot is applied | Restored 1 organization, 1 member, 1 auth user, 1 document, and the related settings, responsibilities, sickness, and inventory rows; every relational check found 0 orphans. The document's bytes were not in the dump, which confirms that a database restore alone never recovers files: the runbook's coordinated restore (metadata from the backup, objects from R2, then a link check) is required. The dump also contained auth sessions and refresh tokens and was deleted right after the check; a real backup file must be handled as a credential. A restore of a provider snapshot through the dashboard is still to be rehearsed once PITR or a first customer exists. |

## Recovery objectives

Not yet agreed with the owner. Until then, assume: acceptable loss one business day of writes, acceptable time to restore one business day. Record the agreed values here when the owner decides on PITR (see the hardening plan decision table).

## Restore procedure (database)

1. Stop writes: pause the Vercel project (dashboard) or announce a maintenance window to the beta customer.
2. In the Supabase dashboard, open Database → Backups and restore the chosen daily backup. This replaces the database; note the backup timestamp.
3. Re-run `bun run migrations:check` against the restored project and apply any committed migration newer than the backup with the migration rule from [environments](environments.md).
4. Reconcile files: documents whose `storage_path` has no object (uploaded after the backup point but the metadata was lost) are detected with `bun scripts/check-r2.ts` style head requests; objects without metadata are orphans and can be listed with `listStorageObjectPaths`. Decide with the owner whether orphaned objects are re-linked or removed.
5. Invalidate sessions by rotating the JWT secret only if credentials were involved; otherwise users sign in again normally.
6. Resume writes and verify with the cloud canary (`bun run test:verify --target cloud`) against DEV first if the restore was rehearsed there.

A restore rehearsal with synthetic data has not been executed yet. The local stack cannot rehearse a provider restore; a DEV rehearsal needs a dashboard restore of the DEV project and is recorded as outstanding in the hardening plan.

## Restore procedure (files)

Trashed documents are restored inside the app (`/dokumente`, Papierkorb). Permanently deleted objects cannot be recovered. If a whole bucket is lost, the database still holds every path and size, which bounds the loss and lets the owner ask customers to re-upload.

## Monitoring

Currently available signals:

- Vercel deployment logs and runtime errors (dashboard, hobby plan: no log drains, no alert rules).
- Supabase project logs, adviser reports, and usage pages; e-mail alerts for project health can be enabled by the owner.
- Application logs use `console.error` with stable error codes; no personal data or tokens are logged by design. There is no correlation ID yet.

No alert reaches a person automatically today. Enabling Supabase and Vercel e-mail notifications to the owner is listed as a decision in the hardening plan.

## Incident handling

| Step | Owner | Action |
| --- | --- | --- |
| Detect | Owner, business partner, or beta customer report | Confirm on the dashboards; capture time, route, and error code. Do not copy customer data into chat. |
| Contain | Owner | Pause the Vercel project if data exposure is suspected. Rotate the affected secret in its provider: Supabase service key (dashboard → API keys, then update Vercel env and every gitignored env backup), Resend keys (Resend dashboard, then Supabase function secrets), R2 tokens (Cloudflare dashboard, then Vercel env). Deleting a leaked value from a file does not revoke it. |
| Revoke access | Owner | For a compromised user: Supabase dashboard → Authentication → sign the user out of all sessions and reset the password. For a leaving admin: transfer the organization first (last-admin protection blocks removal). |
| Preserve evidence | Agent or owner | Export the relevant Supabase and Vercel log excerpts with identifiers redacted into `.agent-logs/incidents/<date>/`. |
| Restore | Owner with agent support | Follow the restore procedures above. |
| Verify | Agent | Run the cloud canary and the affected groups; confirm the adviser reports are clean. |
| Communicate | Owner | Inform the beta customer of impact and, if personal data was exposed, assess the GDPR notification duty with the owner's advisor. |

No alert-delivery test has been run because no alert destination exists yet.
