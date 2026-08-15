# Wave 1 Flow Audit

Wave 1 (`P1-00` through `P1-12`) is accepted complete. This audit exhaustively exercises the user-flow catalog ([`docs/product/user-flow-catalog.md`](../product/user-flow-catalog.md)) — every flow any user can actually perform, far beyond what the golden gates pin — before Wave 2 begins. This document is the protocol, the session plan, and the **coverage ledger** (the authoritative record of what was tested, how, and what came of it).

## Why this exists

Each slice was accepted with focused specs, reviews, and cumulative golden-suite regression runs. The audit therefore mostly *confirms*. Its real yield is the uncovered-flow tail: small flows no spec ever pinned (checklists, folder management, break-policy settings, project parking, role-change guards, …), plus turning the flow catalog from asserted into verified — which is exactly what the eventual handover needs.

## Battery mechanics

- Audit specs live in `tests/audit/wave-1/`, named `a1-<topic>.spec.ts` … `a7-<topic>.spec.ts` so filename order equals session order, tagged `@AUDIT-W1-A<N>` per session.
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
| reserve | +65 … +69 |

## Session protocol

Each session is one focused agent thread owning one ledger section below, start to finish:

1. **Re-verify the triage.** The ledger's coverage buckets were assigned from spec *titles*; the session reads the actual spec bodies for its `covered:` rows and confirms the mapped test really asserts the flow. Wrong mappings are corrected in the ledger (a `covered:` row may become `new:`, and vice versa).
2. **Write and run the session's audit spec** for all `new:` rows: one spec file, own date partition, business actions through the UI, read-only db helpers for state assertions, German test titles per repo convention. Iterate focused (`--grep @AUDIT-W1-A<N>`) until green.
3. **Classify and fix failures immediately, in-session.** Every failure is exactly one of: **(a) product defect** — fix it now with the smallest correct change, no smuggled redesigns; **(b) test bug** — fix the test; **(c) catalog inaccuracy** — the app's actual behavior is acceptable and the flow description was wrong: correct `user-flow-catalog.md` and record `catalog_corrected`. If a failure exposes a real product *design question* rather than a bug, do not improvise: record it as a decision item in the session's ledger notes, continue with the other flows, and present all decision items to the product owner at the end of the session.
4. **Check the `manual` rows** by hand (headed browser or dev server), record `manual_ok` or reclassify as defect.
5. **Freeze statics and focused greens.** TypeScript/lint/unit clean; the session's focused audit spec green; if app code changed, the focused golden spec(s) of the affected slice(s) green too. Fix-and-rerun loops happen here, at focused-spec granularity — never by rerunning whole suites per fix.
6. **CodeRabbit review** (per `docs/technical/coderabbit.md`): required for any session whose diff contains app-code changes; sessions with test/doc-only diffs may batch their review with the next such session (record the deferral in the ledger). Disposition every finding, apply the fixes, then re-freeze step 5 (statics + focused specs green again).
7. **Final confirmation runs — always LAST, after all review fixes.** Fresh production build. Run the focused `@AUDIT-W1-A<N>` battery FIRST — it is the cheap run (~5 min), and an audit-side failure must never waste a 15-minute golden run. Then, if the session changed app code or anything under `tests/golden/` (specs or shared support), **one full golden suite run** (93 tests) green per `testing.md`'s numbered rules — once per session, not per fix. **Reopening is SCOPED:** a later change to app code or to `tests/golden/**` reopens step 5 and requires the full pair again; a change that touches ONLY files under `tests/audit/**` reopens step 5 but then requires only a fresh focused audit run against the unchanged build — the existing golden evidence stays valid, because golden runs cannot execute audit specs and audit specs are not part of the app build. Nothing may change after the last run of the required set (the P1-09 lesson). A1 experience: applying reopening unscoped cost several redundant full golden reruns; do not repeat that.
8. **Document and publish.** Update every ledger row for the session (status + evidence), append a session entry to the log below, add the session's entry to **In-world left-behind state** below, update the catalog where corrected, commit on local `main`, publish with `git push origin main:partner-preview`. Never plain `git push`, never `origin main`.

