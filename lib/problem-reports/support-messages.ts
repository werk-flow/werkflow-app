import { describeFailure } from '@/lib/action-messages';
import { PROBLEM_REPORT_FILE_FAILURE_MESSAGES } from './messages';
import type { ProblemReportBucket, ProblemReportScrubState } from './types';

// The German words of WerkFlow support's screens for problem reports.

export const PROBLEM_REPORT_BUCKET_LABELS: Record<ProblemReportBucket, string> = {
  blocker: 'Blocker',
  fehler: 'Fehler',
  unklarheit: 'Unklarheit',
  wunsch: 'Wunsch',
};

/** What support reads in place of a report's text while it has no scrubbed copy. */
export const UNSCRUBBED_NOTICES: Record<Exclude<ProblemReportScrubState, 'bereinigt'>, string> = {
  ausstehend: 'Der Text wird noch bereinigt und erscheint danach hier.',
  nicht_bereinigbar: 'Der Text ließ sich nicht bereinigen. Du liest ihn nur über „Original öffnen“.',
};

/** What support reads for a report whose original was deleted before it had a scrubbed copy. */
export const REPORT_WITHOUT_TEXT =
  'Zu dieser Meldung gibt es keinen Text mehr: Er ließ sich nicht rechtzeitig bereinigen, und das Original ist nach seiner Frist gelöscht.';

const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  support_unavailable:
    'Der Support-Bereich ist gerade nicht eingerichtet. Gib dem WerkFlow-Team Bescheid und versuche es danach erneut.',
  report_not_found: 'Diese Meldung gibt es nicht mehr. Lade die Liste neu.',
  assignee_not_support: 'Diese Person gehört nicht mehr zum Support. Wähle eine andere aus.',
  triage_failed: 'Die Änderung konnte nicht gespeichert werden. Versuche es in einem Moment erneut.',
  file_not_found: 'Diesen Anhang gibt es nicht mehr. Seine Frist ist abgelaufen.',
  sign_failed: 'Der Anhang ließ sich gerade nicht öffnen. Versuche es in einem Moment erneut.',
  reporter_not_member: 'Diese Person gehört nicht mehr zu der Organisation. Wähle sie neu aus.',
  report_conflict:
    'Diese Meldung wurde schon anders gespeichert. Lade die Seite neu und nimm sie noch einmal auf.',
  submit_failed: 'Die Meldung konnte nicht gespeichert werden. Versuche es in einem Moment erneut.',
  ...PROBLEM_REPORT_FILE_FAILURE_MESSAGES,
};

/** The sentence for a failed support action. */
export function supportFailureMessage(code: string): string {
  return describeFailure(
    code,
    FAILURE_MESSAGES,
    'Das hat gerade nicht geklappt. Prüfe deine Verbindung und versuche es erneut.',
  );
}

/** The refusals of a caller who is not support: a page answers each with the not-found page. */
const SUPPORT_REFUSALS: ReadonlySet<string> = new Set([
  'not_authenticated',
  'not_authorized',
  'support_unavailable',
]);

export function isSupportRefusal(code: string): boolean {
  return SUPPORT_REFUSALS.has(code);
}
