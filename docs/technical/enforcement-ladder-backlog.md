# Enforcement-Ladder Backlog

Status: living — last reviewed 2026-08-29

The open conversion candidates from the 2026-08-27 three-part audit (code comments, docs, skills) under [decision 0005](../decisions/0005-enforcement-ladder.md). Each row names the rule, where it lives as prose today, and the concrete mechanism that would enforce it. Remove a row when its conversion lands (and annotate the owning doc "enforced by …"); add rows as new lessons appear.

Stage A of that phase (2026-08-28) added its own protections directly rather than through this backlog: run-policy pins the canary suite to the cloud target and the preflight refuses any run whose `.env.local` routing does not match the requested target (Tier 1); retained-world cleanup refuses a backend mismatch (Tier 1); the untracked-file fingerprint uses NUL-separated git output (Tier 1); local-stack health probes carry named remedies and the canary pins the HIBP copy and migration-history parity (Tier 2). The owner review after Stage A extended the rerun budget to every certification suite — it was golden-only, which let eight same-class audit certification retries run ungated during the Stage A campaign (Tier 2, `scripts/run-playwright.ts`).

Stage B (2026-08-28) retired four Tier 1 rows and two Tier 2 rows by landing them, and added its own protections: the `RealtimeTable` type derives from the one `REALTIME_TABLES` list and the provider generates every binding from it, so a table cannot subscribe without its organization filter (Tier 1 by construction); `useLiveView`/`useRealtimeRouterRefresh` expose no debounce option, so the 150 ms floor cannot be undercut (Tier 1 by construction); `bun run realtime:check` — also part of the local preflight — diffs the list against the database publication and replica-identity state (Tier 2); ESLint bans async `startTransition` callbacks, `setInterval` (named wall-clock exceptions), and `useRealtimeEvent` imports outside the live-view family (Tier 2); replica identity `USING INDEX` makes the DELETE payload leak unwritable at the schema level (Tier 1).

Stage C (2026-08-29) retired the testing and Realtime-check rows that the hardening pass completed. Audit date ranges now go through `ownedBerlinDateAtOffset()` (Tier 1). Persisted precondition helpers fail fast with the exact recovery grep chain, and the full Wave 1 audit battery follows the current conventions (Tier 2). ESLint rejects raw page-root selectors, positional locators, fixed sleeps, per-test timeout overrides, skipped or focused tests, direct cleanup markers, and `visibleText(...).toHaveCount(0)` in specs. Unit convention tests check serial mode, negative-check presence, staged Golden tags, audit tags, date ownership, and precondition recovery text (Tier 2). The Realtime import ban covers alias and relative imports, and `realtime:check` verifies exact replica-index columns plus INSERT, UPDATE, and DELETE publication flags (Tier 2). The optimistic-mutation and cross-battery-lock candidates remain open because Stage C did not make either rule structural.

## Tier 1 candidates (make it unwritable)

| Rule (prose home) | Mechanism |
| --- | --- |
| Admin client only after `getUser()` validation (architecture.md; `lib/data/cached.ts` comment) | Branded `AuthenticatedActor` minted only by `getAuthenticatedUser()`; `createSupabaseAdminClient(actor)` requires it; or one `authorizedAction({role})` factory as the only admin-client export path |
| Organization scoping is hand-written per query (protocol invariant 2) | `orgScoped(client, orgId)` builder injecting the `organization_id` filter; lint-forbid bare `.from(` outside `lib/data/**` |
| Append-only event/revision/action tables must never be rewritten (protocol invariant 4) | Migration: `REVOKE UPDATE, DELETE` on every `*_events`/`*_revisions`/`*_actions` table |
| `RegisterOpenDialog` placement (open-dialog-context comment) | Stop exporting the hook; primitives render the registration themselves |
| Signed-download disposition can be forced inline for unsafe types (documents/actions comment) | Compute disposition inside `createSignedDownloadUrl` from the MIME type; drop the parameter |
| Client-supplied storage paths (documents/actions comment) | Branded `StoragePath` produced only by the path builders |
| File bytes through Server Actions (decision 0001; r2.ts comment) | Move `putStorageObject` out of app reach (scripts-only module); ban `@aws-sdk/client-s3` imports outside `lib/storage/` + `scripts/` |
| PENDING time entries filtered as if only `approved` counts (time-tracking comments, 3 sites) | `getEffectiveTimeEntries()` as the single filter; validation.ts calls it |
| Status colors semantic-only (AGENTS.md styling) | `statusVariant(status)` registry helper; ban raw `bg-green-*`/`bg-red-*`/`bg-yellow-*` |
| Hardcoded German UI strings buried in logic (AGENTS.md) | A `de` message catalog + lint on string literals in JSX text/aria positions |
| Harness mutation helpers can return the optimistic echo (testing rule 13) | Step helpers return the persisted row (db.ts read or reload) |
| "Never run two browser batteries concurrently" is operator discipline (testing.md; audit/canary config comments) | Runner acquires an exclusive lock on the shared `tests/golden/.artifacts` state before preflight and releases it after the child settles, so a concurrent second battery refuses instead of clobbering the world (CodeRabbit finding, Stage A 2026-08-28) |

## Tier 2 candidates (a check catches it)

| Rule (prose home) | Mechanism |
| --- | --- |
| Rule-12 ledger invariant (`X/X mapped; 0 partial; 0 unmapped`; set equality catalog↔ledger↔specs) | `bun run audit:check` parsing catalog IDs, ledger rows, and audit-spec tags |
| Catalog-wording change reopens the flow ID (testing rule 12) | Committed per-ID text hashes; `audit:check` fails on silent drift |
| Every certification run recorded in the gate log (testing.md) | Reporter appends the row itself, or `test:runs` asserts manifest↔log parity |
| Frozen-evidence rule: only docs may change after the green pair (testing rule 8) | `test:runs verify-evidence` comparing current fingerprint to the last passed certification |
| Complete slices have a Golden tag (protocol) | Check roadmap `complete` rows against `--list` output |
| Incident entries written by hand (testing rule 10) | `test:runs classify` appends the incident-log row itself |
| Mutations must invalidate their cache tags (realtime doc) | Static scan: `'use server'` mutation files must call `updateTag()` via a table→tag registry |
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
