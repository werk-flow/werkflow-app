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

None — the design frontier closed on 2026-08-28. New questions discovered by a stage session are added here and resolved with the owner before that stage proceeds past them.

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
| A | Docker-in-WSL go/no-go | open | — |

## Relation to existing records

Decision [0001](../decisions/0001-infrastructure-stack.md) (production infrastructure) is untouched: cloud DEV/PROD Supabase and R2 remain the real environments; this phase changes only what tests run against by default. Decision [0005](../decisions/0005-enforcement-ladder.md) governs how each stage's lessons are encoded. ADR 0006 (testing architecture) is written by Stage A. The UI/UX consolidation ([uiux-consolidation.md](uiux-consolidation.md)) is the process template for the ledgered full sweep.