Status vocabulary for ledger rows: `open` → `pass` | `defect_fixed` (name the fix) | `catalog_corrected` | `manual_ok` | `deferred` (with reason and owner decision).

## Final gate (session F)

After A7: fresh production build, then — sequentially, never concurrently — the **full golden suite (93)** and the **entire `@AUDIT-W1` battery**, both green in one recorded pair of runs. Record in `docs/plans/golden-gate-log.md` as `AUDIT-W1` and close this document's status. Only then is Wave 1 "audited", and `P1-13` work should not run concurrently with audit sessions that may touch shared surfaces.

## Sessions

| Session | Scope (catalog sections) | Status |
| --- | --- | --- |
| A1 | Grundstock (Organisation/Rollen, Kunden-Basis, Aufträge/Projekte-Basis, Kalender-Basis, Zeiterfassung-Basis, Dokumente, Lager) + `P1-00`/`P1-00a` | `complete` |
| A2 | Kunden-Cluster: `P1-01`, `P1-02`, `P1-10` | `open` |
| A3 | Personal-Cluster: `P1-03`, `P1-04`, `P1-05` | `open` |
| A4 | Abwesenheits-Cluster: `P1-06`, `P1-08` | `open` |
| A5 | Aufgaben & Qualifikationen: `P1-07`, `P1-09` | `open` |
| A6 | Planung: `P1-11` | `open` |
| A7 | Einsätze: `P1-12` | `open` |
| F | Final gate: full golden suite + full audit battery | `open` |

## In-world left-behind state (final battery)

In the final gate, all audit specs share **one world in one run**, executing in filename order. Each completed session records here what its spec leaves behind in-world so later specs can tolerate it (post-run database cleanliness is a separate, always-required proof). Verify details against the spec itself when a specific fact is load-bearing.

- **A1** (`a1-grundstock.spec.ts`, runs first): A1-prefixed customers/jobs/projects in various states (edited, deleted/unlinked, parked — including a parked project with children — and completed), a checklist job, manual time entries on the run's previous Berlin business day plus approved/edited/reassigned corrections, the organization break policy possibly left on the **automatic** rule (A1-32 does not guarantee reverting it), documents including a trashed→restored file, a versioned business document, and a 1×1 PNG viewer fixture, an inventory item/location with movements (including a rejected negative booking) and CSV-imported category/supplier/location, and — alive until teardown — **two extra organizations** (the UI-signup organization and the seeded admin's second organization), which appear in the affected users' organization switchers for the remainder of the battery run.

## Coverage ledger

