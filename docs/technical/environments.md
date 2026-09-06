# Environments

Status: living — last reviewed 2026-09-06

WerkFlow runs on two fully separated cloud backend environments since 2026-08-18 (decision [0003](../decisions/0003-dev-prod-environment-split.md)), plus a local Supabase stack for the browser-test harness since 2026-08-28 (decision [0006](../decisions/0006-testing-architecture.md)). This document is the operational reference: which backend is which, who owns which env file, how tools reach each project, and how a new machine gets onboarded.

## The two cloud backends

|                             | Production                                                              | Dev / Test                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase project            | `jbgaqpdjauzoocplgdsn`                                                  | `mbkkzuqjbdvzelqvuzcn` ("WerkFlow App Dev")                                                                                                       |
| Supabase org                | "WerkFlow" (`svxdwqapsmvfkchswonc`)                                     | same org since 2026-08-20 (transfer verified: refs/keys unchanged)                                                                                |
| Region / compute            | AWS eu-central-1, Postgres 17                                           | AWS eu-central-1 (same, deliberate), Postgres 17, Micro compute since 2026-08-21                                                                  |
| R2 bucket (EU jurisdiction) | `werkflow-documents-prod`                                               | `werkflow-documents-dev` (CORS: localhost only)                                                                                                   |
| Serves                      | Deployed app on Vercel, real customers                                  | Local development, the cloud canary, and explicitly scoped provider checks. Application test groups use the local stack under decision 0007 |
| Edge functions              | `send-invite-email`, `send-email-change-current-otp`                    | Same two, deployed from `supabase/functions/`                                                                                                     |
| Auth                        | Site URL `https://app.werk-flow.app`, custom SMTP via Resend (prod key) | Site URL `http://localhost:3000`, custom SMTP via Resend ("werkflow-dev" key)                                                                     |

Both projects live in the one "WerkFlow" org since 2026-08-20 (the separate "WerkFlow Dev" org was deleted after the transfer). **The org is on the Pro plan since 2026-08-21**, so both projects run under Pro quotas. The same day the dev project's compute was raised from Nano to Micro (covered by the plan's compute credits, no additional cost per the owner). The recorded change removed the free-tier auto-pause and shared free-egress cap for DEV. Historical timing evidence lives in the [gate log](../plans/golden-gate-log.md). Compare matching group scope, target, and host conditions before calling a duration change a regression; do not run another full suite merely to refresh a timing baseline.

