# P1-13 work templates implementation plan

> Status: `complete`
> Started: 22 August 2026
> Accepted: 23 August 2026
> Baseline: `e8bd727`
> Owner gate: items 2 through 8 and the recommended approach confirmed on 22 August 2026

## Bounded outcome

Organizations can create and publish versioned SHK work templates for either an Auftrag or a Projekt. Applying a published version materializes editable rows in the existing instruction, planned-material, and capability-requirement models. Published versions and completed applications retain their historical meaning. The slice does not reserve stock, create planning occurrences, schedule or dispatch work, record actual time, create documents, approve evidence, or enforce task dependencies.

## Domain decisions

- `work_templates` owns the stable organization-scoped identity and archive state.
- `work_template_versions` owns numbered drafts and immutable published versions. A template has at most one draft and one current published version.
- Normalized version rows own task and checklist items, evidence expectations, material plans, capability requirements, and structural dependencies.
- Publishing validates the draft and dependency graph, then makes the version and all its child rows immutable.
- Editing a published template creates a new draft version. Existing published versions and applied work never change.
- `work_template_applications` records the exact version and target. An organization-scoped idempotency key makes retries safe.
- Applying materializes instruction items, evidence expectations, dependencies, material lines, and capability requirements into their existing owning tables.
- The existing `job_instruction_items` table expands to accept exactly one Auftrag or Projekt target. Existing rows keep their old meaning and defaults.
- Capability requirements remain one authoritative set per work target. Applying a template merges duplicates and never weakens `require_confirmation = true`.
- Employees see template-produced Auftrag items through the same checklist they use today. Projekt template content remains manager-only.

## Application rules

- Matching published templates are optional in all shared direct-create forms, customer and employee context creation, project child creation, calendar creation, and request conversion.
- Managers can also apply a matching version after creation while the Auftrag or Projekt is not complete.
- The same version cannot be applied twice to the same target. A different template or newer version is additive after an explicit duplicate-content warning.
- The server reloads organization, version, target, assignments, and reference state at action time.
- Retired material, location, or capability references block the whole application. The target stays unchanged.
- Produced rows remain editable through their owning work-detail sections. Later template edits never overwrite them.
- Qualification assessment includes template capability requirements. Existing assignments require the established fingerprinted reason when coverage is incomplete.
- Request conversion claims and links the request only after work creation and template application succeed. Failures remove the new work.

## Confirmed flow contract

