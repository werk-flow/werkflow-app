import { describeFailure } from '@/lib/action-messages';
import type { ProblemReportFileKind, ProblemReportStatus } from './types';

// The German words of a problem report for its reporter.

export const PROBLEM_REPORT_STATUS_LABELS: Record<ProblemReportStatus, string> = {
  eingegangen: 'Eingegangen',
  in_bearbeitung: 'In Bearbeitung',
  erledigt: 'Erledigt',
  abgelehnt: 'Abgelehnt',
};

const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  submit_failed: 'Deine Meldung konnte nicht gesendet werden. Versuche es in einem Moment erneut.',
  file_type_not_allowed: 'Diese Datei passt nicht. Hänge Fotos (PNG, JPEG, WebP, HEIC) oder PDFs an.',
  file_too_large: 'Diese Datei ist zu groß. Ein Anhang darf höchstens 15 MB haben.',
  file_empty: 'Diese Datei ist leer.',
  too_many_attachments: 'Eine Meldung nimmt höchstens fünf Anhänge.',
};

/** A screenshot over its size limit: the person sends without it. */
const SCREENSHOT_TOO_LARGE =
  'Der Screenshot ist zu groß. Entferne den Haken bei „Screenshot mitsenden“ und sende noch einmal.';

/** The sentence for a failed upload of one file of a report. */
export function problemReportFileFailureMessage(code: string, kind: ProblemReportFileKind): string {
  return kind === 'screenshot' && code === 'file_too_large'
    ? SCREENSHOT_TOO_LARGE
    : problemReportFailureMessage(code);
}

/** The sentence for a failed send or upload of a report. */
export function problemReportFailureMessage(code: string): string {
  return describeFailure(
    code,
    FAILURE_MESSAGES,
    'Deine Meldung konnte gerade nicht vollständig gesendet werden. Prüfe deine Verbindung und versuche es erneut.',
  );
}