Legend — Coverage: `covered:@TAG` = an existing golden spec already asserts this flow (session verifies the mapping against the spec body; the flow is re-proven by the final gate's golden run). `new:<ID>` = the session writes an audit test. `manual` = deliberately not automated (reason given); checked by hand once, result recorded. Buckets are **provisional until the session's step-1 re-verification.**

### Session A1 — Grundstock + Wave 0

Organisation, Konten, Rollen:

| ID | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- |
| A1-01 | Konto anlegen (Registrierung) und erste Organisation erstellen | new:A1-01 | `pass` | UI-Registrierung und Organisationserstellung; UI-erzeugte Organisation und Auth-Nutzer durch erweiterten World-Teardown entfernt. |
| A1-02 | Organisation per Code beitreten | new:A1-02 (also produces the dual-membership user for A1-03/A1-28) | `catalog_corrected` | Beitritt als Handwerker und zweite Mitgliedschaft verifiziert; Katalog um Admin-/Inhabergrenzen präzisiert. |
| A1-03 | Aktive Organisation wechseln; Daten strikt getrennt | new:A1-03 | `pass` | Umschalten und beidseitige Datenisolation in `A1-02/A1-03`. |
| A1-04 | Einladung per E-Mail (Büro), Einlösung, rollengerechte Oberflächen | covered:@GG-00 („Einladung: Eingeladene Person tritt bei…") + new:A1-04 (role surfaces) | `pass` | Invite-Body in `@GG-00` re-verifiziert; Handwerker-Navigation in `A1-04/A1-06`. |
| A1-05 | Mitgliederliste mit Live-Stempelstatus („arbeitet") | new:A1-05 (piggyback on A1-26 clock-in) | `pass` | Live-Status „Arbeitet" in `A1-05/A1-26/A1-27/A1-28`. |
| A1-06 | Rollenänderungs-Schutz: eigene Rolle nicht änderbar, kein zweiter Admin, Büro verwaltet nur Handwerker | new:A1-06 | `catalog_corrected` | Schutzregeln verifiziert; Katalog präzisiert, dass Büro zwar Büro einladen, bestehende Büro/Admin aber nicht verwalten kann. |
| A1-07 | Abmelden (+ Auto-Ausstempeln beim Abmelden) | covered:@GG-00 (Abmelden); Auto-Ausstempeln new:A1-07 | `deferred` | Abmelden und Auto-Ausstempeln grün; Entfernung eines Mitglieds löscht dessen Zeithistorie. **Owner ruling 2026-08-15: deferred to `P1-33`** (offboarding owns retained historical identity); the defect is recorded in the `P1-33` roadmap row so it cannot get lost. |

Kunden-Basis:

| ID | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- |
| A1-08 | Kunde anlegen; Liste live | covered:@GG-00 (anlegen + Realtime) | `pass` | `@GG-00`-Body re-verifiziert; finale Golden-Suite. |
| A1-09 | Kunde inline auf Detailseite bearbeiten | new:A1-09 | `pass` | `A1-09/A1-11`. |
| A1-10 | Kunde löschen — Aufträge/Projekte bleiben, verlieren nur die Zuordnung | new:A1-10 | `defect_fixed` | Realtime-Selbst-Rennen beim Löschen behoben; Auftrag/Projekt bleiben ohne Kunde erhalten (`A1-10/A1-14`). |
| A1-11 | Kunde direkt im Auftrags-/Projektdialog neu anlegen | new:A1-11 | `pass` | `A1-09/A1-11`. |

Aufträge & Projekte-Basis:

| ID | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- |
| A1-12 | Auftrag anlegen/zuweisen; Handwerker sieht nur Zugewiesenes | covered:@GG-00 + new:A1-12 (role visibility) | `defect_fixed` | Bearbeitungsdialog gegen Realtime-Resets stabilisiert; Zuweisungsgrenze in `A1-12/A1-13`. |
| A1-13 | Auftrag bearbeiten; Zuweisung entfernen; Auftrag löschen | new:A1-13 | `defect_fixed` | Edit/Delete-Selbst-Rennen behoben; `A1-12/A1-13`. |
| A1-14 | Projekt anlegen; Auftrag im Projekt erbt Kunden; Projekt ohne Aufträge; Projekt löschen löst nur die Zuordnung | new:A1-14 | `defect_fixed` | Asynchroner Nummernvorschlag überschreibt keine Eingabe mehr; Projektlöschung in `A1-10/A1-14`. |
| A1-15 | Datum entziehen parkt den Auftrag; Einplanen entparkt (semantisch, ohne Drag & Drop) | new:A1-15 | `pass` | `A1-15/A1-16`. |
| A1-16 | Projekt parken parkt unfertige Kinder; fertige bleiben fertig | new:A1-16 | `defect_fixed` | Projekt-Statusoverride nutzt jetzt die kaskadierende Park-Aktion; `A1-15/A1-16`. |
| A1-17 | Checkliste: Manager pflegt Punkte; Handwerker hakt ab / öffnet wieder; Attribution sichtbar | new:A1-17 | `pass` | `A1-17/A1-18`. |
| A1-18 | Fertigstellen setzt Abschlussdatum; Projektstatus/-fortschritt abgeleitet; manueller Override | new:A1-18 | `defect_fixed` | Abschlussdatum wird als Geschäftstag Europe/Berlin bestimmt; `A1-17/A1-18`. |
| A1-19 | `/auftraege`: Suche, Status-/Typ-Filter, Parkplatz-/Archiv-Trennung | new:A1-19 | `pass` | `A1-19`. |
| A1-20 | `/auftraege`: nutzerspezifische Spaltenauswahl, Sortierung | manual (display preference, low risk) | `manual_ok` | Kundenspalte nutzerspezifisch ausgeblendet und Nummernsortierung manuell geprüft. |

Kalender-Basis:

| ID | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- |
| A1-21 | Tages-/Wochen-/Monatsansicht; geplante Arbeit vs. Zeitblöcke getrennt | new:A1-21 + covered:@GG-00/@P1-11 | `pass` | Alle drei Ansichten und Blocktrennung in `A1-21/A1-24`. |
| A1-22 | Verschieben per Drag & Drop (inkl. Warnpfad) | new:A1-22 + covered:@P1-09 | `pass` | Drag und bestätigter Warnpfad in `A1-22`. |
| A1-23 | Größe ziehen (Resize) und Drag in den/aus dem Parkplatz | manual (physical drag gestures) | `manual_ok` | Echte Gesten: Breite 305,22→381,53 px; aus Parkplatz geplant und wieder geparkt. |
| A1-24 | Kalender-Filter (Mitarbeiter/Arbeitszeiten/Aufträge) | new:A1-24 | `pass` | `A1-21/A1-24`. |
| A1-25 | Manueller Zeiteintrag aus dem Kalender heraus | manual (duplicate entry path; dashboard path covered by @P1-05) | `manual_ok` | Kalenderdialog legte 09:00–17:00 an; Erfolgsmeldung, Verlauf und DB-Fakten geprüft. |

Zeiterfassung-Basis:

| ID | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- |
| A1-26 | Ein-/Ausstempeln, Pausen, Tagessummen; auftragsbezogene Zeit | covered:@GG-00 + new:A1-26 | `pass` | Pause, Auftragbezug, Zustände und Summen in `A1-05/A1-26/A1-27/A1-28`. |
| A1-27 | Auftragswechsel während laufender Sitzung | new:A1-27 | `pass` | `A1-05/A1-26/A1-27/A1-28`. |
| A1-28 | Kein gleichzeitiges Einstempeln in zwei Organisationen | new:A1-28 (uses A1-02's dual membership) | `pass` | Org-Sperre mit derselben Person in zwei Organisationen. |
| A1-29 | Manuelle Einträge: Reihenfolge-/Überlappungs-Ablehnung | new:A1-29 | `pass` | `A1-29`. |
| A1-30 | Bestehende Einträge korrigieren / löschen / umhängen (Manager) | new:A1-30 | `pass` | Korrigieren, Auftrag umhängen und löschen in `A1-30`. |
| A1-31 | Verlauf-Filter (Zeitraum/Mitarbeiter/Status) | manual (display filter) | `manual_ok` | Mitarbeiter-/Statusfilter und Leerergebnis manuell geprüft. |
| A1-32 | Pausenregel: Admin stellt automatische Pause ein, Büro liest nur; Historie schreibt Vergangenes nicht um | new:A1-32 | `defect_fixed` | Prop-Refresh setzte ungespeicherte Auswahl zurück; primitive Reset-Abhängigkeiten stabilisieren das Formular. |

Dokumente:

| ID | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- |
| A1-33 | Upload >4,5 MB am Auftrag; Bibliothek zeigt es; Handwerker-Upload/-Ansicht; Zugriffsgrenzen | covered:@GG-00 | `pass` | `@GG-00`-Body re-verifiziert; finale Golden-Suite. |
| A1-34 | Ordner anlegen, Datei verschieben/kopieren über den Ziel-Dialog | new:A1-34 | `pass` | `A1-34/A1-35`. |
| A1-35 | Bestehendes Bibliotheksdokument mit Ziel (Auftrag/Kunde) verknüpfen; Verknüpfungsfilter | new:A1-35 | `pass` | `A1-34/A1-35`. |
| A1-36 | Papierkorb: löschen, wiederherstellen, endgültig löschen; Audit-Historie | new:A1-36 | `pass` | `A1-36/A1-37`. |
| A1-37 | Neue Version eines Geschäftsdokuments hochladen; Versionshistorie | new:A1-37 | `defect_fixed` | Versionsupload aktualisiert Version und Audit-Historie sofort im lokalen UI-Zustand; `A1-36/A1-37`. |
| A1-38 | Viewer (PDF/Bild) öffnen; Download über signierten Link | manual (visual overlay + signed download) | `manual_ok` | Bild im Overlay gerendert; signierter „Neuer Tab"-Link und Download-Schaltfläche geprüft. |

Lager:

| ID | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- |
| A1-39 | Handwerker: geplantes Material entnehmen, ungeplant entnehmen, zurückgeben; Bestandskonsistenz; Zugriffsgrenzen | covered:@GG-00 + new:A1-39 | `pass` | Geplant/ungeplant/Retouren und Bestandsfakten in `A1-39/A1-42`; Rollen-Body in `@GG-00`. |
| A1-40 | Artikel + Lagerort über die UI anlegen/bearbeiten (statt Seeder) | new:A1-40 | `pass` | `A1-40/A1-44`. |
| A1-41 | Manuelle Zu-/Abgänge; Buchung unter null wird abgelehnt; Bewegungsliste mit Vorher/Nachher/Grund | new:A1-41 | `defect_fixed` | Bewegungsliste um sichtbare Vorher- und Grund-Spalten ergänzt; `A1-41`. |
| A1-42 | Manager plant Material am Auftrag (ohne Bestandsänderung); Projekt zeigt direktes/vererbtes Material + Summe | new:A1-42 | `pass` | `A1-39/A1-42`. |
| A1-43 | CSV-Import mit Spaltenzuordnung (legt Kategorien/Lieferanten/Orte an; Anfangsmengen als Bewegungen) | new:A1-43 | `pass` | Mapping-UI stabil automatisiert; Stammdaten und Anfangsbewegung per DB-Leseassertion. |
| A1-44 | `/inventar`-Ansichten (Alle Artikel / Lager / Geplant / Bewegungen) mit Suche/Filtern | new:A1-44 (folded into A1-40/41 assertions) | `pass` | Vier Ansichten, Suche und Filter in `A1-40/A1-44` und `A1-41`. |

### Session A2 — Kunden-Cluster (`P1-01`, `P1-02`, `P1-10`)

| ID | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- |
| A2-01 | Ansprechpartner anlegen/primär/archivieren; Einsatzorte pflegen | covered:@P1-01 | `open` | |
| A2-02 | Archivierten Kontakt wiederherstellen; archivierte fehlen in Pickern | new:A2-02 | `open` | |
| A2-03 | Ein-Klick: Kundenadresse als ersten Einsatzort übernehmen | new:A2-03 | `open` | |
| A2-04 | Kundennummer: manuelle Vergabe, Org-Eindeutigkeit wird abgelehnt | new:A2-04 | `open` | |
| A2-05 | Ort-Snapshot: Adressänderung am Einsatzort ändert alte Aufträge nicht | covered:@P1-01 | `open` | |
| A2-06 | Projekt-Standardort/-kontakt befüllt neue Projektaufträge vor; Auftrag kann abweichen; Kundenwechsel löscht Referenzen (inkl. Kinder) | new:A2-06 | `open` | |
| A2-07 | Handwerker sieht Ort/Zugangshinweise/Kontakt mit Anruf-Link | covered:@P1-01 | `open` | |
| A2-08 | Suche über Kontakte/Einsatzorte | covered:@P1-01 | `open` | |
| A2-09 | Anfrage im Anruf erfassen (inkl. Anhang); unbekannte Anruferin zuordnen/anlegen | covered:@GG-01 | `open` | |
| A2-10 | Vorgeschlagene Anfragenummer manuell überschreiben (Regressionsflow des P1-02-Defekts) | new:A2-10 | `open` | |
| A2-11 | Lifecycle: „In Klärung" setzen; geschlossene Anfrage wieder öffnen | new:A2-11 | `open` | |
| A2-12 | Umwandlung genau einmal in **Auftrag**; Schließen mit Grund; Direktauftrag ohne Anfrage | covered:@GG-01 | `open` | |
| A2-13 | Umwandlung in **Projekt** (inkl. Rückverlinkung) | new:A2-13 | `open` | |
| A2-14 | Zugriffsgrenzen `/anfragen` (Handwerker, Fremdorganisation) | covered:@GG-01 | `open` | |
| A2-15 | Kundendetail-Chronik: Reihenfolge, Filter, Deep-Links ohne Kopien | covered:@P1-10 | `open` | |
| A2-16 | Follow-up anlegen/erledigen; überfällig als Aufgabe | covered:@P1-10 | `open` | |
| A2-17 | Follow-up ohne gültigen Verantwortlichen erscheint allen Managern zur Neuzuweisung | new:A2-17 | `open` | |
| A2-18 | Kommunikationspräferenzen: Zweck×Kanal, Warnung, begründete Ausnahme | covered:@P1-10 | `open` | |
| A2-19 | Allgemeine Präferenzen (Kontaktzeiten, Sprache, Kontaktsperre) pflegen und sehen | manual (data entry + display; warning logic covered by A2-18) | `open` | |

### Session A3 — Personal-Cluster (`P1-03`, `P1-04`, `P1-05`)

| ID | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- |
| A3-01 | Personalien pflegen; Konditionen-Versionen (Aktuell/Früher/Geplant); Verlauf | covered:@P1-03 | `open` | |
| A3-02 | Personalakte ohne Zugang; „Zugang einladen" verknüpft; Entfernen ⇒ „Ausgeschieden" | covered:@P1-03 | `open` | |
| A3-03 | Personalnummer: `MA-NNN`-Vorschlag überschreiben; Eindeutigkeit abgelehnt | new:A3-03 | `open` | |
| A3-04 | Wochenplan-Versionen; Ziel aus Plan; Vertragsabweichungs-Hinweis; historische Tage stabil | covered:@P1-04 | `open` | |
| A3-05 | Feiertagskalender wählen; Betriebsruhe setzt Ziel 0; unkonfiguriert = sichtbare Ausnahme | covered:@P1-04 | `open` | |
| A3-06 | Betriebsruhe-Tag wieder entfernen (nur heute/zukünftig) | new:A3-06 | `open` | |
| A3-07 | Feiertagsregion ändern: wirkt ab Auswahl, Vergangenes bleibt | new:A3-07 | `open` | |
| A3-08 | Mitgliederlisten-Fortschrittsbalken mit Unkonfiguriert-Marker | manual (display nuance) | `open` | |
| A3-09 | Verantwortlichkeiten: Vorschau, benannte Holder, Vier-Augen, Fenster-Ende am Aktionspunkt, Schutz des letzten Holders | covered:@P1-05 | `open` | |
| A3-10 | Vertretung vorzeitig beenden (Entzug wirkt sofort am Aktionspunkt) | new:A3-10 | `open` | |
| A3-11 | „Meine Verantwortlichkeiten und Vertretungen" in den eigenen Einstellungen | covered:@P1-05 (Betroffene sehen nur Eigenes) | `open` | |

### Session A4 — Abwesenheits-Cluster (`P1-06`, `P1-08`)

| ID | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- |
| A4-01 | Urlaub beantragen/zurückziehen; Wochenende zählt nicht; Überschneidung blockiert | covered:@P1-06 | `open` | |
| A4-02 | Genehmigung: Saldo, Soll 0, Einstempel-Sperre; Stornierung stellt wieder her | covered:@P1-06 | `open` | |
| A4-03 | Halber Tag = 0,5; ohne Anspruch sichtbare Ausnahme; Vier-Augen | covered:@P1-06 | `open` | |
| A4-04 | Anspruch aus der neuesten Kondition des Jahres (Mitte-Jahr-Änderung) | new:A4-04 (e2e over the arithmetic already unit-tested) | `open` | |
| A4-05 | Kalender: „Urlaub – Name", „(angefragt)" gestrichelt | covered:@P1-06/@GG-02 | `open` | |
| A4-06 | Krankmeldung: Selbstmeldung (rückwirkend/offen), Büro-Erfassung, Korrekturen, Nachweisführung, Stornierung | covered:@P1-08 | `open` | |
| A4-07 | Einstempeln am Kranktag: Hinweis statt Blockade | covered:@P1-08 | `open` | |
| A4-08 | Privacy-Matrix: neutraler Kalender, Kollegen sehen nichts | covered:@P1-08 | `open` | |
| A4-09 | Krankheit während genehmigten Urlaubs: neutraler Überschneidungs-Hinweis, kein automatischer Saldo-Effekt | covered:@P1-08 (mode-dependent hint) — verify mapping, else new:A4-09 | `open` | |
| A4-10 | Typen `Kind krank`/`Sonstige Abwesenheit` wählbar; nirgends ein Diagnosefeld | new:A4-10 (small; includes negative assertion) | `open` | |

### Session A5 — Aufgaben & Qualifikationen (`P1-07`, `P1-09`)

| ID | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- |
| A5-01 | `/aufgaben`: Aufgaben genau für Handlungsfähige, Deep-Links, Deduplizierung, Vertretung folgt Delegation | covered:@GG-02 | `open` | |
| A5-02 | „Alle als gelesen markieren" (Bulk) | new:A5-02 | `open` | |
| A5-03 | Meine Anträge: eigene Anträge mit Status/Gründen | covered:@GG-02 (verify mapping) | `open` | |
| A5-04 | Badges zählen Zeit+Urlaub und nie Nicht-Handlungsfähiges | covered:@GG-02 | `open` | |
| A5-05 | Teams anlegen, datumswirksame Mitglieder, Picker-Expansion ohne Rechte | covered:@P1-09 | `open` | |
| A5-06 | Team auflösen: Historie bleibt | new:A5-06 | `open` | |
| A5-07 | Katalog Fähigkeiten/Zertifikate; Zuordnung mit Gültigkeit/Nachweis; Anforderungen am Auftrag; Override mit Grund | covered:@P1-09 | `open` | |
| A5-08 | Azubi-Warnung admin-gesteuert, standardmäßig aus | covered:@P1-09 | `open` | |
| A5-09 | Ablaufhinweis als Aufgabe; Erneuerung entfernt ihn | covered:@P1-09 | `open` | |
| A5-10 | Mitarbeiter sieht eigene Qualifikationen nur lesend | covered:@P1-09 (Privacy-Test) | `open` | |

### Session A6 — Planung (`P1-11`)

| ID | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- |
| A6-01 | Serie + zweiter Besuch desselben Auftrags; one/this-and-future/series/skip-Edits | covered:@P1-11 | `open` | |
| A6-02 | Über Mitternacht / mehrtägig / interne Einträge ohne Fake-Auftrag | covered:@P1-11 | `open` | |
| A6-03 | Ganztägige Besuche | new:A6-03 | `open` | |
| A6-04 | Monatsserie: ungültige Termine (31.) fallen aus statt zu verrutschen | new:A6-04 | `open` | |
| A6-05 | Serienhorizont um 6 Monate verlängern (idempotent) | new:A6-05 | `open` | |
| A6-06 | Kapazitätswarnung aus schwebendem (pending) Urlaubsantrag | new:A6-06 | `open` | |
| A6-07 | Überschneidungs-/Qualifikationswarnungen mit Grund-Override; geänderte Fakten erzwingen neue Entscheidung | covered:@P1-11 | `open` | |
| A6-08 | Personal ohne Login verplanbar (Manager-sichtbar) | covered:@P1-11 (occurrence-scoped test) — verify mapping | `open` | |
| A6-09 | Legacy-Einzeldatum-Aufträge über die Brücke | covered:@P1-11 | `open` | |
| A6-10 | Vier interne Eintragstypen wählbar mit korrekten Labels | manual (vocabulary display) | `open` | |

### Session A7 — Einsätze (`P1-12`)

| ID | Flow | Coverage | Status | Evidence |
| --- | --- | --- | --- | --- |
| A7-01 | Einsatz senden (geplant + ungeplant); Bereitschaftsbild ehrlich; Parkplatz-Kontext; Legacy-Label | covered:@GG-03 | `open` | |
| A7-02 | Bestätigen; wesentliche Änderung macht Bestätigung ungültig; Rückfrage → Büro löst mit Begründung → erneut bestätigen | covered:@GG-03 | `open` | |
| A7-03 | Nur-Empfänger-Änderung: Bestätigungen Unveränderter leben nachvollziehbar weiter (carry-forward) | new:A7-03 | `open` | |
| A7-04 | Empfänger ohne Login zeigt „nicht möglich" und wird nie auto-bestätigt | new:A7-04 | `open` | |
| A7-05 | Einsatz manuell stornieren; Parken storniert aktive Einsätze sichtbar | covered:@GG-03 (parken) — Storno-Aktion new:A7-05 | `open` | |
| A7-06 | Hinweistext (Anweisung) ändern ⇒ neue Revision, erneut ausstehend | new:A7-06 | `open` | |
| A7-07 | Kundenzusage erfassen; Verschieben ⇒ sichtbare Abweichung; neue Zusage löst ab | covered:@GG-03 | `open` | |
| A7-08 | Kundenzusage mit Grund zurückziehen | new:A7-08 | `open` | |
| A7-09 | Batch: Auswahl, Vorschau (Konflikte/Bestätigungen/Zusagen), alles-oder-nichts, Serien-Ausnahmen | covered:@GG-03 | `open` | |
| A7-10 | Batch-Ablehnungsfälle: ganztägiger Termin braucht Tages-Verschiebung; Null-Verschiebung abgelehnt | new:A7-10 | `open` | |
| A7-11 | Überfällige Parkplatz-Wiedervorlage als Aufgabe | new:A7-11 (if the UI only accepts future review dates, same-day overdue may be untestable e2e — then `manual`/unit note with reason) | `open` | |
| A7-12 | Geparkten Auftrag vom Parkplatz aus dispatchen; späteres Einplanen = nachvollziehbarer Übergang | covered:@GG-03 | `open` | |

## Session log

Newest first. One entry per completed session: what was verified, tests added (count/file), defects found and fixed (with commits), catalog corrections, decision items raised, golden-suite run result if app code changed, CodeRabbit disposition, publication state.

| Date | Session | Summary | Evidence |
| --- | --- | --- | --- |
| 2026-08-15 | A1 | Completed all 44 Grundstock/Wave-0 rows: 21 automated audit tests added in `tests/audit/wave-1/a1-grundstock.spec.ts`, five physical/display flows checked manually, two catalog claims corrected, and one product decision deferred. Fixed nine product defects across customer/job/project Realtime mutations and route invalidation, project numbering/parking, Berlin completion dates, break-policy editing, document-version refresh, and inventory movement evidence; hardened action-menu accessibility, UI-created-world cleanup, ESLint exclusion of generated audit reports, and existing Golden assertions for persisted invitation state, holiday precedence, and calendar overflow on the run date. CodeRabbit: eleven findings, ten applied (Realtime resume refresh, inventory-helper validation, unique approval-card assertion, explicit cleanup-error handling, closed document-dialog guard, stable project picker identity, visible personnel row, run-scoped explicit teardown, profile-before-org cleanup order, customer-delete rejection recovery), one rejected because the mandatory post-run leftover sweep is intentional and concurrent golden/audit runs are prohibited; transient quota retries occurred before the final review. No world state is left behind. | Focused `@AUDIT-W1-A1`: 21/21; TypeScript/lint/unit: clean (187/187); production build: green; affected `@GG-00`: green; final production golden suite: 93/93; final production `@AUDIT-W1-A1`: 21/21. Published by the A1 session commit to `origin/partner-preview`. |
| 2026-08-15 | — | Audit protocol established: this document, the triaged ledger (provisional buckets from spec-title/knowledge triage), `playwright.audit.config.ts`, `tests/audit/` scaffolding, `test:audit:w1` script, gitignore entries. No audit test exists yet. | This session |
