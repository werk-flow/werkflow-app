# User Flow Catalog

Status: living — updated at every slice acceptance

## Purpose And Rules (for agents)

This file is the tactical, exhaustive answer to one question per slice: **what can a user actually DO in the app now that they could not do before, and what does the app do in response?**

It exists for two planned uses:

1. **Handover:** after Phase 1 (possibly in steps), this list explains every new capability to the customer in plain German without roadmap terminology.
2. **Audit coverage:** this list is the test inventory for the exhaustive audit batteries that exercise far more flows than the golden gates cover. Wave 1 audited it in wave-end sessions; **since Wave 2 every slice ships audit coverage for its own flow IDs as part of acceptance** (see `docs/plans/wave-2-audit.md` and testing rule 12), and the wave end only certifies.

Rules for maintaining this file:

- Every flow bullet has one immutable technical ID in inline code. `BASE-*` IDs identify the pre-Phase-1 baseline; `P1-XX-FNN` IDs identify slice flows. Keep an ID stable when wording changes, never reuse a retired ID, and assign a new ID to every new bullet. The ID is excluded when the German wording is reused for customer handover.
- Flows are written in **natural German** after the ID (they will be reused verbatim for handover). Headings and this preamble stay English like other developer artifacts.
- One flow ID = one bullet of 1–3 sentences: what the user does, step by step where needed, and what they see / what the app does in return. A bullet may contain several observable clauses; audit coverage of its ID means **every clause** is evidenced, not merely its headline behavior.
- Be **exhaustive**, not aspirational: list every new user-visible action, including small ones (a new filter, a new badge, a new warning, a new denial). Do not list planned or deferred behavior — only what works today.
- Prefix flows with the acting role where it matters: `Büro/Admin`, `Admin`, `Handwerker`, `Alle`.
- Update this file **as part of every slice's acceptance**, while the behavior is fresh — not retroactively at wave end. Since Wave 2, the slice's flow list is additionally **proposed up front**: the pre-implementation report drafts the bullets with provisional IDs for owner confirmation, implementation refines them, and acceptance finalizes them here together with the slice's rule-12 audit coverage.
- If a later slice changes an earlier flow, correct the earlier flow in place and note the changing slice in parentheses. The catalog describes the app as it is now, per the slice that introduced each capability.
- A material wording change reopens the affected flow ID's audit mapping until the assertion bodies have been rechecked against the complete revised bullet.
- This catalog intentionally repeats things that also live in feature docs. Feature docs describe the product model for agents; this file describes concrete user actions for humans. Do not "deduplicate" it away.
- For audit traceability, the set of relevant IDs here must equal the union of IDs mapped in the owning coverage ledger (a Wave 1 session's, or since Wave 2 a slice's). Mapping is many-to-many: one ledger row/test may cover multiple flow IDs, and one flow ID may need multiple rows/tests. Test count never needs to equal flow count. See testing rule 12, `docs/plans/wave-1-audit.md`, and `docs/plans/wave-2-audit.md`.

---

## Grundstock vor Phase 1 (Stand vor `P1-00`, 4. August 2026)

Diese Abschnitte beschreiben, was die App bereits konnte, bevor der Phase-1-Fahrplan begann. Sie sind der Ausgangspunkt, auf den alle Slices aufbauen.

### Organisation, Konten und Rollen

- `BASE-ORG-F01` — Alle: Nutzer können ein Konto anlegen, sich anmelden und abmelden.
- `BASE-ORG-F02` — Admin: kann eine Organisation erstellen und wird deren Inhaber. Nutzer ohne Admin-Mitgliedschaft können per Organisations-Code als „Handwerker/in“ beitreten. Wer bereits Mitglied ist, kann per Code nur weiteren Organisationen desselben Inhabers beitreten.
- `BASE-ORG-F03` — Admin/Büro: können neue Mitglieder als „Büro" oder „Handwerker/in" per E-Mail einladen; offene Einladungen sind sichtbar und können verwaltet werden. Der Eingeladene erhält eine E-Mail, folgt dem Link und landet nach der Anmeldung direkt in der Organisation.
- `BASE-ORG-F04` — Alle: wer mehreren Organisationen angehört, kann die aktive Organisation wechseln; alle Daten und Ansichten sind strikt auf die aktive Organisation begrenzt.
- `BASE-ORG-F05` — Admin/Büro: sehen unter `/mitarbeiter` die Mitgliederliste mit Rolle, aktuellem Stempelstatus und Tagesfortschritt sowie eine Detailseite je Mitglied. Handwerker haben keinen Zugriff auf diese Seite.
- `BASE-ORG-F06` — Rollenänderungen sind bewusst konservativ: niemand kann die eigene Rolle ändern, einen zweiten Admin ernennen oder sich selbst entfernen. Büro kann neue Büro-Mitglieder einladen, bestehende Büro- oder Admin-Mitglieder aber nicht ändern oder entfernen; bestehende Handwerker können verwaltet werden.

### Kunden

- `BASE-CUSTOMER-F01` — Büro/Admin: können unter `/kunden` Kunden anlegen (privat/gewerblich, E-Mail, Telefon, Adresse, Notizen), bearbeiten und löschen. Die Liste zeigt Anzahl, Typ und Kontaktdaten, hat eine Suche und aktualisiert sich live.
- `BASE-CUSTOMER-F02` — Büro/Admin: können auf der Kundendetailseite die Stammdaten direkt bearbeiten und sehen dort alle Aufträge und Projekte des Kunden. Neue Aufträge/Projekte lassen sich direkt im Kundenkontext anlegen.
- `BASE-CUSTOMER-F03` — Büro/Admin: können beim Anlegen eines Auftrags/Projekts einen bestehenden Kunden wählen oder ohne Umweg einen neuen anlegen.
- `BASE-CUSTOMER-F04` — Das Löschen eines Kunden entfernt nur die Zuordnung von bestehenden Aufträgen/Projekten — die Arbeit selbst bleibt erhalten.

### Aufträge und Projekte

- `BASE-WORK-F01` — Büro/Admin: können Aufträge und Projekte anlegen, bearbeiten und löschen — mit Titel, Beschreibung, Nummer, Kunde, Priorität (niedrig/mittel/hoch), geplantem Datum und Uhrzeit, geschätzter Dauer, Ort und Status (nicht bearbeitet / in Bearbeitung / fertig / geparkt).
- `BASE-WORK-F02` — Ein Auftrag kann eigenständig sein oder zu genau einem Projekt gehören; Projektaufträge erben den Projektkunden. Ein Projekt kann leer starten und später Aufträge erhalten.
- `BASE-WORK-F03` — Büro/Admin: können Aufträge bewusst mit Grund, Verantwortlichkeit und Wiedervorlage „parken". Ein Auftrag ohne geplantes Datum bleibt dagegen ungeplante offene Arbeit; das Entfernen eines Termins parkt ihn nicht. Geparkte Aufträge erscheinen auf der Aufträge-Seite und im Kalender jeweils im „Parkplatz" und tauchen nicht im Terminplan auf. Die zugewiesenen Mitarbeiter bleiben im geparkten Zustand erhalten, sehen den Auftrag aber nicht im Kalender. Das Verlassen des Parkplatzes und eine neue Einplanung sind getrennte bewusste Schritte.
- `BASE-WORK-F04` — Büro/Admin: können ein Projekt parken — dabei werden alle unfertigen Projektaufträge mitgeparkt und ihre Termine entfernt; bereits fertige Aufträge bleiben fertig.
- `BASE-WORK-F05` — Büro/Admin: können einem Auftrag ein oder mehrere Mitglieder zuweisen oder sie entfernen. Handwerker sehen ausschließlich ihre zugewiesenen Aufträge.
- `BASE-WORK-F06` — Büro/Admin: können am Auftrag eine sortierbare Checkliste (Arbeitsanweisungen) pflegen; zugewiesene Handwerker haken Punkte ab oder öffnen sie wieder — wer was wann zuletzt geändert hat, bleibt sichtbar.
- `BASE-WORK-F07` — Wird ein Auftrag auf „fertig" gesetzt, wird das tatsächliche Fertigstellungsdatum festgehalten. Projektstatus, Fortschritt und eine Termin-Ampel werden aus den Aufträgen abgeleitet; ein Manager kann den Status manuell übersteuern.
- `BASE-WORK-F08` — Alle: die `/auftraege`-Seite kombiniert Aufträge und Projekte, klappt Projektaufträge auf, trennt aktive Arbeit, Parkplatz und Archiv und bietet Suche, Status-/Typ-/Kunden-/Mitarbeiter-/Datumsfilter, Sortierung und pro Nutzer wählbare Spalten. Sie aktualisiert sich live.

### Kalender

- `BASE-CALENDAR-F01` — Alle: `/kalender` bietet Tages-, Wochen- und Monatsansicht. Manager sehen die Planung der ganzen Organisation, Handwerker ihre eigene.
- `BASE-CALENDAR-F02` — Büro/Admin: können Aufträge direkt im Kalender anlegen, per Drag & Drop verschieben, in der Länge ziehen und zwischen Mitarbeitern umhängen. Aufträge lassen sich per Drag & Drop in den Parkplatz und wieder heraus ziehen.
- `BASE-CALENDAR-F03` — Alle: erfasste Arbeitszeiten erscheinen als eigene Blöcke im selben Kalender, sichtbar getrennt von geplanter Arbeit. Manuelle Zeiteinträge können aus dem Kalender heraus angelegt werden.
- `BASE-CALENDAR-F04` — Alle: Filter nach Mitarbeitern, Arbeitszeiten und Aufträgen; ausstehende Zeitänderungen sind markiert; Detail-Dialoge öffnen sich per Klick. Der Kalender aktualisiert sich live.

### Zeiterfassung

- `BASE-TIME-F01` — Alle: können sich über die globale Stempeluhr ein- und ausstempeln sowie Pausen starten und beenden; der aktuelle Zustand (ausgestempelt / arbeitet / Pause) und die Tagessummen sind jederzeit sichtbar.
- `BASE-TIME-F02` — Handwerker: können sich direkt auf einen zugewiesenen Auftrag einstempeln und während einer laufenden Sitzung den Auftrag wechseln; die Zeit hängt dann am Auftrag und ist auf Auftrags- und Projektseiten sichtbar.
- `BASE-TIME-F03` — Niemand kann gleichzeitig in zwei Organisationen eingestempelt sein; beim Abmelden oder Entfernen aus der Organisation wird automatisch ausgestempelt.
- `BASE-TIME-F04` — Alle: die Wochenansicht zeigt je Tag Anwesenheit, Arbeit, Pause und Überstunden.
- `BASE-TIME-F05` — Alle: können manuelle Zeiteinträge für den aktuellen Tag nachtragen (mit Reihenfolge-/Überlappungsprüfung). Einträge von Handwerkern werden zur Freigabe vorgelegt; Admin/Büro erfassen im Rahmen ihrer Zuständigkeit direkt.
- `BASE-TIME-F06` — Admin/Büro: entscheiden ausstehende Zeiteinträge im Bereich „Anträge" (mit Sitzungspaaren und Auftragskontext) und filtern den Verlauf nach Zeitraum, Mitarbeiter und Status. Einträge können korrigiert, gelöscht und umgehängt werden.
- `BASE-TIME-F07` — Admin: wählt in den Einstellungen zwischen manuell gestempelten Pausen und einer automatischen Pausenregel (Schwelle/Dauer); Büro sieht die Regel. Regeländerungen schreiben abgeschlossene Tage nicht um.

### Dokumente

- `BASE-DOCUMENT-F01` — Büro/Admin: haben unter `/dokumente` eine zentrale Bibliothek mit manuellem Ordnerbaum, Drive-artiger Dateitabelle, Suche, Kategorie- und Verknüpfungsfiltern.
- `BASE-DOCUMENT-F02` — Büro/Admin: laden Dateien einzeln, als Stapel oder als ganze Ordner hoch (auch Drag & Drop), verschieben/kopieren sie über einen Ziel-Dialog und verknüpfen sie mit Aufträgen, Projekten, Kunden oder Mitarbeitern — ohne Dateikopien.
- `BASE-DOCUMENT-F03` — Büro/Admin: löschen in den Papierkorb, stellen wieder her oder löschen endgültig; wichtige Geschäftsdokument-Kategorien haben Versionen; jede Aktion landet in einer Audit-Historie. PDFs und Bilder öffnen sich im eingebauten Viewer.
- `BASE-DOCUMENT-F04` — Handwerker: sehen die Bibliothek nicht, können aber auf ihren zugewiesenen Aufträgen unter „Dokumente & Bilder" Dateien und Fotos hochladen, ansehen und herunterladen.

### Lager und Material

- `BASE-INVENTORY-F01` — Büro/Admin: haben unter `/inventar` die Lagerverwaltung mit den Ansichten „Alle Artikel", „Lager", „Geplant" und „Bewegungen" plus Suche und Filtern. Handwerker sehen diese Seite nicht.
- `BASE-INVENTORY-F02` — Büro/Admin: legen Katalogartikel an (Material, Verbrauchsmaterial, Werkzeug, Anlage — mit Einheit, SKU, Barcode, Hersteller, Lieferant, Preisen, Mindest-/Zielbestand) und pflegen eigene Lagerorte (Lager, Raum, Regal, Fahrzeug …).
- `BASE-INVENTORY-F03` — Büro/Admin: buchen manuelle Zu- und Abgänge je Lagerort; Bestand kann nie unter null fallen; jede Bewegung wird mit Vorher/Nachher, Grund und ggf. Auftrag festgehalten.
- `BASE-INVENTORY-F04` — Büro/Admin: importieren Katalog und Anfangsbestände per CSV mit Spaltenzuordnung; fehlende Kategorien, Lieferanten und Lagerorte werden dabei angelegt.
- `BASE-INVENTORY-F05` — Büro/Admin: planen Material auf Aufträgen/Projekten (ändert keinen Bestand) und sehen geplante, entnommene, zurückgegebene und abrechenbare Mengen getrennt; Projektseiten zeigen direktes Material, vererbtes Material aus Aufträgen und die Summe.
- `BASE-INVENTORY-F06` — Handwerker: sehen das Material ihrer zugewiesenen Aufträge, entnehmen geplantes Material, entnehmen ungeplant vorhandene Artikel und geben Material zurück — jede Aktion bucht sofort eine echte Bestandsbewegung.

---

## Wave 0 — Baseline und Infrastruktur

### `P1-00` — Baseline-Verifikation (2026-08-04)

Dieser Slice hat bewusst fast keine neuen Bedienflächen — er hat den Bestand geprüft und abgesichert. Eine Verbesserung ist trotzdem spürbar:

- `P1-00-F01` — Alle: mehrere Seiten (u. a. Dokumente und Lager), die sich vorher nur nach manuellem Neuladen aktualisierten, aktualisieren sich jetzt live, sobald jemand anderes etwas ändert.

### `P1-00a` — Dateispeicher (2026-08-04)

- `P1-00A-F01` — Alle: große Dateien (auch deutlich über 4–5 MB, z. B. Foto-Serien oder Pläne) lassen sich jetzt zuverlässig hochladen. Der Upload zeigt einen echten Fortschrittsbalken statt vorher bei großen Dateien kommentarlos zu scheitern.
- `P1-00A-F02` — Alle: Downloads öffnen sich über kurzlebige signierte Links direkt aus dem geschützten Speicher.

---

## Wave 1 — Kunden, Personal, Planung und gemeinsame Koordination

### `P1-01` — Ansprechpartner und Einsatzorte (2026-08-04)

- `P1-01-F01` — Büro/Admin: können je Kunde mehrere **Ansprechpartner** anlegen (Name, frei wählbare Rollenbezeichnung mit Vorschlägen, E-Mail, Telefon, Notizen), einen als „Hauptansprechpartner" markieren und Kontakte archivieren. Archivierte bleiben in einer eigenen Liste sichtbar, können wiederhergestellt werden und tauchen in Auswahl-Pickern nicht mehr auf.
- `P1-01-F02` — Büro/Admin: können je Kunde mehrere dauerhafte **Einsatzorte** anlegen (Name, strukturierte Adresse, Zugangshinweise wie Schlüssel/Parken, Notizen, optionaler Vor-Ort-Kontakt), einen als Standard markieren und Orte archivieren. Ein Klick übernimmt die Kundenadresse als ersten Einsatzort.
- `P1-01-F03` — Büro/Admin: können jedem Kunden eine manuelle, in der Organisation eindeutige **Kundennummer** geben.
- `P1-01-F04` — Büro/Admin: wählen beim Anlegen/Bearbeiten eines Auftrags Einsatzort und Ansprechpartner des Kunden aus; die Adresse des gewählten Orts wird automatisch ins Ort-Feld übernommen. Dieses Feld bleibt ein Schnappschuss — wird die Ort-Adresse später geändert, bleibt bei alten Aufträgen die damals gültige Adresse stehen.
- `P1-01-F05` — Büro/Admin: können am Projekt einen Standard-Einsatzort/-Ansprechpartner hinterlegen, der neue Projektaufträge vorbefüllt; jeder Auftrag kann davon abweichen. Wird der Kunde eines Auftrags/Projekts gewechselt, werden die Orts-/Kontaktverweise des alten Kunden automatisch entfernt.
- `P1-01-F06` — Handwerker: sehen auf dem zugewiesenen Auftrag den Einsatzort (Name, Adresse, Zugangshinweise) und den Ansprechpartner mit antippbarer Telefonnummer.
- `P1-01-F07` — Büro/Admin: die Suche auf `/kunden` findet Kunden jetzt auch über Namen ihrer Ansprechpartner und Adressen ihrer Einsatzorte.

### `P1-02` — Anfragen (2026-08-05)

