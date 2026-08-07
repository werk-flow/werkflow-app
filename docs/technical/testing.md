# Testing And Golden-Gate Harness

Last reviewed: 2026-08-07

WerkFlow's regression safety net is a Playwright end-to-end harness that runs the roadmap's golden-gate scenarios (`GG-XX` in [`docs/plans/phase-1-build-roadmap.md`](../plans/phase-1-build-roadmap.md)) as real multi-role browser journeys against a locally running app and the live Supabase project.

## Running

```bash
bun run test:golden          # all golden-gate specs
bun run test:golden:gg00     # only GG-00
bunx playwright test --grep @GG-03   # any single gate by tag
```

Requirements: `.env.local` with Supabase and R2 credentials, and an app server on `http://localhost:3000` (an existing server is reused; otherwise the config starts `bun run dev`). Results/report/trace live in `tests/golden/.results` and `.report` (gitignored). Record every gate run in [`docs/plans/golden-gate-log.md`](../plans/golden-gate-log.md).

Hard-earned operational rules (2026-08-04):

1. **Run gates against a production build**: `bun run build`, then `bun start`, then the gate. `next dev` compiles routes on demand mid-test and produces flaky timeouts; the dev server is for iterating on a slice, the production build is for the gate that counts.
2. **Port 3000 only.** Direct-to-R2 uploads are CORS-authorized for `http://localhost:3000`; a server on any other port makes browser uploads fail with misleading symptoms.
3. **Never run `bun run build` while a server is serving `.next`.** The rebuild deletes the running server's chunk files; pages then load without JavaScript (broken hydration, forms fall back to native submits). Stop the server, build, start again.
4. `KEEP_WORLD=1` skips teardown for manual debugging of a seeded world; the next run's leftover sweeper cleans it up.
5. Chromium is already installed (`bunx playwright install chromium` has been run on this machine); do not reinstall unless `playwright test` itself reports a missing browser.
6. `GOLDEN_BASE_URL` can point the run at another server, but direct-to-R2 uploads will fail on any origin the bucket CORS does not allow — stick to port 3000 unless the CORS policy was deliberately extended.
7. **The production server must outlive the entire suite.** Start `bun start` as a detached/background process with no tool time limit and health-check `http://localhost:3000` before starting Playwright. A foreground server under a tool timeout dies mid-suite and invalidates the whole run (`ERR_CONNECTION_REFUSED` on every remaining test — this happened in the P1-05 cycle).
8. **Freeze code before the final gate run.** Order per slice: implement → self-review and every intended quality/skill pass → review fixes → `bunx tsc --noEmit` + lint + `bun run test:unit` → production build → focused slice spec → full suite exactly once. Any later application-code change invalidates the build and full-suite evidence and forces a rerun; after the confirmation run passes, only documentation may change.
9. **After a harness-only fix, rerun the focused spec (`--grep @P1-XX`) before another full suite.** A full run costs 5–7 minutes; the focused spec answers the same question in a fraction of that. The full suite is for proving the shared-state chain, not for iterating on one selector.

## Debugging Failed Runs

Playwright writes three artifacts per failure into `tests/golden/.results/<test>/`:

1. **`error-context.md` — read this first.** It contains the failing assertion plus a YAML accessibility snapshot of the page at failure time. Most fixes come straight from seeing what roles/names the page actually exposes (e.g. the employee picker is a `combobox`, its options are `button`s inside a `listbox`, dialogs sometimes close without a success flash).
2. `test-failed-1.png` — screenshot.
3. `trace.zip` — full replay (`bunx playwright show-trace <path>`), rarely needed.

Known interaction gotchas are documented as comments in `tests/golden/support/steps.ts` — read them before writing new steps. The recurring classes so far: duplicate desktop/mobile text nodes (use `visibleText`), Escape closing the whole dialog instead of an inner popover (dismiss by clicking elsewhere), success flashes that do or don't exist per dialog (assert resulting state, not flashes), upload dialogs whose "abgeschlossen" counter includes failed files (also assert the absence of error text), and a pre-hydration login race (the setup retries; the form itself is hardened with `method="post"`).

