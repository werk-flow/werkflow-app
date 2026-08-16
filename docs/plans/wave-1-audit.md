# Wave 1 Flow Audit

Wave 1 (`P1-00` through `P1-12`) is accepted complete. This audit must exhaustively exercise the user-flow catalog ([`docs/product/user-flow-catalog.md`](../product/user-flow-catalog.md)) — every stable flow ID and every observable clause inside its bullet, far beyond what the golden gates pin — before Wave 2 begins. A1–A4 closed under an earlier row-oriented standard, so their results remain historical evidence but are **not yet catalog-completeness certified**; R1 must reconcile their 88 owned flow IDs before A5 starts. This document is the protocol, the session plan, and the **coverage ledger** (the authoritative record of what was tested, how, and what came of it).

## Why this exists

Each slice was accepted with focused specs, reviews, and cumulative golden-suite regression runs. The audit therefore mostly *confirms*. Its real yield is the uncovered-flow tail: small flows no spec ever pinned (checklists, folder management, break-policy settings, project parking, role-change guards, …), plus turning the flow catalog from asserted into verified — which is exactly what the eventual handover needs.

## Battery mechanics

- Audit specs live in `tests/audit/wave-1/`, named `a1-<topic>.spec.ts` … `a7-<topic>.spec.ts` so filename order equals session order, tagged `@AUDIT-W1-A<N>` per session. R1 repairs coverage in the original A1–A4 spec files/tags so the final battery retains its true execution order; it does not hide historical flows in an A5 or last-sorting reconciliation spec.
- Run with `bun run test:audit:w1` (config `playwright.audit.config.ts`; `--grep @AUDIT-W1-A1` for one session). The battery is **not** part of the default golden run and never will be — the golden suite stays lean for per-slice acceptance; the audit battery runs on demand at wave boundaries.
- The battery reuses the golden harness unchanged via relative imports: world seeder/teardown (`tests/golden/support/seed.ts`, one disposable world per battery invocation, serial `workers: 1`), `steps.ts`, `db.ts` (read-only), fixtures. New reusable business steps go into `tests/golden/support/steps.ts` as usual; audit-only helpers stay in the audit spec.
- **Never run the audit battery and the golden suite concurrently.** Both configs share `tests/golden/.artifacts` and each global setup destroys "leftover" worlds — a concurrent run destroys the other run's world.
- All golden-harness operational rules in `docs/technical/testing.md` apply unchanged (production build on port 3000 for acceptance runs, detached server, transient classification, two-same-failures rule, focused-spec-first for harness fixes).
- Prefer iterating audit runs against the **detached production server** too, not just for acceptance: the configs' `webServer: bun run dev` fallback compiles on demand and the sandboxed Google-Fonts fetch can wedge a fresh dev server mid-session (both bit A1). After any `bun run build`, stop the old listener and start a fresh server before testing — see the stale-server rule in `testing.md`.
- **Fixture-date ownership:** golden specs own the run-day offsets documented in `testing.md`. Audit sessions own run-day **+20 … +69** at 06:00 Berlin unless a flow needs another time, partitioned so sessions sharing one world never collide on uniqueness-constrained tables (`employment_conditions.valid_from`, vacation/sickness overlaps, closure days, planning dates):

| Session | Owned run-day offsets |
| --- | --- |
| A1 | +20 … +24 |
| A2 | +25 … +29 |
| A3 | +30 … +34 |
| A4 | +35 … +39 |
| A5 | +40 … +44 |
| A6 | +45 … +54 |
| A7 | +55 … +64 |
| R1 reconciliation reserve | +65 … +69 |

## Session protocol

Each ordinary audit session is one focused agent thread owning one ledger section below, start to finish. R1 begins as one owner-gated reconciliation thread; its Part 1 must count and classify the real A1–A4 gaps and may propose `R-A1` … `R-A4` implementation threads if the complete repair is not safely feasible in one context. A5 stays blocked until every resulting R thread is closed.

1. **Prove catalog completeness before triage.** Derive the exact set of stable catalog flow IDs owned by the session and compare it with the union in the ledger's `Catalog flow IDs` column. Then inspect the actual assertion bodies—not titles, helper names, implementation code, or prior status text—for every mapped ID. A mapping is `covered` only when all observable clauses of the catalog bullet are evidenced across the named bodies. Record partial mappings as `partial`, name their missing clauses, and plan supplemental/new coverage. Before execution the report must state total owned IDs, fully covered IDs, partial IDs, unmapped IDs, and owner-approved manual exceptions; it may not silently omit an ID.
2. **Write and run the session's audit spec** for every `new:` or `partial` claim: one spec file per ordinary session (R1 edits the original A1–A4 files), own date partition, business actions through the UI, read-only db helpers for state assertions, German test titles per repo convention. One Playwright test may cover many ledger rows/catalog IDs and one ID may span tests; test count never needs to equal flow count. Iterate focused (`--grep @AUDIT-W1-A<N>`) until green.
3. **Classify and fix failures immediately, in-session.** Every failure is exactly one of: **(a) product defect** — fix it now with the smallest correct change, no smuggled redesigns; **(b) test bug** — fix the test; **(c) catalog inaccuracy** — the app's actual behavior is acceptable and the flow description was wrong: correct `user-flow-catalog.md` and record `catalog_corrected`. If a failure exposes a real product *design question* rather than a bug, do not improvise: record it as a decision item in the session's ledger notes, continue with the other flows, and present all decision items to the product owner at the end of the session.
4. **Use manual evidence only by named exception.** Playwright is the default for every catalog flow. A manual check may replace it only when automation genuinely cannot observe the behavior and the product owner explicitly approves that catalog ID/clauses as an exception. Record the reason, steps, result, and ruling as `manual_ok`; convenience, display nuance, duplicate-path reasoning, or an old `manual_ok` status is not approval under this rule.
5. **Freeze statics and focused greens.** TypeScript/lint/unit clean; the session's focused audit spec green; if app code changed, the focused golden spec(s) of the affected slice(s) green too. Fix-and-rerun loops happen here, at focused-spec granularity — never by rerunning whole suites per fix.
6. **CodeRabbit review** (per `docs/technical/coderabbit.md`): required for any session whose diff contains app-code changes; sessions with test/doc-only diffs may batch their review with the next such session (record the deferral in the ledger). Disposition every finding, apply the fixes, then re-freeze step 5 (statics + focused specs green again).
7. **Final confirmation runs — always LAST, after all review fixes.** Fresh production build. Run the focused `@AUDIT-W1-A<N>` battery FIRST — it is the cheap run (~5 min), and an audit-side failure must never waste a 15-minute golden run. Then, if the session changed app code or anything under `tests/golden/` (specs or shared support), **one full golden suite run** (93 tests) green per `testing.md`'s numbered rules — once per session, not per fix. **Reopening is SCOPED:** a later change to app code or to `tests/golden/**` reopens step 5 and requires the full pair again; a change that touches ONLY files under `tests/audit/**` reopens step 5 but then requires only a fresh focused audit run against the unchanged build — the existing golden evidence stays valid, because golden runs cannot execute audit specs and audit specs are not part of the app build. Nothing may change after the last run of the required set (the P1-09 lesson). A1 experience: applying reopening unscoped cost several redundant full golden reruns; do not repeat that.
8. **Document and publish.** Update every ledger row for the session (catalog IDs + status + concise whole-bullet clause evidence), append a session entry to the log below, add the session's entry to **In-world left-behind state** below, update the catalog where corrected, and record the closure invariant: `X/X owned catalog IDs mapped; X/X fully evidenced; 0 partial; 0 unmapped`, plus any owner-approved manual exceptions. Commit on local `main`, publish with `git push origin main:partner-preview`. Never plain `git push`, never `origin main`.

