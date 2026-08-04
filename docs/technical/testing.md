# Testing And Golden-Gate Harness

Last reviewed: 2026-08-04

WerkFlow's regression safety net is a Playwright end-to-end harness that runs the roadmap's golden-gate scenarios (`GG-XX` in [`docs/plans/phase-1-build-roadmap.md`](../plans/phase-1-build-roadmap.md)) as real multi-role browser journeys against a locally running app and the live Supabase project.

## Running

```bash
bun run test:golden          # all golden-gate specs
bun run test:golden:gg00     # only GG-00
bunx playwright test --grep @GG-03   # any single gate by tag
```

Requirements: `.env.local` with Supabase and R2 credentials, and an app server on `http://localhost:3000` (an existing `bun run dev`/`bun start` is reused; otherwise the config starts `bun run dev`). Results/report/trace live in `tests/golden/.results` and `.report` (gitignored). Record every gate run in [`docs/plans/golden-gate-log.md`](../plans/golden-gate-log.md).

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

## Conventions

- One spec file per golden gate, tagged `@GG-XX`, tests in `serial` mode.
- New slices extend `steps.ts` with their business actions and add/extend the gate spec named by their roadmap row. Do not put raw selectors in specs.
- Use `visibleText()` for text assertions — pages render text twice (desktop table + hidden mobile card) and strict-mode locators fail otherwise.
- Absence assertions (`toHaveCount(0)`) prove role/organization boundaries; every gate should include at least one negative check.
- Success signals differ per dialog: some show a flash (`Kunde erfolgreich erstellt!`), some close immediately — assert the resulting row/state, not only flashes.
- Seeded identities use `@werkflow-golden.test` emails and org names prefixed `Golden Test SHK` / `Fremde Firma`; the leftover cleaner keys on exactly these markers. Never use these markers for real data.

## Shared-Database Caution

Local dev, the deployed app, and this harness currently share **one** Supabase project and **one** R2 bucket. The harness isolates itself through disposable organizations and cleans up in teardown, but test users transiently exist in the real auth pool. Before test volume grows (around Wave 2), stand up a separate dev/staging Supabase project and pair it with the reserved `werkflow-documents-dev` bucket; the harness then targets that environment via `.env` switching. Track this as an infrastructure follow-up to [decision 0001](../decisions/0001-infrastructure-stack.md).

## What Is Not Covered Yet

Unit tests for pure logic (time math, pricing later) can use `bun test` when the first real candidates appear. Realtime freshness, invites/onboarding, time tracking, and inventory take/return are not yet automated in `GG-00` — see the gate log for per-run coverage notes.
