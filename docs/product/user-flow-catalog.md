# User-flow catalog

This catalog lists the user flows that a test, a golden journey in `lib/testing/journeys.ts` or a code comment cites by id. `static:coverage` (`scripts/check-test-coverage.ts`) checks each flow against `lib/testing/selection/coverage-map.json`. Each mapping names the test titles that prove the flow, and the map holds a hash of each bullet.

- Each bullet has one stable id in inline code. `BASE-*` ids describe the app before Phase 1. `P1-XX-FNN` ids belong to a slice. Never reuse a retired id. Wave 1 test titles spell `P1-00a` as `P1-00A`. Both spellings name the same flows.
- Write the flow in natural German after the id. Name the acting role first: `Büro/Admin`, `Admin`, `Handwerker`, `Alle`.
- A mapping covers every clause of its bullet, not only the headline.
- To change a bullet, recheck the assertions that prove it, then update its hash in the coverage map.
- To add a flow, cite its id in the proving test and add its bullet, mapping and hash in one change.
- When no test, journey or comment cites a flow any more, delete its bullet, its hash and its id in the mappings.

## Grundstock vor Phase 1

### Kunden

- `BASE-CUSTOMER-F01` — Büro/Admin: können unter `/kunden` Kunden anlegen (privat/gewerblich, E-Mail, Telefon, Adresse, Notizen), bearbeiten und löschen. Die Liste zeigt Anzahl, Typ und Kontaktdaten, hat eine Suche und aktualisiert sich live.

### Aufträge und Projekte

- `BASE-WORK-F01` — Büro/Admin: können Aufträge und Projekte anlegen, bearbeiten und löschen — mit Titel, Beschreibung, Nummer, Kunde, Priorität (niedrig/mittel/hoch), geplantem Datum und Uhrzeit, geschätzter Dauer, Ort und Status (nicht bearbeitet / in Bearbeitung / fertig / geparkt).
- `BASE-WORK-F02` — Ein Auftrag kann eigenständig sein oder zu genau einem Projekt gehören; Projektaufträge erben den Projektkunden. Ein Projekt kann leer starten und später Aufträge erhalten.
- `BASE-WORK-F03` — Büro/Admin: können Aufträge bewusst mit Grund, Verantwortlichkeit und Wiedervorlage „parken“. Ein Auftrag ohne geplantes Datum bleibt dagegen ungeplante offene Arbeit; das Entfernen eines Termins parkt ihn nicht. Geparkte Aufträge erscheinen auf der Aufträge-Seite und im Kalender jeweils im „Parkplatz“ und tauchen nicht im Terminplan auf. Die zugewiesenen Mitarbeiter bleiben im geparkten Zustand erhalten, sehen den Auftrag aber nicht im Kalender. Das Verlassen des Parkplatzes und eine neue Einplanung sind getrennte bewusste Schritte.
- `BASE-WORK-F05` — Büro/Admin: können einem Auftrag ein oder mehrere Mitglieder zuweisen oder sie entfernen. Handwerker sehen ausschließlich ihre zugewiesenen Aufträge.
- `BASE-WORK-F06` — Büro/Admin: können am Auftrag eine sortierbare Checkliste (Arbeitsanweisungen) pflegen; zugewiesene Handwerker haken Punkte ab oder öffnen sie wieder — wer was wann zuletzt geändert hat, bleibt sichtbar.
- `BASE-WORK-F07` — Wird ein Auftrag auf „fertig“ gesetzt, wird das tatsächliche Fertigstellungsdatum festgehalten. Projektstatus, Fortschritt und eine Termin-Ampel werden aus den Aufträgen abgeleitet; ein Manager kann den Status manuell übersteuern.
- `BASE-WORK-F08` — Alle: die `/auftraege`-Seite kombiniert Aufträge und Projekte, klappt Projektaufträge auf, trennt aktive Arbeit, Parkplatz und Archiv und bietet Suche, Status-/Typ-/Kunden-/Mitarbeiter-/Datumsfilter, Sortierung und pro Nutzer wählbare Spalten. Sie aktualisiert sich live.

### Kalender