Working coverage vocabulary: `covered` | `new` | `partial` | `manual-exception requested`. Final status vocabulary for ledger rows: `open` → `pass` | `defect_fixed` (name the fix) | `catalog_corrected` | `manual_ok` (named owner ruling required) | `deferred` (with reason and owner decision). `partial` and unmapped catalog IDs are forbidden at session closure.

## Final gate (session F)

After R1 and A5–A7: fresh production build, then — sequentially, never concurrently — the **full golden suite (93)** and the **entire `@AUDIT-W1` battery**, both green in one recorded pair of runs. The final gate must also recheck all 119 catalog IDs against the ledger union and confirm zero partial/unmapped IDs. Record in `docs/plans/golden-gate-log.md` as `AUDIT-W1` and close this document's status. Only then is Wave 1 "audited", and `P1-13` work should not run concurrently with audit sessions that may touch shared surfaces.

## Sessions

| Session | Scope (catalog sections) | Status |
| --- | --- | --- |
| A1 | Grundstock (Organisation/Rollen, Kunden-Basis, Aufträge/Projekte-Basis, Kalender-Basis, Zeiterfassung-Basis, Dokumente, Lager) + `P1-00`/`P1-00a` | `complete` (legacy closure; R1 certification pending) |
| A2 | Kunden-Cluster: `P1-01`, `P1-02`, `P1-10` | `complete` (legacy closure; R1 certification pending) |
| A3 | Personal-Cluster: `P1-03`, `P1-04`, `P1-05` | `complete` (legacy closure; R1 certification pending) |
| A4 | Abwesenheits-Cluster: `P1-06`, `P1-08` | `complete` (legacy closure; R1 certification pending) |
| R1 | Retroactive catalog-completeness reconciliation for A1–A4 (88 flow IDs); repair original ledgers/specs | `open` |
| A5 | Aufgaben & Qualifikationen: `P1-07`, `P1-09` | `blocked` (R1) |
| A6 | Planung: `P1-11` | `blocked` (A5) |
| A7 | Einsätze: `P1-12` | `blocked` (A6) |
| F | Final gate: full golden suite + full audit battery + 119/119 catalog-ID proof | `blocked` (R1, A5–A7) |

### Catalog-ID ownership

The catalog contains **119** stable flow IDs. These sets, not the number of ledger rows or Playwright tests, define session completeness:

| Session | Owned catalog flow IDs | Count |
| --- | --- | ---: |
| A1 | `BASE-ORG-F01…F06`, `BASE-CUSTOMER-F01…F04`, `BASE-WORK-F01…F08`, `BASE-CALENDAR-F01…F04`, `BASE-TIME-F01…F07`, `BASE-DOCUMENT-F01…F04`, `BASE-INVENTORY-F01…F06`, `P1-00-F01`, `P1-00A-F01…F02` | 42 |
| A2 | `P1-01-F01…F07`, `P1-02-F01…F06`, `P1-10-F01…F04` | 17 |
| A3 | `P1-03-F01…F06`, `P1-04-F01…F05`, `P1-05-F01…F05` | 16 |
| A4 | `P1-06-F01…F06`, `P1-08-F01…F07` | 13 |
| **R1** | union of A1–A4 | **88** |
| A5 | `P1-07-F01…F03`, `P1-09-F01…F06` | 9 |
| A6 | `P1-11-F01…F05` | 5 |
| A7 | `P1-12-F01…F17` | 17 |

### R1 reconciliation protocol

R1 is a retroactive certification, not an A5 feature session:

1. Its first thread performs the complete 88-ID set comparison and body-level clause audit for A1–A4, reports the exact fully covered/partial/unmapped/manual-only totals, estimates implementation weight, proposes whether one thread is safe or `R-A1` … `R-A4` should be split, asks the owner the exact confirmation question, and **stops before tests, code edits, or live writes**.
2. Implementation repairs the original A1–A4 ledger rows and spec files/tags. Add or split ledger rows where that makes clause evidence honest; do not create an A5 test or a last-sorting catch-all test. New uniqueness-constrained R1 fixtures use only +65 … +69 unless an existing original-session fixture can be safely extended.
3. Old `pass`, `manual_ok`, session-log prose, and green run counts are historical inputs—not proof under testing rule 12. R1 may retain them only after body inspection proves the complete mapped bullet. Any manual substitute needs a fresh, named owner ruling.
4. Every implementation thread keeps a cumulative R1 gap register in this document. R1 closes only after every split thread is closed and the invariant reads: `88/88 mapped; 88/88 fully evidenced; 0 partial; 0 unmapped`, with owner-approved manual exceptions listed explicitly. R1 closure changes A1–A4 to `complete (Rule 12 certified)`, changes R1 to `complete`, and unblocks A5 to `open`; no later session is unblocked early.
5. Final R1 validation always includes one production-build **combined A1–A4 audit run in file order and one shared world**, not just individually focused additions. This R1-specific rule overrides the ordinary session's focused-only reopening allowance in protocol step 7. Iterate with the affected focused tags first. If app code or `tests/golden/**` changed, also run the affected slice-specific Golden tags and then one complete 93-test Golden suite. Run audit and Golden sequentially, never concurrently. Any later app/Golden change invalidates the combined-audit/full-Golden pair; any later audit-only change invalidates the affected focused tag plus the combined A1–A4 run.
6. If app code changes, complete the authorized CodeRabbit review/fix cycle before final validation. Record the final audit count, build, focused/combined/Golden results, CodeRabbit disposition, world teardown, zero-leftover proof, commit, and preview publication in the R1 session log.

R1 threads maintain these two tables rather than relying on conversation memory:

| R1 completeness metric | Current value |
| --- | ---: |
| Owned A1–A4 catalog IDs | 88 |
| Fully evidenced after body inspection | pending R1 triage |
| Partial | pending R1 triage |
| Unmapped | pending R1 triage |
| Historical manual-only substitutions needing automation or a fresh owner exception | pending R1 triage |

| Catalog flow ID | Original ledger row(s) | Missing clause(s) / problem | Classification | Repair owner/status | Final evidence |
| --- | --- | --- | --- | --- | --- |
| _R1 populates one row per partial, unmapped, falsely covered, or unapproved-manual flow after inspecting all 88 IDs._ | | | | | |

## In-world left-behind state (final battery)

In the final gate, all audit specs share **one world in one run**, executing in filename order. Each completed session records here what its spec leaves behind in-world so later specs can tolerate it (post-run database cleanliness is a separate, always-required proof). Verify details against the spec itself when a specific fact is load-bearing.

- **A1** (`a1-grundstock.spec.ts`, runs first): A1-prefixed customers/jobs/projects in various states (edited, deleted/unlinked, parked — including a parked project with children — and completed), a checklist job, manual time entries on the run's previous Berlin business day plus approved/edited/reassigned corrections, the organization break policy possibly left on the **automatic** rule (A1-32 does not guarantee reverting it), documents including a trashed→restored file, a versioned business document, and a 1×1 PNG viewer fixture, an inventory item/location with movements (including a rejected negative booking) and CSV-imported category/supplier/location, and — alive until teardown — **two extra organizations** (the UI-signup organization and the seeded admin's second organization), which appear in the affected users' organization switchers for the remainder of the battery run.
- **A2** (`a2-kunden.spec.ts`, runs after A1): run-scoped A2 customers including an active restored contact and site plus distinct primary contact/site, one assigned field-service job with site access notes, two customer-number fixtures (only the first retains the unique number), one customer-changed project whose two child jobs remain linked while all old-customer site/contact references are null, a matched unknown-caller request whose captured caller facts remain, one reopened request, one exactly-once request-to-project conversion with reciprocal link, and a relationship customer with a completed follow-up reassigned to the seeded Büro manager. The temporary invited follow-up owner has no remaining organization membership; the linked personnel record remains as `Ausgeschieden` with an exit date. No A2-created organization exists beyond the seeded world.
- **A3** (`a3-personal.spec.ts`, runs after A2): one no-login record `Alina Personal-A3-<runId>` with run-scoped personnel number, complete master data, entry on run-day+30, exit on +34, and a planned Ausbildung condition from +31 corrected from 35 to 34 weekly hours; its append-only personnel/condition history remains. Holiday-region history records Berlin → Thüringen → explicit none, while the current region is none. Both responsibilities end in `role_default`; one leave-approval delegation from the seeded Admin to the seeded employee remains only as an ended historical row (today through +30, revoked today). No A3 closure day, active schedule, or active delegation remains. The separate A3-08 manual world was destroyed and contributes no combined-run state.
- **A4** (`a4-abwesenheit.spec.ts`, runs after A3): the seeded employee retains two future employment conditions on run-day+35 (27 vacation days, 40 weekly hours, run-scoped note) and +36 (31 vacation days, 40 weekly hours, run-scoped note). On the first vacation-consuming date among run-day+37 … +39, one vacation remains cancelled with its requested → approved → cancelled event history and approved-days snapshot. One same-date `sonstige` sickness report remains cancelled after full-day → half-day correction, with reported → corrected → cancelled history and run-scoped reasons. No active A4 vacation or sickness absence remains.

