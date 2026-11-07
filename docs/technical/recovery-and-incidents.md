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

The team moved to Vercel Pro on 2026-11-05; its checklist is open in werk-flow/werkflow-planning#216. The owner deferred point-in-time recovery until the first customer who pays about $1000 a month, after Willert; Supabase gets no further spend before Willert pays ([decision 0008](../decisions/0008-development-workflow.md#amendment-2026-11-07-point-in-time-recovery-waits-for-a-larger-customer)). Whoever completes a checklist updates this page.

| Upgrade | Why | Checklist after enabling |
| --- | --- | --- |
| Vercel Pro for the team | Active since 2026-11-05. It brings Firewall rate limits. | Rate-limit `/login`, `/auth/*`, `/api/*` and Server Action POSTs (`Next-Action` header), sized for shared office IPs. Add runtime-log alerts or a drain. Confirm deployment protection. Record the settings in [environments](environments.md). |
| Supabase point-in-time recovery on PROD | Too expensive before that customer. | Enable it on PROD only and record the recovery objectives here. Within a month, rehearse the provider restore in a disposable target, never shared DEV. Then repeat that drill quarterly, automated where the provider allows. No schedule runs it before then. |

## Recovery rehearsal

`bun scripts/rehearse-recovery.ts` backs up and restores a synthetic schema with file bytes in disposable local databases and buckets. It needs healthy local containers and `.env.local-stack-backup`, takes the workspace test lock, and journals each operation to `.agent-logs/recovery/<run-id>/journal.json`.

`ops/recovery-rehearsal.py` in `werk-flow/werkflow-planning` runs it on [the PC](environments.md#background-jobs): at 04:00 Berlin on the first Monday of January, April, July and October, in a checkout of its own at `origin/main`. After a backup or storage change, run that script with `--revision <branch>`. It shares the stack with every worktree: it adds two databases and three buckets for seconds and restarts nothing, so it takes no heavy slot. A stopped or unhealthy stack fails it. A failure opens or updates `CI alert: recovery rehearsal`, the next pass closes it, and `ops/ci-alert.py` hands it to a thread and reports a quarter without a run. It assigns nobody: no production data is at stake.

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

Signals: the production watcher below, Vercel's dashboards (runtime logs there are PROD data, for the owner only), Supabase logs, advisors and usage pages, and provider e-mail notifications. A notification setting does not prove an outage raises an alert; never provoke an outage to test it. Redact provider details and personal data before you export a log.

A red nightly or release, a scheduled release that stopped at a red full run, and a scheduled run that never started each open or update one issue with the label `ci-alert`: `CI alert: nightly` or `CI alert: release` (`.github/scripts/alert-issue.sh`). The next green run closes it. A release that stops because `main` equals `production` leaves the issue as it is, because it proves nothing. `ops/ci-alert.py` in `werk-flow/werkflow-planning` runs every 10 minutes on [the PC and the Mac](environments.md#background-jobs): it finds a run that never started and hands each open issue, and the weekly health issue, to one T3 thread. These issues only report; no release decision reads them.

Assignment is the owner's one notification, so only a failure that affects production assigns `tamaycbn`: a failed or held release, a release that never started, a production watcher alert, and a failed health check of a credential production depends on. A caller of `alert-issue.sh` says so with `AFFECTS_PRODUCTION=true`. Every other alert reaches its thread only. An open issue that turns into a production failure gains the owner; no update removes an assignee. No issue text or comment mentions the owner. GitHub never notifies a user of their own actions, and `ops/ci-alert.py` runs `gh` as the owner, so it reports a release that never started, and every production watcher alert, by dispatching `.github/workflows/production-alert.yml`, which writes as `github-actions`.

On the machine with the watcher's token, `ops/ci-alert.py` also runs the production watcher, `ops/prod_watch.py`, which owns the rules and thresholds. It reads metadata only, with the token `werkflow app prod-watch` ([credentials](environments.md#credentials)): Vercel's production deployments, the deployment `app.werk-flow.app` serves, the head of `production`, and counts of `vercel.request.count` with a 5xx status per route pattern, status, error code and deployment. It opens one issue per incident:

- `Production alert: deploy`: a production build failed or stuck past its deadline, or production not serving the `production` head for an hour, which is a rollback or a failed promotion.
- `Production alert: server errors`: a burst of server errors against the week before, or a route that starts to fail. It adds a comment at most every few hours and closes a day after the newest error.
- `Production alert: watcher`: several failed passes in a row, such as an expired token. `python3 -I ops/prod_watch.py --health` in werkflow-planning checks the token.

Its thread reads no PROD data: no runtime log, build log, request record or row, and of a failed `Apply pending migrations to PROD` step only the result, since its log may quote a row. It works from the route, status, error code and commit range, and reproduces the failure on staging or the local stack. The watcher closes the deploy alert once production serves its head and no build is failed or stuck. It misses a handled failure answered below 500: no metric counts log levels.

`.github/workflows/date-lookahead.yml` runs the suite nightly on dates still to come, so a test that fails on a date alone surfaces weeks before that date. It reports the same way, on `CI alert: date look-ahead`, and a failed job's name is its date. Each job steps its runner's kernel clock (`.github/scripts/shift-clock.sh`). Containers share that clock, so Bun, Chromium, the app, Postgres and the Supabase services all show the date, and SQL tests read it too. A job fails if the shell, Bun or Postgres shows another date, or if the clock leaves the shift.

| Dates | Groups |
| --- | --- |
| The next 14 days, the first month end and year end past them, and the year turn (00:30 in Berlin, still December 31 in UTC) | Unit, SQL and component |
| Day 14, on Sundays also that month end and year end, and every date the open issue names for a browser job | Every browser group |

A date keeps its browser jobs while the issue names it, so a green run cannot close the issue on a date it skipped. Started by hand, `gh workflow run date-lookahead.yml -f date=<YYYY-MM-DD>` reruns one date and reports nothing.

The look-ahead does not cover:

- A spec merged after its date was day 14: only the suite groups and the real nightly reach that date.
- Any hour but midday, apart from the year turn.
- Data that aged into the date: the stack migrates on the real clock, and each browser group seeds a fresh world on the shifted one.
- The cloud providers: every job uses the local stack.

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