- `P1-02-F01` — Büro/Admin: können unter `/anfragen` während eines Telefonats eine **Anfrage** erfassen: Pflicht ist nur die Zusammenfassung; dazu optional Details, Kategorie (Notfall, Störung/Reparatur, Wartung, Angebotsanfrage, Installation/Umbau, Garantie/Mangel, Allgemeine Frage, Sonstiges), Dringlichkeit, Quelle (Telefon, E-Mail, Vor Ort, Sonstiges), Eingangszeit, eine automatisch vorgeschlagene Nummer (`ANF-JJJJ-NNN`, überschreibbar) und eine zuständige Büro-Person.
- `P1-02-F02` — Büro/Admin: können unbekannte Anrufer mit Freitextfeldern (Name, Telefon, E-Mail, Adresse) festhalten und die Anfrage später einem bestehenden Kunden **zuordnen** oder den Anrufer mit einem Klick als neuen Kunden **anlegen** — alle Felder sind vorbefüllt, nichts wird neu getippt, die erfassten Anruferdaten bleiben als Historie auf der Anfrage.
- `P1-02-F03` — Büro/Admin: können Dateien direkt an die Anfrage anhängen (normales Dokumentsystem inkl. Papierkorb und Viewer).
- `P1-02-F04` — Büro/Admin: führen die Anfrage durch ihren Lebenszyklus: „Offen" → optional „In Klärung" → „Umgewandelt" oder „Geschlossen" (mit Pflicht-Grund: kein Bedarf mehr, abgelehnt, Duplikat, anderweitig gelöst, Sonstiges). Geschlossene Anfragen können wieder geöffnet werden; umgewandelte sind endgültig und schreibgeschützt.
- `P1-02-F05` — Büro/Admin: wandeln eine Anfrage **genau einmal** in einen neuen Auftrag oder ein Projekt um. Der Dialog ist komplett vorbefüllt (Titel ← Zusammenfassung, Beschreibung ← Details, Kunde/Kontakt/Einsatzort übernommen, Dringlichkeit → Priorität) und bleibt editierbar. Nichts wird dabei terminiert oder versendet; ein Auftrag ohne Datum bleibt ungeplante offene Arbeit (seit `P1-12`/`P1-14` entsteht kein passiver Park-Zustand mehr, siehe `BASE-WORK-F03` und `P1-12-F08`). Auftrag und Anfrage verlinken sich gegenseitig („Entstanden aus Anfrage …").
- `P1-02-F06` — Büro/Admin: die Anfragenliste filtert nach Aktiv/Umgewandelt/Geschlossen/Alle und durchsucht Zusammenfassung, Kunde, Anrufer, Nummer und Zuständige; die Detailseite zeigt alle Fakten, Anhänge und eine lückenlose Ereignis-Historie. Handwerker sehen den Bereich überhaupt nicht.

### `P1-03` — Personalakte und Beschäftigung (2026-08-05)

- `P1-03-F01` — Büro/Admin: pflegen auf dem Mitarbeiter-Detail den neuen Abschnitt **Personalien**: Personalnummer (Vorschlag `MA-NNN`, manuell überschreibbar, organisationsweit eindeutig), Telefon, private E-Mail, Adresse, Notfallkontakt, Eintritts-/Austrittsdatum, Notizen.
- `P1-03-F02` — Büro/Admin: pflegen unter **Beschäftigung** datumswirksame Versionen der Beschäftigungsbedingungen (Gültig-ab-Datum; Art: Vollzeit/Teilzeit/Ausbildung/Minijob/Sonstiges; Wochenstunden; Urlaubstage pro Jahr; Notiz). Aktuelle, frühere und geplante Versionen bleiben gleichzeitig sichtbar und sind als „Aktuell" / „Früher" / „Geplant" markiert.
- `P1-03-F03` — Büro/Admin: legen unter **Weiteres Personal** Personalakten für Menschen ohne App-Zugang an (künftige Mitarbeiter, Personal ohne Login) und laden später mit **„Zugang einladen"** ein Konto dazu ein — die eingelöste Einladung verbindet sich automatisch mit der bestehenden Akte, es entsteht kein Duplikat.
- `P1-03-F04` — Alle Personalzeilen tragen abgeleitete Status-Badges: „Aktiv" / „Geplant" / „Ausgeschieden" sowie „Mit Zugang" / „Eingeladen" / „Ohne Zugang".
- `P1-03-F05` — Wird ein Mitglied aus der Organisation entfernt, verschwindet die Person nicht mehr: die Personalakte bleibt als „Ausgeschieden" erhalten.
- `P1-03-F06` — Büro/Admin: sehen unter **Verlauf** jede Änderung an Akte und Bedingungen mit Zeitpunkt, handelnder Person und Vorher/Nachher-Werten.

### `P1-04` — Arbeitszeitmodelle, Feiertage, Betriebsruhe (2026-08-05)

- `P1-04-F01` — Büro/Admin: hinterlegen je Person unter **Arbeitszeitmodell** einen Wochenplan mit Minuten pro Wochentag (0 = kein Arbeitstag), wieder als Gültig-ab-Versionen — historische Tage behalten immer das damals gültige Modell.
- `P1-04-F02` — Admin: wählt in den Einstellungen das Bundesland für den **Feiertagskalender** (Bayern in zwei Varianten); Büro sieht die Auswahl. Admin und Büro pflegen zusätzlich **Betriebsruhe**-Tage (nur heute/zukünftig, Vergangenes wird nie umgeschrieben).
- `P1-04-F03` — Alle: Tagesziel, Fortschrittsring, Überstundengrenze und Wochen-Soll in der Zeiterfassung sowie die Fortschrittsbalken der Mitarbeiterliste rechnen jetzt mit dem echten Modell statt pauschal 8 Stunden. Feiertage und Betriebsruhe setzen das Tagessoll auf 0.
- `P1-04-F04` — Wo kein Modell hinterlegt ist, rechnet die App mit dem sichtbar gekennzeichneten Fallback **„Kein Arbeitszeitmodell hinterlegt – Standardziel 8 Stunden"** weiter; dieses Standardziel bleibt ausdrücklich unkonfiguriertes Verhalten und wird nicht als hinterlegtes Arbeitszeitmodell dargestellt.
- `P1-04-F05` — Alle: die Kalender-Monatsansicht zeigt Feiertage und Betriebsruhe als beschriftete, nicht anklickbare Ganztages-Hinweise.

### `P1-05` — Verantwortlichkeiten und Vertretungen (2026-08-06)

- `P1-05-F01` — Admin (Inhaber): konfiguriert unter **Einstellungen → Mitarbeiter** die Verantwortlichkeiten **Zeitfreigaben** und **Urlaubsfreigaben**: entweder bleibt der Rollen-Standard (Admin und Büro entscheiden wie bisher) oder es werden benannte Personen ausgewählt, die den Standard ersetzen — auch normale Handwerker, ohne dass sie sonst mehr Rechte bekommen. Büro sieht die Konfiguration nur lesend.
- `P1-05-F02` — Admin (Inhaber): sieht vor dem Speichern eine **„Auswirkung vor dem Speichern"**-Vorschau: wer gewinnt, behält oder verliert die Zuständigkeit. Erst die Bestätigung speichert.
- `P1-05-F03` — Admin (Inhaber): richtet für einen Zuständigen eine **Vertretung** mit Von-/Bis-Datum ein und beendet sie vorzeitig; die Vertretung erbt genau die Freigabe-Reichweite des Vertretenen und verliert sie mit Fensterende sofort — auch wenn ein Browser noch die alte Ansicht zeigt.
- `P1-05-F04` — Alle: sehen in den eigenen Einstellungen **„Meine Verantwortlichkeiten und Vertretungen"**, sofern sie betroffen sind; Mitglied-Details zeigen Managern eine Zusammenfassung.
- `P1-05-F05` — Neu spürbar in der Zeiterfassung: eigene manuelle Nachträge von Büro-Nutzern werden jetzt „ausstehend" statt still selbst genehmigt (Vier-Augen-Prinzip); niemand kann je den eigenen Eintrag freigeben. Nachträge des Admins bleiben als Wiederherstellungsweg direkt wirksam.

### `P1-06` — Urlaub (2026-08-06)

- `P1-06-F01` — Handwerker (alle Mitarbeiter): beantragen im Bereich **Urlaub & Abwesenheit** der Zeiterfassung eigenen Urlaub (Zeitraum; bei einem einzelnen Tag auch halbtags) und ziehen offene Anträge selbst zurück. Die App zeigt vor dem Absenden die berechneten Urlaubstage — Wochenenden, Feiertage, Betriebsruhe und freie Wochenplantage kosten nichts.
- `P1-06-F02` — Alle: der Urlaubssaldo ist echte Arithmetik: Anspruch (aus den Urlaubstagen der Beschäftigungsbedingung) − genommen = Rest, mit offenen Anträgen als separater Vorschau. Ohne hinterlegten Anspruch zeigt die App ehrlich „Kein Urlaubsanspruch hinterlegt" statt einer erfundenen Zahl; beantragen geht trotzdem.
- `P1-06-F03` — Urlaubsfreigabe-Zuständige: entscheiden Anträge im Tab **Anträge** — mit berechneten Tagen, Restanspruch, Abwesenheits-Überschneidungen und zugewiesenen Aufträgen im Zeitraum als Hinweisen. Eigene Anträge erscheinen nie in der eigenen Liste (Vier-Augen).
- `P1-06-F04` — Urlaubsfreigabe-Zuständige: stornieren bereits genehmigten Urlaub mit Pflicht-Grund — der rückwirkende Korrekturweg, der den Saldo nachvollziehbar wiederherstellt.
- `P1-06-F05` — Alle: genehmigter Urlaub senkt das Tagessoll (ganzer Tag → 0, halber Tag → halbes Soll) und erscheint im Kalender als ruhiger lila Eintrag „Urlaub – Name"; beantragter, noch nicht entschiedener Urlaub ist gestrichelt und mit „(angefragt)" markiert. Manager sehen alle, Mitarbeiter nur sich selbst.
- `P1-06-F06` — Wer an einem eigenen genehmigten Urlaubstag einstempeln will, wird mit verständlicher Meldung abgelehnt („Heute ist Urlaub genehmigt"); der Korrekturweg ist die Stornierung des Urlaubs.

### `P1-07` — Aufgaben und Benachrichtigungen (2026-08-07)

- `P1-07-F01` — Alle: die neue Seite **`/aufgaben`** bündelt, was einen selbst angeht: **Aufgaben** (nur Dinge, die man selbst jetzt entscheiden kann — ausstehende Zeitfreigaben, Urlaubsanträge, offene Anfragen mit Zuständigem und Alter), **Benachrichtigungen** (Entscheidungen über die eigenen Anträge) und **Meine Anträge** (eigene Urlaubsanträge mit Status und Gründen).
- `P1-07-F02` — Alle: jedes Element verlinkt direkt in die zuständige Oberfläche; entschieden wird weiterhin nur dort. Benachrichtigungen lassen sich einzeln oder alle auf einmal als gelesen markieren; wird eine Genehmigung später storniert, wird dieselbe Benachrichtigung wieder ungelesen statt doppelt zu erscheinen.
- `P1-07-F03` — Alle: die Seitenleisten-Badges stimmen jetzt: das Aufgaben-Badge zählt handlungsrelevante Punkte plus ungelesene Benachrichtigungen, das Zeiterfassungs-Badge zählt Zeit- **und** Urlaubsfreigaben — und nie etwas, das der Betrachter gar nicht entscheiden darf. Vertretungen sehen Aufgaben nur innerhalb ihres Vertretungsfensters.

### `P1-08` — Krankmeldung (2026-08-08)

- `P1-08-F01` — Alle Mitarbeiter: melden sich im Bereich **Krankmeldung** der Zeiterfassung selbst krank — auch rückwirkend, auch „bis auf Weiteres" ohne Enddatum, bei einem einzelnen Tag auch halbtags; Typ neutral: Krankheit, Kind krank, Sonstige Abwesenheit. Ein Diagnose-Feld gibt es bewusst nirgends.
- `P1-08-F02` — Alle Mitarbeiter: setzen/korrigieren das eigene Enddatum („wieder gesund ab …") und stornieren eine eigene irrtümliche Meldung.
- `P1-08-F03` — Büro/Admin: erfassen eine Krankmeldung telefonisch für eine Person auf deren Mitglied-/Personal-Detail (der übliche 7-Uhr-Anruf), korrigieren Daten mit Pflicht-Grund und führen den **Nachweis-Status** („Nachweis ausstehend" / „Nachweis erhalten") — ohne Datei-Upload, als reine Buchführung.
- `P1-08-F04` — Privatsphäre spürbar: der gemeinsame Kalender zeigt nur neutral „Abwesend – Name" (nie den Typ, offene Meldungen mit „bis auf Weiteres"); Kollegen sehen gar nichts; Typ und Nachweis-Stand existieren nur für die Person selbst und Admin/Büro.
- `P1-08-F05` — Alle: aktive Krankheit setzt das Tagessoll auf 0 (halber Tag → halb); das eigene Dashboard sagt „Krankmeldung – heute keine Sollarbeitszeit."
- `P1-08-F06` — Wer an einem Kranktag einstempelt, wird **nicht** blockiert: das Einstempeln gelingt mit sichtbarem Hinweis („Für heute liegt eine Krankmeldung vor …") — wer früher gesund ist, arbeitet real; die Korrektur ist das Enddatum.
- `P1-08-F07` — Beide Seiten werden benachrichtigt: Manager erfahren von Meldungen, die sie nicht selbst erfasst haben; die Person erfährt von Büro-Erfassungen und -Stornierungen der eigenen Meldung.

### `P1-09` — Teams, Qualifikationen, Eignung (2026-08-08/09)

- `P1-09-F01` — Büro/Admin: legen **Teams** an und pflegen ihre Mitglieder datumswirksam; Teams sind reine Planungs-Abkürzungen und geben niemandem Rechte. In Zuweisungs-Pickern (Auftragsdialoge und Kalender) wählt ein Klick auf ein Team alle zum jeweiligen Datum aktiven Mitglieder auf einmal aus; in Auftragsdialogen werden Mitglieder ohne Login dabei ausgewiesen übersprungen, während die Kalenderplanung sie seit `P1-11` als planbares Personal mit einplant.
- `P1-09-F02` — Büro/Admin: pflegen einen Organisations-Katalog aus **Fähigkeiten und Zertifikaten** und ordnen Personen Einträge mit Gültigkeitsdaten und Nachweis-Status zu. Mitarbeiter sehen die eigenen Einträge nur lesend.
- `P1-09-F03` — Büro/Admin: hängen an Aufträge **Anforderungen** aus diesem Katalog. Das Auftragsdetail erklärt je Anforderung, ob die zugewiesenen Personen sie decken — gedeckt, intern unbestätigt, abgelaufen, noch nicht gültig oder fehlend — und nennt die stärkste passende Person.
- `P1-09-F04` — Büro/Admin: jede Zuweisungsänderung — im Dialog, auf dem Detail oder per Kalender-Drag — prüft die Eignung zum geplanten Datum. Bei Lücken erscheint ein Bestätigungsdialog, der jede betroffene Person/Anforderung erklärt; fortfahren geht nur mit erfasstem Grund, Abbrechen stellt den Kalender still wieder her.
- `P1-09-F05` — Admin: kann eine optionale **Azubi-Warnung** einschalten (standardmäßig aus), die allein zugewiesene Auszubildende markiert.
- `P1-09-F06` — Zuständige: ablaufende Zertifikate erscheinen rechtzeitig als Aufgabe auf `/aufgaben`.

### `P1-10` — Kundenbeziehung, Follow-ups, Kommunikationspräferenzen (2026-08-10)

- `P1-10-F01` — Büro/Admin: das Kundendetail zeigt eine **Chronik** aus allem, was zu diesem Kunden wirklich passiert ist — Anfragen mit ihren Ereignissen, Aufträge/Projekte, Dokumente, Follow-ups, Präferenz-Änderungen — filterbar (Arbeit / Dokumente / Interne Aktivität), mit handelnder Person und je Eintrag einem direkten Sprung zur Quelle (Dokumente öffnen direkt im Viewer). Nichts wird doppelt gespeichert.
- `P1-10-F02` — Büro/Admin: legen **Follow-ups** („Wiedervorlagen") am Kunden an — mit Fälligkeitszeitpunkt, verantwortlicher Büro-Person und optionalem Bezug (Kontakt, Einsatzort, Anfrage, Auftrag, Projekt) — und erledigen oder verwerfen sie mit Attribution. Fällige und überfällige Follow-ups erscheinen dem Verantwortlichen als Aufgabe auf `/aufgaben`; verliert ein Follow-up seinen Verantwortlichen, sehen es alle Manager zur Neuzuweisung.
- `P1-10-F03` — Büro/Admin: hinterlegen **Kommunikationspräferenzen** je Kunde und je Ansprechpartner: pro Kanal (Telefon, E-Mail, SMS, Brief, persönlich) und Zweck (Termin/Service, Marketing, Notwendiges) erlaubt / nicht erlaubt / unbekannt, dazu bevorzugter Kontakt, Kontaktzeiten, Sprache, Barrierefreiheit und Kontaktsperren. Nicht Gepflegtes bleibt sichtbar „unbekannt".
- `P1-10-F04` — Büro/Admin: Telefon-/E-Mail-Aktionen im Kundenkontext warnen bei falscher Person, unerwünschtem Kanal oder Kontaktsperre; wer trotzdem fortfährt, erfasst eine begründete, zugeordnete Ausnahme. Die App verschickt weiterhin selbst nichts und behauptet keine rechtliche Bewertung.

### `P1-11` — Serien-, Mehrtages- und Besuchsplanung (2026-08-13)

- `P1-11-F01` — Büro/Admin: planen im Kalender **Besuche** für Aufträge und **interne Einträge** (Interne Arbeit, Besprechung, Schulung, Sonstiges) — mit Uhrzeit oder ganztägig, mehrtägig, über Mitternacht, einmalig oder als Serie (täglich, wöchentlich, monatlich). Ein Auftrag kann mehrere Besuche haben, ohne dupliziert zu werden.
- `P1-11-F02` — Büro/Admin: Serien reichen zunächst 18 Monate in die Zukunft und lassen sich per Klick um je sechs Monate verlängern. Ungültige Monatstermine (z. B. 31. im Februar) fallen aus statt zu verrutschen.
- `P1-11-F03` — Büro/Admin: beim Bearbeiten eines Serientermins wählt man **„Nur dieser Termin"**, **„Dieser und zukünftige"** oder **„Ganze Serie"**; Vergangenes und bereits Begonnenes wird nie umgeschrieben. Einzelne Termine lassen sich ausfallen lassen oder stornieren und bleiben nachvollziehbar sichtbar statt zu verschwinden.
- `P1-11-F04` — Büro/Admin: jede Planung prüft **Kapazität** (Wochenplan, Feiertage, Betriebsruhe, genehmigter Urlaub, Krankheit, schwebende Urlaubsanträge, Überschneidungen mit anderer geplanter Arbeit) und **Qualifikation** zum Termindatum. Warnungen erklären jede betroffene Person und jedes Datum; fortfahren geht nur mit Grund, und wenn sich die Fakten seit der Warnung geändert haben, verlangt die App eine neue Entscheidung.
- `P1-11-F05` — Handwerker: sehen im Kalender genau die Termine, die ihnen zugewiesen sind — auch Personal ohne Login kann verplant werden (sichtbar für Manager). Geplante Termine erzeugen niemals automatisch Ist-Arbeitszeit.

### `P1-12` — Einsätze, Bestätigung, Parkplatz-Kontext, Kundenzusagen, Batch-Umplanung (2026-08-14)

**Einsätze senden und bestätigen:**

- `P1-12-F01` — Büro/Admin: öffnen im Kalender über den Kopfzeilen-Schalter das **„Einsätze"**-Panel. Es zeigt je geplantem Besuch die Empfänger mit ihrem Stand: ausstehend, bestätigt, übernommen, Rückfrage — oder „nicht möglich" für Personal ohne Login, das nie automatisch als bestätigt gilt.
- `P1-12-F02` — Büro/Admin: senden für einen Besuch (oder einen noch unterminierten Auftrag) einen **Einsatz** mit optionalem Hinweistext. Der Dialog zeigt vorher das ehrliche **Bereitschaftsbild**: Kapazität und Qualifikation aus der Planungsprüfung, Einsatzort/Zugang, Anfahrt (nur aus belegbaren Fakten, sonst „nicht bewertet"), Materialbedarf gegen den Bestand (immer als „nicht reserviert" gekennzeichnet) und Werkzeug (immer „nicht bewertet"). Unbekanntes wird nie grün angezeigt.
- `P1-12-F03` — Handwerker: sehen auf dem zugewiesenen Auftragsdetail die Karte **„Mein Einsatz"** mit Termin, Ort und Hinweis und **bestätigen** den Einsatz mit einem Tippen oder stellen eine **Rückfrage** mit Text. Beides geht auch über `/aufgaben`, wo ausstehende Bestätigungen als eigene Aufgabe erscheinen.
- `P1-12-F04` — Wird ein bestätigter Einsatz danach wesentlich geändert — verschoben, umbesetzt, anderer Ort, per Batch bewegt —, wird die Bestätigung automatisch ungültig: der Empfänger sieht wieder „ausstehend" mit dem neuen Stand und muss erneut bestätigen. Der Hinweistext selbst ist nach dem Senden unveränderlich; eine geänderte Anweisung erreicht die Person über Zurückziehen und erneutes Senden. Eine reine Empfängeränderung lässt bestehende Bestätigungen der Unveränderten nachvollziehbar weiterleben.
- `P1-12-F05` — Büro/Admin: offene Rückfragen erscheinen als Manager-Aufgabe und im Einsätze-Panel. Der Manager löst sie, indem er den Plan anpasst (die Änderung erzeugt automatisch den neuen Stand) oder den Plan **mit Begründung beibehält** — auch dann muss der Handwerker den unveränderten Plan noch einmal aktiv bestätigen.
- `P1-12-F06` — Büro/Admin: können einen Einsatz stornieren; das Parken eines Auftrags storniert seine aktiven Einsätze automatisch und sichtbar. Wird ein Einsatz für einen ungeplanten Auftrag gesendet und der Auftrag später eingeplant, bleibt es derselbe Einsatz mit nachvollziehbarem Übergang.
- `P1-12-F07` — Eine Bestätigung bedeutet nur „gesehen und angenommen" — sie erzeugt keine Arbeitszeit, keine Anwesenheit und keine Kundenzusage.

**Parkplatz mit Kontext:**

- `P1-12-F08` — Büro/Admin: parken Aufträge atomar mit dem gemeinsamen **Park-Kontext**: ein Grund aus dem P1-14-Blockervokabular plus Details, verantwortliche Person und Wiedervorlage-Datum. Beim Parken öffnet die App diesen Kontext vor dem Speichern; ein passiver geparkter Zustand ohne Verantwortlichkeit entsteht nicht mehr neu.
- `P1-12-F09` — Alle geparkten Aufträge ohne erfassten Kontext (auch alle aus der Zeit davor) zeigen ehrlich **„Kontext fehlt (Altbestand)"** — nichts wird erfunden.
- `P1-12-F10` — Verantwortliche: eine überfällige Wiedervorlage erscheint als Aufgabe auf `/aufgaben`.
- `P1-12-F11` — Wird ein geparkter Auftrag eingeplant, wechselt ein bestehender Einsatz nachvollziehbar auf den Termin; Planung löst den Park-Kontext nicht stillschweigend. Entparken bleibt ein eigener, begründeter Schritt.
- `P1-12-F12` — Büro/Admin: können einen geparkten Auftrag direkt aus dem Parkplatz heraus als Einsatz an die zugewiesenen Mitarbeiter senden.

**Kundenzusagen:**

- `P1-12-F13` — Büro/Admin: erfassen an einem geplanten Besuch eine **Kundenzusage**: zugesagter Tag, optionales Ankunftsfenster, wie sie zustande kam (telefonisch, vor Ort, schriftlich, sonstige). Das dokumentiert nur die interne Notiz einer Absprache — die App verschickt nichts an den Kunden.
- `P1-12-F14` — Wird der Besuch später verschoben, bleibt die Zusage unverändert stehen und der Besuch zeigt sichtbar, dass Plan und Zusage **nicht mehr übereinstimmen**. Das Büro löst das ausdrücklich: neue Zusage erfassen (die alte bleibt als abgelöst nachvollziehbar) oder die Zusage mit Grund zurückziehen.

**Batch-Umplanung:**

- `P1-12-F15` — Büro/Admin: starten im Einsätze-Panel den **Auswahlmodus**, wählen mehrere zukünftige Besuche per Checkbox (auch über Aufträge hinweg) und geben eine Verschiebung an — ganze Tage und/oder eine neue Uhrzeit.
- `P1-12-F16` — Vor der Ausführung zeigt eine **Vorschau** je Termin den alten und neuen Zeitpunkt, entstehende Kapazitäts-/Qualifikationskonflikte, wie viele Bestätigungen ungültig würden und welche Kundenzusagen betroffen wären. Konflikte lassen sich wie überall nur mit Grund übersteuern.
- `P1-12-F17` — Die Ausführung ist **alles oder nichts**: entweder werden alle gewählten Termine verschoben oder keiner. Ausgewählte Serientermine werden dabei zu Einzel-Ausnahmen ihrer Serie; die Historie jedes Termins bleibt erhalten.

### `P1-13` — Versionierte Arbeitsvorlagen (2026-08-23)

- `P1-13-F01` — Büro/Admin: öffnen **Arbeitsvorlagen**, sehen in einer Organisation ohne Vorlagen den leeren Zustand „Erste Arbeitsvorlage anlegen“ und erhalten keine automatisch angelegten Produktvorlagen.
- `P1-13-F02` — Büro/Admin: legen einen Entwurf für Aufträge oder Projekte mit Name und optionaler Beschreibung an; zum Veröffentlichen ist mindestens ein gültiger Arbeits- oder Checklistenpunkt erforderlich.
- `P1-13-F03` — Büro/Admin: suchen Vorlagen nach Name oder Beschreibung, filtern nach Zielart und Status und sehen archivierte Vorlagen erst nach bewusstem Einblenden.
- `P1-13-F04` — Büro/Admin: ergänzen, bearbeiten, sortieren und entfernen Aufgaben oder Checklistenpunkte, kennzeichnen sie als erforderlich oder optional und gruppieren sie bei Bedarf.
- `P1-13-F05` — Büro/Admin: hinterlegen an einem Punkt erwartete Nachweise mit Dokumentkategorie und Beschreibung; dabei entstehen weder Datei, Freigabe noch Unterschrift.
- `P1-13-F06` — Büro/Admin: planen Material mit Menge, optionalem Lager, Abrechenbarkeit und Notiz und können fehlendes Material oder Lager im Auswahlablauf anlegen; dadurch ändern sich weder Bestand noch Reservierung.
- `P1-13-F07` — Büro/Admin: planen Fähigkeiten oder Zertifikate aus dem Organisationswortschatz, können fehlende Begriffe im Auswahlablauf anlegen und fordern bei Zertifikaten optional eine Bestätigung.
- `P1-13-F08` — Büro/Admin: erklären eine oder mehrere Voraussetzungen zwischen Punkten; Selbstbezüge, fremde Punkte und Zyklen werden abgewiesen, die Abhängigkeit sperrt in P1-13 aber keine Ausführung.
- `P1-13-F09` — Büro/Admin: speichern einen Entwurf; Feld- und Aktionsfehler erscheinen im Formular, ein Erfolg schließt den Dialog oder bestätigt auf der Seite per Banner.
- `P1-13-F10` — Büro/Admin: veröffentlichen einen gültigen Entwurf als unveränderliche Version; fehlende Inhalte oder ungültige Referenzen verhindern die Veröffentlichung mit einer konkreten Korrekturangabe.
- `P1-13-F11` — Büro/Admin: erstellen aus einer veröffentlichten Version einen neuen Entwurf; die alte Version und bereits erzeugte Arbeit bleiben unverändert.
- `P1-13-F12` — Büro/Admin: archivieren oder reaktivieren eine Vorlage; archivierte Vorlagen fehlen in Anwendungsauswahlen, ihre Versionen und bereits erzeugte Arbeit bleiben erhalten.
- `P1-13-F13` — Büro/Admin: sehen Versions- und Anwendungshistorie mit Akteur, Zeitpunkt, Ziel und verwendeter Versionsnummer.
- `P1-13-F14` — Büro/Admin: wählen beim direkten Erstellen eines Auftrags oder Projekts optional eine veröffentlichte, zur Zielart passende Vorlage; ohne Auswahl bleibt das bestehende Erstellen unverändert.
- `P1-13-F15` — Büro/Admin: erhalten dieselbe optionale Auswahl in Kunden- und Mitarbeiterkontexten, bei Projekt-Unteraufträgen und in der Kalendererstellung; vorhandene Vorbelegungen bleiben unverändert.
- `P1-13-F16` — Büro/Admin: wählen bei der Anfrageumwandlung optional eine passende Vorlage; schlägt die Anwendung fehl, bleibt die Anfrage offen und es bleiben weder Teilauftrag noch Teilprojekt zurück.
- `P1-13-F17` — Büro/Admin: wenden auf einen noch nicht abgeschlossenen Auftrag oder ein noch nicht abgeschlossenes Projekt eine Vorlage nachträglich an und sehen vorher Version sowie Anzahlen der erzeugten Inhalte.
- `P1-13-F18` — Büro/Admin: können eine andere Vorlage oder neuere Version nach einer deutlichen Doppelungswarnung additiv anwenden; dieselbe Version auf demselben Ziel wird als Duplikat abgewiesen.
- `P1-13-F19` — Die Anwendung erzeugt normale Arbeits- und Checklistenpunkte, Nachweiserwartungen, Materialzeilen und Qualifikationsanforderungen mit Herkunft; sie reserviert keinen Bestand und erzeugt weder Termin, Planungsvorkommen, Zuweisung, Versand, Ist-Zeit, Dokument, Nachricht noch Freigabe.
- `P1-13-F20` — Büro/Admin: bearbeiten alle erzeugten Inhalte später in den bestehenden Auftrags- oder Projektbereichen; spätere Änderungen an der Vorlage überschreiben diese Inhalte nicht.
- `P1-13-F21` — Bei einem Auftrag mit zugewiesenen Personen bewertet die Anwendung die resultierenden Qualifikationsanforderungen; eine Lücke verlangt den bestehenden begründeten und versionsgebundenen Übersteuerungsablauf.
- `P1-13-F22` — Zugewiesene Handwerker sehen erzeugte Auftragspunkte in derselben einfachen Checkliste wie bisher, mit kompakten Hinweisen zu erforderlich oder optional, Nachweisen und Abhängigkeiten; der Abschluss bleibt personell und zeitlich zugeordnet.
- `P1-13-F23` — Eine Projektvorlage erzeugt Punkte, Material und Qualifikationsanforderungen direkt am Projekt; sie erzeugt keine Unteraufträge und vererbt nichts automatisch an spätere Unteraufträge.
- `P1-13-F24` — Gibt es keine passende veröffentlichte Vorlage, zeigt die Auswahl einen erklärenden leeren Zustand und bietet Managern den Weg zur Vorlagenverwaltung; Entwürfe, Archive und fremde Organisationen erscheinen nie.
- `P1-13-F25` — Wurde ein referenziertes Material, Lager oder eine Fähigkeit stillgelegt, bricht die Anwendung vollständig ab, nennt die zu korrigierende Referenz und lässt Ziel und Wiederholungsversuch sauber bestehen.
- `P1-13-F26` — Handwerker sehen keine Vorlagenverwaltung und können keine Vorlage erstellen, ändern, veröffentlichen, archivieren oder anwenden; ein direkter Routen- oder Aktionsaufruf wird abgewiesen und Organisationsgrenzen bleiben dicht.
- `P1-13-F27` — Änderungen an Vorlagen und Anwendungen aktualisieren offene Manageransichten per Realtime; ein offener Dialog verliert keine Eingabe und erhält nach dem Schließen genau eine nachgeholte Aktualisierung.

### `P1-14` — Arbeitsstand, Blocker, Voraussetzungen und Einsatzbereitschaft (2026-08-23)

- `P1-14-F01` — Alle berechtigten Nutzer sehen am Auftrag den kanonischen Arbeitsstand getrennt von Planung, Einsatzbereitschaft, Blockern und Parkplatz; mehrere gleichzeitig wahre Fakten überschreiben einander nicht.
- `P1-14-F02` — Alle berechtigten Nutzer sehen aus dem aktuellen Arbeitsstand, offenen Blockern und Voraussetzungen genau einen klaren nächsten Schritt.
- `P1-14-F03` — Ein neuer Auftrag beginnt als „Nicht begonnen“; ein unangetasteter Altauftrag behält seine bisherige sichtbare Bedeutung und wird als Altbestand ohne erfundenen Verlauf gekennzeichnet.
- `P1-14-F04` — Die Auftrags- und Projektliste zeigt die kanonischen Bezeichnungen und trennt aktive Arbeit, Parkplatz und abgeschlossene Arbeit weiterhin nachvollziehbar.
- `P1-14-F05` — Büro/Admin filtern aktive Arbeit nach „Nicht begonnen“, „In Ausführung“ oder „Unterbrochen“; Suche, weitere Filter und Sortierung wirken weiter auf denselben Bestand.
- `P1-14-F06` — Büro/Admin führen nur erlaubte Zustandswechsel aus; unzulässige Sprünge werden serverseitig abgewiesen und hinterlassen weder Teilstand noch Ereignis.
- `P1-14-F07` — Ein zugewiesener Handwerker kann einen Auftrag starten, unterbrechen, fortsetzen oder als ausgeführt abschließen, aber nicht stornieren, übergeben, parken oder einen terminalen Stand wieder öffnen.
- `P1-14-F08` — Büro/Admin können Arbeit stornieren und terminale Arbeit begründet wieder öffnen; „Storniert“ bleibt von Parkplatz und bloßer Terminverschiebung getrennt.
- `P1-14-F09` — Wechsel, die eine Begründung verlangen, lassen sich ohne mindestens drei Zeichen nicht speichern; die Datenbank speichert Grund, Akteur und Zeitpunkt.
- `P1-14-F10` — Zwei gleichzeitig geöffnete Ansichten können nicht dieselbe Version überschreiben: die zweite Änderung erhält einen konkreten Versionskonflikt und lädt anschließend den aktuellen Stand.
- `P1-14-F11` — Eine Realtime-Änderung aktualisiert eine ruhende Detailansicht; während eines offenen Dialogs bleibt die Eingabe bestehen und eine sichtbare Aufforderung holt den aktuellen Stand nach.
- `P1-14-F12` — Nach erfolgreicher Änderung schließt der Dialog, ein Banner bestätigt den Abschluss, und ein Neuladen zeigt den persistierten statt eines optimistischen Standes.
- `P1-14-F13` — Büro/Admin erfassen mehrere gleichzeitige Blocker mit festem Grund, Details zum nächsten Schritt, verantwortlicher Person und Wiedervorlagedatum.
- `P1-14-F14` — Ein zugewiesener Handwerker meldet am eigenen Auftrag einen Blocker nur für sich selbst mit Wiedervorlage am heutigen Berliner Geschäftstag; fremde Aufträge und Personen bleiben gesperrt.
- `P1-14-F15` — Der Grund „Sonstiges“ verlangt erklärende Details; ungültige oder organisationsfremde Verantwortliche, fehlende Daten und falsche Zielkombinationen werden abgewiesen.
- `P1-14-F16` — Offene Blocker machen „Nicht startbereit“ und „Offene Blocker klären“ sichtbar und verhindern den Start atomar, ohne den vorhandenen Ausführungsstand zu verbergen.
- `P1-14-F17` — Die verantwortliche Person oder Büro/Admin löst einen Blocker mit Begründung; Version, Lösungsnotiz, Akteur und Zeitpunkt bleiben im unveränderlichen Verlauf.
- `P1-14-F18` — Ein gelöster Blocker kann durch Büro/Admin begründet wieder geöffnet werden; die alte Lösung bleibt im Ereignisverlauf und eine veraltete Version wird nicht überschrieben.
- `P1-14-F19` — Ein heute fälliger oder überfälliger offener Blocker erscheint einmal in der gemeinsamen Aufgaben-Pipeline mit Ziel-Link, Verantwortlichkeit und versionsstabiler Lesemarkierung.
- `P1-14-F20` — Wird ein Blocker bearbeitet, gelöst oder wieder geöffnet, aktualisiert sich derselbe Aufmerksamkeitseintrag beziehungsweise verschwindet; es entsteht keine zweite Inbox oder gespeicherte Aufgabenkopie.
- `P1-14-F21` — Büro/Admin parken einen Auftrag oder ein Projekt atomar mit Grund, Details, verantwortlicher Person und Wiedervorlage; ein Parkplatz-Blocker und die Planungslücke bleiben getrennte Fakten.
- `P1-14-F22` — Beim Parken eines Projekts werden offene Unteraufträge in derselben Transaktion geparkt, ohne ihren Ausführungsstand zu ändern; ein Fehler rollt die gesamte Operation zurück.
- `P1-14-F23` — Büro/Admin verlassen den Parkplatz mit Begründung; der Parkplatz-Blocker wird gelöst, aber ein neuer Termin bleibt ein eigener bewusster Planungsschritt.
- `P1-14-F24` — Bestehende P1-12-Parkkontexte und ihre Ereignisse erscheinen im einen neuen Blockermodell; die alten operativen Tabellen und das alte Schreib-RPC bestehen nicht parallel fort.
- `P1-14-F25` — Ein geparkter Altauftrag ohne Kontext bleibt ehrlich als „Kontext fehlt (Altbestand)“ sichtbar; die Migration erfindet weder Grund, Person, Wiedervorlage noch Ereignis.
- `P1-14-F26` — Büro/Admin verknüpfen einen Auftrag oder ein Projekt mit einem vorausgehenden Auftrag, Projekt oder bestehenden Arbeits-/Checklistenpunkt derselben Organisation.
- `P1-14-F27` — Büro/Admin deklarieren eine noch nicht strukturierte Freigabe, Lieferung, Einsatzort-Bedingung oder ein Fremdgewerk als benannte Voraussetzung, ohne ein P1-15-Artefakt vorzutäuschen.
- `P1-14-F28` — Für jede Voraussetzung wählen Büro/Admin „Blockiert den Start“, „Blockiert den Abschluss“ oder „Nur Hinweis“; der Server erzwingt nur die gewählte Wirkung.
- `P1-14-F29` — Eine offene Startvoraussetzung verhindert den Start atomar und erklärt die nächste Aktion; eine Warnung bleibt sichtbar, verhindert den Wechsel aber nicht.
- `P1-14-F30` — Eine offene Abschlussvoraussetzung verhindert „Ausführung abgeschlossen“, solange keine begründete Manager-Ausnahme verwendet wird.
- `P1-14-F31` — Eine verknüpfte Arbeitsvoraussetzung gilt aus ihrem kanonischen Vorgängerstand als erfüllt und wird bei dessen Wiederöffnung automatisch wieder offen, ohne die Deklaration umzuschreiben.
- `P1-14-F32` — Die bestehenden P1-13-Punktvoraussetzungen sperren den Abschluss eines Nachfolgers, solange der Vorgänger offen ist; Wiederöffnen wirkt sofort über denselben Checklistenpunkt.
- `P1-14-F33` — Selbstbezüge, Organisationssprünge und direkte oder mehrstufige Zyklen zwischen Aufträgen und Projekten werden serverseitig abgewiesen.
- `P1-14-F34` — Eine Stornierung erfüllt eine Arbeitsvoraussetzung nicht stillschweigend; die betroffene Arbeit bleibt als offene Voraussetzung sichtbar und verlangt eine bewusste Änderung.
- `P1-14-F35` — Büro/Admin markieren nur deklarierte Bedingungen begründet als erfüllt, offen oder erlassen; verknüpfte Arbeits- und Punktzustände bleiben aus ihrem Ursprung abgeleitet.
- `P1-14-F36` — Büro/Admin entfernen eine Voraussetzung begründet; aktuelle Zeile, Version und unveränderlicher Ereignisverlauf zeigen, was wann beendet wurde.
- `P1-14-F37` — Die Detailansicht verwendet dieselbe Einsatzbereitschaftsprojektion wie der Versand und zeigt Kapazität, Qualifikation, Einsatzort, Reise, Material und Werkzeug jeweils als erfüllt, prüfen oder nicht bewertet.
- `P1-14-F38` — Fehlende Konfiguration, fehlender Einsatzort und nicht vorhandene belastbare Fakten bleiben ausdrücklich unbekannt oder nicht bewertet und werden nie als bereit dargestellt.
- `P1-14-F39` — Ein Ladefehler der Einsatzbereitschaft erscheint als Fehler und lässt keine Dimension stillschweigend bestehen; ein späteres Neuladen bewertet aus den aktuellen Quellen neu.
- `P1-14-F40` — Kein Materialbedarf bleibt ein wahrer neutraler Fakt; geplanter Bedarf heißt „nicht reserviert“, Fehlbestand warnt, und P1-14 erzeugt weder Reservierung noch Bestandsbewegung.
- `P1-14-F41` — Werkzeug bleibt bis P1-32 „nicht bewertet“; P1-14 erfindet weder Verfügbarkeit noch Besitz oder Übergabe.
- `P1-14-F42` — Die Live-Einsatzbereitschaft kann sich mit Planung, Qualifikation, Einsatzort oder Material ändern; ein Zustandsereignis speichert zusätzlich den genau verwendeten Prüfstand mit Fingerabdruck.
- `P1-14-F43` — Erforderliche offene Arbeits-/Checklistenpunkte und wieder geöffnete Vorgänger verhindern den Abschluss der Ausführung serverseitig.
- `P1-14-F44` — Eine laufende auftragsbezogene Zeiterfassung verhindert den Abschluss; das Beenden der Zeit ändert den Arbeitsstand nicht automatisch auf abgeschlossen.
- `P1-14-F45` — Ein Projekt kann erst ausgeführt abgeschlossen werden, wenn seine nicht stornierten Unteraufträge abgeschlossen oder übergeben sind; leere Projekte bleiben ausdrücklich nicht begonnen.
- `P1-14-F46` — Büro/Admin übersteuern eine prüfbare Abschlusslücke nur mit Grund; Ereignis, Version, Gate-Snapshot und Fingerabdruck machen die Ausnahme nachvollziehbar.
- `P1-14-F47` — Noch nicht vorhandene Quellen für Messungen, Mängel, Material-Ist, Übergabenachweise, Unterschriften und Kundenpakete heißen „nicht prüfbar“ und gelten nie ohne bewusste Manager-Ausnahme als erfüllt.
- `P1-14-F48` — „Ausführung abgeschlossen“ beendet die Feldarbeit; „Übergeben“ ist ein weiterer managergeführter, begründeter Schritt und bleibt von der tieferen P1-17-Übergabe getrennt.
- `P1-14-F49` — Ein Projekt ohne explizite Übersteuerung leitet seinen sichtbaren Arbeitsstand aus den Unteraufträgen ab; gemischte Zustände werden deterministisch als laufende oder unterbrochene Arbeit zusammengefasst.
- `P1-14-F50` — Büro/Admin setzen einen Projektstand nur mit Grund und Version; die Übersteuerung kaskadiert nicht in Unteraufträge und bleibt sichtbar vom automatisch abgeleiteten Stand getrennt.
- `P1-14-F51` — Büro/Admin löschen eine Projektübersteuerung begründet; danach folgt das Projekt wieder den aktuellen Unteraufträgen und der Wechsel bleibt im Verlauf.
- `P1-14-F52` — Ein Planungsvorkommen macht Arbeit „Geplant“, seine Verschiebung ändert nur Planung, und das Entfernen des letzten Vorkommens ändert weder Ausführung noch erzeugt es automatisch einen Parkplatz-Blocker.
- `P1-14-F53` — Das erste Einstempeln oder Fortsetzen nach einer Pause auf einem zugewiesenen Auftrag wechselt „Nicht begonnen“ oder „Unterbrochen“ atomar zu „In Ausführung“ und protokolliert den automatischen Ursprung.
- `P1-14-F54` — Einstempeln auf blockierte, stornierte, abgeschlossene oder übergebene Arbeit scheitert zusammen mit dem Zeiteintrag; es bleibt kein Zeit- oder Zustands-Teilstand.
- `P1-14-F55` — Versand, Bestätigung, Herausforderung oder Stornierung einer Einsatzanweisung ändern weder Arbeitsstand noch Blocker; ihre Einsatzbereitschaft bleibt ein eigener Versand-Snapshot.
- `P1-14-F56` — Eine Anfrageumwandlung erzeugt einen neuen Auftrag im Standardstand „Nicht begonnen“, aber keine erfundene Historie, Bereitschaft, Blocker, Voraussetzung oder Übergabe.
- `P1-14-F57` — Jeder Zustandswechsel und jede Übersteuerung trägt Datenbankzeit, Akteur, vorherigen und neuen Stand, Versionspaar, erforderlichen Grund und den verwendeten Prüfstand; Ereignisse sind unveränderlich.
- `P1-14-F58` — Aufträge oder Projekte mit Lebenszyklusverlauf lassen sich nicht hart löschen; normale bestehende Daten ohne Verlauf behalten ihren bisherigen Löschpfad.
- `P1-14-F59` — Ohne Blocker oder zusätzliche Voraussetzungen zeigt die Detailansicht ruhige leere Zustände und bleibt für Organisationen nutzbar, die die neuen Funktionen nicht verwenden.
- `P1-14-F60` — RLS und Serveraktionen lassen Manager nur Organisationsarbeit und Handwerker nur zugewiesene Aufträge beziehungsweise eigene Blocker sehen; fremde Organisationen sehen keine operativen oder historischen P1-14-Daten.
- `P1-14-F61` — Änderungen an Arbeitsstand, Blockern, Voraussetzungen, Planung und Checkliste aktualisieren betroffene Detail-, Listen-, Kalender- und Aufgabenansichten über die bestehenden Cache-Tags und zentralen Realtime-Abonnements.
- `P1-14-F62` — Ein Lebenszykluswechsel reserviert, entnimmt, verbraucht oder retourniert kein Material und erstellt oder verändert keinen Termin, Versand, Zeiteintrag, kein Dokument und keine Unterschrift.
- `P1-14-F63` — P1-14 sendet keine Nachricht, erzeugt kein Kundenpaket und baut weder eine zweite Checkliste, Planung, Inbox noch einen konfigurierbaren Workflow; spätere Slices bleiben die Eigentümer dieser Funktionen.

### `P1-15` — Strukturierte Arbeitsnachweise, Freigaben und Unterschriften (2026-08-24)

- `P1-15-F01` — Berechtigte Nutzer finden Arbeitsnachweise direkt am Auftrag oder Projekt zwischen Arbeitsanweisungen und allgemeinen Dokumenten; es entsteht keine zusätzliche Hauptnavigation.
- `P1-15-F02` — Berechtigte Nutzer wählen beim Erstellen genau eine der fünf Arten Bautagebuch, Arbeitsbericht, Aufmaß, Mangel oder Regie-/Änderungsnachweis.
- `P1-15-F03` — Jeder Arbeitsnachweis behält eine stabile Identität, während jede ausdrückliche Speicherung eine neue, unveränderliche Version mit eigener Nummer, Zeit und Urheber erzeugt.
- `P1-15-F04` — Ein Arbeitsnachweis gehört genau zu einem Auftrag oder genau zu einem Projekt derselben Organisation; leere, doppelte oder organisationsfremde Ziele werden serverseitig abgewiesen.
- `P1-15-F05` — Bei einem Auftrag übernimmt ein neuer Arbeitsnachweis den vorhandenen Einsatzort als nachvollziehbaren Kontext, ohne einen zweiten Einsatzort anzulegen.
- `P1-15-F06` — Nutzer können eine Version bewusst einem vorhandenen Arbeits- oder Checklistenpunkt zuordnen; die Zuordnung ersetzt weder Aufgabe noch Nachweiserwartung.
- `P1-15-F07` — Nutzer wählen „Nur intern“ oder „Für Kundendokumentation“; Kundenentscheidung und Unterschrift lassen sich nur für eine kundenbezogene Version verlangen.
- `P1-15-F08` — Ein leerer Bereich erklärt ruhig, dass noch keine Arbeitsnachweise vorhanden sind, und bietet eine klare Aktion „Neu“.
- `P1-15-F09` — Die Liste zeigt Titel, Art, aktuelle Versionsnummer und aktuellen Status; ungültige Nachweise bleiben als Historie erkennbar statt zu verschwinden.
- `P1-15-F10` — Die Detailansicht zeigt die aktuelle strukturierte Version, Dokument- und Quellenbezüge, Entscheidungen sowie den vollständigen Versions- und Aktionsverlauf.
- `P1-15-F11` — Ein zugewiesener Handwerker kann Arbeitsnachweise am eigenen Auftrag und an einem Projekt mit einem ihm zugewiesenen Unterauftrag erstellen und überarbeiten.
- `P1-15-F12` — Büro/Admin können Arbeitsnachweise an jedem Auftrag oder Projekt der aktiven Organisation erstellen, überarbeiten und verwalten.
- `P1-15-F13` — Nicht zugewiesene Handwerker und Mitglieder einer fremden Organisation sehen weder Arbeitsnachweis noch Version, Detaildaten, Entscheidung, Dokumentbezug oder Nachweiserfüllung.
- `P1-15-F14` — Ein Bautagebuch erfasst Arbeitstag, Fortschritt, anwesende Personen, Wetter, Bedingungen vor Ort, Lieferungen, Behinderungen, Entscheidungen und besondere Ereignisse.
- `P1-15-F15` — Ein unvollständiges Bautagebuch bleibt als Entwurf speicherbar; zum Einreichen sind mindestens Arbeitstag und Fortschritt erforderlich.
- `P1-15-F16` — Ein Arbeitsbericht erfasst Besuchsbeginn und -ende, ausgeführte und offene Arbeiten, Materialhinweise, Kundenaussage und nächsten Besuch.
- `P1-15-F17` — Ein Arbeitsbericht kann konkrete, zum Ziel gehörende Zeiteinträge als unveränderliche Quellenbezüge aufnehmen; die Zeiteinträge selbst bleiben im Zeitdomänenmodell.
- `P1-15-F18` — Material- und Zeitangaben im Bericht sind Nachweiskontext und werden weder zu Rechnungspositionen noch zu neuen Zeit- oder Bestandsbewegungen.
- `P1-15-F19` — Ein Aufmaß erfasst Datum, Ort/Bereich, Hinweise und beliebig viele Positionen mit Bezeichnung, Ort, positiver Menge und fester Einheit.
- `P1-15-F20` — Aufmaßmengen akzeptieren deutsche Dezimaleingabe, bleiben positiv und verwenden nur Stück, Meter, Quadratmeter, Kubikmeter, Liter, Kilogramm, Stunde oder Pauschale.
- `P1-15-F21` — Ein Aufmaß lässt sich erst mit Datum, Ort und mindestens einer gültigen Position zur Prüfung einreichen; der aktuelle Stand bleibt für Abschlussprüfungen auswertbar.
- `P1-15-F22` — Ein Mangel erfasst Problem, Schweregrad, Ort, Zuständigkeit, Fälligkeit, Status, vorgeschlagene Lösung und Behebung.
- `P1-15-F23` — Ein Mangel wechselt über eine begründete neue Version zwischen offen, in Bearbeitung und behoben; frühere Zustände und Entscheidungen bleiben erhalten.
- `P1-15-F24` — Ein als behoben eingereichter Mangel verlangt einen bewusst verknüpften Abschlussnachweis derselben Version; eine bloße Behauptung genügt nicht.
- `P1-15-F25` — Ein heute fälliger oder überfälliger offener Mangel erscheint einmal in der gemeinsamen Aufgabenansicht für Büro/Admin, die zugewiesene oder die ausdrücklich verantwortliche Person.
- `P1-15-F26` — Ein Regie-/Änderungsnachweis erfasst Änderung, Grund, anfordernden Kontext, erwartete und tatsächliche Arbeitsminuten und Materialien, Autorisierungsstand und Terminauswirkung.
- `P1-15-F27` — „Angefragt“, „autorisiert“ oder „abgelehnt“ im Regienachweis dokumentiert nur den operativen Kontext und erzeugt keinen Vertrag, Preis, Nachtrag oder abrechenbare Position.
- `P1-15-F28` — Eine kundenbezogene Version kann Kundenaussage, erforderliche Kundenentscheidung und erforderliche Unterschrift getrennt kennzeichnen.
- `P1-15-F29` — „Als Entwurf speichern“ legt die aktuelle Eingabe ausdrücklich als Version ab; nicht gespeicherte Eingabe bleibt nur im geöffneten Formular.
- `P1-15-F30` — „Zur Prüfung einreichen“ validiert die gewählte Nachweisart und erzeugt zusammen mit der Version genau eine unveränderliche Prüfanforderung.
- `P1-15-F31` — Fehlende Pflichtangaben, ungültige Zeitfolgen, Mengen, Zielbezüge oder Kundenoptionen verhindern die gesamte Speicherung und lassen die Formulareingabe zur Korrektur stehen.
- `P1-15-F32` — Bereits gespeicherte Versionen und ihre typisierten Detailzeilen lassen sich weder überschreiben noch löschen; jede Änderung läuft über „Neue Version“.
- `P1-15-F33` — Nach Einreichung, Entscheidung, Kundenreaktion, Unterschrift oder sonstigem Versionsbezug verlangt eine neue Version einen konkreten Korrekturgrund.
- `P1-15-F34` — Eine neue Version erbt weder interne Freigabe noch Kundenentscheidung oder Unterschrift stillschweigend; ältere Evidenz bleibt an ihrer ursprünglichen Version sichtbar.
- `P1-15-F35` — Der Verlauf zeigt alle Versionen und Aktionen mit Zeitpunkt, Akteur, Korrekturgrund und Bezug zur exakten Version.
- `P1-15-F36` — Büro/Admin setzen einen Arbeitsnachweis nur mit Grund ungültig; Inhalt und Verlauf bleiben erhalten und die aktuelle Projektion kennzeichnet ihn als ungültig.
- `P1-15-F37` — Ein Auftrag oder Projekt mit Arbeitsnachweisverlauf lässt sich nicht hart löschen; normale bestehende Arbeit ohne solchen Verlauf behält ihren bisherigen Löschpfad.
- `P1-15-F38` — Zwei gleichzeitige Änderungen können nicht dieselbe Artefaktversion überschreiben; die veraltete Aktion scheitert ohne Teilstand und die lokale Eingabe bleibt erhalten.
- `P1-15-F39` — Wiederholte Übermittlung derselben Versions-, Aktions-, Dokument- oder Quellen-ID liefert das bereits gespeicherte Ergebnis; eine abweichende Wiederverwendung wird als Konflikt abgewiesen.
- `P1-15-F40` — Realtime aktualisiert eine ruhende Arbeitsnachweisliste; ein offener Dialog verliert keine Eingabe und holt nach dem Schließen den aktuellen Stand nach.
- `P1-15-F41` — Interne Entscheidungen verwenden die bestehende Zuständigkeit „Arbeitsnachweise freigeben“ mit Rollenstandard, ausgewählten Personen und zeitlich wirksamer Vertretung.
- `P1-15-F42` — Der Urheber einer Version kann diese nicht selbst intern freigeben, ablehnen oder zur Korrektur zurückgeben; die Datenbank erzwingt das Vier-Augen-Prinzip.
- `P1-15-F43` — Eine zuständige zweite Person gibt eine eingereichte exakte Version intern frei; Status, Zuständigkeits-Snapshot, Akteur und Zeitpunkt bleiben unveränderlich.
- `P1-15-F44` — Eine zuständige zweite Person lehnt eine eingereichte Version nur mit Grund ab; die Ablehnung ersetzt keine frühere Version oder Evidenz.
- `P1-15-F45` — Eine zuständige zweite Person fordert mit Grund eine Korrektur an; der aktuelle Versionsurheber erhält dafür denselben stabilen Aufgabenbezug.
- `P1-15-F46` — Der Einreichende oder Büro/Admin zieht eine noch offene Prüfung zurück; die Version wird wieder Entwurf, während Einreichung und Rückzug im Verlauf bleiben.
- `P1-15-F47` — Eine offene Prüfung erscheint für aktuell zuständige, zugleich zielberechtigte Personen einmal in der gemeinsamen Aufgabenansicht und verschwindet nach Entscheidung oder Rückzug.
- `P1-15-F48` — Eine angeforderte Korrektur erscheint einmal für den Urheber der aktuellen Version und führt direkt zum Arbeitsnachweis; eine neue Version löst denselben offenen Bezug auf.
- `P1-15-F49` — Beginnt oder endet eine Vertretung, wird die Freigabezuständigkeit aus dem aktuellen Berliner Geschäftszeitpunkt neu abgeleitet, ohne alte Entscheidungen umzuschreiben.
- `P1-15-F50` — Interne Freigabe und Kundenbestätigung sind getrennte Aktionen; keine davon wird aus der anderen abgeleitet.
- `P1-15-F51` — Büro/Admin dokumentieren eine Kundenbestätigung mit Name, Rolle/Funktion, Bezug zum Kunden, Erfassungsweg, Wortlaut und Zeitpunkt für genau eine Version.
- `P1-15-F52` — Büro/Admin dokumentieren eine Weigerung mit demselben Kontext und einem verpflichtenden Grund, ohne eine Bestätigung vorzutäuschen.
- `P1-15-F53` — Büro/Admin dokumentieren einen Vorbehalt mit demselben Kontext und einem verpflichtenden Grund; Vorbehalt und uneingeschränkte Bestätigung bleiben unterscheidbar.
- `P1-15-F54` — Hat die bestätigende Person kein WerkFlow-Konto, bleibt ihre eingegebene Identität und Beziehung als Kontext erhalten, ohne ein Benutzerkonto zu erfinden.
- `P1-15-F55` — Kundenentscheidung, Weigerung, Vorbehalt und Unterschrift verweisen immer auf die exakte aktuelle Version und werden bei einer Folgeversion nicht umgehängt.
- `P1-15-F56` — Büro/Admin zeichnen eine Unterschrift auf einem zugänglichen Zeigegerät, setzen sie zurück oder speichern sie; die Bilddatei läuft direkt über den vorhandenen signierten Browser-zu-R2-Upload und wird der Version zugeordnet.
- `P1-15-F57` — Vor der Kundenreaktion zeigt die Oberfläche den gespeicherten Wortlaut und den Hinweis, dass WerkFlow damit keine besondere Rechtswirksamkeit oder qualifizierte elektronische Signatur bestätigt.
- `P1-15-F58` — Eine Weigerung oder ein Vorbehalt verhindert nicht, dass das Team den tatsächlichen Vorgang dokumentiert; die offene Anforderung gilt als beantwortet statt als erfundene Zustimmung.
- `P1-15-F59` — Die Oberfläche bezeichnet keine erfasste Unterschrift als für einen bestimmten deutschen Rechtszweck ausreichend und bietet keinen externen Signaturanbieter an.
- `P1-15-F60` — Berechtigte Nutzer verknüpfen ein vorhandenes, zum selben Auftrag oder Projekt gehörendes Dokument mit genau einer Version; fremde oder gelöschte Dokumente werden abgewiesen.
- `P1-15-F61` — Beim Dokumentbezug wählen Nutzer bewusst „Nachweis“ oder „Abschlussnachweis“; eine Unterschrift und ein gerenderter Export verwenden eigene feste Beziehungen.
- `P1-15-F62` — Ein gewöhnliches Foto oder Dokument bleibt gewöhnlich, bis ein Nutzer es ausdrücklich mit einer Version oder Nachweiserwartung verknüpft; P1-15 erzwingt keine allgemeine Dokumentfreigabe.
- `P1-15-F63` — Ein verknüpfter Zeiteintrag muss zum selben Auftrag beziehungsweise Projekt gehören und bleibt eine unveränderliche Quelle der Version; er verändert die Zeiterfassung nicht.
- `P1-15-F64` — Nutzer erfüllen eine vorhandene P1-13-Nachweiserwartung bewusst mit genau einem Dokument oder einer exakten Arbeitsnachweisversion; die Checkliste zeigt anschließend „Nachweis erfüllt“.
- `P1-15-F65` — Eine bereits aktiv erfüllte Nachweiserwartung kann nicht doppelt erfüllt werden; Entfernen oder Ersetzen verlangt einen versionierten, begründeten Vorgang.
- `P1-15-F66` — Eine erforderliche, noch unerfüllte Nachweiserwartung verhindert „Ausführung abgeschlossen“ atomar; ein aktueller Nachweis macht nur diese konkrete Lücke prüfbar.
- `P1-15-F67` — Büro/Admin erzeugen aus der aktuellen Version einen deterministischen, eigenständigen UTF-8-HTML-Export mit A4-Drucklayout.
- `P1-15-F68` — Der Export wird als vorhandene Dokumentkategorie „Bericht“ in R2 gespeichert, zum Auftrag oder Projekt und als gerenderte Ausgabe zur exakten Version verknüpft.
- `P1-15-F69` — Renderer-Version und Inhalts-Hash machen denselben Export wiederholbar und idempotent; Teilfehler entfernen nicht registrierte Objekte und zeigen einen sichtbaren Fehler.
- `P1-15-F70` — Der Export nennt Artefakt, Version, Status, Renderer und Inhalts-Hash und enthält die aktuelle strukturierte Fassung samt Aufmaß und aufgezeichneten Entscheidungen.
- `P1-15-F71` — Der P1-14-Prüfstand zählt aktuelle Aufmaße und lässt „Messungen“ nur dann als nicht bewertbar stehen, wenn kein belastbares Aufmaß vorhanden ist.
- `P1-15-F72` — Der P1-14-Prüfstand zählt offene aktuelle Mängel; ihre Bearbeitung bleibt Warnung und verwendet weiterhin das eine Mangelartefakt statt eines zweiten Blockermodells.
- `P1-15-F73` — Der P1-14-Prüfstand zählt ausstehende formale Freigaben der aktuellen Version und erneuert seinen Fingerabdruck nach Einreichung, Entscheidung, Korrektur oder neuer Version.
- `P1-15-F74` — Eine ausdrücklich verlangte Kundenentscheidung oder Unterschrift verhindert die normale Übergabe, bis für die aktuelle Version ein tatsächlicher Ausgang erfasst ist; die bestehende begründete Manager-Ausnahme bleibt möglich.
- `P1-15-F75` — Büro/Admin erfüllen eine deklarierte P1-14-Freigabevoraussetzung nur durch die bewusste Verknüpfung mit einer aktuellen internen Freigabe desselben Ziels; Freitext oder eine alte Version genügen nicht.
- `P1-15-F76` — Änderungen an Arbeitsnachweisen und aktiven Nachweiserfüllungen aktualisieren Detail-, Aufgaben-, Dokument- und Lebenszyklusansichten über bestehende Cache-Tags und zentrale Realtime-Abonnements; unveränderliche Ledger bleiben unveröffentlicht.
- `P1-15-F77` — Erstellen, Ändern, Entscheiden, Signieren, Verknüpfen und Exportieren eines Arbeitsnachweises verändert weder Planung, Versand, Ist-Zeit, Bestand, Preis, Rechnung, Kundenpaket noch Nachricht.
- `P1-15-F78` — P1-15 baut weder einen vollständigen Außendienst-Arbeitspack noch Übergabepaket, Geräteakte, Abrechnung, Dokumenten-Pipeline, Rechtsarchiv, Kundenportal oder generischen Formular-/Workflow-Designer; die vorgesehenen späteren Slices bleiben Eigentümer.

### `P1-16` — Fokussierter Arbeitspack für zugewiesene Handwerker (2026-08-25)

- `P1-16-F01` — Ein zugewiesener Handwerker öffnet am Auftrag einen fokussierten Arbeitspack mit den für den Einsatz nötigen Informationen und Aktionen.
- `P1-16-F02` — Einzelauftrag und Projekt-Unterauftrag verwenden dieselbe rollenabhängige Arbeitspack-Komposition ohne doppelte Lader oder Fachlogik.
- `P1-16-F03` — Beim Projekt-Unterauftrag sieht der Handwerker nur Nummer und Titel des übergeordneten Projekts, nicht Geschwisteraufträge oder die Projektgesamtansicht.
- `P1-16-F04` — Admin behält die vollständige bestehende Auftragsansicht mit Planung, Zuweisung, Qualifikation, Projekt-, Dokument- und Verwaltungskontrollen.
- `P1-16-F05` — Büro behält die vollständige bestehende Auftragsansicht mit seinen bisherigen Berechtigungen und Arbeitswegen.
- `P1-16-F06` — Ein nicht zugewiesener Handwerker erhält weder Arbeitspack noch Auftragsdaten und wird zur eigenen Auftragsliste zurückgeführt.
- `P1-16-F07` — Ein Mitglied einer fremden Organisation erhält weder Arbeitspack noch Auftragsdaten und bleibt auf die eigene Organisation begrenzt.
- `P1-16-F08` — Wird eine Zuweisung während einer geöffneten Seite entfernt, verschwinden geschützte Inhalte beim aktuellen Realtime-/Fokusabgleich und weitere Aktionen werden serverseitig abgewiesen.
- `P1-16-F09` — Jede Arbeitspack-Lese- und Schreibaktion prüft aktive Organisation, Rolle und aktuelle Auftragszuweisung auf dem Server; ausgeblendete Schaltflächen ersetzen keine Autorisierung.
- `P1-16-F10` — Das bloße Öffnen oder Aktualisieren des Arbeitspacks erzeugt oder verändert keinen Termin, Versand, keine Bestätigung, Zeit, Bestandsbewegung, Datei, Evidenz, keinen Status, Blocker, keine Nachricht oder Übergabe.
- `P1-16-F11` — Bestehende zugewiesene Aufträge liefern den Arbeitspack sofort aus ihren aktuellen Fachdaten; es sind weder Backfill noch kopierte Arbeitspack-Zeilen erforderlich.
- `P1-16-F12` — Auf kleinen Bildschirmen folgt der Arbeitspack der festen Reihenfolge Vor dem Einsatz, aktueller Arbeitsstand, Anweisungen, Nachweise, Dokumente, eigene Zeit, Material, offene Punkte und weitere Angaben.
- `P1-16-F13` — Der Kopf zeigt Auftragsnummer, Titel und verständlichen aktuellen Arbeitsstand ohne Büro-Metadaten zu überladen.
- `P1-16-F14` — Geplanter Tag und Zeitraum bleiben klar als Planung gekennzeichnet und werden nicht mit tatsächlicher Arbeitszeit vermischt.
- `P1-16-F15` — Der angeforderte Arbeitszweck beziehungsweise die Auftragsbeschreibung erscheint vor dem Einsatz, wenn er vorhanden ist.
- `P1-16-F16` — Der zugehörige Kunde erscheint als Arbeitskontext, ohne interne Kundenbewertung oder kaufmännische Daten.
- `P1-16-F17` — Der korrekte Einsatzort erscheint mit seiner gespeicherten Auftragsadresse und bleibt historisch vom später veränderten Kundenstamm getrennt.
- `P1-16-F18` — Praktische Zugangshinweise zum Einsatzort erscheinen vor dem Einsatz; interne Standortnotizen bleiben im Büro.
- `P1-16-F19` — Der relevante Ansprechpartner erscheint mit Name, Funktion und benötigter Telefonnummer.
- `P1-16-F20` — Ein mindestens 44 Pixel hohes Telefonziel startet den Anruf über einen unmittelbaren `tel:`-Link.
- `P1-16-F21` — Ein mindestens 44 Pixel hohes Navigationsziel öffnet die Geräte-Navigation über die vorhandene Adresse; Adresse kopieren bleibt möglich, ohne einen Anbieter, GPS-Verlauf oder Geocoding einzuführen.
- `P1-16-F22` — Fehlender Kunde, Einsatzort, Zugangshinweis, Ansprechpartner oder Termin erscheint als ruhige, eindeutige Lücke und nicht als erfundener Wert.
- `P1-16-F23` — Interne Kunden-, Kontakt- und Standortnotizen sowie E-Mail-Adressen bleiben aus dem Arbeitspack ausgeschlossen.
- `P1-16-F24` — Namen, E-Mails, Personal-, Zeit- oder Zuständigkeitsdetails anderer Beschäftigter bleiben ausgeschlossen, soweit sie nicht unmittelbar für die Arbeit nötig sind.
- `P1-16-F25` — Preise, Margen, Einkauf, Verkauf, Bewertung und Abrechenbarkeit bleiben vollständig Büro-Sache.
- `P1-16-F26` — Dokumentverwaltung, interne Entwürfe anderer Urheber, zentrale Bestandsverwaltung und sonstige Governance-Flächen bleiben aus dem Arbeitspack ausgeschlossen.
- `P1-16-F27` — Eine aktuelle noch unbestätigte Einsatzanweisung erhält vor dem Arbeitsstand die höchste Aktionspriorität.
- `P1-16-F28` — Der Arbeitspack zeigt gleichzeitig genau eine hervorgehobene nächste Hauptaktion.
- `P1-16-F29` — Ohne vorrangige Einsatzanweisung stammen nächste Aktion und erlaubte Übergänge ausschließlich aus dem P1-14-Lebenszyklus.
- `P1-16-F30` — Einsatzbereitschaft wird ausschließlich durch die bestehende `composeReadiness`-Projektion aus aktuellen Fachdaten gebildet.
- `P1-16-F31` — Kapazität, Qualifikation, Einsatzort, Fahrzeit, Material und Werkzeuge bleiben getrennt und verwenden ihre bestehenden ehrlichen Zustände.
- `P1-16-F32` — Fehlende, nicht bewertete oder fehlgeschlagene Bereitschaft wird nie grün dargestellt; eine kompakte Ausnahme führt zur zuständigen Quelle.
- `P1-16-F33` — „Bestätigen“ bestätigt genau die aktuelle Einsatzrevision über die bestehende Versandaktion und gilt weder als Anwesenheit noch Arbeitsbeginn.
- `P1-16-F34` — „Rückfrage senden“ verlangt den vorhandenen Grund und verwendet die bestehende Versand-Herausforderung, ohne selbst eine Nachricht an den Kunden zu senden.
- `P1-16-F35` — Bestätigung, Rückfrage oder Ansicht ändern weder Ausführungsstand, Arbeitszeit, Bestand, Kundenversprechen noch Kommunikation stillschweigend.
- `P1-16-F36` — Ein berechtigter Handwerker startet „In Ausführung“ über den bestehenden P1-14-Übergang.
- `P1-16-F37` — „Unterbrechen“ verlangt den bestehenden Grund und speichert denselben versionierten Lebenszyklusübergang.
- `P1-16-F38` — „Fortsetzen“ verwendet den bestehenden Übergang zurück zu „In Ausführung“ und erzeugt keinen neuen Auftrag oder Zeitabschnitt.
- `P1-16-F39` — „Ausführung abgeschlossen“ bleibt durch die aktuellen Aufgaben-, Nachweis-, Blocker- und sonstigen P1-14-Prüfungen begrenzt und scheitert atomar bei einer offenen Pflicht.
- `P1-16-F40` — „Ausführung abgeschlossen“ bedeutet nur, dass die Feldarbeit beendet ist; „Übergeben“ bleibt ein eigener späterer Bürostand.
- `P1-16-F41` — Abgeschlossene, übergebene, stornierte oder sonst terminale Arbeit ist für Handwerker im Arbeitspack schreibgeschützt.
- `P1-16-F42` — Wiedereröffnung, begründete Übergabeausnahme, Büroprüfung und Kundenpaket bleiben P1-17 vorbehalten.
- `P1-16-F43` — Arbeitsanweisungen erscheinen in ihrer materialisierten Reihenfolge mit Art, Pflicht/optional, Gruppe und praktischen Notizen.
- `P1-16-F44` — Strukturelle Aufgabenabhängigkeiten und noch nicht erfüllte Vorgänger bleiben sichtbar und verwenden das vorhandene P1-13-Modell.
- `P1-16-F45` — Ein zugewiesener Handwerker markiert eine erlaubte Anweisung erledigt oder wieder offen; Akteur und Zeitpunkt bleiben im vorhandenen Datensatz.
- `P1-16-F46` — Schnelle, veraltete oder wegen eines Vorgängers abgewiesene Aufgabenaktionen werden serialisiert, sichtbar zurückgesetzt und aus dem aktuellen Serverstand nachgeladen.
- `P1-16-F47` — Erwartete Nachweiskategorien und ihre aktuelle Erfüllung erscheinen an der bestehenden Anweisung und werden nur über die P1-15-Erfüllungsaktion geändert.
- `P1-16-F48` — Der Arbeitspack kopiert weder Aufgaben noch Nachweiserwartungen in ein eigenes Modell.
- `P1-16-F49` — Zugewiesene Handwerker erfassen die fünf vorhandenen strukturierten Arbeitsnachweisarten in der bestehenden P1-15-Oberfläche.
- `P1-16-F50` — Erstellen, neue Version, Einreichen, Zurückziehen und sonstige sichtbare Nachweisaktionen verwenden ausschließlich die P1-15-Serveraktionen und deren exakte Versionen.
- `P1-16-F51` — Der Handwerker sieht und bearbeitet den eigenen internen Entwurf am zugewiesenen Auftrag.
- `P1-16-F52` — Interne Entwürfe anderer Urheber und deren Signaturkontext bleiben für den Handwerker verborgen.
- `P1-16-F53` — Bei veralteter oder fehlgeschlagener Nachweisspeicherung bleibt die lokale Eingabe erhalten; der aktuelle Serverstand kann bewusst geladen und erneut gespeichert werden.
- `P1-16-F54` — Bereits vorhandene P1-15-Kundenreaktionen und Unterschriften bleiben exakt versionsgebunden; P1-16 fügt keine zweite Feldentscheidung hinzu.
- `P1-16-F55` — Der Arbeitspack erzeugt keinen Übergabebericht, kein Kundenpaket und keine kundenöffentliche Ausgabe.
- `P1-16-F56` — Dokumente und Bilder erscheinen ausschließlich im vorhandenen kontextbezogenen Auftragsbereich.
- `P1-16-F57` — Ein Upload überträgt die Datei direkt über den vorhandenen signierten Browser-zu-R2-Pfad und registriert nur die bestehende Dokumentmetadaten-Verknüpfung.
- `P1-16-F58` — Berechtigte Handwerker können zugängliche Auftragsdateien ansehen und herunterladen.
- `P1-16-F59` — Handwerker erhalten keine zentrale Dokumentbibliothek, Verknüpfen-vorhanden-, Papierkorb-, Versions-, Audit- oder Governance-Oberfläche.
- `P1-16-F60` — Der Arbeitspack speichert keine private Dateikopie nur für seine Anzeige.
- `P1-16-F61` — Teilweise oder fehlgeschlagene Uploads bleiben pro Datei sichtbar und erneut versuchbar; fertig hochgeladene Dateien bleiben beim Metadatenfehler erhalten und verwaiste Retention läuft begrenzt aus.
- `P1-16-F62` — Der Zeitbereich zeigt dem Handwerker nur die eigenen auftragsbezogenen Einträge und Summen.
- `P1-16-F63` — Zeiten, E-Mails und Personalangaben von Kollegen bleiben aus dem Feldbereich ausgeschlossen.
- `P1-16-F64` — „Arbeitszeit starten“ verwendet die bestehende Clock-Oberfläche und erzeugt einen normalen auftragsbezogenen Zeiteintrag.
- `P1-16-F65` — „Arbeitszeit beenden“ beendet den vorhandenen laufenden Eintrag über die Zeitdomäne.
- `P1-16-F66` — Bei laufender Zeit auf einem anderen Auftrag bietet der Arbeitspack den vorhandenen bewussten Wechsel an.
- `P1-16-F67` — Zuweisung beweist keine Anwesenheit, Auftragsbezug macht Zeit nicht automatisch abrechenbar und archivierte Arbeit behält ihre Zeitbezüge.
- `P1-16-F68` — Planung und Ist-Zeit bleiben getrennt; nur das bestehende erste Einstempeln darf den P1-14-Arbeitsstand atomar starten.
- `P1-16-F69` — P1-16 baut keine Arbeits-, Fahrt-, Pause-, Bereitschafts- oder Rufbereitschaftssegmentierung aus P1-21 vor.
- `P1-16-F70` — Der Materialbereich zeigt vorhandenen Bedarf, offene Menge, Bestandshinweis und tatsächliche Bewegungen, ohne Reservierung zu erfinden.
- `P1-16-F71` — Ein zugewiesener Handwerker entnimmt geplantes vorhandenes Material über die bestehende Inventaraktion.
- `P1-16-F72` — Ein zugewiesener Handwerker sucht ein ungeplantes vorhandenes Teil in einem serverseitig begrenzten Bestandssuchergebnis und entnimmt es über dieselbe Inventaraktion.
- `P1-16-F73` — Ein zugewiesener Handwerker legt zuvor entnommenes Material über die bestehende Rückgabeaktion zurück.
- `P1-16-F74` — Der Handwerker kann keinen Artikel oder Lagerort anlegen und erreicht weder zentrale Inventarroute noch Projekt-Inventarabläufe.
- `P1-16-F75` — Lieferant, Einkauf, Verkauf, Bewertung und Abrechenbarkeit bleiben im Materialbereich verborgen.
- `P1-16-F76` — Geplant, reserviert, entnommen, verbraucht/installiert und abrechenbar bleiben getrennte Zustände; entnommene Menge wird nicht als Verbrauch oder Rechnung interpretiert.
- `P1-16-F77` — Abschluss kann auf offenen Bedarf, ausstehendes Material oder Werkzeuge hinweisen, repariert diese Zustände aber nie stillschweigend.
- `P1-16-F78` — Ein zugewiesener Handwerker meldet einen eigenen Blocker mit dem bestehenden Grund-, Detail- und Prüfkontext.
- `P1-16-F79` — Der Handwerker bearbeitet oder löst nur den eigenen erlaubten Blocker; Manager behalten ihre bestehenden erweiterten Kontrollen.
- `P1-16-F80` — Zusätzliche Voraussetzungen und ihre aktuelle Erfüllung erscheinen lesbar im vorhandenen P1-14-Modell.
- `P1-16-F81` — P1-16 erstellt weder ein zweites Blocker- noch ein zweites Fragen- oder Aufmerksamkeitssystem.
- `P1-16-F82` — Kompakte Bereitschafts- und Problemzusammenfassungen stehen früh im Arbeitspack; seltene Details bleiben über progressive Offenlegung erreichbar.
- `P1-16-F83` — Der Server lädt unabhängige Arbeitspack-Quellen parallel und begrenzt Listen und Suchergebnisse; es entsteht keine serielle Karten-Wasserfallkette.
- `P1-16-F84` — Schlägt eine Quelle beim ersten Laden fehl, zeigt ihr Abschnitt eine sichtbare Ausnahme und eine konkrete Wiederholen-Aktion statt einen falschen Leerzustand.
- `P1-16-F85` — Schlägt eine spätere Aktualisierung fehl, bleibt der letzte erfolgreiche Stand sichtbar, wird als möglicherweise veraltet gekennzeichnet und lässt keine betroffene Mutation zu.
- `P1-16-F86` — Veraltete Versionen, doppelte Anfragen und mehrdeutige Materialantworten führen zu einem bewussten Nachladen und sicheren erneuten Versuch statt zu einem Teilstand.
- `P1-16-F87` — Zuweisungsänderung, Fokus- oder Sichtbarkeitsrückkehr und relevante Realtime-Ereignisse gleichen geschützte Arbeitspack-Daten zeitnah mit dem Server ab.
- `P1-16-F88` — Der Arbeitspack verwendet die vorhandenen zentralen Abonnements und veröffentlicht keine unveränderlichen Versand- oder Arbeitsnachweis-Ledger reflexartig; Root-Ereignisse lösen den Nachladeweg aus.
- `P1-16-F89` — Geöffnete Dialoge behalten ihre Eingabe, während störende Router-Aktualisierungen angehalten und nach dem Schließen einmal nachgeholt werden.
- `P1-16-F90` — Primäraktionen, Anruf und Navigation bieten mindestens 44 Pixel Zielhöhe, sichtbaren Fokus, Tastaturbedienung, deutsche Beschriftung und verständliche Screenreader-Namen.
- `P1-16-F91` — Die Web-Oberfläche verspricht keine Offline-Verfügbarkeit und führt keine Offline-Warteschlange ein.
- `P1-16-F92` — P1-16 führt keinen Navigationsanbieter, Geocoder, GPS- oder Routenverlauf und kein kostenpflichtiges externes Konto ein.
- `P1-16-F93` — P1-16 sendet keine Nachricht oder Kundenaktualisierung und baut weder Geräte-/Servicehistorie, kaufmännische Freigabe noch kundenöffentliche Übergabe vor.
- `P1-16-F94` — Jede sichtbare Aktion bleibt beim zuständigen Fachgebiet; Rendern und Ausführen erzeugen keine fachfremde Mutation und der Arbeitspack bleibt eine Projektion statt einer neuen Domäne.

### `P1-17` — Bürogeprüfte Übergabe und Kundenpaket (2026-08-27)

- `P1-17-F01` — Büro/Admin öffnen für einen Einzelauftrag den eigenen Übergabestand unter `/auftraege/[Auftragsnummer]/uebergabe`.
- `P1-17-F02` — Büro/Admin öffnen für einen Projekt-Unterauftrag denselben fachlichen Übergabestand unter der verschachtelten Auftragsroute.
- `P1-17-F03` — Büro/Admin öffnen für ein Projekt einen eigenen Übergabestand, der nicht mit einem Unterauftrag zusammenfällt.
- `P1-17-F04` — Auftrag und Projekt zeigen im Detail nur eine kompakte Zusammenfassung und eine primäre Aktion zum vollständigen Übergabestand.
- `P1-17-F05` — Der P1-16-Arbeitspack bleibt feldtauglich und erhält keine Büroprüfung, Quellenauswahl oder Ausnahmebegründung.
- `P1-17-F06` — Ein zugewiesener Handwerker sieht am eigenen Auftrag nur den kompakten kundenverträglichen Freigabestand.
- `P1-17-F07` — Ein nicht zugewiesener Handwerker erhält weder Übergabepaket noch Prüfdetails oder Kundenpaketdaten.
- `P1-17-F08` — Mitglieder einer fremden Organisation erhalten keine Paket-, Review-, Freigabe- oder Verlaufsdaten.
- `P1-17-F09` — Bestehende Aufträge und Projekte beginnen ohne erfundenes Paket, Review, Bereitschaftsurteil oder Freigabehistorie.
- `P1-17-F10` — Das bloße Öffnen, Aktualisieren oder Vorschauen erzeugt keine Paketzeile, Datei, Freigabe oder Lebenszyklusänderung.
- `P1-17-F11` — Die Zielzusammenfassung nennt Nummer, Titel, Kunde, Einsatzort und den gespeicherten Ansprechpartner mit Funktion und Kontaktdaten, soweit vorhanden.
- `P1-17-F12` — Fehlende Kunden-, Einsatzort- oder Kontaktdaten erscheinen ehrlich als fehlend und werden nicht aus anderen Zielen geraten.
- `P1-17-F13` — Ein Projektpaket kann eigene Projektquellen und freigegebene Unterauftragspakete enthalten.
- `P1-17-F14` — Ein Unterauftragspaket erweitert die Berechtigung eines Handwerkers weder auf das Projekt noch auf Geschwisteraufträge oder Projektdokumente.
- `P1-17-F15` — Jede Leseaktion prüft aktive Organisation, Mitgliedschaft, Zielzugriff und die für die Rolle zulässige Projektion serverseitig.
- `P1-17-F16` — Jede Schreibaktion prüft Organisation, Ziel, aktuelle Verantwortung oder Delegation und alle erwarteten Versionen erneut am Server.
- `P1-17-F17` — Die Verantwortung `work_handover_review` ist von der Freigabe strukturierter Arbeitsnachweise getrennt.
- `P1-17-F18` — Admin und Büro bilden den Rollenstandard der Übergabeprüfung; eine konfigurierte benannte Zuständigkeit ersetzt ihn nach dem bestehenden Verantwortungsmodell.
- `P1-17-F19` — Eine aktuell wirksame Delegation darf die Übergabe im delegierten Umfang bearbeiten, ohne der Person weitere Bürorechte zu geben.
- `P1-17-F20` — Eine abgelaufene Verantwortung oder Delegation macht die geladene Fläche veraltet und weist die Aktion zum Absendezeitpunkt ab.
- `P1-17-F21` — Eine während der Bearbeitung entfernte Auftragszuweisung entzieht dem Handwerker die geschützte Paketprojektion beim nächsten Abgleich.
- `P1-17-F22` — Ein Ausführungsstand vor „Ausführung abgeschlossen“ kann kein Übergabepaket freigeben und erklärt die fehlende Voraussetzung sichtbar.
- `P1-17-F23` — „Ausführung abgeschlossen“ beendet die Feldarbeit, bedeutet aber noch nicht „Übergeben“.
- `P1-17-F24` — Nur die atomare Freigabe eines gültigen Pakets setzt den zugehörigen Auftrag oder das Projekt auf „Übergeben“.
- `P1-17-F25` — Vollständig übergebene Unteraufträge leiten für ihr Projekt höchstens „Ausführung abgeschlossen“ ab; das Projekt braucht seine eigene Paketfreigabe.
- `P1-17-F26` — Ein noch laufender Zeitstempel am Ziel ist eine nicht überschreibbare Freigabesperre.
- `P1-17-F27` — Ein leeres Paket ist eine nicht überschreibbare Freigabesperre.
- `P1-17-F28` — Ungültige, fremde oder nicht mehr zugängliche Quellen sind eine nicht überschreibbare Freigabesperre.
- `P1-17-F29` — Ein Projekt darf nur aktuelle unveränderliche Freigaben seiner eigenen Unteraufträge aufnehmen.
- `P1-17-F30` — Erwartete Paket-, Lebenszyklus-, Quell- und Prüfstands-Versionen bilden harte atomare Konkurrenzgrenzen.
- `P1-17-F31` — Fehlende Pflichtanweisungen oder geforderte Nachweise erscheinen als begründbar überschreibbare Ausnahme.
- `P1-17-F32` — Offene Abschlussblocker oder unerfüllte Abhängigkeiten erscheinen als begründbar überschreibbare Ausnahme.
- `P1-17-F33` — Offene Mängel und ausstehende formale Arbeitsnachweis-Freigaben erscheinen als begründbar überschreibbare Ausnahme.
- `P1-17-F34` — Eine verlangte Kundenentscheidung oder Unterschrift ohne aktuellen Ausgang erscheint als begründbar überschreibbare Ausnahme.
- `P1-17-F35` — Unvollständige oder wieder geöffnete Unterauftragspakete verhindern die normale Projektfreigabe und verlangen eine begründete Ausnahme, soweit die harte Integrität gewahrt bleibt.
- `P1-17-F36` — Fehlende optionale Fotos oder Dokumente erscheinen als Warnung und nicht als erfüllte Tatsache.
- `P1-17-F37` — Fehlender Versand-, Zeit- oder Materialkontext erscheint jeweils als Warnung und wird nicht automatisch zur Sperre.
- `P1-17-F38` — Zeitsegmentierung, Materialverbrauch, Werkzeugverwahrung, Abrechenbarkeit, Mengen, Preise, Steuern und Buchhaltung bleiben ausdrücklich nicht bewertet.
- `P1-17-F39` — Die Fläche fasst Sperren, begründbare Ausnahmen, Warnungen und nicht bewertete Bereiche getrennt, kompakt und mit Quellensprung zusammen.
- `P1-17-F40` — Ein Paket besitzt genau eine veränderliche Wurzel mit versionierter Entwurfsmitgliedschaft.
- `P1-17-F41` — Büro/Admin wählen zulässige freigegebene Arbeitsnachweis-Versionen bewusst für den Entwurf aus oder ab.
- `P1-17-F42` — Büro/Admin wählen zugängliche Auftrags- oder Projektdokumente bewusst für den Entwurf aus oder ab.
- `P1-17-F43` — Eine Dokumentquelle friert Dokument-ID, genaue Versionsnummer und den zu dieser Version gehörenden Speicherpfad ein.
- `P1-17-F44` — Eine Arbeitsnachweisquelle friert genau die freigegebene unveränderliche Revision ein und folgt nicht still einer späteren Version.
- `P1-17-F45` — Eine Projektquelle friert die konkrete unveränderliche Unterauftragsfreigabe ein und folgt nicht still deren Nachfolger.
- `P1-17-F46` — Nachträgliche Änderungen an ausgewählten Quellen markieren den Entwurf als veraltet und verhindern eine unbemerkte Freigabe.
- `P1-17-F47` — Entzogener Dokumentzugriff oder zurückgezogene Arbeitsnachweis-Freigabe wird beim Absenden erneut erkannt.
- `P1-17-F48` — Der gespeicherte Entwurf bleibt nach Neuladen oder neuer Sitzung mit seiner exakten Auswahl erhalten.
- `P1-17-F49` — Zwei Büropersonen bearbeiten dieselbe Paketwurzel; der erste gültige Stand gewinnt und der zweite erhält eine konkrete Veraltet-Meldung.
- `P1-17-F50` — Bei einer veralteten Speicherung bleiben lokale Auswahl und Begründung erhalten, bis der aktuelle Serverstand bewusst geladen wird.
- `P1-17-F51` — Eine doppelte Speicheranfrage mit derselben Anfrage-ID ist idempotent; ein abweichender Inhalt mit derselben ID wird abgewiesen.
- `P1-17-F52` — Die interne Vorschau zeigt Ziel, ausgewählte Quellen, Prüfstand, Warnungen und die spätere Kundenausgabe vor der Freigabe.
- `P1-17-F53` — Die Kundenvorschau enthält nur eine ausdrückliche erlaubte Feldmenge und keine zufällig serialisierten Quelldaten.
- `P1-17-F54` — Interne Notizen, interne Entwürfe, Korrektur- und Ablehnungsstände bleiben aus der Kundenausgabe ausgeschlossen.
- `P1-17-F55` — Verantwortungs-, Review- und Ausnahmebegründungen bleiben intern und erscheinen nicht im Kundenpaket.
- `P1-17-F56` — Personal- und detaillierte Zeitdaten, verborgener Signaturkontext und fremde Zieldaten bleiben aus der Kundenausgabe ausgeschlossen.
- `P1-17-F57` — Preise, Margen, Lieferantenbedingungen, Bewertung und Abrechenbarkeit bleiben aus Vorschau und Kundenpaket ausgeschlossen.
- `P1-17-F58` — Der Renderer erzeugt aus demselben eingefrorenen Inhalt bytegleiches UTF-8-HTML mit fester Renderer-Version.
- `P1-17-F59` — Ein SHA-256-Inhalts-Hash identifiziert die genaue Kundenausgabe und ändert sich bei einer Inhaltsänderung.
- `P1-17-F60` — Die erzeugte Datei wird über den vorhandenen EU-R2-Pfad gespeichert und als bestehendes Dokument zum exakten Ziel registriert.
- `P1-17-F61` — Das Kundenpaket enthält sichere Zeit- und Materialzusammenfassungen mit reproduzierbaren Quellenfingerabdrücken statt kopierter Fachzeilen.
- `P1-17-F62` — Fotos und sonstige Dokumente gelangen nur durch ihre bewusst ausgewählte genaue Dokumentversion in das Paket.
- `P1-17-F63` — Die Freigabe friert Kunden-, Einsatzort- und Ansprechpartnerkontext zusammen mit dem Prüfstand der Freigabe ein.
- `P1-17-F64` — Die Freigabe friert handelnde Person und die zu diesem Zeitpunkt wirksame Verantwortungs- oder Delegationsauflösung ein.
- `P1-17-F65` — Die Freigabe speichert `ready_for_commercial_review`, wenn keine akzeptierte Ausnahme verbleibt.
- `P1-17-F66` — Die Freigabe speichert `ready_with_exceptions`, wenn begründbar überschriebene Ausnahmen akzeptiert wurden.
- `P1-17-F67` — Die Bereitschaft bedeutet nur, dass die operative Unterlage für eine spätere kaufmännische Prüfung bereitsteht; sie ist keine Rechnungs- oder Preisfreigabe.
- `P1-17-F68` — Eine begründbare Ausnahme kann nur mit aktiv ausgewählter Manager-Ausnahme und einer nicht leeren fachlichen Begründung freigegeben werden.
- `P1-17-F69` — Harte Sperren können weder durch Rolle noch Begründung überschrieben werden.
- `P1-17-F70` — Ohne vorhandene begründbare Ausnahme wird eine unnötige Ausnahmefreigabe abgewiesen.
- `P1-17-F71` — Paketregistrierung, unveränderliche Freigabe, Quellmitglieder, Verlauf, Readiness und Lebenszykluswechsel werden in einer Datenbanktransaktion geschrieben.
- `P1-17-F72` — Ein erfolgreicher Lebenszykluswechsel ohne freigegebenes Paket und eine freigegebene Paketzeile ohne Lebenszykluswechsel sind unmöglich.
- `P1-17-F73` — Scheitert die Datenbankregistrierung nach dem Upload, wird das Objekt nur gelöscht, wenn sicher keine registrierte Referenz darauf zeigt.
- `P1-17-F74` — Ist die Referenzprüfung nach einem Teilfehler nicht eindeutig, bleibt das Objekt für die bestehende begrenzte Bereinigung erhalten statt möglicherweise Geschäftsdaten zu löschen.
- `P1-17-F75` — Scheitert Erzeugung oder Upload vor der Registrierung, bleibt der Entwurf unverändert und die Oberfläche zeigt einen wiederholbaren Fehler.
- `P1-17-F76` — Eine wiederholte identische Freigabeanfrage liefert dasselbe Ergebnis und erzeugt weder zweite Datei noch zweite Freigabe.
- `P1-17-F77` — Eine widersprüchliche Wiederverwendung derselben Freigabe-Anfrage-ID wird ohne Teilmutation abgewiesen.
- `P1-17-F78` — Jede unveränderliche Freigabe besitzt eine fortlaufende Nummer, ihren Paketbeleg und ihre genaue Quellmitgliedschaft.
- `P1-17-F79` — Ein Projektpaket speichert die konkreten Unterauftragsfreigabe-IDs in stabiler Reihenfolge und kopiert deren Fachquellen nicht in neue Eigentümerschaft.
- `P1-17-F80` — Eine Projektfreigabe setzt nur das Projekt auf „Übergeben“ und verändert keine unveränderliche Unterauftragsfreigabe.
- `P1-17-F81` — Die Freigabe verändert weder Planung, Versand, Einsatzbestätigung noch tatsächliche Arbeitszeit.
- `P1-17-F82` — Die Freigabe erzeugt weder Bestandsbewegung, Reservierung, Verbrauch noch Beschaffung.
- `P1-17-F83` — Die Freigabe erzeugt weder Angebot, Vertrag, Rechnung, Zahlung, Buchung noch Nachricht.
- `P1-17-F84` — Die Anwendung stellt das Paket bereit, versendet es aber nicht an den Kunden und erzeugt keinen öffentlichen Link.
- `P1-17-F85` — P1-17 führt weder Kundenkonto noch Kundenportal, Gastzugriff oder öffentliche Download-Route ein.
- `P1-17-F86` — P1-17 führt keinen externen Signatur-, Versand-, PDF-, Speicher- oder sonstigen kostenpflichtigen Anbieter ein.
- `P1-17-F87` — P1-17 behauptet keine Offline-Verfügbarkeit und legt keine Offline-Warteschlange für Review oder Freigabe an.
- `P1-17-F88` — Geräteakte, Servicehistorie, Zeitsegmente, Verbrauch, Nachkalkulation und kaufmännische Belege bleiben bei ihren späteren Slices.
- `P1-17-F89` — Büro/Admin nehmen eine erfolgte Übergabe nur mit einem sichtbaren fachlichen Grund zurück.
- `P1-17-F90` — Die Rücknahme setzt den Lebenszyklus atomar auf „Ausführung abgeschlossen“ und bewahrt die alte Freigabe unverändert.
- `P1-17-F91` — Die Rücknahme eröffnet einen Nachfolgerentwurf, der seine Vorgängerfreigabe eindeutig referenziert.
- `P1-17-F92` — Büro/Admin geben den Auftrag oder das Projekt nur mit Grund wieder in „In Ausführung“, wenn tatsächliche Korrekturarbeit nötig ist.
- `P1-17-F93` — Wiedereröffnung und Korrektur überschreiben weder altes Review noch Ausnahme, Readiness, Paketdatei oder Lebenszyklusereignis.
- `P1-17-F94` — Die erneute Übergabe erzeugt eine neue fortlaufende unveränderliche Freigabe mit Vorgängerbezug.
- `P1-17-F95` — Die Freigabehistorie zeigt Vorgänger, Rücknahme, Korrektur und Nachfolger mit Akteur, Zeitpunkt und internem Grund.
- `P1-17-F96` — Ein alter Paketbeleg bleibt nach der Nachfolgerfreigabe adressierbar und wird weder ersetzt noch umgebogen.
- `P1-17-F97` — Eine zurückgezogene Freigabe ist nicht mehr der aktuelle Kundenstand, bleibt aber als historische Tatsache erhalten.
- `P1-17-F98` — Ein veralteter Rücknahme-, Wiedereröffnungs- oder Nachfolgeraufruf wird atomar mit dem aktuellen Serverstand abgewiesen.
- `P1-17-F99` — Doppelte Rücknahme- und Wiedereröffnungsanfragen sind über ihre Anfrage-ID idempotent.
- `P1-17-F100` — Eine Korrektur kann neue genaue Quellen aufnehmen, ohne die Mitgliedschaft einer früheren Freigabe zu verändern.
- `P1-17-F101` — Ein Projekt-Nachfolger referenziert die zu diesem Zeitpunkt aktuellen Unterauftragsfreigaben und bewahrt die alte Projektzusammensetzung.
- `P1-17-F102` — Das erste Laden zeigt einen klaren Ladezustand und unabhängige Quellen werden parallel und begrenzt geladen statt als Karten-Wasserfall.
- `P1-17-F103` — Schlägt das erste Laden fehl, erscheint ein sichtbarer Fehler mit Wiederholen-Aktion statt eines falschen leeren Pakets.
- `P1-17-F104` — Schlägt eine spätere Aktualisierung fehl, bleibt der letzte bekannte Stand sichtbar, wird als veraltet markiert und ist für betroffene Mutationen gesperrt.
- `P1-17-F105` — Zentrale Realtime-Ereignisse der veränderlichen Paketwurzel, Fokus- und Sichtbarkeitsrückkehr führen über den vorhandenen 150-ms-Abgleich zum aktuellen Serverstand.
- `P1-17-F106` — Unveränderliche Freigabe-, Mitglieds- und Verlaufszeilen brauchen keine eigenen Client-Kanäle; die veröffentlichte Paketwurzel signalisiert das autoritative Nachladen.
- `P1-17-F107` — Ein geöffneter Dialog behält Eingabe und Fokus, stellt störende Aktualisierungen zurück und holt nach dem Schließen genau einmal nach.
- `P1-17-F108` — Primäre Aktionen, Auswahl, Dialoge und Verlauf besitzen logische Tastaturreihenfolge, sichtbaren Fokus, deutsche Screenreader-Namen, Live-Rückmeldung und mindestens 44 Pixel Touchhöhe.
- `P1-17-F109` — Jede sichtbare P1-17-Aktion bleibt auf Paket, Review, Readiness und den gekoppelten Lebenszyklus begrenzt; Rendering und Nachladen sind nebenwirkungsfrei und erzeugen keine spätere Fachdomäne vorzeitig.

**Acceptance invariant:** `109/109 mapped; 109/109 fully evidenced; 0 partial; 0 unmapped` (accepted 2026-08-28).

### `P1-18` — Installierte Anlagen und Geräte (2026-08-29)

- `P1-18-F01` — Büro/Admin öffnen unter `/service/anlagen` eine organisationsweite, nach Anlage, Kunde, Einsatzort, Hersteller, Modell und Kennung durchsuchbare Anlagenliste.
- `P1-18-F02` — Büro/Admin registrieren eine Anlage an genau einem vorhandenen Einsatzort eines vorhandenen Kunden.
- `P1-18-F03` — Jede Anlage erhält unveränderlich eine organisationsweit eindeutige Nummer im Format `ANL-YYYY-NNN`.
- `P1-18-F04` — Eine Anlage besitzt eine begrenzte SHK-Kategorie oder den ehrlichen Wert „Sonstiges“ statt eines frei konfigurierbaren Gerätetypsystems.
- `P1-18-F05` — Eine optionale Positionsangabe beschreibt den Ort am Einsatzort frei; P1-18 erzeugt keine Gebäude-, Wohnungs-, Etagen- oder Raumhierarchie.
- `P1-18-F06` — Eine eigenständig wartbare Komponente gehört genau zu einer Wurzelanlage und darf keine weitere Komponente enthalten.
- `P1-18-F07` — Wurzel und Komponente gehören zwingend derselben Organisation, demselben Kunden und demselben Einsatzort.
- `P1-18-F08` — Installierte Kundengeräte bleiben strukturell von WerkFlow-Inventar, Materialbestand und betriebseigenen Werkzeugen getrennt.
- `P1-18-F09` — Hersteller, Modell, Baujahr, Einbau-, Inbetriebnahme- und Garantiedaten sind optionale Tatsachen; fehlende Werte bleiben sichtbar unbekannt.
- `P1-18-F10` — Garantieende und Garantiebasis werden als dokumentierte Fakten gezeigt, ohne eine kaufmännische oder rechtliche Garantieentscheidung abzuleiten.
- `P1-18-F11` — Serien-, Produkt-, QR-/Barcode- und sonstige Kennungen behalten Rohwert, normalisierten Suchwert und Typ.
- `P1-18-F12` — Eine Seriennummer ist innerhalb einer Organisation und ihres Herstellers oder Herausgebers eindeutig; Produktnummern werden nicht als Instanzidentität missverstanden.
- `P1-18-F13` — Eine identische Kennung kann idempotent erneut übermittelt werden; widersprüchliche Wiederverwendung wird ohne Teilmutation abgewiesen.
- `P1-18-F14` — Altdaten dürfen ohne Hersteller, Modell, Seriennummer, Einbauursprung oder Inbetriebnahme erfasst werden; WerkFlow errät nichts aus Notizen, Dokumentnamen, Inventar oder jüngster Arbeit.
- `P1-18-F15` — Ein Anlagenursprung kann genau einen Auftrag oder ein Projekt referenzieren und bewahrt dessen damaligen Ziel- und Adresskontext.
- `P1-18-F16` — Ein Ursprung aus einer Büroübergabe referenziert die genaue unveränderliche Freigabe statt eines veränderlichen aktuellen Paketzeigers.
- `P1-18-F17` — Ein Arbeitsnachweisbezug referenziert die genaue unveränderliche Revision statt kopierter Nachweisfelder.
- `P1-18-F18` — Ein Anlagenbezug zu Installation, Inbetriebnahme, Service, Ausbau oder Ersatz referenziert den bestehenden Auftrag oder das bestehende Projekt; er erzeugt kein zweites Arbeitsobjekt.
- `P1-18-F19` — Ein vorhandenes Dokument wird über den bestehenden Dokumenteigentümer mit der Anlage verknüpft; Dateibytes werden weder kopiert noch durch eine Server Action geleitet.
- `P1-18-F20` — Ein Anlagen-Dokumentbezug erweitert die Dokumentberechtigung eines Handwerkers nicht.
- `P1-18-F21` — Ein Dokument mit unveränderlicher Anlagenhistorie kann nicht dauerhaft gelöscht oder von der Anlage getrennt werden, solange dieser Verlauf darauf beruht.
- `P1-18-F22` — Die Anlagenhistorie ist eine strukturierte Zeitleiste aus Anlagen-, Kennungs-, Arbeits-, Dokument- und Lebenszyklusbezügen und kein zweiter Dokumentordner oder Freitext-Verlauf.
- `P1-18-F23` — Registrierung, Einbau und Inbetriebnahme sind datierte Tatsachen oder Ereignisse und werden nicht als Lebenszyklusstatus missbraucht.
- `P1-18-F24` — Der aktuelle Status ist genau einer von „Unbekannt“, „Aktiv“, „Inaktiv“, „Ausgebaut“, „Ersetzt“ oder „Außer Betrieb“.
- `P1-18-F25` — Büro/Admin ändern einen zulässigen Status mit erwarteter Version; veraltete Änderungen werden atomar mit dem aktuellen Serverstand abgewiesen.
- `P1-18-F26` — Ausbau, Ersatz und Außerbetriebnahme verlangen einen sichtbaren fachlichen Grund und bewahren die bisherige Anlagenidentität.
- `P1-18-F27` — Ersatz erzeugt eine neue Nachfolgeridentität und verknüpft sie eindeutig mit dem unveränderten Vorgänger.
- `P1-18-F28` — Ein ersetzter oder außer Betrieb gesetzter Vorgänger kann nicht still reaktiviert oder überschrieben werden.
- `P1-18-F29` — Nur eine inaktive Anlage oder dieselbe ausgebaute physische Einheit darf zulässig reaktiviert werden.
- `P1-18-F30` — Ein irrtümlicher terminaler Vorgang wird durch ein begründetes Korrekturereignis berichtigt; das ursprüngliche Ereignis bleibt unverändert.
- `P1-18-F31` — Jede Mutation bewahrt Akteur, Wirksamkeitszeit, Aufzeichnungszeit, Anfrage-ID, Version, Einsatzort-/Adresssnapshot und genaue Quellen.
- `P1-18-F32` — Gleiche Anfrage-ID und gleicher Inhalt liefern dasselbe Ergebnis; gleiche Anfrage-ID mit anderem Inhalt wird ohne zweite Historienzeile abgewiesen.
- `P1-18-F33` — Das bloße Öffnen, Suchen, Filtern oder Nachladen erzeugt keine Anlage, Kennung, Historie, Verknüpfung oder Dokumentzeile.
- `P1-18-F34` — Die Kundendetailseite zeigt je Einsatzort nur eine kompakte Anlagenzusammenfassung und verweist für technische Details auf `/service/anlagen/[Anlagennummer]`.
- `P1-18-F35` — Die Detailseite zeigt Identität, Einsatzort, technische Fakten, Kennungen, Garantie, genaue Ursprünge, Arbeitsbezüge, Dokumente und chronologischen Verlauf in einer serviceeigenen Oberfläche.
- `P1-18-F36` — Eine unbekannte oder leere Anlagenakte wird als fehlende Erfassung gezeigt und niemals als bestätigte Abwesenheit von Geräten formuliert.
- `P1-18-F37` — Admin und Büro dürfen Anlagen lesen und verändern; ein Mitarbeiter erhält keine Anlagenliste, Kundenakte oder serviceweite Suche.
- `P1-18-F38` — Ein Handwerker sieht nur eine kompakte Anlage, die exakt mit einem ihm exakt zugewiesenen Auftrag verknüpft ist.
- `P1-18-F39` — Kunden-, Einsatzort-, Projekt-, Wurzel-, Komponenten- oder Geschwisterbezug allein erweitert den Mitarbeiterzugriff nicht.
- `P1-18-F40` — Mitglieder einer fremden Organisation können Anlagen, Kennungen, Arbeitsbezüge, Dokumentbezüge und Ereignisse weder lesen noch verändern.
- `P1-18-F41` — Organisation, Kunde, Einsatzort, Wurzel, Quelle und Ziel werden bei jeder Schreibaktion serverseitig erneut auf Konsistenz geprüft.
- `P1-18-F42` — Das erste Laden zeigt einen klaren Ladezustand; ein Fehler zeigt eine sichtbare Wiederholen-Aktion statt eines falschen Leerzustands.
- `P1-18-F43` — Schlägt eine spätere Aktualisierung fehl, bleibt der letzte bekannte Stand sichtbar, wird als veraltet markiert und sperrt betroffene Mutationen.
- `P1-18-F44` — Änderungen an der veränderlichen Anlagenwurzel, Fokus- und Sichtbarkeitsrückkehr lösen über den zentralen Realtime-Abgleich ein autoritatives Nachladen aus.
- `P1-18-F45` — Kennungen, Arbeitsbezüge, Dokumentbezüge und Ereignisse bleiben unveröffentlicht; ihre erfolgreiche Mutation aktualisiert die veröffentlichte Anlagenwurzel als Invalidierungssignal.
- `P1-18-F46` — Dialoge bewahren Eingabe und Fokus bei aufgeschobener Aktualisierung; Aktionen sind tastaturbedienbar, deutsch benannt, sichtbar fokussiert und mobil ausreichend groß.
- `P1-18-F47` — P1-18 erzeugt weder Serviceannahme, Disposition, Wartungsplan, Vertrag, Wiederholung, Fälligkeit, Zeitsegment, Bestandsbewegung, Verbrauch, Preis, Rechnung, Nachricht, öffentlichen Link noch Offline-Warteschlange.
- `P1-18-F48` — P1-18 führt weder Herstellerregelwerk, Rechts- oder Compliance-Behauptung, IoT/Telemetrie, Ferndiagnose, Kundenportal, externen Anbieter noch generische EAV-/CMDB-/Workflow-Plattform ein.

**Acceptance invariant:** `48/48 mapped; 48/48 fully evidenced; 0 partial; 0 unmapped` (accepted 2026-08-29).

### `P1-19` — Reaktiver Service und vermutete Gewährleistung (2026-08-30)

- `P1-19-F01` — Büro/Admin öffnen unter `/service/faelle` eine organisationsweite Liste reaktiver Servicefälle.
- `P1-19-F02` — Die Liste lässt sich nach Fallnummer, Kurzbeschreibung, Kunde, Einsatzort, Auftragsnummer und exakt verknüpfter Anlage durchsuchen.
- `P1-19-F03` — Büro/Admin erfassen einen direkten Servicefall ohne eine künstliche Anfrage anzulegen.
- `P1-19-F04` — Ein direkter Servicefall bewahrt die ursprüngliche Kundenaussage unveränderlich.
- `P1-19-F05` — Eine vorhandene Kundenanfrage kann genau einmal atomar in einen Servicefall übernommen werden.
- `P1-19-F06` — Die Anfrage bleibt mit ihrer eigenen Identität und ihrem Verlauf erhalten und wird nicht in den Servicefall kopiert oder gelöscht.
- `P1-19-F07` — Die Übernahme bewahrt ursprüngliche Zusammenfassung, Details, Dringlichkeit, Kunde, Ansprechpartner und Einsatzort.
- `P1-19-F08` — Eine bereits übernommene Anfrage kann keinen zweiten Servicefall erzeugen.
- `P1-19-F09` — Eine Anfrage ohne eindeutigen Kunden und Einsatzort wird nicht still qualifiziert.
- `P1-19-F10` — Jeder Servicefall erhält eine organisationsweit eindeutige, stabile Nummer im Format `SRV-YYYY-NNN`.
- `P1-19-F11` — Der Servicefall besitzt genau die Aufnahmeart „Anfrage“ oder „Direkt“; beide Wege behalten ihre unterschiedliche Herkunft.
- `P1-19-F12` — Das bloße Öffnen, Suchen, Filtern oder Nachladen erzeugt keinen Servicefall und verändert keine Anfrage.
- `P1-19-F13` — Ein Servicefall gehört genau zu einem vorhandenen Kunden und einem vorhandenen Einsatzort dieses Kunden.
- `P1-19-F14` — Ein optionaler Ansprechpartner muss zu demselben Kunden gehören.
- `P1-19-F15` — Mehrere vorhandene Anlagen dürfen nur verknüpft werden, wenn sie zu genau diesem Kunden und Einsatzort gehören.
- `P1-19-F16` — Fehlende Anlagen bleiben sichtbar fehlend; WerkFlow errät kein Gerät aus Text, Auftrag, Dokument, Material oder Kundenhistorie.
- `P1-19-F17` — Ein vorhandener Auftrag ist der einzige operative Arbeitsbezug eines Servicefalls.
- `P1-19-F18` — Der verknüpfbare Auftrag muss zu demselben Kunden und Einsatzort gehören.
- `P1-19-F19` — Kunde, Einsatzort, Ansprechpartner, Anlage und Auftrag behalten ihre bestehenden Identitäten; der Servicefall legt keine Kopien an.
- `P1-19-F20` — Eine Anlagenverknüpfung verändert weder Anlagenstatus noch Anlagenidentität, Kennungen oder Lebenszyklus.
- `P1-19-F21` — Eine Auftragsverknüpfung verändert weder Auftragstitel noch Lebenszyklus, Zuweisung, Planung oder Disposition.
- `P1-19-F22` — Anfrage-, Kunden-, Anlagen-, Auftrags- und Dokumenthistorien bleiben bei ihren jeweiligen Eigentümern.
- `P1-19-F23` — Jede Verknüpfung wird bei der Schreibaktion erneut auf Organisation und fachliche Konsistenz geprüft.
- `P1-19-F24` — Schwache Nähe über Kunde, Projekt, Einsatzort oder Anlagenwurzel reicht niemals für eine zusätzliche Verknüpfung oder Berechtigung.
- `P1-19-F25` — Büro/Admin unterscheiden „Neu“, „Rückfrage nötig“, „Einsatz erforderlich“, „Nacharbeit erforderlich“, „Erledigt“, „Ohne Einsatz geschlossen“ und „Duplikat“.
- `P1-19-F26` — Die Dringlichkeit bleibt genau „Niedrig“, „Normal“, „Hoch“ oder „Notfall“ und wird bewusst festgelegt.
- `P1-19-F27` — Ein Notfallwert löst keine automatische Nachricht, Eskalation, Rufbereitschaft oder Disposition aus.
- `P1-19-F28` — Zugangshinweise werden als eigener operativer Feldkontext erfasst.
- `P1-19-F29` — Interne Triagehinweise bleiben von den für den Einsatz nötigen Zugangshinweisen getrennt.
- `P1-19-F30` — Der Abrechnungskontext bleibt „Unbekannt“, vermutete Gewährleistung, Vertrag, Kulanz, Nacharbeit oder voraussichtlich berechenbar.
- `P1-19-F31` — Ein vermuteter Gewährleistungs-, Vertrags-, Kulanz- oder Nacharbeitsfall ist nur eine operative Einordnung.
- `P1-19-F32` — P1-19 trifft keine rechtliche Gewährleistungs-, Vertragsdeckungs- oder endgültige Abrechnungsentscheidung.
- `P1-19-F33` — „Erledigt“, „Ohne Einsatz geschlossen“ und „Duplikat“ verlangen einen sichtbaren Abschlussgrund.
- `P1-19-F34` — „Einsatz beendet“ und „technisches Problem gelöst“ bleiben unterschiedliche Bedeutungen; Nacharbeit kann offen bleiben.
- `P1-19-F35` — Eine Rückkehr zum Kunden wird über fortbestehenden Servicefall, Nachfassaktion und vorhandene Planung dargestellt statt durch eine still kopierte Arbeit.
- `P1-19-F36` — Jede fachliche Änderung verlangt einen Grund und erzeugt eine unveränderliche Verlaufstatsache.
- `P1-19-F37` — Büro/Admin verknüpfen zwei bestehende Fälle als „Duplikat von“, „Zugehörig“ oder „Fortsetzung von“.
- `P1-19-F38` — Beide Fallidentitäten bleiben bei einer Beziehung erhalten; kein Fall wird still zusammengeführt oder gelöscht.
- `P1-19-F39` — Ein Fall kann nicht mit sich selbst verknüpft werden.
- `P1-19-F40` — Eine Duplikatbeziehung verlangt einen fachlichen Grund und einen vorhandenen anderen Fall.
- `P1-19-F41` — Wiederkehrende Störungen können als Fortsetzung verknüpft werden, ohne frühere Aussagen oder Ergebnisse umzuschreiben.
- `P1-19-F42` — Ein Servicefall kann mit einem vorhandenen, passenden Auftrag verbunden und wieder bewusst davon gelöst werden.
- `P1-19-F43` — P1-19 erzeugt keinen zweiten Serviceauftrag, wenn ein passender Auftrag bereits existiert.
- `P1-19-F44` — Ein Besuch wird als vorhandener Kalendertermin für den verknüpften Auftrag geplant.
- `P1-19-F45` — Der Kalender bleibt Eigentümer von Zeitpunkt, Dauer, Zuordnung, Kapazität und Terminserien.
- `P1-19-F46` — Die vorhandene P1-12-Disposition bleibt Eigentümer von Revision, Empfängern, Bereitschaft und Versandstatus.
- `P1-19-F47` — Ein zugewiesener Mitarbeiter bestätigt oder hinterfragt den Einsatz über den vorhandenen Dispositionsablauf.
- `P1-19-F48` — Servicefall, Auftrag, Kalendertermin und Disposition bleiben getrennte, exakt verknüpfte Identitäten.
- `P1-19-F49` — Ein exakt dem Auftrag zugewiesener Mitarbeiter sieht im vorhandenen Einsatzpaket eine kompakte Servicezusammenfassung.
- `P1-19-F50` — Das Einsatzpaket zeigt Fallnummer, gemeldetes Problem und Dringlichkeit.
- `P1-19-F51` — Das Einsatzpaket zeigt die für den konkreten Besuch nötigen Zugangshinweise.
- `P1-19-F52` — Das Einsatzpaket zeigt nur die exakt mit dem Fall verknüpften Anlagen dieses Kunden und Einsatzorts.
- `P1-19-F53` — Anlagen werden mit ihrer bestehenden Nummer und Bezeichnung gezeigt, nicht als kopierter Servicetext.
- `P1-19-F54` — Interne Triagehinweise bleiben aus dem Mitarbeiter-Einsatzpaket ausgeschlossen.
- `P1-19-F55` — Vermutete Gewährleistung, Vertrag, Kulanz, Nacharbeit und Berechenbarkeit bleiben aus dem Mitarbeiter-Einsatzpaket ausgeschlossen.
- `P1-19-F56` — Der Mitarbeiter erhält keine serviceweite Fallliste, Kundenakte oder kaufmännische Serviceansicht.
- `P1-19-F57` — Kunden-, Einsatzort-, Projekt-, Anlagen- oder Komponentenbezug allein erweitert den Mitarbeiterzugriff nicht.
- `P1-19-F58` — Wird die Auftragszuweisung entzogen, endet auch der daraus abgeleitete Feldzugriff.
- `P1-19-F59` — Das Feldpaket verwendet weiterhin P1-14-Lebenszyklus, P1-15-Arbeitsnachweise, Dokumente, eigene Zeit und vorhandenes Material.
- `P1-19-F60` — P1-19 führt keine zweite mobile Anwendung, keinen zweiten Auftragslebenszyklus und keine zweite Mitarbeiter-Disposition ein.
- `P1-19-F61` — Ein Besuch wird mit einem vorhandenen P1-15-Arbeitsnachweis dokumentiert.
- `P1-19-F62` — Der Servicefall verknüpft die genaue unveränderliche Arbeitsnachweis-Revision statt Titel, Text oder Ergebnis zu kopieren.
- `P1-19-F63` — Nur Revisionen des exakt verknüpften Auftrags können als Servicebeleg gewählt werden.
- `P1-19-F64` — Eine spätere Arbeitsnachweis-Revision biegt einen bestehenden Servicebeleg nicht still um.
- `P1-19-F65` — Ein vorhandenes oder neu hochgeladenes Dokument wird über den Dokumenteigentümer exakt mit dem Servicefall verknüpft.
- `P1-19-F66` — Dateibytes bleiben im privaten R2-Pfad und werden weder kopiert noch durch eine Server Action geleitet.
- `P1-19-F67` — Dokumentmetadaten und Versionen bleiben beim Dokumenteigentümer; der Servicefall speichert nur den genauen Bezug.
- `P1-19-F68` — Eine Dokumentverknüpfung erweitert den Mitarbeiterzugriff nicht über dessen vorhandenen Auftragskontext.
- `P1-19-F69` — Büro/Admin legen eine P1-10-Nachfassaktion mit vorhandenem Manager-Eigentümer direkt aus dem Servicefall an.
- `P1-19-F70` — Die Nachfassaktion behält den Servicefall als genaue Quelle und erscheint über die vorhandene Kundenbeziehungs- und Aufmerksamkeitslogik.
- `P1-19-F71` — Serviceabschluss schließt eine offene Nachfassaktion nicht automatisch und erzeugt keine zweite Aufgabenlogik.
- `P1-19-F72` — Arbeitsnachweise, Dokumente und Nachfassaktionen bleiben eigenständige Datensätze mit eigener Berechtigung und Historie.
- `P1-19-F73` — Jede Servicefall-Mutation prüft die erwartete Version; ein veralteter Stand überschreibt keinen neueren Stand.
- `P1-19-F74` — Zwei Büropersonen können denselben Fall öffnen; der erste gültige Schreibstand gewinnt und der zweite erhält eine konkrete Veraltet-Meldung.
- `P1-19-F75` — Eine identische Anfrage-ID mit identischem Inhalt ist idempotent und erzeugt keine zweite Fall- oder Verlaufszeile.
- `P1-19-F76` — Dieselbe Anfrage-ID mit abweichendem Inhalt wird ohne Teilmutation abgewiesen.
- `P1-19-F77` — Erstellung, Anfrageübernahme, Aktualisierung, Beziehung und Belegverknüpfung schreiben Wurzel und unveränderlichen Verlauf atomar.
- `P1-19-F78` — Der Verlauf bewahrt Akteur, Zeitpunkt, Grund, Anfrage-ID sowie Vorher- und Nachherstand.
- `P1-19-F79` — Anfrageübernahme, Auftrags- und Anlagenbezug, Beziehung, Beleg und Dokument erscheinen als strukturierte verknüpfte Historie.
- `P1-19-F80` — Die Historie ist weder ein zweiter Dokumentordner noch ein einziges unstrukturiertes Notizfeld.
- `P1-19-F81` — Änderungen an der veränderlichen Servicefallwurzel aktualisieren eine zweite Managersitzung über den zentralen Realtime-Abgleich.
- `P1-19-F82` — Ereignisse, Beziehungen und Belegzeilen bleiben unveröffentlicht; die Wurzel signalisiert das autoritative Nachladen.
- `P1-19-F83` — Fokus- und Sichtbarkeitsrückkehr gleichen den letzten autoritativen Serverstand ab.
- `P1-19-F84` — Ein später Aktualisierungsfehler darf keinen neuen Leerstand als Wahrheit darstellen; der letzte bekannte Stand bleibt als veraltet erkennbar.
- `P1-19-F85` — Admin und Büro dürfen Servicefälle lesen, anlegen, triagieren und verknüpfen.
- `P1-19-F86` — Mitarbeiter dürfen Servicefallwurzeln, Ereignisse, Beziehungen und Belege nicht direkt lesen oder verändern.
- `P1-19-F87` — Mitglieder einer fremden Organisation sehen weder Falltext noch Fallnummer, Verlauf, Beziehung, Beleg oder Dokumentbezug.
- `P1-19-F88` — Organisationsgrenzen werden in Tabellenrichtlinien und bei jeder serverseitigen Mutation erneut erzwungen.
- `P1-19-F89` — Listen-, Detail-, Formular-, Beleg-, Beziehungs- und Nachfassaktionen sind auf Deutsch beschriftet und per Tastatur erreichbar.
- `P1-19-F90` — Dialoge besitzen sichtbaren Fokus, verständliche Screenreader-Namen, klare Fehlertexte und ausreichend große primäre Bedienziele.
- `P1-19-F91` — Das erste Laden und das Nachladen zeigen ehrliche Lade- oder Fehlerzustände statt einen erfundenen leeren Servicebestand.
- `P1-19-F92` — P1-19 erzeugt weder Wartungsplan, Vertragsschutz, Wiederholung, Fälligkeit, nächste Wartung noch Verlängerungsrisiko.
- `P1-19-F93` — P1-19 erzeugt weder Arbeits-, Reise-, Pausen-, Bereitschafts- oder Rufbereitschaftssegment und verändert keine Zeitbuchung.
- `P1-19-F94` — Planung, Triage, Disposition, Abschluss und Dokumentation erzeugen weder Reservierung, Bestandsbewegung, Verbrauch, Lieferantenretoure noch Garantie-Rücksendung.
- `P1-19-F95` — P1-19 erzeugt weder Preis, Angebot, Vertrag, Rechnung, Buchung, endgültige Abrechenbarkeit noch ausgehende Kundennachricht.
- `P1-19-F96` — P1-19 führt weder Offline-Warteschlange, native mobile Hülle, externen Connector, Herstellerregelwerk, Telemetrie, Ferndiagnose, automatische Diagnose noch rechtliche Gewährleistungsklassifikation ein.

**Acceptance invariant:** `96/96 mapped; 96/96 fully evidenced; 0 partial; 0 unmapped` (accepted 2026-08-30).

### `P1-20` — Wartungspläne und operative Abdeckung (2026-08-31)

- `P1-20-F01` — Büro/Admin öffnen unter `/service/wartung` eine gemeinsame Wartungsübersicht; Mitarbeiter werden von der managerweiten Route weggeleitet.
- `P1-20-F02` — Die Übersicht trennt fällige Arbeit, Wartungspläne und operative Abdeckungen in klar benannte Ansichten.
- `P1-20-F03` — Ein ehrlicher Leerzustand erklärt, dass ohne bewusst angelegte Abdeckung und Pläne keine Wartungsarbeit existiert.
- `P1-20-F04` — Büro/Admin durchsuchen Wartungsdaten nach Plan, Kunde, Einsatzort, Anlage oder Referenz, ohne beim Lesen Fachzeilen anzulegen.
- `P1-20-F05` — Status- und Fälligkeitsfilter verändern nur die Ansicht und erzeugen weder Fälligkeit noch Termin.
- `P1-20-F06` — Eine operative Abdeckung gehört genau zu einem vorhandenen Kunden und einem vorhandenen Einsatzort dieses Kunden.
- `P1-20-F07` — Die Abdeckung erhält eine freie betriebliche Referenz, einen begrenzten Status und optional eingegebene Gültigkeitsdaten.
- `P1-20-F08` — Kündigungs-, Verlängerungs- und interne Prüfdaten bleiben eingegebene operative Tatsachen statt errechneter Vertragsbehauptungen.
- `P1-20-F09` — Fehlende Abdeckungsdaten bleiben sichtbar unbekannt; WerkFlow leitet sie nicht aus Dokumenten, Garantie, Auftrag oder Notiz ab.
- `P1-20-F10` — Ein sichtbares Verlängerungs- oder Prüfrisiko ist ein interner Hinweis und keine automatische Vertragsverlängerung oder Kündigung.
- `P1-20-F11` — Eine operative Notiz bleibt manager-intern und wird nicht in das Einsatzpaket eines Mitarbeiters projiziert.
- `P1-20-F12` — Eine Abdeckung enthält weder Preis, Leistungsposition, Rechtsauslegung, Rechnung noch kaufmännischen Vertragsstatus.
- `P1-20-F13` — Jeder Wartungsplan erhält eine stabile organisationsweit eindeutige Plannummer.
- `P1-20-F14` — Ein Plan gehört genau zu einem vorhandenen Kunden und einem vorhandenen Einsatzort dieses Kunden.
- `P1-20-F15` — Ein Plan referenziert mindestens eine genaue installierte Anlage oder Komponente dieses Einsatzorts.
- `P1-20-F16` — Anlagen-, Komponenten-, Kunden- und Einsatzortidentitäten bleiben bei P1-18 und werden nicht in Wartungstext kopiert.
- `P1-20-F17` — Ein Plan referenziert genau eine veröffentlichte P1-13-Arbeitsvorlagenversion.
- `P1-20-F18` — Eine unveröffentlichte, archivierte, gelöschte oder zielartfremde Vorlagenversion kann keinen neuen aktiven Plan tragen.
- `P1-20-F19` — Aufgaben, Nachweise, Abhängigkeiten, Materialhinweise und Qualifikationen bleiben in der genauen Vorlagenversion nachvollziehbar.
- `P1-20-F20` — Spätere Vorlagenänderungen biegen eine gespeicherte Planrevision oder einen erzeugten Besuchsauftrag nicht still um.
- `P1-20-F21` — Ein Plan kann eine vorhandene operative Abdeckung desselben Kunden und Einsatzorts referenzieren.
- `P1-20-F22` — Eine Abdeckung ist für den Plan optional; fehlende Abdeckung wird nicht als fehlender rechtlicher Vertrag interpretiert.
- `P1-20-F23` — Ein Plan speichert einen Wirksamkeitsbeginn, ein erstes Fälligkeitsdatum, ein positives Monatsintervall und eine ausgewählte Nächste-Fälligkeit-Basis.
- `P1-20-F24` — Plananweisungen ergänzen den betrieblichen Kontext, ersetzen aber weder Checkliste noch Arbeitsnachweis.
- `P1-20-F25` — Jede Planrevision bewahrt die damaligen Kunden-, Einsatzort-, Anlagen-, Vorlagen-, Intervall-, Basis- und Anweisungsfakten unveränderlich.
- `P1-20-F26` — Ein neuer Plan beginnt als Entwurf und erzeugt noch keine fällige Arbeit.
- `P1-20-F27` — Die bewusste Aktivierung erzeugt einen verständlichen 18-Monats-Horizont serviceeigener Fälligkeiten.
- `P1-20-F28` — Normales Öffnen, Suchen, Filtern, Fokusrückkehr und Realtime-Nachladen erzeugen keine neue Fälligkeit.
- `P1-20-F29` — Anlage, Aktivierung, Revision, Fortsetzung, Abschluss und ausdrückliche Horizonterweiterung dürfen den Horizont idempotent vorziehen.
- `P1-20-F30` — Wiederholte Generierung mit demselben Stand erzeugt keine doppelte Fälligkeit.
- `P1-20-F31` — Jede Fälligkeit besitzt eine stabile Identität aus Planrevision, geplanter Sequenz und genauer Anlage.
- `P1-20-F32` — Mehrere Anlagen eines Plans behalten getrennte Fälligkeitsidentitäten, auch wenn sie später denselben Besuch teilen.
- `P1-20-F33` — Monatsfolgen verwenden geklemmte Kalendermonate; ein nicht vorhandener Monatstag verrutscht nicht in den Folgemonat.
- `P1-20-F34` — Der erzeugte Horizont ist begrenzt und kann nur bewusst in weiteren begrenzten Abschnitten erweitert werden.
- `P1-20-F35` — Offene Fälligkeiten zeigen Plannummer, Kunde, Einsatzort, Anlage, Solltermin und aktuellen Arbeitsbezug.
- `P1-20-F36` — Überfälligkeit wird aus einer offenen, zeitlich vergangenen Fälligkeit abgeleitet und nicht als eigener widersprüchlicher Status gespeichert.
- `P1-20-F37` — Ein fehlender Besuch bleibt als offene Fälligkeit sichtbar und wird nicht durch einen leeren Kalender als erledigt dargestellt.
- `P1-20-F38` — Fällige Arbeit entsteht ohne Auftrag, Kalendertermin, Disposition, Zeitbuchung oder Bestandsbewegung.
- `P1-20-F39` — Zwei gleichzeitig aktive Pläne für dieselbe genaue Anlage und überlappenden Umfang verlangen einen sichtbaren fachlichen Grund.
- `P1-20-F40` — Ein fehlender Überlappungsgrund weist die Anlage atomar ab und hinterlässt keinen zweiten Plan oder Teilverlauf.
- `P1-20-F41` — Ein begründeter überlappender Plan bleibt mit eigener Identität, Revision, Fälligkeit und Historie erhalten.
- `P1-20-F42` — Der Planstatus ist genau „Entwurf“, „Aktiv“, „Pausiert“ oder „Beendet“.
- `P1-20-F43` — Büro/Admin pausieren einen aktiven Plan nur mit einem sichtbaren Grund.
- `P1-20-F44` — Pausieren erzeugt keine neuen Fälligkeiten und löscht weder bestehende Arbeit noch abgeschlossene Historie.
- `P1-20-F45` — Büro/Admin setzen einen pausierten Plan bewusst fort; die Fortsetzung kann den begrenzten Horizont idempotent auffüllen.
- `P1-20-F46` — Büro/Admin beenden einen Plan nur mit Grund; ein beendeter Plan kann nicht still reaktiviert werden.
- `P1-20-F47` — Archivieren ändert nur die normale Sichtbarkeit und ist erst nach Beendigung zulässig.
- `P1-20-F48` — Ein aktiver oder pausierter Plan kann nicht archiviert werden, um offene Arbeit oder Historie zu verstecken.
- `P1-20-F49` — Eine fachliche Planänderung erzeugt eine neue unveränderliche Revision statt alte Definitionen zu überschreiben.
- `P1-20-F50` — Eine neue Revision schreibt abgeschlossene, übersprungene, abgebrochene oder bereits verknüpfte Fälligkeiten nicht um.
- `P1-20-F51` — Eine offene Fälligkeit kann bewusst übersprungen, abgebrochen oder durch eine neue Revision abgelöst werden; diese Bedeutungen bleiben getrennt.
- `P1-20-F52` — Überspringen und Abbrechen verlangen einen fachlichen Grund und bewahren die ursprüngliche Sollfälligkeit.
- `P1-20-F53` — „Abgelöst“ bezeichnet nur einen nachvollziehbaren Revisionswechsel und ist kein versteckter Abschluss.
- `P1-20-F54` — Mehrere kompatible Fälligkeiten dürfen bewusst in einem vorhandenen Besuchsauftrag zusammengeführt werden.
- `P1-20-F55` — Zusammengeführte Fälligkeiten behalten getrennte Identitäten, Anlagen, Ergebnisse und nächste Termine.
- `P1-20-F56` — Die Besuchserstellung ist eine bewusste Manageraktion und kein Nebeneffekt des Lesens oder der Horizonterzeugung.
- `P1-20-F57` — Ein Besuch ist ein normaler Auftrag mit eigener stabiler Auftragsnummer und dem vorhandenen Kunden-/Einsatzortbezug.
- `P1-20-F58` — Der Besuchsauftrag erhält die genaue veröffentlichte Vorlagenversion der Fälligkeit über den bestehenden P1-13-Anwendungsweg.
- `P1-20-F59` — Checkliste, erwartete Nachweise, Materialhinweise und Qualifikationsanforderungen werden als bearbeitbare auftragseigene Planung angewendet.
- `P1-20-F60` — Die Wartungsoberfläche kopiert keine privaten Job-Inserts und umgeht keine vorhandene Kunden-, Einsatzort-, Vorlagen- oder Qualifikationsprüfung.
- `P1-20-F61` — Wiederholtes Auslösen mit derselben Anfrage-ID liefert denselben Besuchsbezug statt eines zweiten Auftrags.
- `P1-20-F62` — Gleiche Anfrage-ID mit abweichendem Inhalt wird ohne zweiten Auftrag und ohne Teilverknüpfung abgewiesen.
- `P1-20-F63` — Die Fälligkeit wechselt erst nach erfolgreicher atomarer Auftragsverknüpfung auf „Besuch angelegt“.
- `P1-20-F64` — Ein Besuchsauftrag ist noch kein Kalendertermin; die Planung bleibt eine getrennte bewusste Manageraktion.
- `P1-20-F65` — Der geplante Besuch verwendet eine normale P1-11-Auftragsvorkommnis-Identität mit Datum, Zeit und Zuordnung.
- `P1-20-F66` — Kapazität, Qualifikationsabdeckung, Teamauflösung und Planungshinweise bleiben bei P1-11.
- `P1-20-F67` — Das Verschieben eines einzelnen Termins ändert weder Wartungsintervall noch Planrevision, Sollfälligkeit oder andere Besuche.
- `P1-20-F68` — P1-11-Einzel-, Zukunfts- und Serienänderungen bleiben Terminsemantik und werden nicht als Wartungsdefinitionsänderung missverstanden.
- `P1-20-F69` — Ein abgesagter oder ausgelassener Kalendertermin schließt die serviceeigene Fälligkeit nicht automatisch.
- `P1-20-F70` — Auftrag, Vorkommnis und Fälligkeit bleiben drei getrennte, exakt verknüpfte Identitäten.
- `P1-20-F71` — Ein exakt dem Besuchsauftrag zugewiesener Mitarbeiter sieht im vorhandenen Einsatzpaket einen kompakten Wartungskontext.
- `P1-20-F72` — Der Feldkontext zeigt Plannummer, genaue Anlage, Solltermin und operative Anweisungen für diesen Besuch.
- `P1-20-F73` — Der Feldkontext verwendet vorhandene Auftragsschritte, Arbeitsnachweise, Dokumente, eigene Zeit und Materialaktionen statt eines zweiten mobilen Ablaufs.
- `P1-20-F74` — Abdeckungsdaten, Verlängerungsrisiko, interne Prüfung und managerinterne Notizen bleiben aus dem Feldkontext ausgeschlossen.
- `P1-20-F75` — Eine nicht zugewiesene Person erhält keinen Wartungskontext; Entzug der Auftragszuweisung beendet den abgeleiteten Zugriff.
- `P1-20-F76` — Kunden-, Einsatzort-, Anlagenwurzel-, Komponenten-, Plan- oder Abdeckungsnähe allein erweitert den Mitarbeiterzugriff nicht.
- `P1-20-F77` — Der normale P1-14-Lebenszyklus steuert Start, Unterbrechung, Fortsetzung und Ausführungsabschluss des Besuchs.
- `P1-20-F78` — „Ausführung abgeschlossen“ bedeutet nicht automatisch „Wartung vollständig belegt“ oder „technisches Problem gelöst“.
- `P1-20-F79` — Ein Wartungsabschluss referenziert eine genaue unveränderliche eingereichte P1-15-Arbeitsnachweisrevision des genauen Besuchsauftrags.
- `P1-20-F80` — Eine spätere Nachweisrevision biegt den gespeicherten Wartungsbeleg nicht still um.
- `P1-20-F81` — Fehlt der erforderliche genaue Nachweis, bleibt die Fälligkeit offen und die Oberfläche erklärt den fehlenden Abschlussbeleg.
- `P1-20-F82` — Der Abschlussstatus „Vollständig“, „Teilweise“ oder „Ungeklärt“ bleibt getrennt vom Fälligkeitsstatus „Abgeschlossen“.
- `P1-20-F83` — „Teilweise“ und „Ungeklärt“ bewahren eine sichtbare Begründung und können Folgearbeit auslösen, ohne sie als erledigt auszugeben.
- `P1-20-F84` — Der Abschluss verknüpft die genaue Anlage und den Besuch nachvollziehbar mit der vorhandenen P1-18-Anlagenhistorie.
- `P1-20-F85` — Die nächste Fälligkeit folgt entweder der geplanten Sollfälligkeit oder dem tatsächlichen Abschlussdatum gemäß der gespeicherten Planrevision.
- `P1-20-F86` — Fehlendes oder widersprüchliches Abschlussdatum erzeugt eine sichtbare Ausnahme statt eines erfundenen nächsten Termins.
- `P1-20-F87` — Der berechnete nächste Termin erweitert den begrenzten Horizont idempotent und erzeugt keine doppelte Fälligkeit.
- `P1-20-F88` — Abschluss, nächster Termin und Ergebnis schreiben keine rechtliche Vertragserfüllung, Abrechenbarkeit oder Mängelfreiheit fest.
- `P1-20-F89` — Büro/Admin verknüpfen einen vorhandenen passenden P1-19-Servicefall als reaktiven Kontext einer Fälligkeit oder eines Besuchs.
- `P1-20-F90` — Der Servicefall behält eigene Nummer, Triage, Status, Verlauf und Auftrag; P1-20 kopiert oder schließt ihn nicht.
- `P1-20-F91` — Nur ein Servicefall desselben Kunden und Einsatzorts kann verknüpft werden; fremde oder nur ähnliche Fälle werden abgewiesen.
- `P1-20-F92` — Büro/Admin legen aus einer Abdeckung eine normale P1-10-Wiedervorlage mit genauer Abdeckungsquelle und vorhandenem Manager-Eigentümer an.
- `P1-20-F93` — Abschluss, Pause, Beendigung oder Archivierung schließen eine offene Wiedervorlage nicht automatisch.
- `P1-20-F94` — Ein vorhandenes oder neu hochgeladenes Dokument wird über den typisierten Dokumenteigentümer genau mit der Abdeckung verknüpft.
- `P1-20-F95` — Dateibytes bleiben im privaten R2-Pfad; Verknüpfung und Upload kopieren keine Bytes und leiten sie nicht durch eine Server Action.
- `P1-20-F96` — Ein Abdeckungsdokument erweitert weder Mitarbeiterzugriff noch Kunden-, Plan- oder Anlagenberechtigungen.
- `P1-20-F97` — Jede Mutation prüft Organisation, Rolle, Zielbeziehungen, erwartete Version und Anfrage-ID erneut auf dem Server.
- `P1-20-F98` — Ein veralteter Plan-, Abdeckungs- oder Fälligkeitsstand überschreibt keinen neueren Stand und hinterlässt keine Teilmutation.
- `P1-20-F99` — Gleiche Anfrage-ID mit gleichem Inhalt ist idempotent; widersprüchliche Wiederverwendung wird atomar abgewiesen.
- `P1-20-F100` — Unveränderliche Ereignisse bewahren Akteur, Aufzeichnungszeit, Grund, Anfrage-ID sowie fachlichen Vorher-/Nachherkontext.
- `P1-20-F101` — Admin und Büro dürfen Wartungspläne, Fälligkeiten und operative Abdeckung lesen und verändern; Mitarbeiter dürfen die Wurzeln nicht direkt lesen oder schreiben.
- `P1-20-F102` — Mitglieder einer fremden Organisation sehen und verändern weder Plan, Revision, Fälligkeit, Abdeckung, Verknüpfung, Beleg noch Verlauf.
- `P1-20-F103` — Die drei veränderlichen Wurzeln Abdeckung, Plan und Fälligkeit aktualisieren Managersitzungen über den zentralen Realtime-Abgleich; unveränderliche Kindzeilen bleiben unveröffentlicht.
- `P1-20-F104` — Erstes Laden, Fehler, veralteter letzter Stand, Dialogaufschub, Fokus-/Sichtbarkeitsrückkehr, Tastatur, sichtbarer Fokus, deutsche Namen und ausreichend große Ziele folgen den vorhandenen gemeinsamen UI-Primitiven.
- `P1-20-F105` — P1-20 erzeugt ohne bewusste Fachaktion weder Altbestands-Backfill, Auftrag, Termin, Disposition, Nachricht, Zeitsegment, Bestand, Verbrauch, Bestellung, Preis, Vertrag, Rechnung, Rechtsbehauptung, Offline-Warteschlange, Connector, Herstellerregelwerk, Telemetrie noch automatische Diagnose.

**Acceptance invariant:** `105/105 mapped; 105/105 fully evidenced; 0 partial; 0 unmapped` (accepted 2026-08-31).

### `P1-21` — Explizite Zeitsegmente (2026-08-31)

- `P1-21-F01` — Ein Mitarbeiter startet seine eigene Zeiterfassung über eine eindeutige, touchfreundliche Hauptaktion; WerkFlow zeigt die laufende Aktivität und verstrichene Zeit.
- `P1-21-F02` — Admin und Büro verwenden für die eigene Zeit dieselbe Erfassung; P1-21 erlaubt ihnen keine spontane Live-Steuerung fremder Sitzungen.
- `P1-21-F03` — Ein Start erzeugt genau eine stabile Anwesenheitssitzung und genau ein offenes Aktivitätssegment.
- `P1-21-F04` — Ein Mitarbeiter beendet seine laufende Erfassung bewusst; Sitzung und letztes Segment schließen in einem atomaren Schritt.
- `P1-21-F05` — „Arbeit“ erfasst produktive Arbeit getrennt von Fahrt, Pause, Bereitschaft, Notdienst und interner Tätigkeit.
- `P1-21-F06` — „Fahrt“ erfasst Fahrzeit als eigenes Segment und verlangt eine sichtbare Strecke und Rolle.
- `P1-21-F07` — Die Fahrstrecke bleibt eine begrenzte Auswahl wie Lager, Zuhause und Einsatzort statt frei erfundener Routingdaten.
- `P1-21-F08` — Die Fahrrolle bleibt Fahrer/in, Mitfahrer/in oder ausdrücklich unbekannt; WerkFlow berechnet weder Kilometer noch Kosten.
- `P1-21-F09` — „Pause“ unterbricht die laufende Aktivität, ohne die Anwesenheitssitzung zu beenden.
- `P1-21-F10` — Nach einer Pause setzt der Mitarbeiter bewusst Arbeit oder eine andere Aktivität fort; die Pause wird dabei atomar geschlossen.
- `P1-21-F11` — Bei automatischer Pausenregel ist die manuelle Pausenaktion nicht verfügbar und ein direkter manueller Pausenversuch wird serverseitig abgewiesen.
- `P1-21-F12` — Die automatische Pausenberechnung bleibt von tatsächlich gestempelten Segmenten getrennt und wird nicht als Mitarbeiterhandlung gespeichert.
- `P1-21-F13` — „Bereitschaft“ erfasst Bereitschaft getrennt von aktiver Arbeit oder einem Notdiensteinsatz.
- `P1-21-F14` — Bereitschaft bewahrt den gewählten Kontext vor Ort, extern oder unbekannt, ohne daraus Vergütung abzuleiten.
- `P1-21-F15` — „Notdienst“ erfasst einen aktiven Einsatz als eigenes Segment und nicht als Bereitschaft.
- `P1-21-F16` — „Intern“ verwendet eine feste praktische Auswahl für Betriebsarbeit, Besprechung, Schulung oder Sonstiges.
- `P1-21-F17` — Arbeit, Notdienst und Fahrt können einem vorhandenen passenden Auftrag zugeordnet werden.
- `P1-21-F18` — Arbeit, Notdienst und Fahrt können ausdrücklich „Ohne Auftrag“ erfasst werden; fehlende Zuordnung verliert keine Zeit.
- `P1-21-F19` — Ein Mitarbeiter wählt standardmäßig nur relevante zugewiesene Aufträge; eine fremde Zuordnung wird bei der Schreibaktion erneut abgewiesen.
- `P1-21-F20` — Pause, Bereitschaft und interne Tätigkeit tragen keine fingierte Auftragszuordnung.
- `P1-21-F21` — Direkte Projekt- oder Kundenzuordnung entsteht nicht; ein Auftrag liefert diesen vorhandenen Kontext.
- `P1-21-F22` — Ein Auftragswechsel beendet nur das aktuelle Segment und startet ein neues Segment in derselben Anwesenheitssitzung.
- `P1-21-F23` — Jeder Aktivitätswechsel schließt das vorherige und öffnet das neue Segment in derselben Datenbanktransaktion.
- `P1-21-F24` — Ein fehlgeschlagener Wechsel hinterlässt weder ein halb geschlossenes Segment noch einen fälschlich bestätigten UI-Stand.
- `P1-21-F25` — Jede gültige Mutation prüft die erwartete Sitzungsversion; ein veraltetes Gerät überschreibt keinen neueren Stand.
- `P1-21-F26` — Derselbe Wiederholungsauftrag mit gleichem Inhalt liefert dasselbe Ergebnis und erzeugt kein zweites Segment.
- `P1-21-F27` — Dieselbe Anfrage-ID mit abweichendem Inhalt wird ohne Teilmutation abgewiesen.
- `P1-21-F28` — Gleichzeitige Aktionen zweier Geräte werden pro Mitarbeiter und Organisation serialisiert; nur ein gültiger Folgezustand gewinnt.
- `P1-21-F29` — Eine Person kann organisationsübergreifend nur eine offene Anwesenheitssitzung besitzen.
- `P1-21-F30` — Ein anderer Mitarbeiter kann parallel seine eigene unabhängige Sitzung führen.
- `P1-21-F31` — Jedes Segment besitzt eine stabile Identität, die bei Tages-, Wochen-, Kalender-, Auftrags- und Übergabeansichten erhalten bleibt.
- `P1-21-F32` — Eine über Mitternacht laufende Aktivität bleibt ein Segment; die Europe/Berlin-Tagesanzeige teilt nur die Darstellung.
- `P1-21-F33` — Ein geteilter Arbeitstag mit mehreren Sitzungen bleibt als getrennte stabile Anwesenheit nachvollziehbar.
- `P1-21-F34` — Anwesenheit, Arbeit, Fahrt, Pause, Bereitschaft, Notdienst und interne Tätigkeit werden als getrennte Tatsachen summiert.
- `P1-21-F35` — Auftragsbezogene und ausdrücklich nicht zugeordnete Zeit bleiben getrennt sichtbar.
- `P1-21-F36` — Sollzeit und Überstundenanzeige verwenden weiterhin die P1-04-Ziele; P1-21 erfindet keine gutgeschriebene oder abrechenbare Zeit.
- `P1-21-F37` — Ein seit mehr als 24 Stunden offener Stand zeigt eine konkrete Wiederherstellung statt still weiterzulaufen.
- `P1-21-F38` — Der Mitarbeiter kann einen ungewöhnlich langen Stand bewusst fortsetzen oder beenden.
- `P1-21-F39` — Automatische Wiederherstellung wird als System-/Managerquelle mit Grund und Zeitpunkt festgehalten und nie als ursprüngliche Mitarbeiteraktion ausgegeben.
- `P1-21-F40` — Eine ungültige oder überlappende Sequenz wird atomar abgewiesen und bleibt als konkreter Fehler sichtbar.
- `P1-21-F41` — Ein vorhandener offener Legacy-Stempel bleibt nach dem Rollout nutzbar und wird bei der nächsten Aktion sichtbar in das kanonische Modell überführt.
- `P1-21-F42` — Die Legacy-Überführung schließt genau die offene Altsequenz, ohne frühere Zeitzeilen zu verändern oder historische Segmente zu erfinden.
- `P1-21-F43` — Alle vorhandenen Legacy-Zeitzeilen behalten Zeitstempel, Akteur, Status, Auftrag, Prüfung und ursprüngliche Bedeutung.
- `P1-21-F44` — Organisationen ohne neue Erfassung erhalten durch die Migration keine kanonischen Sitzungen, Segmente oder Ereignisse.
- `P1-21-F45` — Abmelden schließt eine eigene offene kanonische Sitzung nachvollziehbar, damit kein unsichtbarer Stand zurückbleibt.
- `P1-21-F46` — Das Entfernen eines Mitglieds schließt dessen offene Sitzung und Segment mit systemseitiger Attribution, bevor die Mitgliedschaft endet.
- `P1-21-F47` — Historische Zeit bleibt nach dem Entfernen oder Offboarding erhalten und weiterhin der damaligen Person zuordenbar.
- `P1-21-F48` — Mitarbeiter sehen nur ihre eigenen organisationsbezogenen kanonischen Zeitdaten.
- `P1-21-F49` — Admin und Büro sehen organisationsbezogene Mitarbeiterstände und Zeitprojektionen gemäß ihrer bestehenden Rolle.
- `P1-21-F50` — Außenstehende und Mitglieder einer fremden Organisation sehen weder Sitzung, Segment, Vorgang noch Ereignis.
- `P1-21-F51` — Direkte Client-Schreibrechte auf kanonische Tabellen bleiben gesperrt; jede Mutation läuft durch die erneut autorisierende Servergrenze.
- `P1-21-F52` — Laufende Sitzungs- und Segmentänderungen aktualisieren andere offene Ansichten über den zentralen Realtime-Abgleich.
- `P1-21-F53` — Unveränderliche Ereignis- und Vorgangszeilen bleiben unveröffentlicht; ein Wurzel-/Segment-Signal löst das autoritative Nachladen aus.
- `P1-21-F54` — Beim Organisationswechsel verwirft der Client einen Stand der vorherigen Organisation, statt ihn kurz als neuen Stand anzuzeigen.
- `P1-21-F55` — Auftrags- und Projektansichten verwenden dieselbe kanonische Kompatibilitätsprojektion und keinen zweiten lokalen Timer.
- `P1-21-F56` — Das zugewiesene Einsatzpaket startet oder wechselt Arbeit am aktuellen Auftrag über dieselbe globale Sitzung.
- `P1-21-F57` — Jobbezogene Arbeit oder Notdienst kann den vorhandenen P1-14-Ausführungsstart auslösen; reine Fahrt tut das nicht.
- `P1-21-F58` — P1-15-Arbeitsnachweise und P1-17-Übergaben lesen nachvollziehbare Zeitquellen, verändern oder klassifizieren sie aber nicht.
- `P1-21-F59` — Kalenderansichten unterscheiden weiterhin geplante Termine von tatsächlichen Zeitsegmenten; keine Seite schreibt die jeweils andere Wahrheit um.
- `P1-21-F60` — Kanonische Projektionen sind in alten Bearbeiten-, Löschen- und Änderungsantragswegen bis P1-22 sichtbar schreibgeschützt.
- `P1-21-F61` — Tastaturbedienung, sichtbarer Fokus, deutsche zugängliche Namen und große primäre Ziele bleiben im Aktivitätsdialog erhalten.
- `P1-21-F62` — Lade-, Netzwerk-, Veraltet- und Wiederherstellungsfehler behaupten keinen Erfolg und gleichen anschließend den Serverstand ab.
- `P1-21-F63` — P1-21 erzeugt keine Korrekturfreigabe, Zeitkonto-, Zuschlags-, Compliance-, Periodenabschluss-, Lohn-, Rechnungs- oder Billability-Entscheidung.
- `P1-21-F64` — P1-21 erzeugt ohne bewusste Zeitaktion weder Termin, Disposition, Wartungsarbeit, Dokument, Bestand, Verbrauch, Bestellung, Nachricht, Offline-Warteschlange noch externen Provideraufruf.

**Acceptance invariant:** `64/64 mapped; 64/64 fully evidenced; 0 partial; 0 unmapped` (accepted 2026-08-31).

### `P1-22` — Einheitliche Zeitkorrekturen und Freigaben (2026-09-01)

- `P1-22-F01` — Mitarbeiter öffnen aus ihrem persönlichen Verlauf eine geführte Zeitkorrektur; Kalender und Verlauf führen in dieselbe Korrekturdomäne.
- `P1-22-F02` — Admin und Büro verwenden für Korrekturen dieselbe Oberfläche und denselben nachvollziehbaren Datenpfad wie Mitarbeiter.
- `P1-22-F03` — Die Oberfläche unterstützt Nachtrag, Änderung, Entfernung, Aufteilung, Tätigkeitswechsel, Auftragswechsel, Mitarbeiterwechsel und vergessene Buchung als klar benannte Vorgänge.
- `P1-22-F04` — Eine Korrektur referenziert die genaue Ausgangsquelle und verändert weder deren ursprüngliche Erfassung noch unveränderliche kanonische Vorgänge oder Ereignisse.
- `P1-22-F05` — Jede Korrektur verlangt einen verständlichen Grund; Rückfrage und Ablehnung verlangen zusätzlich einen Kommentar.
- `P1-22-F06` — Vor dem Speichern zeigt WerkFlow den bisher wirksamen und den vorgeschlagenen Zustand getrennt.
- `P1-22-F07` — Die Vorschau zeigt Zeit, Person, Tätigkeit und Auftragszuordnung und erklärt die Änderung der wirksamen Dauer, ohne eine Zeitkonto- oder Abrechnungswirkung zu erfinden.
- `P1-22-F08` — Nachtrag und vergessene Buchung erzeugen neue vorgeschlagene Fakten ohne fingierte Ausgangsquelle.
- `P1-22-F09` — Eine Änderung ersetzt nach Freigabe nur die ausgewählten Zeitfakten und bewahrt die Ausgangsquelle im Verlauf.
- `P1-22-F10` — Eine Entfernung schlägt einen leeren Folgezustand vor und löscht die ursprüngliche Quelle nicht.
- `P1-22-F11` — Eine Aufteilung erzeugt mehrere nachvollziehbare Folgefakten und bleibt als spätere Korrektur erkennbar.
- `P1-22-F12` — Eine Tätigkeitsänderung bewahrt Zeit und Person, während die neue Tätigkeit ausdrücklich ausgewiesen wird.
- `P1-22-F13` — Ein Auftragswechsel bewahrt die Zeit und trennt „Ohne Auftrag“ von einem genauen vorhandenen Auftrag.
- `P1-22-F14` — Ein Mitarbeiterwechsel bewahrt ursprüngliche und angenommene Person und wird nur innerhalb der Zuständigkeit des Handelnden angewendet.
- `P1-22-F15` — Legacy-Eintrag, kanonische Sitzung, kanonisches Segment und bereits angewendete Korrektur sind unterscheidbare Quellarten derselben Korrekturdomäne.
- `P1-22-F16` — Ungültige Reihenfolgen, Zeitgrenzen, Formen, fremde Quellen oder unzulässige Ziele werden vor einer Teilanwendung sichtbar abgewiesen.
- `P1-22-F17` — Eine eigene Korrektur ist immer ein Antrag; es gibt kein Zeitfenster für eine direkte Selbstkorrektur.
- `P1-22-F18` — Ein zuständiger Admin oder Büro-Nutzer kann die Zeit einer anderen Person direkt und atomar korrigieren.
- `P1-22-F19` — Korrigiert Admin oder Büro die eigene Zeit, bleibt die Änderung bis zur Entscheidung einer anderen zuständigen Person ein Antrag.
- `P1-22-F20` — Jede Entscheidung löst `time_approval` am Handlungstag und für die betroffene Person erneut auf.
- `P1-22-F21` — Eine gültige zeitlich begrenzte Vertretung erbt nur den Umfang des vertretenen Freigabeverantwortlichen; nach Ablauf ist die Handlung gesperrt.
- `P1-22-F22` — Ohne ausdrückliche Konfiguration gilt der vorhandene rollenbasierte Zeitfreigabe-Fallback; eine Konfiguration ersetzt diesen Fallback.
- `P1-22-F23` — Fehlt eine zweite geeignete Freigabeperson, bleibt der Antrag sichtbar offen und wird nicht still selbst freigegeben.
- `P1-22-F24` — Auch Admin besitzt keinen Selbstfreigabe- oder Wiederherstellungs-Bypass für eigene Korrekturen.
- `P1-22-F25` — Ein eingereichter Vorschlag verändert bestätigte Zeitfakten nicht und erzeugt noch keine Korrekturanwendung.
- `P1-22-F26` — Tages- und Wochenansichten kennzeichnen vorgeschlagene Summen ausdrücklich als vorläufig und halten bestätigte Summen getrennt.
- `P1-22-F27` — Der Kalender zeigt einen offenen Vorschlag als vorläufigen tatsächlichen Zeitkontext, ohne ihn als bestätigte Zeit oder Planung auszugeben.
- `P1-22-F28` — Offene Anträge erscheinen im persönlichen Verlauf, in der Freigabeansicht und für zuständige Personen im gemeinsamen Aufgabenmuster.
- `P1-22-F29` — „Zur Prüfung“, „Rückfrage“, „Freigegeben“, „Abgelehnt“, „Zurückgezogen“ und „Anwendung fehlgeschlagen“ bleiben als verständliche Zustände sichtbar.
- `P1-22-F30` — Der Antragsteller kann einen eigenen offenen oder zur Klärung zurückgegebenen Antrag zurückziehen; Antrag und Verlauf bleiben erhalten.
- `P1-22-F31` — Eine Ablehnung verändert keine Zeitquelle und zeigt dem Antragsteller den Entscheidungsgrund.
- `P1-22-F32` — Eine Rückfrage verändert weder Quelle noch ursprüngliche Antragsrevision und zeigt die Frage im persönlichen Verlauf.
- `P1-22-F33` — Die Antwort auf eine Rückfrage erzeugt eine neue unveränderliche Revision und reicht genau diese Revision erneut ein.
- `P1-22-F34` — Eine Entscheidung oder erneute Einreichung mit veralteter Revisionsnummer überschreibt keinen neueren Antrag.
- `P1-22-F35` — Eine Freigabe erzeugt genau eine atomare Anwendung; identische Wiederholung liefert dasselbe Ergebnis statt einer zweiten Wirkung.
- `P1-22-F36` — Scheitert die Anwendung, behauptet WerkFlow keinen bestätigten Zeitstand und bewahrt den Fehlerzustand zur Klärung.
- `P1-22-F37` — Eine spätere Korrektur kann die genaue vorherige Anwendung als Quelle verwenden; Leser zeigen nur den neuesten wirksamen Stand der Kette.
- `P1-22-F38` — Dieselbe Ausgangsquelle kann nicht in zwei unabhängigen freigegebenen Anwendungen doppelt wirksam werden.
- `P1-22-F39` — Zuständige Personen wählen mehrere weiterhin einzeln sichtbare Anträge für eine gemeinsame Freigabe aus; unterschiedliche Gründe und Vorschauen bleiben erkennbar.
- `P1-22-F40` — Eine Stapelentscheidung ist vollständig atomar: eine veraltete oder unzulässige Position verhindert jede Teilfreigabe.
- `P1-22-F41` — Antrag, Revision, Entscheidung, Anwendung und Ereignis bewahren Organisation, Person, Antragsteller, Akteur, Prüfer, Zeitpunkte, Grund, Kommentar sowie Vorher-/Nachherzustand.
- `P1-22-F42` — Freigegebene, abgelehnte, zurückgezogene und zur Klärung zurückgegebene Vorgänge verschwinden nicht aus der persönlichen und berechtigten Managerhistorie.
- `P1-22-F43` — Historien und Freigabelisten sind begrenzt, deterministisch sortiert und behalten bei Ladefehlern den letzten bekannten Stand, während veraltete Aktionen gesperrt sind.
- `P1-22-F44` — Mitarbeiter sehen ihre eigenen Korrekturen; Admin und Büro sehen organisationsbezogene Historie, aber nur wirksame `time_approval`-Inhaber erhalten Entscheidungsaktionen.
- `P1-22-F45` — Mitglieder einer fremden Organisation sehen weder Antrag, Revision, Quelle, Ereignis noch Anwendung.
- `P1-22-F46` — Direkte Client-Schreibrechte bleiben gesperrt; öffentliche Korrektur-RPCs sind nur für die Service-Rolle ausführbar und prüfen Organisation und Akteur erneut.
- `P1-22-F47` — Änderungen der veränderlichen Antragswurzel aktualisieren offene Verlauf-, Aufgaben-, Kalender- und Summenansichten über den zentralen Realtime-Abgleich; unveränderliche Kindtabellen bleiben unveröffentlicht.
- `P1-22-F48` — Zeit-, Kalender-, Auftrags- und Projektleser verwenden dieselbe bestätigte Korrekturprojektion, unterdrücken ersetzte Quellen und kopieren keine zweite Zeitwahrheit.
- `P1-22-F49` — Eine Zeitkorrektur plant keinen Termin um und erzeugt weder Disposition, Bestand, Dokument, Nachricht, kommerzielle Entscheidung, Abrechnung, Lohnlauf, Offline-Warteschlange noch Provideraufruf.
- `P1-22-F50` — P1-22 reserviert den verständlichen Fehler `period_closed` für den späteren Periodenbesitzer, führt aber selbst weder Periodenabschluss noch Wiedereröffnung, Zeitkonto oder Export ein.

**Acceptance invariant:** `50/50 mapped; 50/50 fully evidenced; 0 partial; 0 unmapped` (accepted 2026-09-01).

### `P1-23` — Zeitkonten, Periodenabschluss und Lohnexport (2026-09-01)

- `P1-23-F01` — Die Organisation verwendet zunächst vollständige Kalendermonate in `Europe/Berlin`; jede Periode bewahrt ihre ausdrücklichen Grenzen für eine spätere, separat entschiedene Stichtagslogik.
- `P1-23-F02` — Eine datierte, bestätigte Standardregel gilt organisationsweit, solange keine datierte Mitarbeiterzuordnung sie ersetzt.
- `P1-23-F03` — Admin kann benannte Ausnahmeregeln anlegen und einem Mitarbeiter ohne überlappende Gültigkeitsbereiche zuordnen.
- `P1-23-F04` — Bestätigte Regelversionen bleiben historisch unveränderlich; eine neue Konfiguration erzeugt eine neue Version.
- `P1-23-F05` — Die sechs vorhandenen Tätigkeiten behalten ihre Rohzeit und erhalten getrennte Gutschriften von 0, 50 oder 100 Prozent.
- `P1-23-F06` — Fahrtgutschrift unterscheidet Hin-/Rückweg sowie Fahrer/Beifahrer, Bereitschaft unterscheidet Betrieb/zu Hause.
- `P1-23-F07` — Urlaub und Krankheit werden je Regel ausdrücklich als bezahlt, unbezahlt oder informativ eingestuft, ohne den Abwesenheitsdatensatz umzuschreiben.
- `P1-23-F08` — Nacht-, Sonntags- und Organisationsfeiertagsminuten werden quellenbezogen klassifiziert, ohne Zuschlagsbetrag, Lohn oder Rechtsaussage zu berechnen.
- `P1-23-F09` — Überlappende Zuschlagsklassifikationen bleiben nicht additiv und werden nicht zu einer erfundenen Gesamtsumme zusammengezogen.
- `P1-23-F10` — Nachtklassifikation bleibt deaktiviert, bis ein ausdrückliches lokales Zeitfenster bestätigt wurde.
- `P1-23-F11` — Ein Zeitkonto entsteht nur durch eine ausdrückliche Admin-Eröffnung mit Anfangssaldo, Wirksamkeitsdatum und Grund; null Minuten sind eine bewusste Bestätigung.
- `P1-23-F12` — Die Einführung rekonstruiert keine Anfangssalden aus lückenhaften historischen Buchungen und erzeugt beim Rollout keine Konten.
- `P1-23-F13` — Ein Konto zeigt Anfangssaldo, unveränderliche Ereignisse, Periodenbewegungen und aktuellen Saldo nachvollziehbar getrennt.
- `P1-23-F14` — Admin und Büro können Korrektur-, Verfall- oder Auszahlungsvorgänge in Minuten beantragen; kein Vorgang berechnet Geld.
- `P1-23-F15` — Eine andere wirksame `time_approval`-Person muss eine Kontobewegung freigeben; Selbstfreigabe bleibt ausgeschlossen.
- `P1-23-F16` — Eine abgelehnte Kontobewegung verändert weder Saldo noch Kontoversion und bleibt mit Entscheidungsgrund erhalten.
- `P1-23-F17` — Wiederholte identische Kontooperationen liefern dieselbe Wirkung; veraltete erwartete Versionen überschreiben keinen neueren Stand.
- `P1-23-F18` — Es gibt keinen automatischen Höchstsaldo, Verfall, Ausgleich, Auszahlung oder Verzicht.
- `P1-23-F19` — Eine Periodenberechnung umfasst alle im Monat beschäftigten Personalakten, auch Personen ohne App-Zugang.
- `P1-23-F20` — Fehlendes Zeitkonto, fehlende bestätigte Regel, fehlender verlässlicher Sollplan oder unklassifizierte Abwesenheit bleibt je Mitarbeiter als Abschlussblocker sichtbar.
- `P1-23-F21` — WerkFlow verwendet den datierten Sollplan, Feiertagsbereich, Betriebsruhetage, genehmigten Urlaub und Krankheitszeitraum aus ihren jeweiligen Quelldomänen.
- `P1-23-F22` — Legacy-Buchungen, kanonische Sitzungen/Segmente und die neueste freigegebene Korrekturprojektion fließen in dieselbe bestätigte Berechnung ein, ohne eine zweite Zeiterfassung zu erzeugen.
- `P1-23-F23` — Ersetzte kanonische oder Legacy-Quellen werden nach einer freigegebenen Korrektur nicht doppelt angerechnet.
- `P1-23-F24` — Nur Zeitanteile innerhalb der Periodengrenzen werden berücksichtigt; über Nacht laufende Arbeit wird nach Berliner Kalendertagen getrennt.
- `P1-23-F25` — Exakte Quellsekunden werden je Mitarbeiter, Tag und Tätigkeitskontext gesammelt und erst dann auf ganze Minuten gerundet; 30 Sekunden runden auf.
- `P1-23-F26` — Quelle, Gutschrift und Rundungsdifferenz bleiben getrennt gespeichert und in den Kontrollsummen prüfbar.
- `P1-23-F27` — Soll, Rohzeit, gutgeschriebene Zeit, Urlaub, Krankheit, Kontobewegung, Periodendifferenz und Schlusssaldo bleiben unterscheidbar.
- `P1-23-F28` — Auftrags- und Projektzuordnungen bleiben je Zeitquelle erhalten; nicht zugeordnete Zeit wird ausdrücklich als Prüfhinweis gezeigt.
- `P1-23-F29` — Fehlende Buchung, offene Sitzung, Überlappung, offene Korrektur und objektiv fehlende Stammdaten behaupten keine Abschlussreife.
- `P1-23-F30` — Regelbasierte Pausen-, Tagesdauer-, Ruhezeit-, Nacht-, Sonntags- und Feiertagshinweise beginnen als verständliche, konfigurierbare Hinweise und nicht als Rechtsbescheinigung.
- `P1-23-F31` — Hinweise unterscheiden Information, Freigabe erforderlich und Abschluss gesperrt.
- `P1-23-F32` — Eine freigabepflichtige Feststellung verlangt eine Entscheidung mit Grund und aktueller `time_approval`-Berechtigung.
- `P1-23-F33` — Positive Periodendifferenz bleibt Überstundenkandidat und muss vor Abschluss durch eine andere zuständige Person freigegeben werden.
- `P1-23-F34` — Negative Zeit bleibt sichtbar und wird nicht still verworfen; nur eine ausdrücklich konfigurierte Feststellung kann zusätzlich sperren.
- `P1-23-F35` — Eine Neuberechnung erzeugt einen neuen unveränderlichen Versuch und bewahrt frühere Berechnungen und Entscheidungen.
- `P1-23-F36` — Ändern sich Zeit, Korrektur, Personal, Plan, Abwesenheit, Regel, Konto oder Organisationskalender nach der Vorbereitung, verweigert der Abschluss die veraltete Berechnung.
- `P1-23-F37` — Nur ein vollständig vergangener Kalendermonat kann abgeschlossen werden.
- `P1-23-F38` — Der Abschluss sperrt Organisation und Periode transaktional, prüft die vollständige Belegschaft erneut und erzeugt genau eine unveränderliche Abschlussversion.
- `P1-23-F39` — Der Abschluss bucht je einbezogenem Konto genau eine nachvollziehbare Periodenbewegung und stimmt Konten- und Periodenkontrollsummen ab.
- `P1-23-F40` — Nach Abschluss verweigern betroffene gewöhnliche Zeit- und Korrekturanwendungen die Wirkung mit `period_closed`.
- `P1-23-F41` — Nur Admin kann eine Periode mit Grund wieder öffnen; der alte Abschluss und seine Exportdateien bleiben unverändert erhalten.
- `P1-23-F42` — Wiederöffnung erzeugt nachvollziehbare Gegenbuchungen; Korrektur, Neuberechnung und erneuter Abschluss erzeugen Nachfolgeversionen statt Umschreiben.
- `P1-23-F43` — Der Mitarbeiter sieht ausschließlich das eigene Zeitkonto, eigene relevante Hinweise und eigene abgeschlossene Monatsnachweise.
- `P1-23-F44` — Admin und Büro können Perioden vorbereiten und Exporte verwalten; nur wirksame Zeitfreigabeverantwortliche entscheiden Feststellungen und schließen eine bereite Periode.
- `P1-23-F45` — Fremde Organisationsmitglieder sehen weder Konto, Periode, Ergebnis, Feststellung, Abschluss noch Export.
- `P1-23-F46` — Eine bestätigte Lohnzuordnung bildet jeden Mitarbeiter und jeden erforderlichen festen Ausgabe-Code ausdrücklich und versioniert ab; Lücken sperren den Export, nicht den Abschluss.
- `P1-23-F47` — Ein Export umfasst immer die vollständige, im Abschluss eingefrorene Organisationsbelegschaft; Mitarbeiterfilter und Differenzexporte bleiben späterer Umfang.
- `P1-23-F48` — Das erste Artefakt ist ein deterministisches ZIP mit vier semikolongetrennten UTF-8-BOM-CSV-Dateien und einem Manifest; identische Eingaben erzeugen identische Bytes und Hashes.
- `P1-23-F49` — Das ZIP trennt Lohnwerte, Auftrags-/Projektzuordnungen, Korrekturverlauf und Kontrollsummen, neutralisiert Tabellenformeln und speichert die genaue Abschluss-, Mapping- und Generatorversion privat in R2/Dokumenten.
- `P1-23-F50` — P1-23 erzeugt weder Lohnberechnung, Steuer, Rechtsbestätigung, PDF-Nachweis, Providerübertragung, Buchungssatz, Rechnung noch automatische Folgeaktion; Realtime aktualisiert nur die freigegebenen veränderlichen Wurzeln.

**Acceptance invariant:** `50/50 mapped; 50/50 fully evidenced; 0 partial; 0 unmapped` (accepted 2026-09-01).