- `BASE-CALENDAR-F02` — Büro/Admin: können Aufträge direkt im Kalender anlegen, per Drag & Drop verschieben, in der Länge ziehen und zwischen Mitarbeitern umhängen. Aufträge lassen sich per Drag & Drop in den Parkplatz und wieder heraus ziehen.
- `BASE-CALENDAR-F03` — Alle: erfasste Arbeitszeiten erscheinen als eigene Blöcke im selben Kalender, sichtbar getrennt von geplanter Arbeit. Manuelle Zeiteinträge können aus dem Kalender heraus angelegt werden.
- `BASE-CALENDAR-F04` — Alle: Filter nach Mitarbeitern, Arbeitszeiten und Aufträgen; ausstehende Zeitänderungen sind markiert; Detail-Dialoge öffnen sich per Klick. Der Kalender aktualisiert sich live.

### Zeiterfassung

- `BASE-TIME-F01` — Alle: können sich über die globale Stempeluhr ein- und ausstempeln sowie Pausen starten und beenden; der aktuelle Zustand (ausgestempelt / arbeitet / Pause) und die Tagessummen sind jederzeit sichtbar.
- `BASE-TIME-F06` — Admin/Büro: entscheiden ausstehende Zeiteinträge im Bereich „Anträge“ (mit Sitzungspaaren und Auftragskontext) und filtern den Verlauf nach Zeitraum, Mitarbeiter und Status. Einträge können korrigiert, gelöscht und umgehängt werden.

### Dokumente

- `BASE-DOCUMENT-F02` — Büro/Admin: laden Dateien einzeln, als Stapel oder als ganze Ordner hoch (auch Drag & Drop), verschieben/kopieren sie über einen Ziel-Dialog und verknüpfen sie mit Aufträgen, Projekten, Kunden oder Mitarbeitern — ohne Dateikopien.
- `BASE-DOCUMENT-F04` — Handwerker: sehen die Bibliothek nicht, können aber auf ihren zugewiesenen Aufträgen unter „Dokumente & Bilder“ Dateien und Fotos hochladen, ansehen und herunterladen.

## Phase 1

### `P1-00` Baseline-Verifikation

- `P1-00-F01` — Alle: mehrere Seiten (u. a. Dokumente und Lager), die sich vorher nur nach manuellem Neuladen aktualisierten, aktualisieren sich jetzt live, sobald jemand anderes etwas ändert.

### `P1-00a` Dateispeicher

- `P1-00a-F01` — Alle: große Dateien (auch deutlich über 4–5 MB, z. B. Foto-Serien oder Pläne) lassen sich jetzt zuverlässig hochladen. Der Upload zeigt einen echten Fortschrittsbalken statt vorher bei großen Dateien kommentarlos zu scheitern.
- `P1-00a-F02` — Alle: Downloads öffnen sich über kurzlebige signierte Links direkt aus dem geschützten Speicher.

### `P1-01` Ansprechpartner und Einsatzorte

- `P1-01-F07` — Büro/Admin: die Suche auf `/kunden` findet Kunden jetzt auch über Namen ihrer Ansprechpartner und Adressen ihrer Einsatzorte.

### `P1-02` Anfragen

- `P1-02-F05` — Büro/Admin: wandeln eine Anfrage **genau einmal** in einen neuen Auftrag oder ein Projekt um. Der Dialog ist komplett vorbefüllt (Titel ← Zusammenfassung, Beschreibung ← Details, Kunde/Kontakt/Einsatzort übernommen, Dringlichkeit → Priorität) und bleibt editierbar. Nichts wird dabei terminiert oder versendet; ein Auftrag ohne Datum bleibt ungeplante offene Arbeit (seit `P1-12`/`P1-14` entsteht kein passiver Park-Zustand mehr, siehe `BASE-WORK-F03` und `P1-12-F08`). Auftrag und Anfrage verlinken sich gegenseitig („Entstanden aus Anfrage …“).

### `P1-03` Personalakte und Beschäftigung

- `P1-03-F01` — Büro/Admin: pflegen auf dem Mitarbeiter-Detail den neuen Abschnitt **Personalien**: Personalnummer (Vorschlag `MA-NNN`, manuell überschreibbar, organisationsweit eindeutig), Telefon, private E-Mail, Adresse, Notfallkontakt, Eintritts-/Austrittsdatum, Notizen.
- `P1-03-F05` — Wird ein Mitglied aus der Organisation entfernt, verschwindet die Person nicht mehr: die Personalakte bleibt als „Ausgeschieden“ erhalten.

### `P1-05` Verantwortlichkeiten und Vertretungen