## Coverage ledger

Legend — `Catalog flow IDs` is the many-to-many traceability link to the authoritative catalog wording. For A1–A4 these allocations are provisional inputs to R1 even where the historical status says `pass`; R1 must inspect every clause and may split/remap rows. Coverage: `covered:@TAG` = an existing Golden body is claimed to assert the mapped flow; `new:<ID>` = an audit test supplies coverage; `partial` = at least one named catalog clause is still missing; `manual` = a historical hand check that does not satisfy testing rule 12 without a fresh owner-approved named exception. No session can close with a missing catalog ID, `partial`, or unapproved manual substitute.

### Session A1 — Grundstock + Wave 0

Organisation, Konten, Rollen:

| ID | Catalog flow IDs | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| A1-01 | `BASE-ORG-F01`, `BASE-ORG-F02` | Konto anlegen (Registrierung) und erste Organisation erstellen | new:A1-01 | `pass` | UI-Registrierung und Organisationserstellung; UI-erzeugte Organisation und Auth-Nutzer durch erweiterten World-Teardown entfernt. |
| A1-02 | `BASE-ORG-F02` | Organisation per Code beitreten | new:A1-02 (also produces the dual-membership user for A1-03/A1-28) | `catalog_corrected` | Beitritt als Handwerker und zweite Mitgliedschaft verifiziert; Katalog um Admin-/Inhabergrenzen präzisiert. |
| A1-03 | `BASE-ORG-F04` | Aktive Organisation wechseln; Daten strikt getrennt | new:A1-03 | `pass` | Umschalten und beidseitige Datenisolation in `A1-02/A1-03`. |
| A1-04 | `BASE-ORG-F03`, `BASE-ORG-F05` | Einladung per E-Mail (Büro), Einlösung, rollengerechte Oberflächen | covered:@GG-00 („Einladung: Eingeladene Person tritt bei…") + new:A1-04 (role surfaces) | `pass` | Invite-Body in `@GG-00` re-verifiziert; Handwerker-Navigation in `A1-04/A1-06`. |
| A1-05 | `BASE-ORG-F05` | Mitgliederliste mit Live-Stempelstatus („arbeitet") | new:A1-05 (piggyback on A1-26 clock-in) | `pass` | Live-Status „Arbeitet" in `A1-05/A1-26/A1-27/A1-28`. |
| A1-06 | `BASE-ORG-F06` | Rollenänderungs-Schutz: eigene Rolle nicht änderbar, kein zweiter Admin, Büro verwaltet nur Handwerker | new:A1-06 | `catalog_corrected` | Schutzregeln verifiziert; Katalog präzisiert, dass Büro zwar Büro einladen, bestehende Büro/Admin aber nicht verwalten kann. |
| A1-07 | `BASE-ORG-F01`, `BASE-TIME-F03` | Abmelden (+ Auto-Ausstempeln beim Abmelden) | covered:@GG-00 (Abmelden); Auto-Ausstempeln new:A1-07 | `deferred` | Abmelden und Auto-Ausstempeln grün; Entfernung eines Mitglieds löscht dessen Zeithistorie. **Owner ruling 2026-08-15: deferred to `P1-33`** (offboarding owns retained historical identity); the defect is recorded in the `P1-33` roadmap row so it cannot get lost. |

Kunden-Basis:

| ID | Catalog flow IDs | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| A1-08 | `BASE-CUSTOMER-F01`, `P1-00-F01` | Kunde anlegen; Liste live | covered:@GG-00 (anlegen + Realtime) | `pass` | `@GG-00`-Body re-verifiziert; finale Golden-Suite. |
| A1-09 | `BASE-CUSTOMER-F01`, `BASE-CUSTOMER-F02` | Kunde inline auf Detailseite bearbeiten | new:A1-09 | `pass` | `A1-09/A1-11`. |
| A1-10 | `BASE-CUSTOMER-F01`, `BASE-CUSTOMER-F04` | Kunde löschen — Aufträge/Projekte bleiben, verlieren nur die Zuordnung | new:A1-10 | `defect_fixed` | Realtime-Selbst-Rennen beim Löschen behoben; Auftrag/Projekt bleiben ohne Kunde erhalten (`A1-10/A1-14`). |
| A1-11 | `BASE-CUSTOMER-F02`, `BASE-CUSTOMER-F03` | Kunde direkt im Auftrags-/Projektdialog neu anlegen | new:A1-11 | `pass` | `A1-09/A1-11`. |

Aufträge & Projekte-Basis:

| ID | Catalog flow IDs | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| A1-12 | `BASE-WORK-F01`, `BASE-WORK-F05` | Auftrag anlegen/zuweisen; Handwerker sieht nur Zugewiesenes | covered:@GG-00 + new:A1-12 (role visibility) | `defect_fixed` | Bearbeitungsdialog gegen Realtime-Resets stabilisiert; Zuweisungsgrenze in `A1-12/A1-13`. |
| A1-13 | `BASE-WORK-F01`, `BASE-WORK-F05` | Auftrag bearbeiten; Zuweisung entfernen; Auftrag löschen | new:A1-13 | `defect_fixed` | Edit/Delete-Selbst-Rennen behoben; `A1-12/A1-13`. |
| A1-14 | `BASE-WORK-F01`, `BASE-WORK-F02` | Projekt anlegen; Auftrag im Projekt erbt Kunden; Projekt ohne Aufträge; Projekt löschen löst nur die Zuordnung | new:A1-14 | `defect_fixed` | Asynchroner Nummernvorschlag überschreibt keine Eingabe mehr; Projektlöschung in `A1-10/A1-14`. |
| A1-15 | `BASE-WORK-F03` | Datum entziehen parkt den Auftrag; Einplanen entparkt (semantisch, ohne Drag & Drop) | new:A1-15 | `pass` | `A1-15/A1-16`. |
| A1-16 | `BASE-WORK-F04` | Projekt parken parkt unfertige Kinder; fertige bleiben fertig | new:A1-16 | `defect_fixed` | Projekt-Statusoverride nutzt jetzt die kaskadierende Park-Aktion; `A1-15/A1-16`. |
| A1-17 | `BASE-WORK-F06` | Checkliste: Manager pflegt Punkte; Handwerker hakt ab / öffnet wieder; Attribution sichtbar | new:A1-17 | `pass` | `A1-17/A1-18`. |
| A1-18 | `BASE-WORK-F07` | Fertigstellen setzt Abschlussdatum; Projektstatus/-fortschritt abgeleitet; manueller Override | new:A1-18 | `defect_fixed` | Abschlussdatum wird als Geschäftstag Europe/Berlin bestimmt; `A1-17/A1-18`. |
| A1-19 | `BASE-WORK-F08` | `/auftraege`: Suche, Status-/Typ-Filter, Parkplatz-/Archiv-Trennung | new:A1-19 | `pass` | `A1-19`. |
| A1-20 | `BASE-WORK-F08` | `/auftraege`: nutzerspezifische Spaltenauswahl, Sortierung | manual (display preference, low risk) | `manual_ok` | Kundenspalte nutzerspezifisch ausgeblendet und Nummernsortierung manuell geprüft. |

Kalender-Basis:

| ID | Catalog flow IDs | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| A1-21 | `BASE-CALENDAR-F01`, `BASE-CALENDAR-F03` | Tages-/Wochen-/Monatsansicht; geplante Arbeit vs. Zeitblöcke getrennt | new:A1-21 + covered:@GG-00/@P1-11 | `pass` | Alle drei Ansichten und Blocktrennung in `A1-21/A1-24`. |
| A1-22 | `BASE-CALENDAR-F02` | Verschieben per Drag & Drop (inkl. Warnpfad) | new:A1-22 + covered:@P1-09 | `pass` | Drag und bestätigter Warnpfad in `A1-22`. |
| A1-23 | `BASE-CALENDAR-F02` | Größe ziehen (Resize) und Drag in den/aus dem Parkplatz | manual (physical drag gestures) | `manual_ok` | Echte Gesten: Breite 305,22→381,53 px; aus Parkplatz geplant und wieder geparkt. |
| A1-24 | `BASE-CALENDAR-F04` | Kalender-Filter (Mitarbeiter/Arbeitszeiten/Aufträge) | new:A1-24 | `pass` | `A1-21/A1-24`. |
| A1-25 | `BASE-CALENDAR-F03` | Manueller Zeiteintrag aus dem Kalender heraus | manual (duplicate entry path; dashboard path covered by @P1-05) | `manual_ok` | Kalenderdialog legte 09:00–17:00 an; Erfolgsmeldung, Verlauf und DB-Fakten geprüft. |

Zeiterfassung-Basis:

| ID | Catalog flow IDs | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| A1-26 | `BASE-TIME-F01`, `BASE-TIME-F02`, `BASE-TIME-F04` | Ein-/Ausstempeln, Pausen, Tagessummen; auftragsbezogene Zeit | covered:@GG-00 + new:A1-26 | `pass` | Pause, Auftragbezug, Zustände und Summen in `A1-05/A1-26/A1-27/A1-28`. |
| A1-27 | `BASE-TIME-F02` | Auftragswechsel während laufender Sitzung | new:A1-27 | `pass` | `A1-05/A1-26/A1-27/A1-28`. |
| A1-28 | `BASE-TIME-F03` | Kein gleichzeitiges Einstempeln in zwei Organisationen | new:A1-28 (uses A1-02's dual membership) | `pass` | Org-Sperre mit derselben Person in zwei Organisationen. |
| A1-29 | `BASE-TIME-F05` | Manuelle Einträge: Reihenfolge-/Überlappungs-Ablehnung | new:A1-29 | `pass` | `A1-29`. |
| A1-30 | `BASE-TIME-F06` | Bestehende Einträge korrigieren / löschen / umhängen (Manager) | new:A1-30 | `pass` | Korrigieren, Auftrag umhängen und löschen in `A1-30`. |
| A1-31 | `BASE-TIME-F06` | Verlauf-Filter (Zeitraum/Mitarbeiter/Status) | manual (display filter) | `manual_ok` | Mitarbeiter-/Statusfilter und Leerergebnis manuell geprüft. |
| A1-32 | `BASE-TIME-F07` | Pausenregel: Admin stellt automatische Pause ein, Büro liest nur; Historie schreibt Vergangenes nicht um | new:A1-32 | `defect_fixed` | Prop-Refresh setzte ungespeicherte Auswahl zurück; primitive Reset-Abhängigkeiten stabilisieren das Formular. |

Dokumente:

| ID | Catalog flow IDs | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| A1-33 | `BASE-DOCUMENT-F02`, `BASE-DOCUMENT-F04`, `P1-00-F01`, `P1-00A-F01` | Upload >4,5 MB am Auftrag; Bibliothek zeigt es; Handwerker-Upload/-Ansicht; Zugriffsgrenzen | covered:@GG-00 | `pass` | `@GG-00`-Body re-verifiziert; finale Golden-Suite. |
| A1-34 | `BASE-DOCUMENT-F01`, `BASE-DOCUMENT-F02` | Ordner anlegen, Datei verschieben/kopieren über den Ziel-Dialog | new:A1-34 | `pass` | `A1-34/A1-35`. |
| A1-35 | `BASE-DOCUMENT-F01`, `BASE-DOCUMENT-F02` | Bestehendes Bibliotheksdokument mit Ziel (Auftrag/Kunde) verknüpfen; Verknüpfungsfilter | new:A1-35 | `pass` | `A1-34/A1-35`. |
| A1-36 | `BASE-DOCUMENT-F03` | Papierkorb: löschen, wiederherstellen, endgültig löschen; Audit-Historie | new:A1-36 | `pass` | `A1-36/A1-37`. |
| A1-37 | `BASE-DOCUMENT-F03` | Neue Version eines Geschäftsdokuments hochladen; Versionshistorie | new:A1-37 | `defect_fixed` | Versionsupload aktualisiert Version und Audit-Historie sofort im lokalen UI-Zustand; `A1-36/A1-37`. |
| A1-38 | `BASE-DOCUMENT-F03`, `BASE-DOCUMENT-F04`, `P1-00A-F02` | Viewer (PDF/Bild) öffnen; Download über signierten Link | manual (visual overlay + signed download) | `manual_ok` | Bild im Overlay gerendert; signierter „Neuer Tab"-Link und Download-Schaltfläche geprüft. |

Lager:

| ID | Catalog flow IDs | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| A1-39 | `BASE-INVENTORY-F06` | Handwerker: geplantes Material entnehmen, ungeplant entnehmen, zurückgeben; Bestandskonsistenz; Zugriffsgrenzen | covered:@GG-00 + new:A1-39 | `pass` | Geplant/ungeplant/Retouren und Bestandsfakten in `A1-39/A1-42`; Rollen-Body in `@GG-00`. |
| A1-40 | `BASE-INVENTORY-F02` | Artikel + Lagerort über die UI anlegen/bearbeiten (statt Seeder) | new:A1-40 | `pass` | `A1-40/A1-44`. |
| A1-41 | `BASE-INVENTORY-F03` | Manuelle Zu-/Abgänge; Buchung unter null wird abgelehnt; Bewegungsliste mit Vorher/Nachher/Grund | new:A1-41 | `defect_fixed` | Bewegungsliste um sichtbare Vorher- und Grund-Spalten ergänzt; `A1-41`. |
| A1-42 | `BASE-INVENTORY-F05` | Manager plant Material am Auftrag (ohne Bestandsänderung); Projekt zeigt direktes/vererbtes Material + Summe | new:A1-42 | `pass` | `A1-39/A1-42`. |
| A1-43 | `BASE-INVENTORY-F04` | CSV-Import mit Spaltenzuordnung (legt Kategorien/Lieferanten/Orte an; Anfangsmengen als Bewegungen) | new:A1-43 | `pass` | Mapping-UI stabil automatisiert; Stammdaten und Anfangsbewegung per DB-Leseassertion. |
| A1-44 | `BASE-INVENTORY-F01`, `P1-00-F01` | `/inventar`-Ansichten (Alle Artikel / Lager / Geplant / Bewegungen) mit Suche/Filtern | new:A1-44 (folded into A1-40/41 assertions) | `pass` | Vier Ansichten, Suche und Filter in `A1-40/A1-44` und `A1-41`. |

### Session A2 — Kunden-Cluster (`P1-01`, `P1-02`, `P1-10`)

| ID | Catalog flow IDs | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| A2-01 | `P1-01-F01`, `P1-01-F02` | Ansprechpartner anlegen/primär/archivieren; Einsatzorte pflegen | covered:@P1-01 + new:A2-01 (Primär-/Archiv-Ergänzung) | `pass` | `@P1-01`-Body deckt Anlage/Sichtbarkeit; `A2-01/A2-02/A2-03` beweist zusätzlich Primärwechsel und beide Archivlisten. |
| A2-02 | `P1-01-F01`, `P1-01-F02` | Archivierten Kontakt wiederherstellen; archivierte fehlen in Pickern | new:A2-02 | `pass` | Kontakt und Einsatzort archiviert, aus Auftrags-Pickern ausgeschlossen und über die sichtbare Archivliste wiederhergestellt. |
| A2-03 | `P1-01-F02` | Ein-Klick: Kundenadresse als ersten Einsatzort übernehmen | new:A2-03 | `pass` | „Adresse als Einsatzort übernehmen“ legt `Hauptstandort` mit der vollständigen Kundenadresse an. |
| A2-04 | `P1-01-F03` | Kundennummer: manuelle Vergabe, Org-Eindeutigkeit wird abgelehnt | new:A2-04 | `defect_fixed` | Eindeutigkeit dauerhaft per DB-Leseassertion; gemeinsamer Metadaten-Editor zeigt kuratierte deutsche Speicherfehler jetzt sichtbar statt nur in der Konsole. |
| A2-05 | `P1-01-F04` | Ort-Snapshot: Adressänderung am Einsatzort ändert alte Aufträge nicht | covered:@P1-01 | `pass` | `@P1-01`-Body re-verifiziert; finale Golden-Suite 93/93. |
| A2-06 | `P1-01-F04`, `P1-01-F05` | Projekt-Standardort/-kontakt befüllt neue Projektaufträge vor; Auftrag kann abweichen; Kundenwechsel löscht Referenzen (inkl. Kinder) | new:A2-06 | `defect_fixed` | Projektvorgaben werden UI- und serverseitig vererbt, explizite Abweichung bleibt möglich; Kundenwechsel behält beide Kinder und leert alte Orts-/Kontaktverweise. Dialog-Reset, fehlgeschlagene Defaults und veraltete Detailantworten sind abgesichert. |
| A2-07 | `P1-01-F06` | Handwerker sieht Ort/Zugangshinweise/Kontakt mit Anruf-Link | covered:@P1-01 + new:A2-07 (Zugangshinweis-Ergänzung) | `pass` | `@P1-01`-Body deckt Ort/Kontakt/Telefon; `A2-07` ergänzt Adresse, Zugangshinweis und `tel:`-Link in der Handwerkeransicht. |
| A2-08 | `P1-01-F07` | Suche über Kontakte/Einsatzorte | covered:@P1-01 | `pass` | `@P1-01`-Body re-verifiziert; finale Golden-Suite 93/93. |
| A2-09 | `P1-02-F01`, `P1-02-F02`, `P1-02-F03` | Anfrage im Anruf erfassen (inkl. Anhang); unbekannte Anruferin zuordnen/anlegen | covered:@GG-01 + new:A2-09 (bestehendem Kunden zuordnen) | `defect_fixed` | `@GG-01` deckt Erfassung/Anhang/Neuanlage; `A2-09` ordnet einem bestehenden Kunden zu. Erfasster Name und Telefon bleiben nach Zuordnung sichtbar und in der Anfrage gespeichert. |
| A2-10 | `P1-02-F01` | Vorgeschlagene Anfragenummer manuell überschreiben (Regressionsflow des P1-02-Defekts) | new:A2-10 | `pass` | Nur die Nummernvorschlags-Server-Action wird verzögert; der vorher eingegebene run-scoped Wert überlebt die späte Antwort und wird gespeichert. |
| A2-11 | `P1-02-F04`, `P1-02-F06` | Lifecycle: „In Klärung" setzen; geschlossene Anfrage wieder öffnen | new:A2-11 | `pass` | `offen → in_klaerung → geschlossen → offen` jeweils nach Persistenz geprüft. |
| A2-12 | `P1-02-F04`, `P1-02-F05` | Umwandlung genau einmal in **Auftrag**; Schließen mit Grund; Direktauftrag ohne Anfrage | covered:@GG-01 | `pass` | Vollständige `@GG-01`-Bodies re-verifiziert; finale Golden-Suite 93/93. |
| A2-13 | `P1-02-F05` | Umwandlung in **Projekt** (inkl. Rückverlinkung) | new:A2-13 | `pass` | Einmalige UI-Umwandlung, Anfrage→Projekt und Projekt→Quellanfrage sichtbar und per DB-Leseassertion belegt; zweite Umwandlung nicht angeboten. |
| A2-14 | `P1-02-F06` | Zugriffsgrenzen `/anfragen` (Handwerker, Fremdorganisation) | covered:@GG-01 | `pass` | Rollen- und Fremdorganisations-Bodies re-verifiziert; finale Golden-Suite 93/93. |
| A2-15 | `P1-10-F01` | Kundendetail-Chronik: Reihenfolge, Filter, Deep-Links ohne Kopien | covered:@P1-10 | `pass` | `@P1-10` re-verifiziert; `A2-15/A2-17` ergänzt gültige absteigende `datetime`-Reihenfolge unter weiterem Follow-up-Verlauf. |
| A2-16 | `P1-10-F02` | Follow-up anlegen/erledigen; überfällig als Aufgabe | covered:@P1-10 | `pass` | `@P1-10`-Body re-verifiziert; finale Golden-Suite 93/93. |
| A2-17 | `P1-10-F02` | Follow-up ohne gültigen Verantwortlichen erscheint allen Managern zur Neuzuweisung | new:A2-17 | `pass` | Temporär eingeladener Owner per UI entfernt; Admin und Büro sehen „Neu zuweisen“, Büro übernimmt/erledigt. Danach keine Mitgliedschaft mehr; die verknüpfte Personalakte bleibt nachvollziehbar als `Ausgeschieden` mit Austrittsdatum erhalten. |
| A2-18 | `P1-10-F03`, `P1-10-F04` | Kommunikationspräferenzen: Zweck×Kanal, Warnung, begründete Ausnahme | covered:@P1-10 | `pass` | Zweck-/Kanaltrennung, Warnung und begründete Ausnahme im vollständigen `@P1-10`-Body re-verifiziert; finale Golden-Suite 93/93. |
| A2-19 | `P1-10-F03` | Allgemeine Präferenzen (Kontaktzeiten, Sprache, Kontaktsperre) pflegen und sehen | manual (data entry + display; warning logic covered by A2-18) | `manual_ok` | Laufende App geprüft: bevorzugter Kontakt, Telefon, Werktags 08:00–10:00, Sprache, Barrierefreiheit, Kontaktsperre und zweckspezifisches „Nicht erlaubt“ sichtbar; unkonfiguriert zeigt ausdrücklich „Noch nicht konfiguriert“/„Unbekannt“. Diagnosewelt anschließend zerstört. |

**A2 closure note / final-gate item:** Zwei zusätzliche vollständige 29-Test-Batterieversuche ließen alle acht A2-Tests nach A1 in derselben Welt grün laufen, waren insgesamt aber nicht grün: zuerst A1-30 mit dokumentierter Laufzeitüberschreitung (fokussiert danach 18,7 s grün), danach reproduzierbar A1-10 beim Kundenlöschen. Read-only Live-Prüfung der gehaltenen Diagnosewelt bewies, dass der Kunde bereits gelöscht und die Projekt-/Auftragsreferenzen bereits auf `null` gesetzt waren, während die UI-Server-Action auf „Wird gelöscht…“ blieb. Das ist ein A1-Post-Delete-Antwort-/Cache-Invalidierungsdefekt außerhalb des A2-Eigentums und muss vor Session F geklärt werden; A2-App-/Testcode wurde dafür nicht erweitert.

### Session A3 — Personal-Cluster (`P1-03`, `P1-04`, `P1-05`)

| ID | Catalog flow IDs | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| A3-01 | `P1-03-F01`, `P1-03-F02`, `P1-03-F06` | Personalien pflegen; Konditionen-Versionen (Aktuell/Früher/Geplant); Verlauf | covered:@P1-03 + new:A3-01 supplement | `defect_fixed` | `@P1-03` deckt Stammdaten sowie Aktuell/Früher ab; `A3-01/A3-03` ergänzt alle Personalien, eine geplante Kondition und sichtbare Vorher/Nachher-Werte. Der Verlauf zeigte zuvor trotz gespeicherter Payload nur Ereignis/Zeit/Person; bekannte Geschäftsänderungen werden jetzt deutsch und lesbar angezeigt. Die Abschlussprüfung ergänzte außerdem die zuvor unvollständigen Anlage-Payloads: `created` enthält alle im Anlagedialog erfassten Werte und `condition_added` die Konditionsnotiz; Personalnummer, Vorname, Aktennotiz und Konditionsnotiz sind sichtbar als neue Werte bewiesen. |
| A3-02 | `P1-03-F03`, `P1-03-F04`, `P1-03-F05` | Personalakte ohne Zugang; „Zugang einladen" verknüpft; Entfernen ⇒ „Ausgeschieden" | covered:@P1-03 | `pass` | Vollständiger `@P1-03`-Body re-verifiziert; finale Golden-Suite 93/93. |
| A3-03 | `P1-03-F01` | Personalnummer: `MA-NNN`-Vorschlag überschreiben; Eindeutigkeit abgelehnt | new:A3-03 | `pass` | Die Nummernvorschlags-Server-Action wird gehalten; der manuelle run-scoped Wert überlebt nachweislich die späte Antwort. Ein zweiter UI-Anlageversuch mit derselben Nummer wird abgelehnt. |
| A3-04 | `P1-04-F01`, `P1-04-F03` | Wochenplan-Versionen; Ziel aus Plan; Vertragsabweichungs-Hinweis; historische Tage stabil | covered:@P1-04 | `pass` | Vollständiger `@P1-04`-Body re-verifiziert; finale Golden-Suite 93/93. |
| A3-05 | `P1-04-F02`, `P1-04-F03`, `P1-04-F04`, `P1-04-F05` | Feiertagskalender wählen; Betriebsruhe setzt Ziel 0; unkonfiguriert = sichtbare Ausnahme | covered:@P1-04 | `pass` | Vollständiger `@P1-04`-Body re-verifiziert; finale Golden-Suite 93/93. |
| A3-06 | `P1-04-F02` | Betriebsruhe-Tag wieder entfernen (nur heute/zukünftig) | covered:@P1-04 + new:A3-06 boundary supplement | `pass` | `@P1-04` deckt Anlegen/Entfernen heute ab; `A3-06/A3-07` ergänzt UI-Anlage/Entfernung auf +32 mit read-only Persistenzbeweis und die verständliche Ablehnung eines vergangenen Tages. |
| A3-07 | `P1-04-F02`, `P1-04-F05` | Feiertagsregion ändern: wirkt ab Auswahl, Vergangenes bleibt | new:A3-07 | `pass` | UI-Wechsel Berlin→Thüringen, append-only Verlauf per read-only Kontext, Tag vor erster Auswahl ohne Region und der nächste `Weltkindertag` am 20.09. im Monatskalender; das Jahr wird aus dem realen Berliner Lauftag abgeleitet. Finale Auswahl per UI auf „Kein Feiertagskalender“ zurückgesetzt. Resolver-Grenzen zusätzlich in 187/187 Unit-Tests. |
| A3-08 | `P1-04-F03`, `P1-04-F04` | Mitgliederlisten-Fortschrittsbalken mit Unkonfiguriert-Marker | manual (display nuance) | `manual_ok` | In Welt `msuposh9` visuell/zugänglich geprüft: konfigurierte Person mit normalem 0%-Balken ohne Marker; explizites Nullziel als „Betriebsruhe“; unkonfiguriertes Büro mit gelbem Marker, `aria-label` und Tooltip „Kein Arbeitszeitmodell hinterlegt – Standardziel 8 Stunden“. Testplan/Betriebsruhe per UI entfernt, read-only leer, Welt zerstört. |
| A3-09 | `P1-05-F01`, `P1-05-F02`, `P1-05-F03`, `P1-05-F05` | Verantwortlichkeiten: Vorschau, benannte Holder, Vier-Augen, Fenster-Ende am Aktionspunkt, Schutz des letzten Holders | covered:@P1-05 | `pass` | Vollständiger `@P1-05`-Body re-verifiziert; finale Golden-Suite 93/93. |
| A3-10 | `P1-05-F03` | Vertretung vorzeitig beenden (Entzug wirkt sofort am Aktionspunkt) | covered:@P1-05 | `pass` | Coverage korrigiert: `@P1-05` beendet die Vertretung bereits vorzeitig über die UI und beweist die Ablehnung aus der veralteten Ansicht am Aktionspunkt. |
| A3-11 | `P1-05-F04` | „Meine Verantwortlichkeiten und Vertretungen" in den eigenen Einstellungen | covered:@P1-05 + new:A3-11 supplement | `defect_fixed` | `@P1-05` deckt die betroffene Handwerkeransicht ab; `A3-11` ergänzt aktive Vertretungsdetails, die Eigenübersicht für betroffene Admin/Büro und die Zusammenfassung im Mitglied-Detail. Manager erhielten zuvor nur die Organisationskonfiguration; die kompakte Eigenübersicht steht jetzt darüber. |

### Session A4 — Abwesenheits-Cluster (`P1-06`, `P1-08`)

| ID | Catalog flow IDs | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| A4-01 | `P1-06-F01`, `P1-06-F03` | Urlaub beantragen/zurückziehen; Wochenende zählt nicht; Überschneidung blockiert | covered:@P1-06 | `pass` | Vollständiger `@P1-06`-Body re-verifiziert: Antrag, Rücknahme, Berlin-Arbeitstagszählung und Überschneidungsblockade werden ausgeführt. |
| A4-02 | `P1-06-F02`, `P1-06-F04`, `P1-06-F05`, `P1-06-F06` | Genehmigung: Saldo, Soll 0, Einstempel-Sperre; Stornierung stellt wieder her | covered:@P1-06 | `pass` | Vollständiger `@P1-06`-Body re-verifiziert: Genehmigung, Saldo/Soll, Einstempel-Sperre sowie begründete Stornierung und Wiederherstellung werden ausgeführt. |
| A4-03 | `P1-06-F01`, `P1-06-F02`, `P1-06-F03` | Halber Tag = 0,5; ohne Anspruch sichtbare Ausnahme; Vier-Augen | covered:@P1-06 | `pass` | Vollständiger `@P1-06`-Body re-verifiziert: halber Tag, fehlender Anspruch und Vier-Augen-Grenze werden ausdrücklich behauptet. |
| A4-04 | `P1-06-F02` | Anspruch aus der neuesten Kondition des Jahres (Mitte-Jahr-Änderung) | new:A4-04 (e2e over the arithmetic already unit-tested) | `pass` | Zwei Konditionen per UI auf +35/+36 angelegt; read-only DB-Kontext und Handwerkeransicht belegen den Wechsel von 27 auf den neuesten Anspruch von 31 Tagen. |
| A4-05 | `P1-06-F05` | Kalender: „Urlaub – Name", „(angefragt)" gestrichelt | covered:@P1-06/@GG-02 | `pass` | Vollständige `@P1-06`-/`@GG-02`-Bodies re-verifiziert: neutraler genehmigter Titel und gestrichelter Antragszustand werden behauptet. |
| A4-06 | `P1-08-F01`, `P1-08-F02`, `P1-08-F03`, `P1-08-F05`, `P1-08-F07` | Krankmeldung: Selbstmeldung (rückwirkend/offen), Büro-Erfassung, Korrekturen, Nachweisführung, Stornierung | covered:@P1-08 + new:A4-06 supplement | `pass` | `@P1-08`-Body deckt Selbst-/Büro-Erfassung, Eigenkorrektur, Nachweis und Stornierung; A4 ergänzt die vollständige Managerkorrektur und belegt den verpflichtenden Korrekturgrund. |
| A4-07 | `P1-08-F06` | Einstempeln am Kranktag: Hinweis statt Blockade | covered:@P1-08 | `pass` | Vollständiger `@P1-08`-Body re-verifiziert: neutraler Hinweis erscheint, Einstempeln bleibt möglich. |
| A4-08 | `P1-08-F04` | Privacy-Matrix: neutraler Kalender, Kollegen sehen nichts | covered:@P1-08 | `pass` | Vollständiger `@P1-08`-Body re-verifiziert: Managerkalender bleibt neutral, Kollegenansicht enthält weder Eintrag noch Diagnosekontext. |
| A4-09 | `P1-06-F03`, `P1-08-F01` | Krankheit während genehmigten Urlaubs: neutraler Überschneidungs-Hinweis, kein automatischer Saldo-Effekt | covered:@P1-08 + new:A4-09 supplement | `pass` | A4 wählt deterministisch einen urlaubsverbrauchenden Termin, belegt den neutralen Hinweis und hält genehmigten Snapshot sowie sichtbaren 1/31-Saldo vor und nach Meldung/Korrektur unverändert. |
| A4-10 | `P1-08-F01`, `P1-08-F03` | Typen `Kind krank`/`Sonstige Abwesenheit` wählbar; nirgends ein Diagnosefeld | covered:@P1-08 + new:A4-10 supplement | `pass` | `@P1-08` belegt `Kind krank`; A4 meldet `Sonstige Abwesenheit` und beweist browserseitig in Selbst- und Managerdialog Hinweistext sowie das Fehlen jeglicher Diagnose-Steuerung. |

### Session A5 — Aufgaben & Qualifikationen (`P1-07`, `P1-09`)

| ID | Catalog flow IDs | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| A5-01 | `P1-07-F01`, `P1-07-F02`, `P1-07-F03` | `/aufgaben`: Aufgaben genau für Handlungsfähige, Deep-Links, Deduplizierung, Vertretung folgt Delegation | covered:@GG-02 | `open` | |
| A5-02 | `P1-07-F02` | „Alle als gelesen markieren" (Bulk) | new:A5-02 | `open` | |
| A5-03 | `P1-07-F01` | Meine Anträge: eigene Anträge mit Status/Gründen | covered:@GG-02 (verify mapping) | `open` | |
| A5-04 | `P1-07-F03` | Badges zählen Zeit+Urlaub und nie Nicht-Handlungsfähiges | covered:@GG-02 | `open` | |
| A5-05 | `P1-09-F01` | Teams anlegen, datumswirksame Mitglieder, Picker-Expansion ohne Rechte | covered:@P1-09 | `open` | |
| A5-06 | `P1-09-F01` | Team auflösen: Historie bleibt | new:A5-06 | `open` | |
| A5-07 | `P1-09-F02`, `P1-09-F03`, `P1-09-F04` | Katalog Fähigkeiten/Zertifikate; Zuordnung mit Gültigkeit/Nachweis; Anforderungen am Auftrag; Override mit Grund | covered:@P1-09 | `open` | |
| A5-08 | `P1-09-F05` | Azubi-Warnung admin-gesteuert, standardmäßig aus | covered:@P1-09 | `open` | |
| A5-09 | `P1-09-F06` | Ablaufhinweis als Aufgabe; Erneuerung entfernt ihn | covered:@P1-09 | `open` | |
| A5-10 | `P1-09-F02` | Mitarbeiter sieht eigene Qualifikationen nur lesend | covered:@P1-09 (Privacy-Test) | `open` | |

### Session A6 — Planung (`P1-11`)

| ID | Catalog flow IDs | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| A6-01 | `P1-11-F01`, `P1-11-F03` | Serie + zweiter Besuch desselben Auftrags; one/this-and-future/series/skip-Edits | covered:@P1-11 | `open` | |
| A6-02 | `P1-11-F01` | Über Mitternacht / mehrtägig / interne Einträge ohne Fake-Auftrag | covered:@P1-11 | `open` | |
| A6-03 | `P1-11-F01` | Ganztägige Besuche | new:A6-03 | `open` | |
| A6-04 | `P1-11-F02` | Monatsserie: ungültige Termine (31.) fallen aus statt zu verrutschen | new:A6-04 | `open` | |
| A6-05 | `P1-11-F02` | Serienhorizont um 6 Monate verlängern (idempotent) | new:A6-05 | `open` | |
| A6-06 | `P1-11-F04` | Kapazitätswarnung aus schwebendem (pending) Urlaubsantrag | new:A6-06 | `open` | |
| A6-07 | `P1-11-F04` | Überschneidungs-/Qualifikationswarnungen mit Grund-Override; geänderte Fakten erzwingen neue Entscheidung | covered:@P1-11 | `open` | |
| A6-08 | `P1-11-F05` | Personal ohne Login verplanbar (Manager-sichtbar) | covered:@P1-11 (occurrence-scoped test) — verify mapping | `open` | |
| A6-09 | `P1-11-F01` | Legacy-Einzeldatum-Aufträge über die Brücke | covered:@P1-11 | `open` | |
| A6-10 | `P1-11-F01` | Vier interne Eintragstypen wählbar mit korrekten Labels | manual-exception requested (vocabulary display; automate unless owner approves the named exception) | `open` | |

### Session A7 — Einsätze (`P1-12`)

| ID | Catalog flow IDs | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| A7-01 | `P1-12-F01`, `P1-12-F02`, `P1-12-F08`, `P1-12-F09` | Einsatz senden (geplant + ungeplant); Bereitschaftsbild ehrlich; Parkplatz-Kontext; Legacy-Label | covered:@GG-03 | `open` | |
| A7-02 | `P1-12-F03`, `P1-12-F04`, `P1-12-F05` | Bestätigen; wesentliche Änderung macht Bestätigung ungültig; Rückfrage → Büro löst mit Begründung → erneut bestätigen | covered:@GG-03 | `open` | |
| A7-03 | `P1-12-F04` | Nur-Empfänger-Änderung: Bestätigungen Unveränderter leben nachvollziehbar weiter (carry-forward) | new:A7-03 | `open` | |
| A7-04 | `P1-12-F01` | Empfänger ohne Login zeigt „nicht möglich" und wird nie auto-bestätigt | new:A7-04 | `open` | |
| A7-05 | `P1-12-F06` | Einsatz manuell stornieren; Parken storniert aktive Einsätze sichtbar | covered:@GG-03 (parken) — Storno-Aktion new:A7-05 | `open` | |
| A7-06 | `P1-12-F04`, `P1-12-F07` | Hinweistext (Anweisung) ändern ⇒ neue Revision, erneut ausstehend; Bestätigung erzeugt keine Ist-Zeit | new:A7-06 | `open` | |
| A7-07 | `P1-12-F13`, `P1-12-F14` | Kundenzusage erfassen; Verschieben ⇒ sichtbare Abweichung; neue Zusage löst ab | covered:@GG-03 | `open` | |
| A7-08 | `P1-12-F14` | Kundenzusage mit Grund zurückziehen | new:A7-08 | `open` | |
| A7-09 | `P1-12-F15`, `P1-12-F16`, `P1-12-F17` | Batch: Auswahl, Vorschau (Konflikte/Bestätigungen/Zusagen), alles-oder-nichts, Serien-Ausnahmen | covered:@GG-03 | `open` | |
| A7-10 | `P1-12-F15`, `P1-12-F17` | Batch-Ablehnungsfälle: ganztägiger Termin braucht Tages-Verschiebung; Null-Verschiebung abgelehnt | new:A7-10 | `open` | |
| A7-11 | `P1-12-F10` | Überfällige Parkplatz-Wiedervorlage als Aufgabe | new:A7-11 (if the UI only accepts future review dates, same-day overdue may be untestable e2e — then request a named owner exception rather than silently substituting manual/unit evidence) | `open` | |
| A7-12 | `P1-12-F06`, `P1-12-F11`, `P1-12-F12` | Geparkten Auftrag vom Parkplatz aus dispatchen; späteres Einplanen = nachvollziehbarer Übergang | covered:@GG-03 | `open` | |

## Session log

Newest first. One entry per completed session: what was verified, tests added (count/file), defects found and fixed (with commits), catalog corrections, decision items raised, golden-suite run result if app code changed, CodeRabbit disposition, publication state. A1–A4 entries below describe valid historical session closure under the former row-oriented standard; they do not claim testing-rule-12 catalog completeness until R1 records its separate certification.

| Date | Session | Summary | Evidence |
| --- | --- | --- | --- |
| 2026-08-16 | A4 | Completed all 10 absence-cluster rows: two German serial audit tests added in `tests/audit/wave-1/a4-abwesenheit.spec.ts` (34-test audit battery total across four files), no product defects, catalog corrections, decision items, manual rows, or deferrals. Body-level triage retained A4-04 as new, corrected A4-06 to covered-plus-supplement, and confirmed A4-09/A4-10 as covered-plus-supplement. The inherited A2 note was corrected to match its accepted assertion body: the removed invitee has no membership while the linked personnel record remains `Ausgeschieden` with an exit date. The diff is test/doc-only, so CodeRabbit is deferred under the protocol and no full Golden run is required; neither app code nor `tests/golden/**` changed. A4 leaves only the state documented above inside a combined world. Publication targets `origin/partner-preview` only. | Final statics clean (`git diff --check`, TypeScript, lint), unit 187/187, audit list 34 and Golden list 93, fresh production build `WOZaiy9NP6G52R2p9qlrN` green, final focused `@AUDIT-W1-A4` 2/2 in 2.4m (world `msvf2byf`). The initial focused run also passed 2/2 in 4.0m (world `msveoa7q`). Both worlds were destroyed and each teardown printed zero leftover test records. Existing `@P1-06`, `@P1-08`, and `@GG-02` assertion bodies were inspected rather than inferred from titles. |
| 2026-08-16 | A3 | Completed all 11 personnel-cluster rows: three German serial audit tests added in `tests/audit/wave-1/a3-personal.spec.ts` (32-test audit battery total), one manual display/accessibility check, no catalog corrections and no deferred A3 rows. Body-level triage corrected A3-01 and A3-11 to covered-plus-supplement, A3-06 to boundary supplement, and A3-10 to fully covered. Fixed three product-defect areas: personnel history now exposes curated before/after business values and retains every field entered by the audited personnel/condition creation paths; affected Admin/Büro users now see their own responsibility/delegation summary while retaining the organization-wide controls. A3-07 honestly combines UI region changes, read-only append-only history/resolver evidence, and the approved narrowly external holiday-display date; no historical setting was fabricated, and the next distinguishing 20 September is derived from the real Berlin run date instead of hard-coding 2026. CodeRabbit received the authorized scoped diff/context in six completed WSL CLI passes: 25 issues, 13 applied and 12 rejected after verification (out-of-claim empty-state coverage, non-risky presentation/constant nits, duplicated typed-boundary abstraction, and clock/date suggestions conflicting with the live Berlin/server contract); one earlier attempt was explicitly rate-limited, and the sixth pass raised zero issues. A3 leaves only the state documented above inside a combined world; every audit, Golden, manual, failed, and confirmation world was destroyed with zero leftovers. Publication targets `origin/partner-preview` only. | Final statics clean (`git diff --check`, TypeScript, lint), unit 187/187, audit list 32 and Golden list 93, fresh final production build `Ij6oWyTMYb4wNzSOGFRXC` green, final focused `@AUDIT-W1-A3` 3/3 in 1.4m (world `msuwypzx`), and final production Golden suite 93/93 in 16.1m (world `msux2674`). Both final worlds were destroyed and each teardown printed zero leftovers. A preceding focused run exposed a duplicate-number test race with the convenience suggestion; it was classified as a test bug from `error-context.md`, isolated from the separate late-suggestion regression, and its world `msuwrz9m` also tore down cleanly. Manual A3-08 remains `manual_ok`. The earlier accepted run's first full attempt lost only the documented GG-00 Realtime delivery; a dependency-complete reproduction then passed that check in 4.9s but hit an external Supabase Edge Function HTTP 502 on invite email. The next unchanged `@GG-00` run passed 13/13 (world `msurypdt`) and its full run passed unchanged, per testing rule 10. |
| 2026-08-15 | A2 | Completed all 19 customer-cluster rows: eight German serial audit tests added in `tests/audit/wave-1/a2-kunden.spec.ts` (29-test audit battery total), one manual display check, no catalog corrections and no deferred A2 rows. Corrected the provisional mappings for A2-01, A2-07 and A2-09 after body inspection. Fixed product defects in project-default inheritance, project-customer changes preserving child membership while clearing old references, dialog reset/stale-response handling, retained unknown-caller display, and visible safe metadata-save errors. CodeRabbit received the authorized scoped diff/context in three WSL CLI passes: 26 issues total, 18 applied and 8 rejected or verified false (including already-present German mapping, server normalization/validation already safe, duplicated caller-link scope, and intentionally conditional loading cleanup). A2 leaves only the state documented above inside a combined world; every completed/diagnostic world was destroyed and the final live marker query returned zero test organizations and zero test profiles. Publication: this A2 session commit targets `origin/partner-preview` only. | Statics clean (`git diff --check`, TypeScript, lint), unit 187/187, fresh production build green, final focused `@AUDIT-W1-A2` 8/8 in 2.4m (world `msuk6a6t`), final production golden suite 93/93 in 15.1m (world `msuk9ffk`). Manual A2-19 `manual_ok`. Additional combined runs proved A2 8/8 after inherited A1 state but exposed the separately recorded A1 final-gate item; they are not claimed as green full-battery evidence. |
| 2026-08-15 | A1 | Completed all 44 Grundstock/Wave-0 rows: 21 automated audit tests added in `tests/audit/wave-1/a1-grundstock.spec.ts`, five physical/display flows checked manually, two catalog claims corrected, and one product decision deferred. Fixed nine product defects across customer/job/project Realtime mutations and route invalidation, project numbering/parking, Berlin completion dates, break-policy editing, document-version refresh, and inventory movement evidence; hardened action-menu accessibility, UI-created-world cleanup, ESLint exclusion of generated audit reports, and existing Golden assertions for persisted invitation state, holiday precedence, and calendar overflow on the run date. CodeRabbit: eleven findings, ten applied (Realtime resume refresh, inventory-helper validation, unique approval-card assertion, explicit cleanup-error handling, closed document-dialog guard, stable project picker identity, visible personnel row, run-scoped explicit teardown, profile-before-org cleanup order, customer-delete rejection recovery), one rejected because the mandatory post-run leftover sweep is intentional and concurrent golden/audit runs are prohibited; transient quota retries occurred before the final review. No world state is left behind. | Focused `@AUDIT-W1-A1`: 21/21; TypeScript/lint/unit: clean (187/187); production build: green; affected `@GG-00`: green; final production golden suite: 93/93; final production `@AUDIT-W1-A1`: 21/21. Published by the A1 session commit to `origin/partner-preview`. |
| 2026-08-15 | — | Audit protocol established: this document, the triaged ledger (provisional buckets from spec-title/knowledge triage), `playwright.audit.config.ts`, `tests/audit/` scaffolding, `test:audit:w1` script, gitignore entries. No audit test exists yet. | This session |
