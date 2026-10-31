import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Speed measurements, captures and sweeps run in release mode, in CI's full
 * runs and on explicit request only: the wall-clock and lab groups, the visual
 * references and acceptance captures, and the layout and accessibility sweeps.
 * A change plan selects one only when its own spec or test support changed.
 */
function isReleaseOnlySpec(file: string): boolean {
  return /^tests\/audit\/(performance|lab|visual|layout)\//.test(file);
}

/**
 * What selects a browser group in a change plan (decision 0007, amendment
 * 2026-10-29, group-selection.ts). Every trigger also selects a group whose
 * own spec or test support changed.
 * - `critical`: any product file, migration or shared test support.
 * - `scope`: a product file under one of its declared scopes, until stage 4 moves its denials below the browser.
 * - `own-test`: its own spec or test support only; nightly and release runs take the rest.
 * - `release-only`: like `own-test`, except a wall-clock group never runs in a change plan.
 */
export type ChangeTrigger = 'critical' | 'scope' | 'own-test' | 'release-only';

/**
 * The critical journeys a change plan runs whenever product code, a migration
 * or shared test support changed, with the role each one stands for. The
 * owner approved this set on 2026-10-29 (werk-flow/werkflow-planning#34). A
 * change to it needs the owner.
 */
export const CRITICAL_JOURNEYS: Readonly<
  Record<string, { readonly role: 'all' | 'employee' | 'buero' | 'admin'; readonly journey: string }>
> = {
  'golden:gg-00': {
    role: 'all',
    journey: 'invite and sign-in, assigned-only access, organization boundary, large upload, Realtime',
  },
  'golden:p1-21': { role: 'employee', journey: 'clock in on a job, switch activities, clock out' },
  'golden:p1-17': { role: 'employee', journey: 'execute a dispatched job and hand it over to the office' },
  'golden:gg-01': { role: 'buero', journey: 'Anfrage from a call to Auftrag' },
  'golden:p1-12': {
    role: 'buero',
    journey: 'dispatch on the Plantafel, acknowledgement, live second session',
  },
  'golden:p1-19': { role: 'buero', journey: 'reported fault to dispatched visit with evidence' },
  'golden:p1-07': { role: 'admin', journey: 'Aufgaben reach the responsible person and the deputy' },
  'golden:p1-23': { role: 'admin', journey: 'close and export a month, Zeitkonto, reopen with history' },
  'golden:p1-24': {
    role: 'admin',
    journey: 'onboard an employee with protected documents and access',
  },
};

/** The account security group: the core table selects it for the auth path and the dependencies. */
const SECURITY_GROUP = 'audit:security:account';

/** A spec that drives another organization's session tests the organization boundary. */
const OUTSIDER_SESSION = /\boutsiderPage\b/;

/**
 * Browser groups outside the critical set that hold a role denial, a
 * read-only role or a four-eyes rule in the browser, and drive no outsider
 * session. They keep their scope selection until the named stage-4 issue
 * proves each listed test below the browser and removes the row. The owner
 * decided on 2026-10-29 that no permission test loses its trigger
 * (werk-flow/werkflow-planning#34). Shrink-only.
 */
export const ROLE_DENIAL_GROUPS: Readonly<
  Record<string, { readonly tests: readonly string[]; readonly movesIn: string }>
> = {
  'golden:p1-05': {
    tests: [
      'Eigene Einträge bleiben für Verantwortliche im Vier-Augen-Prinzip',
      'Eine Vertretung gilt im Fenster und verliert die Freigabe nach dem Ende am Aktionspunkt',
    ],
    movesIn: 'werk-flow/werkflow-planning#40',
  },
  'golden:p1-06': {
    tests: [
      'Vier Augen und Anspruchswarnung: eigener Antrag bleibt unsichtbar, Genehmigung ohne Anspruch ist eine sichtbare Ausnahme; Entzug wirkt am Aktionspunkt',
    ],
    movesIn: 'werk-flow/werkflow-planning#40',
  },
  'golden:p1-08': {
    tests: [
      'Eine Krankmeldung als Faktenkette: Selbstmeldung, Büro-Erfassung, Korrektur, Einstempeln, Privacy-Matrix und Stornierung',
    ],
    movesIn: 'werk-flow/werkflow-planning#40',
  },
  'golden:p1-09': {
    tests: [
      'Team und Zertifizierung anlegen, Anforderung mit Teamübernahme begründen und den Ablaufhinweis mit der Erneuerung auflösen',
    ],
    movesIn: 'werk-flow/werkflow-planning#40',
  },
  'golden:p1-16': {
    tests: ['an assigned field worker works through the pack and completes the job'],
    movesIn: 'werk-flow/werkflow-planning#37',
  },
  'golden:p1-18': {
    tests: ['registers, links, corrects and replaces one site-owned asset @P1-18-journey'],
    movesIn: 'werk-flow/werkflow-planning#37',
  },
  'golden:p1-20': {
    tests: ['plans maintenance and completes the first visit with exact evidence @P1-20-journey'],
    movesIn: 'werk-flow/werkflow-planning#37',
  },
  'audit:wave-1:a1-organisation': {
    tests: [
      'A1-02/A1-03/A1-05/A1-26/A1-27/A1-28: Beitritt per Code, Organisationswechsel, Live-Status, Pause, Auftragwechsel und Org-Sperre',
      'A1-04/A1-06: Handwerker-Oberfläche und konservative Rollenregeln',
    ],
    movesIn: 'werk-flow/werkflow-planning#40',
  },
  'audit:wave-1:a3': {
    tests: [
      'A3-11: Betroffene sehen eigene Verantwortung und Vertretung, Büro liest nur, Manager sehen die Personenzusammenfassung',
    ],
    movesIn: 'werk-flow/werkflow-planning#40',
  },
  'audit:wave-1:a4': {
    tests: [
      'A4-R02: Freigabe zeigt neutral eine andere Abwesenheit und nur Aufträge im beantragten Zeitraum [P1-06-F03]',
      'A4-R03: Halber Urlaubstag halbiert das Tagesziel; Manager sehen alle Kalenderzustände, Beschäftigte nur den eigenen [P1-06-F05]',
    ],
    movesIn: 'werk-flow/werkflow-planning#40',
  },
  'audit:wave-1:a5': {
    tests: [
      'A5-07/A5-08/A5-09/A5-10: Fünf Abdeckungszustände mit stärkster Person, Mehrfach-Warnung mit Pflichtgrund, Azubi-Standard aus, rechtzeitiger Ablaufhinweis; Bearbeitungsdialog und Kalender-Drag prüfen erneut und die Eigenansicht bleibt nur lesend [P1-09-F02/P1-09-F03/P1-09-F04/P1-09-F05/P1-09-F06]',
    ],
    movesIn: 'werk-flow/werkflow-planning#40',
  },
};

/** How a change plan selects the browser group `id` with its spec `files`. */
export function changeTrigger(repositoryRoot: string, id: string, files: readonly string[]): ChangeTrigger {
  if (files.some(isReleaseOnlySpec)) return 'release-only';
  if (id in CRITICAL_JOURNEYS) return 'critical';
  if (id === SECURITY_GROUP || id in ROLE_DENIAL_GROUPS) return 'scope';
  return files.some((file) => OUTSIDER_SESSION.test(readFileSync(join(repositoryRoot, file), 'utf8')))
    ? 'scope'
    : 'own-test';
}