- `P1-05-F01` — Admin (Inhaber): konfiguriert unter **Einstellungen → Mitarbeiter** die Verantwortlichkeiten **Zeitfreigaben** und **Urlaubsfreigaben**: entweder bleibt der Rollen-Standard (Admin und Büro entscheiden wie bisher) oder es werden benannte Personen ausgewählt, die den Standard ersetzen — auch normale Handwerker, ohne dass sie sonst mehr Rechte bekommen. Büro sieht die Konfiguration nur lesend.

### `P1-06` Urlaub

- `P1-06-F01` — Handwerker (alle Mitarbeiter): beantragen im Bereich **Urlaub & Abwesenheit** der Zeiterfassung eigenen Urlaub (Zeitraum; bei einem einzelnen Tag auch halbtags) und ziehen offene Anträge selbst zurück. Die App zeigt vor dem Absenden die berechneten Urlaubstage — Wochenenden, Feiertage, Betriebsruhe und freie Wochenplantage kosten nichts.
- `P1-06-F03` — Urlaubsfreigabe-Zuständige: entscheiden Anträge im Tab **Anträge** — mit berechneten Tagen, Restanspruch, Abwesenheits-Überschneidungen und zugewiesenen Aufträgen im Zeitraum als Hinweisen. Eigene Anträge erscheinen nie in der eigenen Liste (Vier-Augen).
- `P1-06-F05` — Alle: genehmigter Urlaub senkt das Tagessoll (ganzer Tag → 0, halber Tag → halbes Soll) und erscheint im Kalender als ruhiger lila Eintrag „Urlaub – Name“; beantragter, noch nicht entschiedener Urlaub ist gestrichelt und mit „(angefragt)“ markiert. Manager sehen alle, Mitarbeiter nur sich selbst.

### `P1-07` Aufgaben und Benachrichtigungen

- `P1-07-F01` — Alle: die neue Seite **`/aufgaben`** bündelt, was einen selbst angeht: **Aufgaben** (nur Dinge, die man selbst jetzt entscheiden kann — ausstehende Zeitfreigaben, Urlaubsanträge, offene Anfragen mit Zuständigem und Alter), **Benachrichtigungen** (Entscheidungen über die eigenen Anträge) und **Meine Anträge** (eigene Urlaubsanträge mit Status und Gründen).
- `P1-07-F02` — Alle: jedes Element verlinkt direkt in die zuständige Oberfläche; entschieden wird weiterhin nur dort. Benachrichtigungen lassen sich einzeln oder alle auf einmal als gelesen markieren; wird eine Genehmigung später storniert, wird dieselbe Benachrichtigung wieder ungelesen statt doppelt zu erscheinen.
- `P1-07-F03` — Alle: die Seitenleisten-Badges stimmen jetzt: das Aufgaben-Badge zählt handlungsrelevante Punkte plus ungelesene Benachrichtigungen, das Zeiterfassungs-Badge zählt Zeit- **und** Urlaubsfreigaben — und nie etwas, das der Betrachter gar nicht entscheiden darf. Vertretungen sehen Aufgaben nur innerhalb ihres Vertretungsfensters.

### `P1-08` Krankmeldung

- `P1-08-F02` — Alle Mitarbeiter: setzen/korrigieren das eigene Enddatum („wieder gesund ab …“) und stornieren eine eigene irrtümliche Meldung.
- `P1-08-F05` — Alle: aktive Krankheit setzt das Tagessoll auf 0 (halber Tag → halb); das eigene Dashboard sagt „Krankmeldung – heute keine Sollarbeitszeit.“

### `P1-09` Teams, Qualifikationen, Eignung