- **P1-13-F01:** Ein Admin oder Büro-Nutzer öffnet „Arbeitsvorlagen", sieht bei einer Organisation ohne Vorlagen den leeren Zustand „Erste Arbeitsvorlage anlegen" und erhält keine automatisch angelegten Produktvorlagen.
- **P1-13-F02:** Ein Admin oder Büro-Nutzer legt einen Entwurf für Aufträge oder Projekte mit Name und optionaler Beschreibung an; zum Veröffentlichen ist mindestens ein gültiger Arbeits- oder Checklistenpunkt erforderlich.
- **P1-13-F03:** Ein Admin oder Büro-Nutzer sucht Vorlagen nach Name oder Beschreibung, filtert nach Zielart und Status und sieht archivierte Vorlagen erst nach bewusstem Einblenden.
- **P1-13-F04:** Ein Admin oder Büro-Nutzer ergänzt, bearbeitet, sortiert und entfernt Aufgaben oder Checklistenpunkte, kennzeichnet sie als erforderlich oder optional und gruppiert sie bei Bedarf.
- **P1-13-F05:** Ein Admin oder Büro-Nutzer hinterlegt an einem Punkt erwartete Nachweise mit Dokumentkategorie und Beschreibung; dabei entstehen weder Datei, Freigabe noch Unterschrift.
- **P1-13-F06:** Ein Admin oder Büro-Nutzer plant Material mit Menge, optionalem Lager, Abrechenbarkeit und Notiz und kann fehlendes Material oder Lager im registrierten Auswahlablauf anlegen; dadurch ändern sich weder Bestand noch Reservierung.
- **P1-13-F07:** Ein Admin oder Büro-Nutzer plant Fähigkeiten oder Nachweise aus dem Organisationswortschatz, kann fehlende Begriffe im registrierten Auswahlablauf anlegen und fordert bei Zertifikaten optional eine Bestätigung.
- **P1-13-F08:** Ein Admin oder Büro-Nutzer erklärt eine oder mehrere Abhängigkeiten zwischen Punkten; Selbstbezüge, fremde Punkte und Zyklen werden abgewiesen, die Abhängigkeiten sperren in P1-13 aber keine Ausführung.
- **P1-13-F09:** Ein Admin oder Büro-Nutzer speichert einen Entwurf; Feldfehler und Aktionsfehler erscheinen im Formular, ein Erfolg schließt den Dialog oder bestätigt auf der Seite per Banner.
- **P1-13-F10:** Ein Admin oder Büro-Nutzer veröffentlicht einen gültigen Entwurf als unveränderliche Version; fehlende Inhalte oder ungültige Referenzen verhindern die Veröffentlichung mit einer konkreten Korrekturangabe.
- **P1-13-F11:** Ein Admin oder Büro-Nutzer erstellt aus einer veröffentlichten Version einen neuen Entwurf; die alte Version und bereits erzeugte Arbeit bleiben unverändert.
- **P1-13-F12:** Ein Admin oder Büro-Nutzer archiviert oder reaktiviert eine Vorlage; archivierte Vorlagen fehlen in Anwendungsauswahlen, ihre Versionen und bereits erzeugte Arbeit bleiben erhalten.
- **P1-13-F13:** Ein Admin oder Büro-Nutzer sieht Versions- und Anwendungshistorie mit Akteur, Zeitpunkt, Ziel und verwendeter Versionsnummer.
- **P1-13-F14:** Ein Admin oder Büro-Nutzer wählt beim direkten Erstellen eines Auftrags oder Projekts optional eine veröffentlichte, zur Zielart passende Vorlage; ohne Auswahl bleibt das bestehende Erstellen unverändert.
- **P1-13-F15:** Dieselbe optionale Auswahl steht in Kunden- und Mitarbeiterkontexten, bei Projekt-Unteraufträgen und in der Kalendererstellung bereit; vorhandene Vorbelegungen bleiben unverändert.
- **P1-13-F16:** Ein Admin oder Büro-Nutzer wählt bei der Anfrageumwandlung optional eine passende Vorlage; schlägt die Anwendung fehl, bleibt die Anfrage offen und es bleiben weder Teilauftrag noch Teilprojekt zurück.
- **P1-13-F17:** Ein Admin oder Büro-Nutzer wendet auf einen noch nicht abgeschlossenen Auftrag oder ein noch nicht abgeschlossenes Projekt eine Vorlage nachträglich an und sieht vorher Version sowie Anzahlen der erzeugten Inhalte.
- **P1-13-F18:** Eine andere Vorlage oder neuere Version kann nach einer deutlichen Doppelungswarnung additiv angewendet werden; dieselbe Version auf demselben Ziel wird als Duplikat abgewiesen.
- **P1-13-F19:** Die Anwendung erzeugt normale Arbeits- und Checklistenpunkte, Nachweiserwartungen, Materialzeilen und Qualifikationsanforderungen mit Herkunft; sie reserviert keinen Bestand und erzeugt weder Termin, Planungsvorkommen, Zuweisung, Versand, Ist-Zeit, Dokument, Nachricht noch Freigabe.
- **P1-13-F20:** Ein Admin oder Büro-Nutzer bearbeitet alle erzeugten Inhalte später in den bestehenden Auftrags- oder Projektbereichen; spätere Änderungen an der Vorlage überschreiben diese Inhalte nicht.
- **P1-13-F21:** Bei einem Auftrag mit zugewiesenen Personen bewertet die Anwendung die resultierenden Qualifikationsanforderungen; eine Lücke verlangt den bestehenden begründeten und versionsgebundenen Übersteuerungsablauf.
- **P1-13-F22:** Eine zugewiesene Handwerkerin oder ein zugewiesener Handwerker sieht erzeugte Auftragspunkte in derselben einfachen Checkliste wie bisher, mit kompakten Hinweisen zu erforderlich oder optional, Nachweisen und Abhängigkeiten, und der Abschluss bleibt personell und zeitlich zugeordnet.
- **P1-13-F23:** Eine Projektvorlage erzeugt Punkte, Material und Qualifikationsanforderungen direkt am Projekt; sie erzeugt keine Unteraufträge und vererbt nichts automatisch an spätere Unteraufträge.
- **P1-13-F24:** Gibt es keine passende veröffentlichte Vorlage, zeigt die Auswahl einen erklärenden leeren Zustand und bietet Managern den Weg zur Vorlagenverwaltung; Entwürfe, Archive und fremde Organisationen erscheinen nie.
- **P1-13-F25:** Wurde ein referenziertes Material, Lager oder eine Fähigkeit stillgelegt, bricht die Anwendung vollständig ab, nennt die zu korrigierende Referenz und lässt Ziel und Wiederholungsversuch sauber bestehen.
- **P1-13-F26:** Handwerkerinnen und Handwerker sehen keine Vorlagenverwaltung und können keine Vorlage erstellen, ändern, veröffentlichen, archivieren oder anwenden; ein direkter Routen- oder Aktionsaufruf wird abgewiesen und Organisationsgrenzen bleiben dicht.
- **P1-13-F27:** Änderungen an Vorlagen und Anwendungen aktualisieren offene Manageransichten per Realtime; ein offener Dialog verliert keine Eingabe und erhält nach dem Schließen genau eine nachgeholte Aktualisierung.

