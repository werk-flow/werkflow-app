# Testing And Golden-Gate Harness

Last reviewed: 2026-08-06

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

## Debugging Failed Runs

Playwright writes three artifacts per failure into `tests/golden/.results/<test>/`:

1. **`error-context.md` — read this first.** It contains the failing assertion plus a YAML accessibility snapshot of the page at failure time. Most fixes come straight from seeing what roles/names the page actually exposes (e.g. the employee picker is a `combobox`, its options are `button`s inside a `listbox`, dialogs sometimes close without a success flash).
2. `test-failed-1.png` — screenshot.
3. `trace.zip` — full replay (`bunx playwright show-trace <path>`), rarely needed.

Known interaction gotchas are documented as comments in `tests/golden/support/steps.ts` — read them before writing new steps. The recurring classes so far: duplicate desktop/mobile text nodes (use `visibleText`), Escape closing the whole dialog instead of an inner popover (dismiss by clicking elsewhere), success flashes that do or don't exist per dialog (assert resulting state, not flashes), upload dialogs whose "abgeschlossen" counter includes failed files (also assert the absence of error text), and a pre-hydration login race (the setup retries; the form itself is hardened with `method="post"`).

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

## Conventions

- One spec file per golden gate, tagged `@GG-XX`, tests in `serial` mode.
- New slices extend `steps.ts` with their business actions and add/extend the gate spec named by their roadmap row. Do not put raw selectors in specs.
- Use `visibleText()` for text assertions — pages render text twice (desktop table + hidden mobile card) and strict-mode locators fail otherwise.
- Absence assertions (`toHaveCount(0)`) prove role/organization boundaries; every gate should include at least one negative check.
- Success signals differ per dialog: some show a flash (`Kunde erfolgreich erstellt!`), some close immediately — assert the resulting row/state, not only flashes.
- Seeded identities use `@werkflow-golden.test` emails and org names prefixed `Golden Test SHK` / `Fremde Firma`; the invite scenario additionally uses Resend's bounce-safe test address pattern `delivered+gg-<runId>@resend.dev` so the real invite email sends without harming sender reputation. The leftover cleaner keys on exactly these markers. Never use these markers for real data.
- `tests/golden/support/db.ts` holds read-only service-role lookups for assertions the UI cannot prove (the invite code inside the email link, stock-ledger consistency). Specs still drive every user-visible action through the UI.

## Shared-Database Caution

Local dev, the deployed app, and this harness currently share **one** Supabase project and **one** R2 bucket. The harness isolates itself through disposable organizations and cleans up in teardown, but test users transiently exist in the real auth pool. Before test volume grows (around Wave 2), stand up a separate dev/staging Supabase project and pair it with the reserved `werkflow-documents-dev` bucket; the harness then targets that environment via `.env` switching. Track this as an infrastructure follow-up to [decision 0001](../decisions/0001-infrastructure-stack.md).

## Unit Tests

Pure-logic unit tests run with `bun run test:unit` (Bun's test runner over `lib/`). The first real candidates landed with `P1-04`: `lib/personnel/holidays.test.ts` asserts the official German holiday lists for the current and next year (a legal change fails CI so the in-code dataset is updated deliberately), and `lib/personnel/targets.test.ts` covers the target-resolution contract across part-time, date-effective schedule changes, holiday/closure zeroing, region history, and the labeled fallback cascade — including the historical cases the UI specs cannot pin to fixed dates. `P1-05` adds `lib/responsibilities/resolution.test.ts`: fixed-role fallback, direct configuration precedence, delegation start/end boundaries, expiry, early end, inherited role scope, deterministic defensive precedence for anomalous overlaps, and self-approval are pure date/authorization contracts and stay out of browser timing assertions. The suite currently passes 35/35.

## What Is Not Covered Yet

As of `P1-05` (2026-08-06), the full production suite is 50 tests: 13 `GG-00`, 8 `GG-01`, 6 `@P1-01`, 8 `@P1-03`, 9 `@P1-04`, and 6 `@P1-05`. `GG-00` covers the full roadmap baseline scenario — role flows, documents, time tracking, Realtime freshness, mobile viewport, invites/onboarding, and inventory take/return — while the slice specs preserve the accepted vertical outcomes; see the gate log for per-run notes.