- `P1-09-F01` — Büro/Admin: legen **Teams** an und pflegen ihre Mitglieder datumswirksam; Teams sind reine Planungs-Abkürzungen und geben niemandem Rechte. In Zuweisungs-Pickern (Auftragsdialoge und Kalender) wählt ein Klick auf ein Team alle zum jeweiligen Datum aktiven Mitglieder auf einmal aus; in Auftragsdialogen werden Mitglieder ohne Login dabei ausgewiesen übersprungen, während die Kalenderplanung sie seit `P1-11` als planbares Personal mit einplant.
- `P1-09-F02` — Büro/Admin: pflegen einen Organisations-Katalog aus **Fähigkeiten und Zertifikaten** und ordnen Personen Einträge mit Gültigkeitsdaten und Nachweis-Status zu. Mitarbeiter sehen die eigenen Einträge nur lesend.
- `P1-09-F03` — Büro/Admin: hängen an Aufträge **Anforderungen** aus diesem Katalog. Das Auftragsdetail erklärt je Anforderung, ob die zugewiesenen Personen sie decken — gedeckt, intern unbestätigt, abgelaufen, noch nicht gültig oder fehlend — und nennt die stärkste passende Person.
- `P1-09-F04` — Büro/Admin: jede Zuweisungsänderung — im Dialog, auf dem Detail oder per Kalender-Drag — prüft die Eignung zum geplanten Datum. Bei Lücken erscheint ein Bestätigungsdialog, der jede betroffene Person/Anforderung erklärt; fortfahren geht nur mit erfasstem Grund, Abbrechen stellt den Kalender still wieder her.
- `P1-09-F05` — Admin: kann eine optionale **Azubi-Warnung** einschalten (standardmäßig aus), die allein zugewiesene Auszubildende markiert.
- `P1-09-F06` — Zuständige: ablaufende Zertifikate erscheinen rechtzeitig als Aufgabe auf `/aufgaben`.

### `P1-11` Serien-, Mehrtages- und Besuchsplanung

- `P1-11-F01` — Büro/Admin: planen im Kalender **Besuche** für Aufträge und **interne Einträge** (Interne Arbeit, Besprechung, Schulung, Sonstiges) — mit Uhrzeit oder ganztägig, mehrtägig, über Mitternacht, einmalig oder als Serie (täglich, wöchentlich, monatlich). Ein Auftrag kann mehrere Besuche haben, ohne dupliziert zu werden.
- `P1-11-F02` — Büro/Admin: Serien reichen zunächst 18 Monate in die Zukunft und lassen sich per Klick um je sechs Monate verlängern. Ungültige Monatstermine (z. B. 31. im Februar) fallen aus statt zu verrutschen.
- `P1-11-F03` — Büro/Admin: beim Bearbeiten eines Serientermins wählt man **„Nur dieser Termin“**, **„Dieser und zukünftige“** oder **„Ganze Serie“**; Vergangenes und bereits Begonnenes wird nie umgeschrieben. Einzelne Termine lassen sich ausfallen lassen oder stornieren und bleiben nachvollziehbar sichtbar statt zu verschwinden.
- `P1-11-F04` — Büro/Admin: jede Planung prüft **Kapazität** (Wochenplan, Feiertage, Betriebsruhe, genehmigter Urlaub, Krankheit, schwebende Urlaubsanträge, Überschneidungen mit anderer geplanter Arbeit) und **Qualifikation** zum Termindatum. Warnungen erklären jede betroffene Person und jedes Datum; fortfahren geht nur mit Grund, und wenn sich die Fakten seit der Warnung geändert haben, verlangt die App eine neue Entscheidung.
- `P1-11-F05` — Handwerker: sehen im Kalender genau die Termine, die ihnen zugewiesen sind — auch Personal ohne Login kann verplant werden (sichtbar für Manager). Geplante Termine erzeugen niemals automatisch Ist-Arbeitszeit.

### `P1-12` Einsätze, Bestätigung, Parkplatz-Kontext, Kundenzusagen, Batch-Umplanung

