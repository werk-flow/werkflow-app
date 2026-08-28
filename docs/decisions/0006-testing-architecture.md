# 0006 — Testing Architecture: Local Certification, Cloud Canary

- **Status:** Accepted
- **Date:** 2026-08-28
- **Owner:** Product owner (Tamay), designed in the platform-hardening sessions ([plan](../plans/platform-hardening.md))
- **Affects:** The browser-test harness, slice acceptance, wave-end certification

## Decision

Deterministic application certification and live-provider proof are separate concerns with separate suites:

1. **The full Golden and audit batteries run against a local Supabase stack** (Supabase CLI on Docker Engine inside WSL Ubuntu). `supabase db reset` builds the schema from the committed `supabase/migrations/` history on every reset, so every local run also validates that history. File bytes go through the stack's bundled S3-compatible Storage endpoint via the same signed-URL code path as production (`lib/storage/r2.ts` with an `R2_ENDPOINT` override — decision D9).
2. **A nine-test cloud canary suite** (`tests/canary/`, `@CANARY`) runs against cloud DEV Supabase and real R2. It owns the behavior only the cloud can prove: real provider auth and session refresh, R2 byte round trips, Realtime delivery through cloud infrastructure, real Resend mail, the HaveIBeenPwned leaked-password rejection, and migration-history parity between DEV and the committed files (decision D10).
3. **Slice acceptance = full local batteries + green canary.** The full battery against the cloud is demoted to wave-end certification gates and owner-named partner milestones (decision D11).
4. The runner carries an explicit target mode (`--target local|cloud`, default local for golden/audit, cloud-only for the canary); the preflight refuses a run whose `.env.local` routing does not match the requested target, and replaces cloud reachability checks with local-stack health checks in local mode. All other harness machinery — lanes, run archives, retained worlds, rerun budgets, failure classification, first-failure stop — is transport-agnostic and unchanged (decision D8).

## Why

The full Golden battery is a ~57-minute serial run. Against live cloud providers, any network hiccup in that window fails a certification: the incident log records two provider-outage certification failures on one day (2026-08-25) and a long-run-latency environment class open since 2026-08-09. Preflight cannot guarantee a later network window; retrying until green turns availability luck into acceptance evidence. Moving the battery onto a local stack removes the provider dependency from the deterministic part of certification, while the canary keeps honest, continuous proof that the cloud path itself works.

## Consequences

- Certification evidence for application logic no longer depends on Cloudflare or Supabase availability; a local failure is a finding about the code, the harness, or the machine — not weather.
- The cloud integration surface is proven by a suite small enough to rerun cheaply (target under 8 minutes).
- Local parity gaps are resolved explicitly, never silently: each one is either configured to match the cloud posture (`supabase/config.toml`), owned by the canary (HIBP, real mail delivery), or recorded in the plan's open decisions. Auth mail lands in the stack's Mailpit capture; the invite edge function runs locally without a Resend key and logs instead of sending.
- The canary is open to additions but must stay short; the growth rule lives in [testing.md](../technical/testing.md).

Execution detail, stage history, and the work ledger live in [docs/plans/platform-hardening.md](../plans/platform-hardening.md). Operational setup for the local stack lives in [environments.md](../technical/environments.md); running instructions live in [testing.md](../technical/testing.md).
