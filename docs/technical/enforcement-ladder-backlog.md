# Enforcement-Ladder Backlog

Status: living — last reviewed 2026-08-28

The open conversion candidates from the 2026-08-27 three-part audit (code comments, docs, skills) under [decision 0005](../decisions/0005-enforcement-ladder.md). Each row names the rule, where it lives as prose today, and the concrete mechanism that would enforce it. Remove a row when its conversion lands (and annotate the owning doc "enforced by …"); add rows as new lessons appear. Most rows are scheduled for the Realtime/testing consolidation phase after P1-17.

Stage A of that phase (2026-08-28) added its own protections directly rather than through this backlog: run-policy pins the canary suite to the cloud target and the preflight refuses any run whose `.env.local` routing does not match the requested target (Tier 1); retained-world cleanup refuses a backend mismatch (Tier 1); the untracked-file fingerprint uses NUL-separated git output (Tier 1); local-stack health probes carry named remedies and the canary pins the HIBP copy and migration-history parity (Tier 2).

## Tier 1 candidates (make it unwritable)

| Rule (prose home) | Mechanism |
| --- | --- |
| Admin client only after `getUser()` validation (architecture.md; `lib/data/cached.ts` comment) | Branded `AuthenticatedActor` minted only by `getAuthenticatedUser()`; `createSupabaseAdminClient(actor)` requires it; or one `authorizedAction({role})` factory as the only admin-client export path |
| Organization scoping is hand-written per query (protocol invariant 2) | `orgScoped(client, orgId)` builder injecting the `organization_id` filter; lint-forbid bare `.from(` outside `lib/data/**` |
| Append-only event/revision/action tables must never be rewritten (protocol invariant 4) | Migration: `REVOKE UPDATE, DELETE` on every `*_events`/`*_revisions`/`*_actions` table |
| Dialog pending state binds to the server call, never a router transition (freshness contract rule 6) | A `useServerAction()` hook owning pending/disabled state as the only sanctioned submit path |
| The 150 ms Realtime debounce floor (freshness contract rule 1) | Export `REALTIME_DEBOUNCE_MS` from the provider; the five current 150-literals import it |
| Generation guards + keep-last-known re-derived per surface (freshness contract rule 5; six duplicated sites) | One `useGuardedRefetch(reader)`/live-view primitive — the centerpiece of the Realtime consolidation |
| Spec date-ownership windows live as prose (testing.md conventions) | `tests/golden/support/date-ownership.ts` claiming per-spec offset windows, throwing on overlap |
| `RegisterOpenDialog` placement (open-dialog-context comment) | Stop exporting the hook; primitives render the registration themselves |
| Signed-download disposition can be forced inline for unsafe types (documents/actions comment) | Compute disposition inside `createSignedDownloadUrl` from the MIME type; drop the parameter |
| Client-supplied storage paths (documents/actions comment) | Branded `StoragePath` produced only by the path builders |
| File bytes through Server Actions (decision 0001; r2.ts comment) | Move `putStorageObject` out of app reach (scripts-only module); ban `@aws-sdk/client-s3` imports outside `lib/storage/` + `scripts/` |
| PENDING time entries filtered as if only `approved` counts (time-tracking comments, 3 sites) | `getEffectiveTimeEntries()` as the single filter; validation.ts calls it |
| `job_assignments` Realtime events reach every org (provider comment) | Add `organization_id` to the table and filter server-side |
| Status colors semantic-only (AGENTS.md styling) | `statusVariant(status)` registry helper; ban raw `bg-green-*`/`bg-red-*`/`bg-yellow-*` |
| Hardcoded German UI strings buried in logic (AGENTS.md) | A `de` message catalog + lint on string literals in JSX text/aria positions |
| Harness mutation helpers can return the optimistic echo (testing rule 13) | Step helpers return the persisted row (db.ts read or reload) |
| "Never run two browser batteries concurrently" is operator discipline (testing.md; audit/canary config comments) | Runner acquires an exclusive lock on the shared `tests/golden/.artifacts` state before preflight and releases it after the child settles, so a concurrent second battery refuses instead of clobbering the world (CodeRabbit finding, Stage A 2026-08-28) |

## Tier 2 candidates (a check catches it)