- `P1-12-F01` — Büro/Admin: öffnen im Kalender über den Kopfzeilen-Schalter das **„Einsätze“**-Panel. Es zeigt je geplantem Besuch die Empfänger mit ihrem Stand: ausstehend, bestätigt, übernommen, Rückfrage — oder „nicht möglich“ für Personal ohne Login, das nie automatisch als bestätigt gilt.
- `P1-12-F02` — Büro/Admin: senden für einen Besuch (oder einen noch unterminierten Auftrag) einen **Einsatz** mit optionalem Hinweistext. Der Dialog zeigt vorher das ehrliche **Bereitschaftsbild**: Kapazität und Qualifikation aus der Planungsprüfung, Einsatzort/Zugang, Anfahrt (nur aus belegbaren Fakten, sonst „nicht bewertet“), Materialbedarf gegen den Bestand (immer als „nicht reserviert“ gekennzeichnet) und Werkzeug (immer „nicht bewertet“). Unbekanntes wird nie grün angezeigt.
- `P1-12-F03` — Handwerker: sehen auf dem zugewiesenen Auftragsdetail die Karte **„Mein Einsatz“** mit Termin, Ort und Hinweis und **bestätigen** den Einsatz mit einem Tippen oder stellen eine **Rückfrage** mit Text. Beides geht auch über `/aufgaben`, wo ausstehende Bestätigungen als eigene Aufgabe erscheinen.
- `P1-12-F04` — Wird ein bestätigter Einsatz danach wesentlich geändert — verschoben, umbesetzt, anderer Ort, per Batch bewegt —, wird die Bestätigung automatisch ungültig: der Empfänger sieht wieder „ausstehend“ mit dem neuen Stand und muss erneut bestätigen. Der Hinweistext selbst ist nach dem Senden unveränderlich; eine geänderte Anweisung erreicht die Person über Zurückziehen und erneutes Senden. Eine reine Empfängeränderung lässt bestehende Bestätigungen der Unveränderten nachvollziehbar weiterleben.
- `P1-12-F05` — Büro/Admin: offene Rückfragen erscheinen als Manager-Aufgabe und im Einsätze-Panel. Der Manager löst sie, indem er den Plan anpasst (die Änderung erzeugt automatisch den neuen Stand) oder den Plan **mit Begründung beibehält** — auch dann muss der Handwerker den unveränderten Plan noch einmal aktiv bestätigen.
- `P1-12-F06` — Büro/Admin: können einen Einsatz stornieren; das Parken eines Auftrags storniert seine aktiven Einsätze automatisch und sichtbar. Wird ein Einsatz für einen ungeplanten Auftrag gesendet und der Auftrag später eingeplant, bleibt es derselbe Einsatz mit nachvollziehbarem Übergang.
- `P1-12-F07` — Eine Bestätigung bedeutet nur „gesehen und angenommen“ — sie erzeugt keine Arbeitszeit, keine Anwesenheit und keine Kundenzusage.
- `P1-12-F08` — Büro/Admin: parken Aufträge atomar mit dem gemeinsamen **Park-Kontext**: ein Grund aus dem P1-14-Blockervokabular plus Details, verantwortliche Person und Wiedervorlage-Datum. Beim Parken öffnet die App diesen Kontext vor dem Speichern; ein passiver geparkter Zustand ohne Verantwortlichkeit entsteht nicht mehr neu.
- `P1-12-F10` — Verantwortliche: eine überfällige Wiedervorlage erscheint als Aufgabe auf `/aufgaben`.
- `P1-12-F12` — Büro/Admin: können einen geparkten Auftrag direkt aus dem Parkplatz heraus als Einsatz an die zugewiesenen Mitarbeiter senden.
- `P1-12-F13` — Büro/Admin: erfassen an einem geplanten Besuch eine **Kundenzusage**: zugesagter Tag, optionales Ankunftsfenster, wie sie zustande kam (telefonisch, vor Ort, schriftlich, sonstige). Das dokumentiert nur die interne Notiz einer Absprache — die App verschickt nichts an den Kunden.
- `P1-12-F14` — Wird der Besuch später verschoben, bleibt die Zusage unverändert stehen und der Besuch zeigt sichtbar, dass Plan und Zusage **nicht mehr übereinstimmen**. Das Büro löst das ausdrücklich: neue Zusage erfassen (die alte bleibt als abgelöst nachvollziehbar) oder die Zusage mit Grund zurückziehen.
- `P1-12-F15` — Büro/Admin: starten im Einsätze-Panel den **Auswahlmodus**, wählen mehrere zukünftige Besuche per Checkbox (auch über Aufträge hinweg) und geben eine Verschiebung an — ganze Tage und/oder eine neue Uhrzeit.
- `P1-12-F16` — Vor der Ausführung zeigt eine **Vorschau** je Termin den alten und neuen Zeitpunkt, entstehende Kapazitäts-/Qualifikationskonflikte, wie viele Bestätigungen ungültig würden und welche Kundenzusagen betroffen wären. Konflikte lassen sich wie überall nur mit Grund übersteuern.
- `P1-12-F17` — Die Ausführung ist **alles oder nichts**: entweder werden alle gewählten Termine verschoben oder keiner. Ausgewählte Serientermine werden dabei zu Einzel-Ausnahmen ihrer Serie; die Historie jedes Termins bleibt erhalten.

### `P1-13` Versionierte Arbeitsvorlagen

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

### `P1-14` Arbeitsstand, Blocker, Voraussetzungen und Einsatzbereitschaft

