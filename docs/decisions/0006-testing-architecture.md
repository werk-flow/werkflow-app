# 0006 — Testing Architecture: Local Certification, Cloud Canary

- **Status:** accepted (2026-08-28)
- **Date:** 2026-08-28
- **Owner:** Product owner (Tamay), designed in the platform-hardening sessions ([plan](../plans/phase-1/consolidation-2026-08/platform-hardening.md))
- **Affects:** The browser-test harness, slice acceptance, wave-end certification

## Supersession on 2026-09-06

[Decision 0007](0007-independent-test-groups.md) replaces this record's execution, rerun, and acceptance policy. In particular, full local batteries plus a fresh canary are no longer mandatory after every slice, and full cloud batteries are no longer routine wave gates. The local application backend and cloud-provider separation remain current. Read [testing.md](../technical/testing.md) for new work. The original decision and amendments below preserve their historical meaning; the serial batteries, the first-failure stop, the two-worker cap and the campaign extensions they describe were replaced by the execution model of the [2026-09-25 amendment of decision 0007](0007-independent-test-groups.md#amendment-2026-09-25-the-execution-model).

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

Execution detail, stage history, and the work ledger live in [docs/plans/phase-1/consolidation-2026-08/platform-hardening.md](../plans/phase-1/consolidation-2026-08/platform-hardening.md). Operational setup for the local stack lives in [environments.md](../technical/environments.md); running instructions live in [testing.md](../technical/testing.md).

## Amendment 2026-09-05: reset evidence and living follow-ups

`supabase db reset` validates that the committed migrations build the local schema when the reset runs. The browser runner does not reset the database before every run. A local certification creates a fresh disposable test world inside the existing stack; it does not independently prove migration replay on that attempt. Keep reset evidence distinct from browser evidence.

The original canary size and duration above describe the accepted design. Current inventory comes from Playwright discovery as documented in [testing.md](../technical/testing.md). The platform-hardening plan is closed. New parity decisions belong in the active plan or a dated decision amendment, with operational facts maintained in [environments.md](../technical/environments.md).

## Amendment 2026-09-05: isolated audit groups and trustworthy run evidence

The [UI/UX Phase 6 retrospective](../plans/phase-1/hardening-2026-09/02-uiux-hardening.md#phase-6-retrospective-and-corrected-closure-method) showed two different outcomes. The audit found real product defects, while repeated complete runs spent hours rediscovering stale selectors and coupled setup. The following mechanisms change how tests establish evidence. They preserve the local/cloud split, business assertions, stable flow IDs, security checks, and existing acceptance scope.

- Audit files own separate disposable worlds. Tests within a file remain serial. Successful groups are cleaned before the next group; a failed group remains available for diagnosis. Golden keeps its intentional cross-domain shared-world journeys.
- Static prerequisite annotations describe producer stages. Discovery resolves exact test identities and rejects incomplete fresh selections before setup. Typed, world-bound checkpoints preserve assigned IDs and observed facts across diagnostic worker restarts. Retained replay also verifies backend provenance and the recorded business date.
- The repository owns execution arguments and validates actual executed identities. File filters, configuration overrides, automatic retries, and parallel workers cannot silently turn a subset into complete certification. A retry proof must execute the failed stage on the current candidate and target.
- Local certification uses a recorded production build. Preflight compares application and environment digests, workspace and process ownership, the disk build ID, and the served opaque build ID. A separate candidate digest covers test and schema inputs without making documentation edits invalidate browser proof. Input changes during a run invalidate its result.
- A persistent campaign records attempt counts and cumulative cost across source changes and failure classes. Complete-run budgets require explicit, single-use extensions after investigation. Diagnostic work remains available as the cheaper recovery path. Current limits and commands live in [testing.md](../technical/testing.md#failures).
- A workspace lifetime lock serializes cooperating browser, cleanup, local-build, environment, unit, SQL, and component-test commands. It does not control raw reset commands or external processes. A killed process leaves an explicit recovery task rather than a lock that another run silently steals.
- Local Windows operations own a WSL lifetime process. The test-server command holds it across environment setup, the recorded build, and the application server; local browser runs also hold it through teardown. This addresses observed graceful WSL shutdowns while Docker services were running. Systemd services alone do not keep WSL alive, as documented by [Microsoft](https://learn.microsoft.com/en-us/windows/wsl/systemd).

Standalone browser tests of real shared components supplement the application suites. They can prove keyboard, focus, error, and pending-state contracts without constructing a business world. They do not replace application persistence, role, or organization-boundary assertions.

Under [decision 0005](0005-enforcement-ladder.md), the ownership and preparation/submission API changes remove unsafe operations at Tier 1 where possible. Runtime selection, provenance, locking, and evidence checks are Tier 2. Fixture meaning, completeness of assertion-to-flow mappings, and new undeclared interactions still require review. These mechanisms alone do not certify the current application or authorize a reduced acceptance battery.

## Amendment 2026-09-05: qualification of this hardening review

After the owner challenged the repeated verification cost, the [UI/UX and test-reliability review](../plans/phase-1/hardening-2026-09/03-uiux-and-test-reliability.md#task-specific-closure-amendment-2026-09-05) adopted a bounded closure record: the completed 149-case local audit baseline, explicitly attributed Golden results, fresh evidence for subsequent affected behavior, component and static checks, and the DEV canary. Its change table owns the exact obligations and remaining limits. This exception applies only to that review; it changes no slice acceptance, wave-end, or production-release gate above.

A candidate digest identifies inputs. It does not prove which behaviors a change affects. Preserve passing evidence with its original provenance and review the change impact before repeating expensive tests. A collection of partial or mixed-candidate passes must never be reported as a complete certification run. The runner continues to enforce that distinction, and this review does not reset its accumulated campaign cost.

## Amendment 2026-09-13: local invite mail

The September 2026 security follow-up replaced the invite function's original log-only local simulation with explicit Mailpit delivery through the local capture transport. [Environments](../technical/environments.md#the-local-test-stack) owns the current local mail configuration and failure behavior; the consequence bullet above keeps its 2026-08-28 wording as history.