Before rerunning anything, classify the failure: **product defect** (fix the app), **harness defect** (fix the step/locator, then focused spec first), **environment** (server died, browser missing, sandbox — fix the environment, the run proves nothing about code), or **known transient** (the documented Resend timeout and Realtime-freshness intermittents — rerun before debugging code you didn't change). Two failures of the same class in a row mean stop and investigate instead of trying variations.

A test that passes must mean the business outcome happened: pair every positive assertion with the state it produced (row exists, URL changed, count is zero for the other role) rather than trusting transient UI feedback.

## Architecture

| Piece | Purpose |
| --- | --- |
| `playwright.config.ts` | Serial execution (shared world state), German locale, Europe/Berlin, screenshots/traces on failure |
| `tests/golden/global-setup.ts` | Removes leftovers from crashed runs, seeds a fresh world, logs in all roles via the real `/login` UI, saves per-role sessions, generates a 6 MB upload fixture |
| `tests/golden/support/seed.ts` | Creates/destroys the disposable world with the service-role key: primary org (admin/Büro/employee), outsider org (isolation checks), active subscriptions, deterministic profile names. Teardown deletes R2 objects under both org prefixes, org rows (everything cascades), subscriptions, and auth users |
| `tests/golden/support/world.ts` | The world contract and artifact paths |
| `tests/golden/support/fixtures.ts` | `adminPage` / `bueroPage` / `employeePage` / `outsiderPage` fixtures bound to the saved sessions |
| `tests/golden/support/steps.ts` | **The reuse mechanism**: named business steps (`createCustomer`, `createJob`, `uploadDocumentOnJobPage`, …). Specs compose steps; when a slice changes UI, update the step once and every gate follows |
| `tests/golden/gg-00.spec.ts` | The baseline gate |
| `tests/golden/p1-05.spec.ts` | P1-05 scoped-responsibility, substitute, four-eyes, owner-safety, RLS, and organization-isolation slice proof (`@P1-05`) |
| `tests/golden/p1-06.spec.ts` | P1-06 vacation request/decision/balance/target/calendar/clock-block slice proof (`@P1-06`) |
| `tests/golden/p1-07.spec.ts` | The `GG-02` gate (`@GG-02`, P1-07 exit): schedules/target hours, overlapping leave, delegation-following attention, approve/reject/withdraw, notification deduplication, pattern audit, employee transparency, RLS/isolation |

## Conventions

- One spec file per golden gate, tagged `@GG-XX`, tests in `serial` mode.
- New slices extend `steps.ts` with their business actions and add/extend the gate spec named by their roadmap row. Do not put raw selectors in specs.
- Use `visibleText()` for text assertions — pages render text twice (desktop table + hidden mobile card) and strict-mode locators fail otherwise.
- Absence assertions (`toHaveCount(0)`) prove role/organization boundaries; every gate should include at least one negative check.
- Success signals differ per dialog: some show a flash (`Kunde erfolgreich erstellt!`), some close immediately — assert the resulting row/state, not only flashes.
- Seeded identities use `@werkflow-golden.test` emails and org names prefixed `Golden Test SHK` / `Fremde Firma`; the invite scenario additionally uses Resend's bounce-safe test address pattern `delivered+gg-<runId>@resend.dev` so the real invite email sends without harming sender reputation. The leftover cleaner keys on exactly these markers. Never use these markers for real data.
- `tests/golden/support/db.ts` holds read-only service-role lookups for assertions the UI cannot prove (the invite code inside the email link, stock-ledger consistency). Specs still drive every user-visible action through the UI.
- **Specs inherit state from every earlier spec** (serial, alphabetical, one shared world): members joined in `@P1-03`, schedules and the holiday calendar from `@P1-04`, and so on. A step that passes in a focused run can legitimately fail only in the full run because names appear in more places or extra action buttons exist — that is the full run doing its job. Scope locators semantically (the exact section/row, `exact: true` names), never by count or position. State `@P1-06` leaves behind: `leave_approval` ends in `selected` mode with the admin as sole holder (Büro and the invited Büro member lost it), the employee has an extra Vollzeit condition valid from the run day + 1 carrying 30 vacation days, the employee keeps one approved future half-day vacation and one rejected request, and Büro keeps one approved future single-day vacation.
- **`GG-02` placement and dual-mode design (P1-07):** the gate spec lives in `p1-07.spec.ts` so it sorts AFTER every slice spec — it inherits the full suite-end state instead of injecting business facts that six earlier specs would silently inherit (the rejected alternative was seeding dedicated fixtures and running the gate early). Because the validation ladder also runs it focused on a fresh world, the spec is deliberately dual-mode: its first test pins the responsibility state itself (`time_approval` → employee sole, `leave_approval` → admin sole — a recorded no-op re-selection in the full run), it creates and closes its own client request instead of relying on GG-01's leftover, and every count expectation (inherited notifications, unified badge numbers) is derived from the database at runtime rather than hardcoded per mode. State `@GG-02` leaves behind (nothing runs after it, but seeder/`KEEP_WORLD` debugging should know): two extra no-op responsibility configurations, one closed GG02 client request, new schedule versions valid from run-day+1 for the employee (Mo–Fr 6h) and Büro (Mo–Fr 8h), one approved Büro manual time entry from yesterday 10–11, and for the employee one extra withdrawn, one cancelled, and one rejected vacation request plus attention read markers/events.
- **Date expectations come from the app's own stored state and in-code rules**: `@P1-06` reads the person's schedules/conditions/holiday calendar through `getTargetContextForRecord` (`tests/golden/support/db.ts`) and computes consumed days and weekly Soll with the same `lib/vacation/balance` and `lib/personnel/targets` functions the product uses — hand-rolled date logic in specs drifts in holiday weeks.
- **Expect Realtime-driven re-renders mid-step.** Re-locate a row after any mutation that re-renders it (a saved locator can hold a detached node), and never re-open or re-select a control whose desired value is already set — a router refresh can detach a Radix option between open and click.
- **Stale-UI action proofs need a frozen page.** The app deliberately self-heals stale views (Realtime events plus a synthetic all-table refresh on `visibilitychange`), so a "click the stale card" test races the app's own freshness machinery and loses intermittently. `@P1-06` freezes the page first — `page.routeWebSocket` swallows the Realtime socket and an init script suppresses `visibilitychange` — which is also the honest simulation of the woken-up-laptop scenario the action-time enforcement exists for. This investigation surfaced a real defect: action-time authorization compared the app clock against database-stamped configuration timestamps, so a machine with a trailing clock briefly kept honoring a just-replaced configuration (fixed with a skew guard in `lib/responsibilities/server.ts`).

- **Manual time entries in specs must lie in the past.** The dialog rejects future times („Manuelle Einträge können nicht in der Zukunft liegen."), so a spec that runs in the morning fails with today's 09:00–10:00; use yesterday with times clear of other specs' yesterday entries (`@P1-05` uses 06–07 and 08–09, `@GG-02` uses 10–11).

## Shared-Database Caution

Local dev, the deployed app, and this harness currently share **one** Supabase project and **one** R2 bucket. The harness isolates itself through disposable organizations and cleans up in teardown, but test users transiently exist in the real auth pool. Before test volume grows (around Wave 2), stand up a separate dev/staging Supabase project and pair it with the reserved `werkflow-documents-dev` bucket; the harness then targets that environment via `.env` switching. Track this as an infrastructure follow-up to [decision 0001](../decisions/0001-infrastructure-stack.md).

## Unit Tests

Pure-logic unit tests run with `bun run test:unit` (Bun's test runner over `lib/`). The first real candidates landed with `P1-04`: `lib/personnel/holidays.test.ts` asserts the official German holiday lists for the current and next year (a legal change fails CI so the in-code dataset is updated deliberately), and `lib/personnel/targets.test.ts` covers the target-resolution contract across part-time, date-effective schedule changes, holiday/closure zeroing, region history, and the labeled fallback cascade — including the historical cases the UI specs cannot pin to fixed dates. `P1-05` adds `lib/responsibilities/resolution.test.ts`: fixed-role fallback, direct configuration precedence, delegation start/end boundaries, expiry, early end, inherited role scope, deterministic defensive precedence for anomalous overlaps, and self-approval are pure date/authorization contracts and stay out of browser timing assertions. `P1-06` adds `lib/vacation/balance.test.ts`: entitlement-per-year resolution (mid-year condition changes, missing values), vacation-day counting across weekends/holidays/closure days/schedule-free days/the labeled default source/half days/year-crossing ranges, the absence-extended daily-target contract, and balance arithmetic including snapshot stability under retroactive schedule changes. `P1-07` adds `lib/attention/resolution.test.ts`: item-identity keys, per-viewer deduplication across authorization paths, decision-notification facts (approve → cancel changes the version of the SAME item), read/unread versioning, the notification window boundary, and open-since day arithmetic — the deduplication and due-state rules the GG-02 UI assertions rest on. The suite currently passes 78/78.

## What Is Not Covered Yet

As of `P1-07` (2026-08-07), the full production suite is 63 tests: 13 `GG-00`, 8 `GG-01`, 6 `@P1-01`, 8 `@P1-03`, 9 `@P1-04`, 6 `@P1-05`, 6 `@P1-06`, and 7 `@GG-02`. `GG-00` covers the full roadmap baseline scenario — role flows, documents, time tracking, Realtime freshness, mobile viewport, invites/onboarding, and inventory take/return — while the slice specs preserve the accepted vertical outcomes and `@GG-02` is the P1-07 golden gate (rerun after `P1-08` and `P1-09`); see the gate log for per-run notes.