**Production configuration posture (since 2026-08-23, applied to BOTH projects so dev mirrors prod):** leaked-password protection (HaveIBeenPwned) ON — the app's `translateSupabasePasswordError` already maps the rejection to German copy; server `password_min_length` 8 (matches the app's `MIN_PASSWORD_LENGTH`); OTP length 6, expiry 5 minutes; custom SMTP via Resend; auth email rate limit 25/hour; SSL enforcement ON for direct database connections (app traffic is PostgREST/HTTP and unaffected; the CLI's `db push` already uses SSL). Spend cap ON (org default). Daily backups with 7-day retention come with Pro automatically. Deliberately NOT adopted, each a future decision: PITR (paid add-on — revisit at first real customer onboarding), signup CAPTCHA (would add friction and break harness signup; revisit at public exposure), database network restrictions (would pin `db push` to fixed IPs), Supabase branching and the GitHub deploy integration (our two-project migration-file workflow from decision 0003 fills that role). Owner-side duties the API cannot cover: MFA on the Supabase account itself and a second organization owner.

**Auth/config parity:** project configuration (auth email templates, SMTP, rate limits) is not schema and is not covered by migrations or the decision-0003 object comparison. `bun scripts/sync-dev-auth-from-prod.ts` diffs the complete auth config of both projects and with `--apply` syncs the `mailer_*` fields prod → dev (this fixed the 2026-08-20 gap where dev sent confirmation links instead of the app's 6-digit OTP). Run the diff after any dashboard-side auth change on prod.

## The local test stack

The [platform-hardening phase](../plans/platform-hardening.md) established the local Supabase test stack. Application test groups continue to use it under [decision 0007](../decisions/0007-independent-test-groups.md). Cloud DEV owns the canary, live-state inspection, and explicitly scoped provider checks. Wave and release acceptance use the local release plan plus the cloud canary, not routine full cloud batteries. The stack is the Supabase CLI's Docker composition, running on Docker Engine (docker-ce) inside WSL Ubuntu — not Docker Desktop.

|                             | Local stack                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runs                        | `supabase start` from the repo root inside WSL (config: `supabase/config.toml`)                                                                                                                                                                                          |
| API / DB / Studio / Mailpit | ports 54321 / 54322 / 54323 / 54324                                                                                                                                                                                                                                      |
| Schema                      | `supabase db reset` replays the committed `supabase/migrations/` history — a failing reset is a finding about that history                                                                                                                                               |
| Keys                        | the CLI's shared local defaults (`sb_publishable_…`/`sb_secret_…`), printed by `supabase status`; not secrets                                                                                                                                                            |
| Storage                     | bundled S3-compatible endpoint (`/storage/v1/s3`), bucket `werkflow-documents-local` declared in `config.toml`; the app reaches it through the `R2_ENDPOINT` override                                                                                                    |
| Auth posture                | mirrors the cloud posture in `config.toml` (password min length 8, OTP 6 digits / 5 minutes, confirmations on); auth mail lands in Mailpit, never real inboxes. Leaked-password protection (HIBP) needs internet and has no local equivalent — the canary owns that copy |
| Edge functions              | served from `supabase/functions/`; without a local `RESEND_API_KEY` the mail functions log instead of sending, which is the intended local behavior                                                                                                                      |

Operational facts for this workstation:

- Windows reaches the stack via the WSL VM's NAT address, not `localhost`: the Windows→WSL localhost relay drops connections under sustained traffic (observed 2026-08-28; mirrored networking is blocked by the corporate IPv6 policy). `bun run env:local` resolves the current WSL address and rewrites `.env.local` — rerun it after every WSL restart, and rebuild before certification because `NEXT_PUBLIC_*` values are baked into the build. The preflight fails with a clear remedy when the address is stale.
- `supabase db reset` leaves the edge-runtime container stopped (CLI 2.116.0). The preflight detects it; the remedy is `wsl docker start supabase_edge_runtime_werkflow-app`.
- Systemd restarts Docker and the containers when WSL starts, but those services do not keep the distribution alive. The September 5 test investigation observed orderly idle shutdowns and changing addresses. `bun run test:server local` owns a WSL process from environment generation through the production build and server lifetime; local browser runs also hold a lease. Keep the test-server process alive for the campaign. This changes no global WSL settings. See [Microsoft's systemd guidance](https://learn.microsoft.com/en-us/windows/wsl/systemd) and the [incident record](test-incident-log.md#2026-09-05-shared-ui-contracts-and-wsl-lifetime).
- A full `supabase stop` / `supabase start` cold start can report healthy HTTP before tenant change replication is ready. Before an event-sensitive browser run after that operation, confirm the Realtime container log has started the tenant replication stream. This remains Tier 3 because the repository preflight uses portable public endpoints and cannot inspect host-specific Docker internals.

## Dependency installation

Dependency installation is pinned separately from environment selection. `vercel.json` uses `bun install --frozen-lockfile`, matching local `bun.lock` resolution while the application keeps the Node runtime. Preserve the existing `package-lock.json` compatibility artifact without regenerating it. The Popper override in `package.json` prevents the old anchor-registration defect documented in the [incident log](test-incident-log.md#certification-follow-up-unpositioned-project-menu); the resolved-dependency unit check catches stale nested installations.

## Env-file ownership

The repository switches its local backend through the gitignored `.env.local`. Next.js also supports its standard `.env` and mode-specific env files; `.env.local` is not its only possible input. The switch scripts replace `.env.local` with the selected local-stack, cloud DEV, or production backup. Vercel holds deployment environment variables independently, so a local file change cannot affect the deployed app. `NEXT_PUBLIC_*` values are baked into each build.

Gitignored backups next to it:

- `.env.local-stack-backup` — the local test stack (normal state for harness work; `env:local` refreshes its WSL address on every switch)
- `.env.dev-backup` — the cloud dev configuration (normal state for dev-server work and canary runs)
- `.env.live-backup` — the production configuration (Supabase prod + `werkflow-documents-prod`)

All three are outside Next.js's env loading chain (only `.env`, `.env.local`, `.env.development*`, `.env.production*`, `.env.test*` are loaded), so their presence changes nothing.

Swapping:

```bash
bun run env:local  # .env.local -> local Supabase stack (golden/audit batteries)
```

```bash
bun run env:dev    # .env.local -> cloud dev backend (canary, live inspection)
```

```bash
bun run env:prod   # .env.local -> LIVE PRODUCTION backend (loud warning; no tests!)
```

Never run the Playwright harness or destructive scripts while `.env.local` points at prod. Switch back immediately after the prod-local task is done. The test preflight additionally refuses any run whose `.env.local` routing does not match the requested target, so a forgotten switch fails loudly instead of sweeping the wrong backend.

## Which tool reaches what

| Access path                                      | Prod                         | Dev                                                 | Notes                                                                                                                                                                                                                                                               |
| ------------------------------------------------ | ---------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| claude.ai Supabase connector (OAuth, org-scoped) | read/write                   | read/write (since the 2026-08-20 org consolidation) | Scoped to the "WerkFlow" org, which now contains both projects. Address projects by ref; prod writes remain forbidden outside the migration rule.                                                                                                                   |
| Account-wide Supabase MCP server (`.mcp.json`)   | yes                          | yes                                                 | Official `@supabase/mcp-server-supabase` via `npx`, authenticated by `SUPABASE_ACCESS_TOKEN` (PAT) from the shell environment. Routine writes belong on dev only.                                                                                                   |
| Supabase CLI (`bunx supabase`)                   | yes (forbidden to link/push) | yes                                                 | With `SUPABASE_ACCESS_TOKEN` exported. The repo links to the **dev** ref only; never `link`/`db push` against prod.                                                                                                                                                 |
| Management API (`api.supabase.com`)              | yes                          | yes                                                 | Same PAT. Used for read-only prod inspection and dev configuration.                                                                                                                                                                                                 |
| R2 API tokens (S3 credentials)                   | prod token: prod bucket only | dev token: dev bucket only                          | Cloud backups carry their matching bucket-scoped credentials; `.env.local` receives the selected backup. Local-stack credentials target local storage. Cloud runtime tokens cannot manage bucket settings; `scripts/setup-r2-cors.ts` needs a separately supplied bucket-admin token or dashboard access. |

## The migration rule

Every schema change is **a file in `supabase/migrations/` first**, and is applied **dev-first, prod-second** — via the MCP `apply_migration` or the CLI, but always both projects and always from the same committed file. Details and the repair-migration story: [decision 0003](../decisions/0003-dev-prod-environment-split.md).

- Dev: prefer `bunx supabase db push` (repo is linked to the dev ref) — it records the committed file's exact version in the remote history. MCP `apply_migration` works but stamps its own apply-time version: 23 pre-Stage-A migrations diverged that way from the committed filenames until the history was repaired by a name-keyed version update on 2026-08-28. Canary C9 now fails on any new divergence, so an MCP-applied dev migration must be followed by the same history alignment.
- Prod: MCP `apply_migration` against `jbgaqpdjauzoocplgdsn` with the identical SQL, after the change is verified on dev. Never `supabase link`/`db push` against prod. MCP may stamp an apply-time version, so compare the name and statement before aligning the ledger key to the committed filename. P1-20's rollout required exact parity and aligned only its fourteen guarded version keys in PROD; schema objects and business data were unchanged.
- After a schema change, run `bun run types:generate`. The repository command reads DEV, includes `graphql_public` and `public`, and uses the pinned tools from `package.json`. Run `bun run types:check` to fail when the committed file differs from a fresh DEV generation. DEV is the generation source; generated types do not prove function-body or production parity.

Parity checkpoints belong in the slice or cross-slice record and the gate log. `bun run migrations:check` compares DEV history with committed files, `bun run types:check` compares DEV-generated types, and `bun run realtime:check` checks publication and replica identity on its selected target. None compares the complete DEV and PROD schemas. Compare live object definitions separately when production parity matters. The [2026-09-05 documentation audit](../plans/post-wave-2-documentation-audit.md) records a function-body difference requiring follow-up.

## Per-machine onboarding checklist

1. **PAT**: make the owner's Supabase Personal Access Token available as `SUPABASE_ACCESS_TOKEN` to the CLI and management scripts. Use the environment or the established local secret-loading setup and restart the agent session after changing its inherited environment. The current workstation also keeps the token in its gitignored backend backups so switching `.env.local` does not remove script access. Keep those copies consistent across every backup you use. Never commit or print the token.
2. **Env file**: obtain `.env.local` (dev values) from the owner's password manager / another machine; place it in the repo root. Optionally also `.env.live-backup` if prod-local sessions are expected. Copy `.env.local` to `.env.dev-backup`.
3. **Claude Code**: approve the project-scoped `.mcp.json` server on first start. Project permissions travel via git (`.claude/settings.json`); the autoMode environment note about the dev project lives in the user-level `~/.claude/settings.json`.
4. **Codex**: add the same account-wide server to `~/.codex/config.toml`:

   ```toml
   [mcp_servers.supabase]
   command = "npx"
   args = ["-y", "@supabase/mcp-server-supabase@latest"]
   env = { "SUPABASE_ACCESS_TOKEN" = "…" }
   ```

5. **Local stack**: install Docker Engine inside WSL Ubuntu (`docker-ce` via Docker's apt repo; corporate proxies permitting), install the Supabase CLI in WSL (pinned to the version in use — 2.116.0 as of Stage A), then from the repo root in WSL: `supabase start` and `supabase db reset`. Create `.env.local-stack-backup` from another machine or from the values `supabase status` prints (the keys are shared CLI defaults; copy `SUPABASE_ACCESS_TOKEN` in from `.env.local` — a swap overwrites `.env.local`, so the PAT must live in every backup).
6. **Browser**: `bunx playwright install chromium` once per machine; rerun it only when `playwright test` reports a missing browser.
7. **Verify**: `bunx supabase projects list` shows both cloud projects; `bun scripts/check-r2.ts` passes the EU round-trip against the dev bucket. Start `bun run test:server local`, then run `bun run test:verify --group golden:gg-00` from another terminal. This proves the onboarding group, not release acceptance.

## Escape hatches for prod work

- **Reads**: the org-scoped claude.ai connector or the account-wide MCP/Management API (read-only queries).
- **Preview publishing**: when the owner requests a push, use `git push origin main:partner-preview` from local `main`. This creates a Vercel preview deployment. It does not advance `origin/main` or deploy production.
- **Production release**: advance `origin/main` only on an explicit release request. A future beta-handoff release is planned after the post-Wave-2 work; it is not authorized by the documentation audit. Preview deployment status alone does not prove which Supabase or R2 backend it uses. Inspect Vercel's Preview environment and branch overrides during the infrastructure audit.
- **Prod-local session**: `bun run env:prod`, do the task, `bun run env:dev`. No tests, no bulk scripts, in between.