| Rule (prose home) | Mechanism |
| --- | --- |
| "Mid-suite specs are not dual-mode" — a focused replay of a mid-suite/mid-file test without its predecessors fails spuriously after minutes on a wrong locator (testing.md; cost the P1-17 cycle three diagnostic rounds rediscovering the A1-01→A1-02→A1-05 chain) | Precondition guards: each dependent legacy test opens with a cheap persisted-state check (the `expectSetupJob` pattern the stage-split convention already mandates for new specs) that fails in seconds with the exact grep chain to run instead ("this test needs A1-01\|A1-02 in the same run"). Optional second layer: the runner warns when an iteration grep selects a strict subset of a serial file |
| Legacy Wave-1 audit test bodies predate every hardening convention (sanctioned reload, refresh-cycle waits, persisted-precondition guards, measured budgets) and surface latent races under each new slice's load — the dominant time cost of both the P1-16 and P1-17 cycles | One deliberate content-hardening sweep over `tests/audit/wave-1/**` applying the current conventions, folded into the Realtime consolidation phase (most of the latent races are freshness races that phase changes anyway; hardening them twice is waste) |
| Rule-12 ledger invariant (`X/X mapped; 0 partial; 0 unmapped`; set equality catalog↔ledger↔specs) | `bun run audit:check` parsing catalog IDs, ledger rows, and audit-spec tags |
| Catalog-wording change reopens the flow ID (testing rule 12) | Committed per-ID text hashes; `audit:check` fails on silent drift |
| Every certification run recorded in the gate log (testing.md) | Reporter appends the row itself, or `test:runs` asserts manifest↔log parity |
| Frozen-evidence rule: only docs may change after the green pair (testing rule 8) | `test:runs verify-evidence` comparing current fingerprint to the last passed certification |
| Complete slices have a Golden tag (protocol) | Check roadmap `complete` rows against `--list` output |
| Incident entries written by hand (testing rule 10) | `test:runs classify` appends the incident-log row itself |
| Raw selectors / `page.getByText` / `.nth()`/`.first()` in specs (testing conventions) | Spec-scoped lint: page-locator calls allowed only under `tests/*/support/**` |
| Stage-split per new slice spec; serial mode; ≥1 negative check (testing conventions) | Meta-test over `tests/golden/p1-*.spec.ts` |
| Golden-marker identities outside the seeder (testing conventions) | Lint ban on `werkflow-golden.test`/`Golden Test SHK`/`Fremde Firma` literals outside `seed.ts` |
| Publication/`TABLES`/replica-identity drift (realtime doc, restated per slice) | Unit test diffing dev `pg_publication_tables` + `relreplident` against the provider's `TABLES` union |
| Mutations must invalidate their cache tags (realtime doc) | Static scan: `'use server'` mutation files must call `updateTag()` via a table→tag registry |
| No polling without a named exception (realtime doc; `use-member-status-polling` is unnamed today) | Ban `setInterval` in product dirs with a named allowlist |
| Radix dialog imports bypassing the suspension wrapper (freshness rule 6) | Ban `@radix-ui/react-dialog`/`react-alert-dialog` imports outside `components/ui/**` |
| Purple/violet/amber palette bans; ring offsets; heavy shadows; hex in components (2 files to clean first) | Styling selector additions after the small cleanups |
| Generated-types drift; auth-config posture; advisors clean (environments.md, supabase skill) | `types:check`, sync script `--check` mode, `advisors:check`. Migration-history alignment landed in Stage A: canary C9 fails on any divergence between DEV's `schema_migrations` and the committed files, and every local `supabase db reset` validates the history itself |
| Build while a server serves `.next` (testing rule 3); dev-server fallback in `webServer` config (rule 1) | `guarded-build` script reusing the listener check; drop `webServer` from the certification path |
| Destructive migrations unmarked (protocol) | SQL lint requiring a `-- @destructive: <reason>` marker |
| Every public table has RLS + org column (protocol invariant 2) | Live dev check with a named global-table allowlist |
| Roadmap status enum, ready-set recomputation, accepted counter, record/log linkage (protocol) | `docs:check` extensions parsing the roadmap table |
| CodeRabbit invocation rules (WSL path, repo root, `-c` context, output location, hourly limit) | One `bun run review` wrapper script collapsing six prose rules |
| Dependency denylist (provider migrations, unapproved AI SDKs, sonner) without a decision record | Unit test over `package.json` |
| Doc counters (test counts, version pins, spec-file table) vs reality | `docs:check` extension comparing docs to `--list`/`package.json` |
| `AlertDialogFooter` containing a raw `Button` (werkflow-design; 1 existing site) | Fix the site, then a registry selector |
| Silent `catch { console.error }` blocks (werkflow-design "no silent failures"; 17 sites) | Triage the 17, then a `CatchClause` selector |
| jsx-a11y beyond Next's subset; axe sweep (AGENTS.md accessibility) | Enable `jsx-a11y/recommended`; one `@axe-core/playwright` pass per role |

## Stale or contradictory prose found by the audit (fix in the owning docs)

- AGENTS.md Bun-First: the "no package-lock.json" bullet contradicts the later "package-lock.json is completely fine" note and the tracked file — reconcile before any lockfile check.
- testing.md rule 5 (Chromium installed) is workstation state, not a repository rule. (environments.md's hardcoded onboarding count was removed in Stage A.)
- architecture.md "Implementation Simplicity" near-duplicates AGENTS.md's simplicity bullets (one-home-per-fact violation).
- coderabbit.md's plan/rate-limit facts are self-flagged stale; verify before encoding the review wrapper's limit.
- Entity lists vs fixed-enum `Select` (werkflow-design): 24 candidate files need one human triage pass before any freeze.
