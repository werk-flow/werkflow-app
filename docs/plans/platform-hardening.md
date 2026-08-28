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

## Relation to existing records

Decision [0001](../decisions/0001-infrastructure-stack.md) (production infrastructure) is untouched: cloud DEV/PROD Supabase and R2 remain the real environments; this phase changes only what tests run against by default. Decision [0005](../decisions/0005-enforcement-ladder.md) governs how each stage's lessons are encoded. ADR 0006 (testing architecture) is written by Stage A. The UI/UX consolidation ([uiux-consolidation.md](uiux-consolidation.md)) is the process template for the ledgered full sweep.
