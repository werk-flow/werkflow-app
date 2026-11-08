import type { WorkArtifactFieldIssue, WorkArtifactRuleField } from '@/lib/work-artifacts/field-rules';

/** The control each rule field marks and focuses (`Field htmlFor`), in the form's visual order. */
export const WORK_ARTIFACT_CONTROL_IDS = {
  title: 'artifact-title',
  workDate: 'artifact-work-date',
  progress: 'artifact-progress',
  visitStartedAt: 'artifact-visit-start-date',
  visitEndedAt: 'artifact-visit-end-date',
  performedWork: 'artifact-performed-work',
  measurementDate: 'artifact-measurement-date',
  measurementLocation: 'artifact-measurement-location',
  measurementLines: 'artifact-measurement-add-line',
  defectDescription: 'artifact-defect-description',
  defectLocation: 'artifact-defect-location',
  defectSeverity: 'artifact-defect-severity',
  changeDescription: 'artifact-change-description',
  changeReason: 'artifact-change-reason',
  requestedByContext: 'artifact-requested-by',
} as const satisfies Record<WorkArtifactRuleField, string>;

export const measurementLineDescriptionId = (line: number): string =>
  `artifact-measurement-description-${line}`;

const REQUIRED_MESSAGES: Readonly<Record<WorkArtifactRuleField, string>> = {
  title: 'Bitte gib einen Titel mit mindestens 3 Zeichen an.',
  workDate: 'Bitte wähle den Arbeitstag.',
  progress: 'Bitte beschreibe den Fortschritt.',
  visitStartedAt: 'Bitte gib den Beginn an.',
  visitEndedAt: 'Bitte gib das Ende an.',
  performedWork: 'Bitte beschreibe die ausgeführten Arbeiten.',
  measurementDate: 'Bitte wähle das Aufmaßdatum.',
  measurementLocation: 'Bitte gib den Aufmaßort an.',
  measurementLines: 'Bitte ergänze mindestens eine Position.',
  defectDescription: 'Bitte beschreibe den Mangel.',
  defectLocation: 'Bitte gib den Ort des Mangels an.',
  defectSeverity: 'Bitte wähle den Schweregrad.',
  changeDescription: 'Bitte beschreibe die Änderungs- oder Regiearbeit.',
  changeReason: 'Bitte gib den Grund an.',
  requestedByContext: 'Bitte gib an, wer die Arbeit angefordert hat.',
};

/** The rule issues as the form's error map: keyed by control id, in visual order; measurement lines come last. */
export function workArtifactFieldErrors(issues: readonly WorkArtifactFieldIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    if (issue.field === 'measurementLineDescription') continue;
    errors[WORK_ARTIFACT_CONTROL_IDS[issue.field]] =
      issue.code === 'visit_end_must_be_after_start'
        ? 'Das Ende muss nach dem Beginn liegen.'
        : REQUIRED_MESSAGES[issue.field];
  }
  const ordered: Record<string, string> = {};
  for (const id of Object.values(WORK_ARTIFACT_CONTROL_IDS)) {
    const message = errors[id];
    if (message) ordered[id] = message;
  }
  for (const issue of issues)
    if (issue.field === 'measurementLineDescription')
      ordered[measurementLineDescriptionId(issue.line)] = 'Bitte gib eine Bezeichnung an.';
  return ordered;
}