## Data and authorization plan

- Add all schema changes in committed migrations. Apply DEV first with the linked CLI, verify it, regenerate TypeScript types once, and apply the identical SQL to production only after DEV acceptance.
- Enable RLS on every new public table. Authenticated users receive only the reads their role needs. Business writes run through authorized server actions and service-role-only RPCs.
- Use `app_private` SECURITY DEFINER helpers for membership and assigned-job checks. Policies do not query RLS-protected tables directly.
- Publish mutable operational tables through `supabase_realtime` with replica identity full. Keep append-only event tables outside the publication.
- Add work-template cache tags and invalidate the existing jobs, projects, inventory, and qualification tags after application.

## Test and release plan

- Add focused unit tests for draft normalization, publish validation, dependency cycles, merge rules, duplicate application, and qualification input composition.
- Add `tests/golden/p1-13.spec.ts` tagged `@P1-13`.
- Add `tests/audit/wave-2/p1-13.spec.ts` with `@AUDIT-W2 @AUDIT-W2-P1-13`, using only run-day offsets +70 through +74 at 06:00 Europe/Berlin.
- Map every clause of all 27 flows to executable assertions. Assert persisted state, organization isolation, and zero stock, schedule, dispatch, time, document, and attention side effects.
- Rerun affected Wave 1 audit tags `@AUDIT-W1-A1`, `@AUDIT-W1-A2`, and `@AUDIT-W1-A5`.
- Follow the per-slice ladder in `wave-2-audit.md`, including CodeRabbit fixes, re-freeze, a fresh production build and server, focused audit, and one final full Golden run.
- Close the catalog, Wave 2 ledger, both left-behind-state registers, gate log, feature contracts, technical docs, and roadmap before acceptance.

## Acceptance evidence

- Sixteen P1-13 migration files were applied to DEV first and production second with identical SQL. The pre-P1-13 idempotent baseline-reconciliation migration was also recorded on production before them so migration history remains ordered. All twelve new template/provenance tables had zero production rows after deployment; the Security Advisor returned no findings.
- TypeScript, lint, `git diff --check`, and the optimized production build passed. Unit tests passed 200/200. DEV database lint reported only the pre-existing unused `app_private.seed_inventory_defaults` parameter.
- The dedicated Golden spec passed 4/4. Affected Wave 1 audit tags A1, A2, and A5 passed; the final post-review A1 run passed 28/28.
- The Wave 2 ledger closes all confirmed flows: `27/27 mapped; 27/27 fully evidenced; 0 partial; 0 unmapped`.
- On the final frozen production build, `@AUDIT-W2-P1-13` passed 6/6 in 4.7 minutes (world `mt53i68y`), followed by the only full Golden run, 97/97 in 29.5 minutes (world `mt53oa0k`). Both worlds tore down with zero leftovers.
- Two CodeRabbit CLI reviews were dispositioned; valid concurrency, provenance, authorization, form-state, accessibility, query-bound, and test-integrity findings were fixed before the final freeze.