- `P1-14-F19` — Ein heute fälliger oder überfälliger offener Blocker erscheint einmal in der gemeinsamen Aufgaben-Pipeline mit Ziel-Link, Verantwortlichkeit und versionsstabiler Lesemarkierung.
- `P1-14-F21` — Büro/Admin parken einen Auftrag oder ein Projekt atomar mit Grund, Details, verantwortlicher Person und Wiedervorlage; ein Parkplatz-Blocker und die Planungslücke bleiben getrennte Fakten.

### `P1-15` Strukturierte Arbeitsnachweise, Freigaben und Unterschriften

- `P1-15-F29` — „Als Entwurf speichern“ legt die aktuelle Eingabe ausdrücklich als Version ab; nicht gespeicherte Eingabe bleibt nur im geöffneten Formular.

### `P1-16` Fokussierter Arbeitspack für zugewiesene Handwerker

- `P1-16-F01` — Ein zugewiesener Handwerker öffnet am Auftrag einen fokussierten Arbeitspack mit den für den Einsatz nötigen Informationen und Aktionen.
- `P1-16-F45` — Ein zugewiesener Handwerker markiert eine erlaubte Anweisung erledigt oder wieder offen; Akteur und Zeitpunkt bleiben im vorhandenen Datensatz.
- `P1-16-F49` — Zugewiesene Handwerker erfassen die fünf vorhandenen strukturierten Arbeitsnachweisarten in der bestehenden P1-15-Oberfläche.

### `P1-21` Explizite Zeitsegmente

- `P1-21-F01` — Ein Mitarbeiter startet seine eigene Zeiterfassung über eine eindeutige, touchfreundliche Hauptaktion: Die Stempeluhr-Schaltfläche öffnet eine Liste der nächsten Aktionen („Arbeit starten“, „Arbeit an Auftrag …“, „Fahrt starten“, „Weitere Aktivitäten …“), jede Aktion startet mit einem Tipp; WerkFlow zeigt die laufende Aktivität und den Auftrag in der Anzeige über der Schaltfläche, die während der Arbeit grün und in der Pause gelb mit Tassensymbol erscheint; die verstrichene Zeit zeigt die Uhr auf der Zeiterfassungsseite. Über der Schaltfläche liegen während der Erfassung zwei Schnelltasten für die zwei wahrscheinlichsten nächsten Schritte (geändert in Pre-Wave-3 Schritt 3, 2026-09-15).
- `P1-21-F04` — Ein Mitarbeiter beendet seine laufende Erfassung bewusst; Sitzung und letztes Segment schließen in einem atomaren Schritt.
- `P1-21-F48` — Mitarbeiter sehen nur ihre eigenen organisationsbezogenen kanonischen Zeitdaten.
- `P1-21-F50` — Außenstehende und Mitglieder einer fremden Organisation sehen weder Sitzung, Segment, Vorgang noch Ereignis.
- `P1-21-F57` — Jobbezogene Arbeit oder Notdienst kann den vorhandenen P1-14-Ausführungsstart auslösen; reine Fahrt tut das nicht.

### `P1-22` Einheitliche Zeitkorrekturen und Freigaben

- `P1-22-F44` — Mitarbeiter sehen ihre eigenen Korrekturen; Admin und Büro sehen organisationsbezogene Historie, aber nur wirksame `time_approval`-Inhaber erhalten Entscheidungsaktionen.
- `P1-22-F45` — Mitglieder einer fremden Organisation sehen weder Antrag, Revision, Quelle, Ereignis noch Anwendung.

### `P1-24a` Plantafel und Kalender-Überarbeitung

- `P1-24a-F10` — Büro/Admin: Eine Karte in eine andere Zeile ziehen besetzt den Termin um, mit denselben Dialogen wie bisher (Qualifikation, Kapazität, Einsatz-Ablösung, Kundenzusage). In eine andere Spalte ziehen verschiebt das Datum; Uhrzeit und Dauer bleiben. Ein Ziel auf einem Urlaubstag oder einem arbeitsfreien Tag wird schon beim Ziehen mit Satz abgelehnt; mit gedrückter Umschalttaste ist die Ablage trotzdem möglich und öffnet den Hinweis-Dialog. Ein Ziel außerhalb der Beschäftigung bleibt abgelehnt.
- `P1-24a-F15` — Alle: Jede Ablage wirkt sofort in der Ansicht; nach dem Speichern erscheint ein grüner Hinweis mit „Rückgängig“; schlägt das Speichern fehl, springt die Karte zurück und der Hinweis nennt die Regel und den nächsten Schritt; schlägt „Rückgängig“ fehl, sagt der Hinweis das mit derselben Regel.
