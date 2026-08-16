# User Flow Catalog

## Purpose And Rules (for agents)

This file is the tactical, exhaustive answer to one question per slice: **what can a user actually DO in the app now that they could not do before, and what does the app do in response?**

It exists for two planned uses:

1. **Handover:** after Phase 1 (possibly in steps), this list explains every new capability to the customer in plain German without roadmap terminology.
2. **Wave audits:** after each wave, this list is the test inventory for a large harness audit that exercises far more flows than the golden gates cover.

Rules for maintaining this file:

- Every flow bullet has one immutable technical ID in inline code. `BASE-*` IDs identify the pre-Phase-1 baseline; `P1-XX-FNN` IDs identify slice flows. Keep an ID stable when wording changes, never reuse a retired ID, and assign a new ID to every new bullet. The ID is excluded when the German wording is reused for customer handover.
- Flows are written in **natural German** after the ID (they will be reused verbatim for handover). Headings and this preamble stay English like other developer artifacts.
- One flow ID = one bullet of 1–3 sentences: what the user does, step by step where needed, and what they see / what the app does in return. A bullet may contain several observable clauses; audit coverage of its ID means **every clause** is evidenced, not merely its headline behavior.
- Be **exhaustive**, not aspirational: list every new user-visible action, including small ones (a new filter, a new badge, a new warning, a new denial). Do not list planned or deferred behavior — only what works today.
- Prefix flows with the acting role where it matters: `Büro/Admin`, `Admin`, `Handwerker`, `Alle`.
- Update this file **as part of every slice's acceptance**, while the behavior is fresh — not retroactively at wave end.
- If a later slice changes an earlier flow, correct the earlier flow in place and note the changing slice in parentheses. The catalog describes the app as it is now, per the slice that introduced each capability.
- A material wording change reopens the affected flow ID's audit mapping until the assertion bodies have been rechecked against the complete revised bullet.
- This catalog intentionally repeats things that also live in feature docs. Feature docs describe the product model for agents; this file describes concrete user actions for humans. Do not "deduplicate" it away.
- For wave-audit traceability, the set of relevant IDs here must equal the union of IDs mapped in that session's coverage ledger. Mapping is many-to-many: one ledger row/test may cover multiple flow IDs, and one flow ID may need multiple rows/tests. Test count never needs to equal flow count. See testing rule 12 and `docs/plans/wave-1-audit.md`.

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
- `BASE-WORK-F03` — Büro/Admin: können Aufträge „parken". Ein Auftrag ohne geplantes Datum ist automatisch geparkt; wird einem Auftrag das Datum entzogen, wird er geparkt; wird ein geparkter Auftrag eingeplant, kehrt er in die offene Arbeit zurück. Geparkte Aufträge erscheinen auf der Aufträge-Seite und im Kalender jeweils im „Parkplatz" und tauchen nicht im Terminplan auf. Die zugewiesenen Mitarbeiter bleiben im geparkten Zustand erhalten, sehen den Auftrag aber nicht im Kalender.
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
- `P1-02-F05` — Büro/Admin: wandeln eine Anfrage **genau einmal** in einen neuen Auftrag oder ein Projekt um. Der Dialog ist komplett vorbefüllt (Titel ← Zusammenfassung, Beschreibung ← Details, Kunde/Kontakt/Einsatzort übernommen, Dringlichkeit → Priorität) und bleibt editierbar. Nichts wird dabei terminiert oder versendet; ein Auftrag ohne Datum startet geparkt. Auftrag und Anfrage verlinken sich gegenseitig („Entstanden aus Anfrage …").
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
- `P1-04-F04` — Wo kein Modell hinterlegt ist, rechnet die App sichtbar gekennzeichnet weiter („Kein Arbeitszeitmodell hinterlegt") — es werden keine Zahlen erfunden.
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

- `P1-09-F01` — Büro/Admin: legen **Teams** an und pflegen ihre Mitglieder datumswirksam; Teams sind reine Planungs-Abkürzungen und geben niemandem Rechte. In Zuweisungs-Pickern (Auftragsdialoge und Kalender) wählt ein Klick auf ein Team alle aktuell aktiven Mitglieder auf einmal aus; Mitglieder ohne Login werden dabei ausgewiesen übersprungen.
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
- `P1-12-F04` — Wird ein bestätigter Einsatz danach wesentlich geändert — verschoben, umbesetzt, anderer Ort, geänderter Hinweis, per Batch bewegt —, wird die Bestätigung automatisch ungültig: der Empfänger sieht wieder „ausstehend" mit dem neuen Stand und muss erneut bestätigen. Eine reine Empfängeränderung lässt bestehende Bestätigungen der Unveränderten nachvollziehbar weiterleben.
- `P1-12-F05` — Büro/Admin: offene Rückfragen erscheinen als Manager-Aufgabe und im Einsätze-Panel. Der Manager löst sie, indem er den Plan anpasst (die Änderung erzeugt automatisch den neuen Stand) oder den Plan **mit Begründung beibehält** — auch dann muss der Handwerker den unveränderten Plan noch einmal aktiv bestätigen.
- `P1-12-F06` — Büro/Admin: können einen Einsatz stornieren; das Parken eines Auftrags storniert seine aktiven Einsätze automatisch und sichtbar. Wird ein Einsatz für einen ungeplanten Auftrag gesendet und der Auftrag später eingeplant, bleibt es derselbe Einsatz mit nachvollziehbarem Übergang.
- `P1-12-F07` — Eine Bestätigung bedeutet nur „gesehen und angenommen" — sie erzeugt keine Arbeitszeit, keine Anwesenheit und keine Kundenzusage.

**Parkplatz mit Kontext:**

- `P1-12-F08` — Büro/Admin: ergänzen an geparkten Aufträgen einen **Park-Kontext**: Grund (Warten auf Kunde / Warten auf Material / Warten auf Freigabe / Kapazität / Sonstiges) plus Notiz, eine verantwortliche Büro-Person und ein Wiedervorlage-Datum. Direkt nach dem Parken bietet die App das Ergänzen an.
- `P1-12-F09` — Alle geparkten Aufträge ohne erfassten Kontext (auch alle aus der Zeit davor) zeigen ehrlich **„Kontext fehlt (Altbestand)"** — nichts wird erfunden.
- `P1-12-F10` — Verantwortliche: eine überfällige Wiedervorlage erscheint als Aufgabe auf `/aufgaben`.
- `P1-12-F11` — Wird der Auftrag entparkt (eingeplant), wird der Kontext automatisch und nachvollziehbar entfernt.
- `P1-12-F12` — Büro/Admin: können einen geparkten Auftrag direkt aus dem Parkplatz heraus als Einsatz an die zugewiesenen Mitarbeiter senden.

**Kundenzusagen:**

- `P1-12-F13` — Büro/Admin: erfassen an einem geplanten Besuch eine **Kundenzusage**: zugesagter Tag, optionales Ankunftsfenster, wie sie zustande kam (telefonisch, vor Ort, schriftlich, sonstige). Das dokumentiert nur die interne Notiz einer Absprache — die App verschickt nichts an den Kunden.
- `P1-12-F14` — Wird der Besuch später verschoben, bleibt die Zusage unverändert stehen und der Besuch zeigt sichtbar, dass Plan und Zusage **nicht mehr übereinstimmen**. Das Büro löst das ausdrücklich: neue Zusage erfassen (die alte bleibt als abgelöst nachvollziehbar) oder die Zusage mit Grund zurückziehen.

**Batch-Umplanung:**

- `P1-12-F15` — Büro/Admin: starten im Einsätze-Panel den **Auswahlmodus**, wählen mehrere zukünftige Besuche per Checkbox (auch über Aufträge hinweg) und geben eine Verschiebung an — ganze Tage und/oder eine neue Uhrzeit.
- `P1-12-F16` — Vor der Ausführung zeigt eine **Vorschau** je Termin den alten und neuen Zeitpunkt, entstehende Kapazitäts-/Qualifikationskonflikte, wie viele Bestätigungen ungültig würden und welche Kundenzusagen betroffen wären. Konflikte lassen sich wie überall nur mit Grund übersteuern.
- `P1-12-F17` — Die Ausführung ist **alles oder nichts**: entweder werden alle gewählten Termine verschoben oder keiner. Ausgewählte Serientermine werden dabei zu Einzel-Ausnahmen ihrer Serie; die Historie jedes Termins bleibt erhalten.
