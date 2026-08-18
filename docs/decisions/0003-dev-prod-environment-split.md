# 0003 — Dev/Prod Environment Split

- **Status:** accepted, implemented 2026-08-18
- **Supersedes:** the shared-database follow-up flagged in [0001](0001-infrastructure-stack.md) and formerly tracked in `docs/technical/testing.md` ("Shared-Database Caution") — resolved.

## Decision

WerkFlow development and testing move off the production Supabase project onto a dedicated dev project. Production never again carries development or test traffic.

- **Prod:** project `jbgaqpdjauzoocplgdsn`, org "WerkFlow" (`svxdwqapsmvfkchswonc`), AWS eu-central-1, Postgres 17. Serves the deployed Vercel app and real customers. Bucket `werkflow-documents-prod`.
- **Dev:** project `mbkkzuqjbdvzelqvuzcn` ("WerkFlow App Dev"), org "WerkFlow Dev" (`sptlkyimyrrmthjezafx`), same region (deliberate — identical latency/behavior characteristics), free tier, NANO compute. Serves local dev and the entire Playwright harness. Bucket `werkflow-documents-dev` (EU jurisdiction, localhost-only CORS).
- **Separate orgs for billing:** Supabase plans are per-org. Prod's org can upgrade to Pro without paying for the dev project; dev stays free (accepting NANO performance and ~1-week idle auto-pause).
- The operational reference (env files, tool access, onboarding) is `docs/technical/environments.md`.

## Migration history materialization

Until this split, schema changes were applied to prod via the Supabase MCP (`apply_migration`), which recorded them only in prod's `supabase_migrations.schema_migrations` table — the repo had no `supabase/` directory. As part of the split, all 120 recorded migrations (versions `20251125131200` … `20260817175701`) were exported byte-exactly (MD5-verified per file against prod) into `supabase/migrations/` and are now versioned in git.

Replaying that history into the empty dev project surfaced objects that had been created or changed on prod **outside** the recorded history (dashboard/manual work from the early days). These gaps are closed by four clearly-marked, fully **idempotent repair migrations** — they are no-ops on any database where the objects already exist, prod included:

1. `20251129053500_baseline_unrecorded_core_schema.sql` — seven early core tables (`profiles`, `clients`, `projects`, `jobs`, `job_assignments`, `organization_settings`, `organization_user_preferences`) with their historical shapes, five enums, helper functions (`update_updated_at_column`, `get_org_clients`, `generate_job_number`, `generate_project_number`), an organizations unique index, and realtime publication members.
2. `20260426211500_baseline_recreate_org_role_enum.sql` — recreates `org_role` as `('admin','buero','employee')` (the recorded history creates `('admin','employee','accountant')` + later `manager`/`secretary`; the consolidation to the buero model happened outside the history). Handles every dependent (columns, defaults, two functions, three policies).
3. `20260519150000_baseline_unrecorded_secondary_objects.sql` — `time_entries.job_id` (column + FK), unrecorded indexes, `email_change_challenges` policies, remaining publication members.
4. `20260817175800_baseline_reconcile_unrecorded_drift.sql` — drops six indexes prod had removed outside the history, widens one policy's role list, and updates two function bodies to prod's current form.

**Fidelity proof (2026-08-18):** after the replay, a full object-level comparison of prod vs dev reported **zero discrepancies** across tables (78), columns (902), enums (29), constraints (580), indexes (404), policies (103), triggers (113), functions (138, whitespace-normalized), realtime publication members (58), and auth triggers (2). `supabase gen types` output for dev is identical to `lib/supabase/database.types.ts` except the `PostgrestVersion` platform stamp.

Prod's migration table was left untouched (still 120 rows). The four repair migrations are recorded only in dev's migration table; if they are ever pushed against prod they no-op by design.

## The migration rule (from now on)

Every schema change:

1. **Is a file** in `supabase/migrations/<version>_<name>.sql`, committed to git.
2. **Applies dev-first, prod-second** — via MCP `apply_migration` or the CLI, but always both projects, always the same SQL.

Never write schema changes to prod that are not a committed migration file. Never `supabase link` or `db push` against prod (the repo links to the dev ref only). Regenerate `lib/supabase/database.types.ts` from **dev** after schema changes.

## Edge functions, auth, storage

- Both edge function sources are now versioned in `supabase/functions/` (fetched from prod) and deployed to dev with `verify_jwt=false` preserved. Dev's secret store carries `RESEND_API_KEY` (the "werkflow-dev" Resend key) and `FROM_EMAIL` (`WerkFlow <noreply@werk-flow.app>`); the platform injects `SUPABASE_SECRET_KEYS` etc. automatically. Prod's Resend key remains prod-only.
- Dev auth mirrors prod's custom SMTP (smtp.resend.com:465) with the dev Resend key; site URL and redirect allow-list point at `http://localhost:3000`.
- Both R2 buckets are EU-jurisdiction. The shared R2 API token is object-scoped; bucket settings (CORS) are managed in the Cloudflare dashboard. Follow-up: consider per-bucket-scoped tokens so dev credentials cannot touch the prod bucket.

## Acceptance evidence (2026-08-18)

- Statics: `tsc` clean, lint clean, unit tests 188/188.
- `bun run build` + production `bun start` against dev.
- Focused `@GG-00` 13/13 (2.0m) — signup, invite email through the dev edge function, direct R2 uploads to the dev bucket, Realtime.
- Full Golden suite **93/93 (27.4m)** and focused `@AUDIT-W1-A7` **9/9 (6.2m)** — first attempts, no reruns needed; durations ~2× the prod-class baseline (NANO compute, documented in `docs/technical/testing.md`). Teardown destroyed every world; the independent leftover sweep returned `LEFTOVER_SWEEP=0` against dev.
- Untouched-prod proof: migration count (120) and max version identical to the session-start baseline; zero organizations matching test markers.
