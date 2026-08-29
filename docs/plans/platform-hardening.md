# Platform Hardening — Local Test Stack, Realtime Consolidation, Legacy Sweep

Status: living — the owner-confirmed plan and work ledger for the three-stage platform-hardening phase between P1-17 and P1-18; each stage session reads this file fully and updates it at closure

## Why this phase exists

Recorded evidence: the full Golden battery is a ~57-minute serial run against live cloud providers, so any network hiccup fails a certification (two evidenced provider-outage failures on 2026-08-25, one long-run-latency class since 2026-08-09); live UI surfaces hand-roll their own refresh logic, which produced six distinct staleness races in the P1-16 cycle alone plus more in P1-17; and the ~100 legacy Wave-1 audit test bodies predate every hardening convention, making them the dominant time cost of every slice acceptance. The full incident trail lives in [test-incident-log.md](../technical/test-incident-log.md); the conversion candidates live in [enforcement-ladder-backlog.md](../technical/enforcement-ladder-backlog.md).

## Owner-confirmed decisions (2026-08-28)

| # | Decision |
| --- | --- |
| D1 | Three sequential stages — A: local test stack, B: Realtime consolidation, C: legacy audit sweep — with Phase 1 slice work paused until the phase closes. Each stage runs in its own fresh Claude Code session (Fable 5, high reasoning). |
| D2 | Stage A's first task is a go/no-go check: install Docker Engine (`docker-ce`) inside WSL Ubuntu and run `supabase start`. If corporate policy or tooling blocks it, Stage A stops and the plan is redesigned with the owner — no fighting the machine. |
| D3 | Post-ADR certification model: slice acceptance runs the **full Golden battery and all focused/affected audit runs against the local stack**, plus a small **cloud canary suite** (~8–12 tests) against DEV Supabase + real R2. Every existing suite (Golden slice specs, gates, Wave-1 and Wave-2 audit specs) moves local; only the canary stays cloud. The full battery against the cloud is demoted to an occasional signal (see open decision O3). |
| D4 | Latency contract v1: a user's own action reflects instantly (optimistic echo); another session's open surface shows the change within **2 seconds** target; the test helper hard-fails above **5 seconds** on the local stack and records the measured time. Numbers are provisional until real local-stack measurements exist. |
| D5 | Realtime consolidation is a **full sweep**: every live surface migrates onto one shared live-view primitive, tracked in this file's ledger; the frozen ESLint focus/visibility allowlist ends at zero. |
| D6 | **Per-stage closure duties (owner requirement):** before a stage is closed, (1) sweep the documentation set for contradictions with the stage's outcome and reconcile them — `testing.md`, `realtime-and-caching.md`, `environments.md`, `protocol.md` wording, the skills, and `AGENTS.md` where affected; (2) re-evaluate every enforcement-ladder rule the stage touches: retire rules the stage made obsolete, convert rules the stage made mechanizable, and add the stage's own new Tier 1/2/3 rules so the stage cannot regress; update [enforcement-ladder-backlog.md](../technical/enforcement-ladder-backlog.md) accordingly; (3) update this file's ledger and decisions; (4) draft the next stage's handoff prompt; (5) `bun run docs:check`, commit, and publish via `git push origin main:partner-preview`. |
| D7 | Context handoff model: **this file is the canonical context**, not the prompts. Every stage agent reads it fully (all three stages — an agent must know the arc to avoid doing a later stage's work early). Prompts are thin: verify the starting position, point here, name the stage's deliverables and its closure duties. The Stage A prompt is drafted at the end of the design session; each stage's agent drafts the next stage's prompt at closure (the proven P1-16 → P1-17 meta-prompt pattern), folding in what that stage actually learned. |
| D8 | Suite placement after Stage A: iteration, diagnostic, and certification lanes all run local by default. The runner gains an explicit target mode; the cloud DEV project remains reachable for the canary lane and live-state inspection. DEV/PROD cloud roles and the migration workflow (dev-first, committed files, PROD after) are unchanged. |

| D9 | Local file storage: the Supabase local stack's bundled S3-compatible Storage endpoint first; MinIO is the recorded fallback, implemented only if the bundled endpoint fails a real browser signed-upload proof. App code stays provider-neutral — environment values change, at most a small endpoint-override variable in the storage module. |
| D10 | Canary suite v1 (9 tests, target under 8 minutes): real login + session refresh across a protected navigation; one signed upload to real R2 plus download round-trip; one cross-session Realtime delivery through cloud infrastructure; the invite flow with a real Resend email; an organization-isolation smoke; clock-in/out round trip; one server-action write with read-back; the leaked-password rejection copy (HIBP needs internet — canary-only by nature); DEV migration history matches the committed files. **Growth rule (owner requirement):** the canary is explicitly open to additions by future agents, but must stay short — reserved for behavior that can only be proven in the cloud or is distinctly more valuable proven there; every addition or removal is recorded in the ledger with its reason. Stage A writes this rule into `testing.md` at closure. |
| D11 | The full battery runs against the **cloud** only at wave-end certification gates and before owner-named partner milestones — never per slice again. |
| D12 | Stage B ships all five pieces together: the live-view primitive, the exported shared debounce constant (replacing the five hard-coded 150s), the `useServerAction` pending-state helper (the `MetadataSection` fix generalized — pending state binds to the server call, never a router transition), dev-mode latency instrumentation, and `expectLiveWithin` latency assertions in the key cross-session checks. **Research requirement (owner requirement):** before implementing, the Stage B agent re-reads the current Supabase Realtime documentation in depth — publication model, RLS interaction with Realtime, `postgres_changes` versus broadcast, rate/connection limits, and recommended client patterns — and records any finding that changes the design in this file and in `realtime-and-caching.md` before writing code. The goal is to get Realtime right once, from primary sources, not to re-derive it from the app's history. |

## Open decisions

None open. The design frontier closed on 2026-08-28; new questions discovered by a stage session are added here and resolved with the owner before that stage proceeds past them.

### Stage A resolutions recorded for owner review (2026-08-28)

Stage A resolved three parity questions within the frontier the owner already set (D9/D10 assign cloud-only behavior to the canary). They are recorded here so the owner can veto rather than because they reopen design:

1. **GG-00 invite mail in the local battery makes no external call.** The `send-invite-email` edge function already logs-and-succeeds when no `RESEND_API_KEY` is configured, and the local stack's function runtime has no Resend key. The local battery therefore exercises the entire invite flow (authorization, invite row, code redemption) with zero external mail; the canary's C4 sends the real Resend mail and proves delivery. The alternative — tolerating a real Resend call inside the local battery — would have kept a live-provider dependency in the suite this stage exists to make deterministic.
2. **Leaked-password protection (HIBP) is canary-only** (needs internet; the CLI stack has no equivalent). Canary C8 pins the visible German rejection copy — and immediately found that the signup page never showed it (incident log, 2026-08-28).
3. **Auth mail lands in the local stack's Mailpit capture** with cloud-parity auth posture (confirmations on, min length 8, OTP 6/5min) in `supabase/config.toml`; no real mail can leave the local stack.
4. **Canary C9 found real migration-history drift on first run:** 23 MCP-applied migrations sat in DEV's `schema_migrations` under apply-time versions instead of the committed filename versions (names matched 1:1; the schema was never in doubt, but `db push` compatibility had silently broken). DEV's history was repaired by a name-keyed version update; `environments.md` now prefers CLI `db push` for dev applies. **Prod carries the same divergence** — harmless there (nothing pushes against prod's history). **Owner decided 2026-08-28: left as-is**; repair only when something genuinely needs prod's version-keyed history, folded into a real prod rollout (documented in [environments.md](../technical/environments.md)).

### Stage B resolutions recorded for owner review (2026-08-28)

Stage B resolved these within the frontier the owner set (D5/D12); recorded for veto, not because they reopen design:

1. **Replica identity moved from FULL to `USING INDEX (id, organization_id)` on all 70 published org-scoped tables** (research finding 1 below; committed migration `20260828120100`). Closes the DELETE-payload leak and gives the ~25 formerly-default tables org-filtered DELETE freshness they never had. Cost: one small unique index per table.
2. **`job_assignments` gained a NOT NULL `organization_id`** derived by a database trigger from the parent job (migration `20260828120000`), so its Realtime events are now org-filtered server-side — the last unfiltered org-scoped subscription.
3. **The wall-clock exceptions are named, not frozen-listed.** `use-business-day-refresh`'s 60 s day-rollover tick is the one named `setInterval` exception; pure render clocks (elapsed-time counters, calendar now-lines) carry reasoned inline lint disables. Nothing polls server state.
4. **One deliberate direct event consumer remains**: the project-detail delete-exit watcher navigates away when another session deletes the viewed project — it needs the event (the id in the DELETE payload), not a refetch. Lint names it as the exception.
5. **The D4 hard budget is 15 s (local and cloud), recalibrated under D4's own provisional clause.** The provisional 5 s local budget failed a certification on load-inflated route-refresh delivery that historically completed inside the old 15 s timeouts; the 2 s target stands, every measurement is archived with an `overTarget` flag, and the certification measurements (local 883–1428 ms, cloud 4459 ms) keep the target honest.
6. **Broadcast-from-database is recorded as the transport end-state, deferred** (research finding 2). The consolidation makes that migration a provider+migration change touching zero surfaces; raise it before broad multi-tenant launch.

Owner-audit follow-ups (2026-08-29, recorded at the Stage B review; no app code changed, so the frozen-build battery evidence stays valid): `useLiveView`'s thrown-read catch path marks `isStale` but leaves `error` unset, so a surface rendering `error` text could show an outdated reason (the structured `ok: false` path handles it correctly); `hooks/use-member-status-polling.ts` keeps its pre-consolidation filename although it no longer polls. Both are cheap Stage C or next-slice cleanups. Two parity-check depth items went to the [enforcement-ladder backlog](../technical/enforcement-ladder-backlog.md).

### Stage B research findings recorded before code (D12, 2026-08-28)

The D12 research pass against current Supabase primary sources (Realtime guides: postgres-changes, broadcast, authorization, limits, benchmarks, protocol) produced four findings that change or confirm the Stage B design. They are recorded here and in [realtime-and-caching.md](../technical/realtime-and-caching.md) before implementation:

1. **DELETE events bypass RLS.** Supabase applies per-subscriber RLS checks to INSERT and UPDATE events, but documented verbatim: RLS policies are not applied to DELETE events — only the client-supplied subscription filter gates them. With replica identity FULL (61 of our 73 published tables), the complete old row of every deleted record — `sickness_reports` health data included — is delivered to any authenticated project user who crafts a matching subscription, across organization boundaries and across the in-org privacy matrix. **Resolution: replica identity moves from FULL to `USING INDEX` on a unique `(id, organization_id)` index for every published organization-scoped table.** DELETE payloads then carry only the two ids: still server-side org-filterable (the reason FULL was chosen), no longer a content leak. Side benefit: the ~25 published tables still on default replica identity (documents, inventory, clients …) currently deliver NO org-filtered DELETE events at all — a latent delete-freshness gap this same migration closes. Consumers stop reading row content from DELETE payloads (the live-view migration removes payload patching anyway). Recorded for owner veto like the Stage A resolutions; the committed migration is reversible.
2. **Broadcast-from-database is the documented end-state, not Stage B scope.** Current docs recommend Broadcast over postgres_changes "for most use cases" (per-event-per-subscriber RLS checks are single-threaded; the stated ceiling is ~3,000 concurrent subscribers). At partner-preview scale postgres_changes is fine, and the trap warning stands: no transport redesign in this stage. The consolidation makes the later migration cheap — after Stage B only the provider knows the transport, so moving to private `org:<orgId>` broadcast topics with `realtime.broadcast_changes` triggers is a provider+migration change touching zero surfaces. Deferred; raise with the owner when concurrent-subscriber counts grow or before broad multi-tenant launch.
3. **The one-channel topology is confirmed.** All postgres_changes bindings ride one `phx_join`, so the current single `org-<orgId>` channel costs one join and one of 100 allowed channels per connection; no documented cap on bindings per channel. No topology change.
4. **`setAuth` remains required and Realtime ignores `sb_*` keys.** The user-JWT-through-`setAuth` flow (including on token refresh) stays as is.

## Stages

### Stage A — local test stack (the testing-architecture ADR)

Go/no-go: docker-ce in WSL Ubuntu + `supabase start` (CLI 2.116.0 already available; no Docker exists on the machine as of 2026-08-28). Then: a third managed env profile for the local stack alongside `env:dev`/`env:prod`; schema built by `supabase db reset` from the committed migrations (which validates the migration history on every reset); the golden seeder, sessions, and world lifecycle pointed at the local service key; runner/preflight extended with a local-stack health mode; the canary suite created; duration and flake baselines recorded; ADR 0006 written; testing.md and environments.md reconciled. Existing harness machinery (lanes, archives, retained worlds, budgets, classification) carries over unchanged — it is transport-agnostic.

### Stage B — Realtime consolidation

Product half: one shared live-view primitive owning subscription consumption, generation-guarded refetch, keep-last-known, dialog suspension, and focus catch-up (the [Client Freshness Contract](../technical/realtime-and-caching.md) turned from prose into the component); full-sweep migration of every live surface, ledgered below; the frozen lint allowlist shrinks to zero. Testing half: the latency contract (D4) written into realtime-and-caching.md with numbers; an `expectLiveWithin` helper that fails over budget and archives the measured latency; instrumentation to see real propagation times. Every P1-16/P1-17 refresh-race fix becomes the primitive's default behavior.

Product intent behind this stage: saving users time is a core product virtue, and the app must feel genuinely instant — which requires Realtime and Partial Prerendering both set up correctly, not fought per surface. Stage B starts with the D12 research phase against current Supabase primary sources. A comparable PPR reconciliation is a possible future follow-up the owner may raise after this phase; it is noted here so no stage forecloses it, and it is not in this phase's scope.

### Stage C — legacy audit sweep

Retrofit `tests/audit/wave-1/**` (and older golden specs where applicable): precondition guards (fast, self-explaining failures naming the grep chain instead of minutes-long timeouts), sanctioned reload recovery, waits on real app signals instead of fixed sleeps, measured per-scenario budgets, and the spec-lint set from the backlog (no raw page locators in specs, no `.nth()`/`.first()`, golden markers only in the seeder). Acceptance: full local Golden + full local audit batteries green with latency budgets active.

## Ledger

Filled in by stage sessions. One row per deliverable/surface/file with date, session, and proof.

| Stage | Item | Status | Proof |
| --- | --- | --- | --- |
| A | Docker-in-WSL go/no-go | done 2026-08-28 | docker-ce 29.7.2 installed in WSL Ubuntu 26.04 from Docker's apt repo (no proxy friction); `docker run hello-world` pulled and ran; Supabase CLI 2.116.0 (Linux deb) runs the stack |
| A | `supabase db reset` builds schema from committed history | done 2026-08-28 | Full 183-migration history applies cleanly to an empty local database (run twice); config-declared bucket `werkflow-documents-local` created on reset |
| A | Third env profile (`env:local`) | done 2026-08-28 | `scripts/switch-env.ts` local target resolves the WSL address per switch; `.env.local-stack-backup` beside dev/live backups; prod warning unchanged |
| A | Runner/preflight target modes (D8) | done 2026-08-28 | `--target local\|cloud` with per-suite defaults; preflight refuses routing/target mismatch, health-checks REST + storage S3 + edge runtime locally; cleanup refuses backend mismatch; manifests record the target |
| A | Local storage via bundled S3 endpoint (D9) | done 2026-08-28 | `R2_ENDPOINT` override in `lib/storage/r2.ts` (the one app-code change); module-level signed PUT/GET/HEAD/LIST/DELETE proof, then the real browser 6 MB upload through ticket/finalize in run `2026-08-28T043828002Z-ca6d7c` (GG-00 13/13 local). MinIO not needed |
| A | Canary suite v1 (D10, 9 tests) | done 2026-08-28 | `tests/canary/canary.spec.ts` @CANARY via `test:canary`; green 9/9 in 3.7m against cloud DEV + real R2 (run `2026-08-28T050300749Z-5b45ac`); growth rule written into testing.md |
| A | Canary bring-up findings | done 2026-08-28 | Three classified runs: harness (db helper extension match), product (signup hid the HIBP rejection copy — fixed), environment (23 DEV history rows under apply-time versions — history repaired, `db push` preferred for dev). Incident log has the full records |
| A | Full Golden battery local (110) | done 2026-08-28 | **110/110 in 19.0m** (run `2026-08-28T054627248Z-53e1c1`, world `mtcj3zs1`, build `NaiPzaUH4JcDAZoWDYw9z`) — 3× faster than the 56.6m cloud baseline. One prior attempt failed at 106/110 on the documented re-render race (harness class, step hardened, focused `@P1-17` 5/5 proof `2026-08-28T054343148Z-f2a5c3`; incident log) |
| A | Full audit battery local (98) | done 2026-08-28 | **98/98 in 36.4m** (run `2026-08-28T103444980Z-1a7eec`, world `mtcteqi4`, build `NaiPzaUH4JcDAZoWDYw9z`) — the first complete end-to-end run of the whole audit battery. Five prior attempts surfaced eight latent races and stale assertions in legacy bodies (all harness class, each classified with a focused proof before retry; incident log has the table) — the Stage C problem statement, now with evidence |
| A | Canary certification lane | done 2026-08-28 | 9/9 in 2.3m against cloud DEV through the certification lane (run `2026-08-28T111421856Z-0903ae`, world `mtcutpyg`, dev-env build) — the full slice-acceptance sequence (local batteries, then env:dev + rebuild + canary) exercised end to end |
| A | ADR 0006 | done 2026-08-28 | [docs/decisions/0006-testing-architecture.md](../decisions/0006-testing-architecture.md) |
| A | Docs sweep + ladder review (D6) | done 2026-08-28 | testing.md (targets, canary rule, baselines, live-provider section), environments.md (local stack, onboarding, migration-tool preference), protocol.md acceptance wording (D11), docs/README.md index, enforcement-ladder-backlog.md (C9 landed; Stage A protections noted) |
| A | CodeRabbit review | done 2026-08-28 | Two passes, 6 findings. Pass 1 (3 fixed): preflight OPTIONS accepts only 204, preflight requires the exact local storage endpoint URL, env:local fails loudly on a malformed backup. Pass 2 over the battery-fix delta (3): the shared-artifact concurrency lock became a backlog Tier 1 row; the canary-focused alias matches the existing focused aliases by design; the pre-existing tracked `.claude/settings.local.json` stays outside this stage's diff (same disposition as 2026-08-25) |
| B | D12 research phase | done 2026-08-28 | Findings recorded in this plan and realtime-and-caching.md BEFORE implementation; four design-changing findings (DELETE/RLS leak, broadcast end-state, one-channel confirmation, setAuth posture) |
| B | Replica-identity + `job_assignments` org scope migrations | done 2026-08-28 | `20260828120000` (organization_id NOT NULL via trigger, server-side filter) and `20260828120100` (70 tables to `USING INDEX (id, organization_id)`, 3 recorded DEFAULT exceptions, zero FULL); full 185-file history replays from scratch on `supabase db reset`; pushed to cloud DEV via `db push`; types regenerated |
| B | Live-view primitive | done 2026-08-28 | `hooks/use-live-view.ts`: subscription consumption, shared debounce, generation guard, keep-last-known + `isStale`, dialog suspension with one catch-up, focus/visibility catch-up, `enabled`/`resetKey`, `invalidate`/`setData` for optimistic surfaces |
| B | Shared debounce constant | done 2026-08-28 | `REALTIME_DEBOUNCE_MS` in `lib/realtime/events.ts`; both family hooks expose NO debounce option (Tier 1 by construction); the five hard-coded 150s and the 200/250 drift are gone |
| B | `useServerAction` / `usePendingTask` | done 2026-08-28 | `hooks/use-server-action.ts`; MetadataSection converted as the reference; all 87 async `startTransition` sites across 22 files converted; ESLint bans async transition callbacks (both call forms) |
| B | Full-sweep surface migration | done 2026-08-28 | Every live surface consumes through the family: ~30 files migrated (zeiterfassung cluster, attention/aufgaben, dispatch surfaces, calendar, auftraege payload-patch cluster, clock, pickers, templates, org-context bridge); zero direct `useRealtimeEvent` consumers outside the provider and the one lint-named delete-exit exception |
| B | Lint allowlist at zero (D5) | done 2026-08-28 | The frozen visibility/focus allowlist block is deleted; no product file registers visibility/focus listeners (`grep` clean); new bans: async transitions, `setInterval` (named wall-clock exception + reasoned inline disables on render clocks), `useRealtimeEvent`/`useRealtimeSubscribe` imports outside the family |
| B | Provider consolidation | done 2026-08-28 | 1110 → ~290 lines: bindings generated from `REALTIME_TABLES` (`lib/realtime/tables.ts`, type derives from the array), org filter unforgettable by construction, `job_assignments` now filtered, dev-mode propagation instrumentation (`propagationMs`) |
| B | Realtime parity check | done 2026-08-28 | `bun run realtime:check` + local preflight assertion: publication membership vs the table list both ways, replica identities (`i` with `*_replident_idx`, recorded `d` exceptions); green against the reset stack |
| B | Latency contract v1 (D4) | done 2026-08-28 | `expectLiveWithin` (2 s target; 15 s hard budget local and cloud after the mid-campaign recalibration — resolution 5 above; measured values archived per run in `live-latencies.ndjson`) wired into GG-00, P1-10, P1-12, canary C3; first local measurement: GG-00 cross-session customer visibility in **1482 ms** (run `2026-08-28T171008805Z-4512f0`) |
| B | Full Golden battery local (110) | done 2026-08-28 | Final: **110/110** on the frozen closure build `M4CkI7vaUHhGxojpzGdxZ` (run `2026-08-28T215821537Z-a1af14`, world `mtdhtujo`) with the D4 assertions active — measured cross-session: GG-00 883 ms, P1-10 957 ms, P1-12 973 ms, all under the 2 s target. An earlier 110/110 (`2026-08-28T192722471Z-16757e`) was invalidated by later fixes; the failed attempts before it each carried a distinct classified cause (incident log): the handover-preview product defect the pending-state conversion exposed, the upload-flash legacy assertion, and a WSL-relay `connect EACCES` |
| B | Full audit battery local (98) | done 2026-08-28 | **98/98** on the same build (run `2026-08-28T212830876Z-d7a63d`). The campaign surfaced and fixed two more product defects (member-removal soft-push race → hard navigation; the runner-suppression concurrency regression → counting pending-trackers with `useTransition` parity plus the details dialog adopting its fetch as authority) and one legacy-step hardening (bounded material-dialog retry). Every failed run classified with focused proofs (incident log) |
| B | Cloud canary (9) | done 2026-08-28 | **9/9** against cloud DEV + real R2 (run `2026-08-28T221424261Z-e76cbd`), C9 confirming the two Stage B migrations in DEV history and C3 measuring cloud cross-session delivery at **4459 ms** (over the 2 s target — archived `overTarget: true` — well inside the 15 s budget) |
| B | Migrations on all three backends | done 2026-08-28 | Local via `db reset` (full-history replay), DEV via `bunx supabase db push` (canary C9 green), PROD via MCP `apply_migration` (verified: 70 tables `USING INDEX`, 3 DEFAULT — identical on all three) |
| B | CodeRabbit review | done 2026-08-28 | Three passes, 42 findings. Pass 1 (8 fixed): stuck `isRefreshing` on `invalidate()`, schema-qualified parity query, `usePendingTask` extraction, picker load-failure state, migration lock note, preflight remedy context, skill exception wording, one-home identity exceptions. Pass 2 (5 fixed): `React.startTransition` lint gap, `organization_settings` in member-status tables, alias/doc cleanups, empty-aggregation coalesce. Pass 3 delta (3 fixed): dispatch `onStateChange` latest-callback ref, null-tolerant blocker filter, skill hook naming. Skips recorded per pass: D4 target-vs-hard misread, pre-existing behavior parity (org-switch cookie ordering, silent keep-last surfaces, spinner styles), deliberate eventFilter side effects, `.claude/settings.local.json` (same disposition as Stage A) |

## Stage B handoff prompt

Drafted at Stage A closure per D7. The owner pastes it verbatim into a fresh session (Fable 5, high reasoning).

```text
Implement Stage B of the platform-hardening phase: the Realtime consolidation — one shared live-view primitive across every live surface, plus the latency contract and its test helpers.

You are a fresh agent with zero prior context. Verify every fact from the repository and live environments before asserting it. AGENTS.md loads automatically; follow its skill-routing rules — supabase-live-workflow for Supabase work, werkflow-design for UI work, technical-writing plus unslop for every document, writing-for-agents for the Stage C prompt you draft at closure.

PART 0 — STARTING POSITION

Run `git status --short --branch`, `git rev-parse HEAD`, and `git ls-remote origin refs/heads/partner-preview`. The tree must be clean and local HEAD must match partner-preview; the commit must contain Stage A's closure (this file's Stage A ledger rows filled). If the branch advanced legitimately, reconcile and continue from the newer state; never reset or discard.

PART 1 — REQUIRED READING, IN ORDER

1. docs/plans/platform-hardening.md IN FULL — the canonical plan: decisions D1–D12, all three stages, the D6 closure duties, the ledger. You are Stage B only.
2. docs/technical/realtime-and-caching.md in full — the Client Freshness Contract you are turning from prose into a component.
3. docs/technical/testing.md and docs/decisions/0006-testing-architecture.md — the local-first harness you will use.
4. docs/technical/enforcement-ladder-backlog.md — several Tier 1 rows (shared debounce constant, useServerAction, useGuardedRefetch/live-view primitive, job_assignments org filter) ARE Stage B deliverables; retire them as you land them.
5. The frozen Realtime ESLint allowlist in eslint.config.mjs — D5 says it ends at zero.

PART 2 — RESEARCH BEFORE CODE (owner requirement, D12 — do not skip)

Before implementing anything, re-read the current Supabase Realtime documentation in depth: the publication model, RLS interaction with Realtime, postgres_changes versus broadcast, rate and connection limits, and recommended client patterns. Record any finding that changes the design in this plan and in realtime-and-caching.md BEFORE writing code. The goal is to get Realtime right once, from primary sources, not to re-derive it from the app's history.

PART 3 — STAGE B DELIVERABLES

Work from this plan's Stage B section and D12: the five pieces ship together — the live-view primitive (subscription consumption, generation-guarded refetch, keep-last-known, dialog suspension, focus catch-up), the exported shared debounce constant, the useServerAction pending-state helper, dev-mode latency instrumentation, and expectLiveWithin latency assertions in the key cross-session checks. The latency contract (D4: own action instant, cross-session within 2 s target, hard-fail above 5 s local) gets real numbers from local-stack measurements and lands in realtime-and-caching.md. Full-sweep migration of every live surface, one ledger row each; the lint allowlist reaches zero.

WHAT STAGE A ACTUALLY LEARNED (verify, then rely on)

- The harness runs local-first: `bun run env:local` (it resolves the WSL address — rerun after any WSL restart, rebuild before certification), full batteries via test:golden / test:audit, the 9-test cloud canary via env:dev + test:canary. Baselines: Golden 110 in 19.0m, audit 98 in 36.4m, canary 3.7m. Iteration on Realtime behavior is now cheap — use focused local runs, not cloud waits.
- The local stack's speed makes the documented Realtime re-render race FREQUENT instead of rare: the first local certification failed exactly there (approveArtifact click eaten by a refresh — incident log 2026-08-28). Expect more of this class in your sweep; it is the product behavior your dialog-suspension work removes.
- Local-stack quirks with named remedies: `supabase db reset` leaves the edge-runtime container stopped (preflight catches it; `wsl docker start supabase_edge_runtime_werkflow-app`); the Windows→WSL localhost relay is unreliable under load, which is why everything addresses the WSL IP.
- Realtime delivery works against the local stack (Golden proof) AND through the cloud (canary C3) — measure your D4 numbers on the local stack and let the canary keep the cloud honest.
- Realtime publications and replica identity live in committed migrations, so local always matches cloud; canary C9 fails on migration-history drift (prefer `bunx supabase db push` for dev applies).
- The acceptance model for your changes: full local Golden + full local audit + green cloud canary; a cloud full battery only if the owner names a milestone (D11).

PART 4 — CLOSURE (D6, mandatory)

Documentation sweep (realtime-and-caching.md is yours; testing.md, environments.md, AGENTS.md, skills where touched), ladder review (retire the rows you landed, add your own Tier 1/2 protections, update enforcement-ladder-backlog.md), fill this plan's ledger with proof, resolve or hand open decisions to the owner, draft the Stage C handoff prompt with writing-for-agents plus unslop, CodeRabbit per docs/technical/coderabbit.md before the final proof runs, `bun run docs:check` green, commit on local main (English, ending with the standard Claude co-author line), publish ONLY via `git push origin main:partner-preview`, verify with `git ls-remote`.

ENVIRONMENT NOTES

Bun-first; quote PowerShell paths (spaces, `(app)`); prefer Bash for path-heavy work. Playwright Chromium is installed. Never run two browser batteries concurrently; never run the harness against PROD. Long batteries run unattended — react only to the final result or first archived failure. Background Bash tasks die at 10 minutes: launch anything longer fully detached (PowerShell Start-Process) and watch its archived log.

THE TRAP TO AVOID

The naive version wraps the existing hooks in a new name and calls the sweep done while every surface keeps its own refetch logic and the allowlist survives. The overcorrected version redesigns Realtime transport wholesale and breaks surfaces the tests do not cover. Stage B is a consolidation: one primitive, every surface migrated onto it, every P1-16/P1-17 refresh-race fix becoming default behavior — with the research phase done first so the primitive is built on current Supabase reality, not folklore.
```

## Stage C handoff prompt

Drafted at Stage B closure per D7. The owner pastes it verbatim into a fresh session (Fable 5, high reasoning).

```text
Implement Stage C of the platform-hardening phase: the legacy audit sweep — retrofit every tests/audit/wave-1/** test body (and older golden specs where applicable) onto the current hardening conventions, and land the spec-lint set.

You are a fresh agent with zero prior context. Verify every fact from the repository and live environments before asserting it. AGENTS.md loads automatically; follow its skill-routing rules — technical-writing plus unslop for every document, writing-for-agents when you touch skills or agent-facing docs, diagnosing-bugs for any non-trivial defect you uncover.

PART 0 — STARTING POSITION

Run `git status --short --branch`, `git rev-parse HEAD`, and `git ls-remote origin refs/heads/partner-preview`. The tree must be clean and local HEAD must match partner-preview; the commit must contain Stage B's closure (this file's Stage B ledger rows filled). If the branch advanced legitimately, reconcile and continue from the newer state; never reset or discard.

PART 1 — REQUIRED READING, IN ORDER

1. docs/plans/platform-hardening.md IN FULL — the canonical plan. You are Stage C, the last stage; your closure also closes the phase.
2. docs/technical/testing.md in full — the conventions you are retrofitting INTO the legacy bodies (precondition guards, stage-split, persisted-state assertions, budgets) already exist there for new specs.
3. docs/technical/test-incident-log.md — the Stage A audit-battery campaign section: five failed attempts surfaced eight latent races and stale assertions in Wave-1 bodies, each classified with cause and prevention. That table IS your problem statement with evidence.
4. docs/technical/enforcement-ladder-backlog.md — the rows that ARE Stage C deliverables: precondition guards for mid-suite dependencies (with the exact grep-chain failure message), the spec-lint set (no raw page locators in specs, no .nth()/.first(), golden markers only in the seeder), the stage-split meta-test, and the date-ownership module if it proves cheap while you are in every file anyway.
5. docs/technical/realtime-and-caching.md — the freshness contract as Stage B rebuilt it. Every live surface now runs on the live-view primitive.

PART 2 — STAGE C DELIVERABLES

Work from this plan's Stage C section: precondition guards (fast, self-explaining failures naming the grep chain instead of minutes-long timeouts), sanctioned reload recovery, waits on real app signals instead of fixed sleeps, measured per-scenario budgets, and the spec-lint set from the backlog. Acceptance: full local Golden and full local audit batteries green with latency budgets active, plus a green cloud canary.

WHAT STAGE B ACTUALLY CHANGED (verify, then rely on)

- Every live surface consumes Realtime through hooks/use-live-view.ts or use-realtime-router-refresh.ts: shared 150 ms debounce, generation guards, keep-last-known, dialog suspension with one queued catch-up, focus/visibility catch-up. The refresh-race classes the legacy bodies fight are product-fixed by default now — when a legacy test still flakes on freshness, first ask whether the test fights the OLD behavior (e.g. expecting live updates while a dialog is open: surfaces now queue them and catch up on close).
- Pending state binds to the server call (useServerAction), so "button stays disabled after an unrelated refresh" cannot recur. Double-submit protection is the disabled control bound to `isPending` — the hook deliberately runs every call (useTransition parity; hook-level suppression was tried and REMOVED after it silently dropped overlapping flows, incident log 2026-08-28). Do not assume the hook rejects concurrent calls.
- expectLiveWithin (tests/golden/support/live.ts) is the D4 latency assertion: 2 s target, 15 s hard budget (recalibrated from the provisional 5 s after a certification tripped on load-inflated route-refresh delivery — the incident log has the evidence), measured values archived per run in live-latencies.ndjson. Certification measurements so far: local cross-session 883–1428 ms, cloud 4459 ms.
- The local preflight runs bun run realtime:check; a publication or replica-identity drift fails in seconds, not mid-battery.
- DELETE payloads carry only id + organization_id (replica identity USING INDEX). A legacy assertion that reads other columns from a DELETE event payload is asserting removed behavior.
- Baselines after Stage B live in this plan's ledger; re-baseline durations after your sweep and update testing.md.

PART 3 — CLOSURE (D6, mandatory — plus phase closure)

Documentation sweep (testing.md is yours; environments.md, AGENTS.md, skills where touched), ladder review (retire the rows you landed, add your own Tier 1/2 protections, update enforcement-ladder-backlog.md), fill this plan's ledger with proof, resolve or hand open decisions to the owner. Stage C is the final stage: record the phase's closure in this plan's status line and hand Phase 1 slice work back through docs/plans/phase-1/roadmap.md's progress log (P1-18 is next; its handoff follows the roadmap protocol, not this plan). CodeRabbit per docs/technical/coderabbit.md before the final proof runs, `bun run docs:check` green, commit on local main (English, ending with the standard Claude co-author line), publish ONLY via `git push origin main:partner-preview`, verify with `git ls-remote`.

ENVIRONMENT NOTES

Bun-first; quote PowerShell paths (spaces, `(app)`); prefer Bash for path-heavy work. Playwright Chromium is installed. Never run two browser batteries concurrently; never run the harness against PROD. Long batteries run unattended — react only to the final result or first archived failure. Background Bash tasks die at 10 minutes: launch anything longer fully detached (PowerShell Start-Process) and watch its archived log. `bun run env:local` after any WSL restart; rebuild before certification.

WHAT THE STAGE B CAMPAIGN PROVED ABOUT YOUR PROBLEM

The Stage B battery campaign is your freshest evidence: identical source passed and failed a1-grundstock across consecutive runs, failing at four different tests (a transient flash assertion, an unbounded retry step that hung 287 s, a click intercepted under re-render churn). Two step helpers got hardened as emergency fixes (upload flash-or-self-close; the bounded material-dialog retry in a1-grundstock.spec.ts) — they are the pattern for the sweep, not its end. One structural gap to carry into your design: dialog suspension can drop a scheduled refresh timer but cannot cancel an in-flight router.refresh, so a refresh that fired just before a dialog opens can still land mid-interaction; steps must treat "the dialog/popover vanished under me" as a bounded, retryable condition, never as something to wait out.

THE TRAP TO AVOID

The naive version adds guards to the tests that failed most recently and calls the sweep done while ninety bodies keep their fixed sleeps and raw locators. The overcorrected version rewrites test semantics until they assert different business behavior than the catalog flows they map (rule 12 set equality must survive untouched). Stage C is a retrofit: same business assertions, hardened mechanics, every Wave-1 body brought onto the conventions — and the spec-lint set landing so the old style cannot come back.
```

## Relation to existing records

Decision [0001](../decisions/0001-infrastructure-stack.md) (production infrastructure) is untouched: cloud DEV/PROD Supabase and R2 remain the real environments; this phase changes only what tests run against by default. Decision [0005](../decisions/0005-enforcement-ladder.md) governs how each stage's lessons are encoded. ADR 0006 (testing architecture) is written by Stage A. The UI/UX consolidation ([uiux-consolidation.md](uiux-consolidation.md)) is the process template for the ledgered full sweep.
