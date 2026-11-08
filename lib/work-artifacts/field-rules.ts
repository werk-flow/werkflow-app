import type { WorkArtifactContentInput, WorkArtifactKind } from './types';

// The field rules of a saved Arbeitsnachweis. The save schema (validation.ts)
// reports each as a Zod issue; the editor runs the same rules before the save
// and marks the named fields, so the server never answers with a rule the
// form could not show.

/** A content field that a kind requires. */
type RequiredContentField =
  | 'workDate'
  | 'progress'
  | 'visitStartedAt'
  | 'visitEndedAt'
  | 'performedWork'
  | 'measurementDate'
  | 'measurementLocation'
  | 'measurementLines'
  | 'defectDescription'
  | 'defectLocation'
  | 'defectSeverity'
  | 'changeDescription'
  | 'changeReason'
  | 'requestedByContext';

export type WorkArtifactRuleField = 'title' | RequiredContentField;

export type WorkArtifactFieldIssue =
  | { field: WorkArtifactRuleField; code: string }
  | { field: 'measurementLineDescription'; line: number; code: 'measurement_line_description_required' };

/** The draft the rules read: the client's editor state or the parsed save input. */
export type WorkArtifactRuleDraft = {
  kind: WorkArtifactKind;
  title: string;
  submit: boolean;
  content: {
    [Key in Exclude<RequiredContentField, 'measurementLines'>]?: WorkArtifactContentInput[Key] | undefined;
  } & { measurementLines?: ReadonlyArray<{ description: string }> | undefined };
};

const WORK_ARTIFACT_TITLE_MIN_LENGTH = 3;

/** The fields each kind needs for a submit, in the form's order; a draft needs the ones in `DRAFT_REQUIRED`. */
const SUBMIT_REQUIRED: Readonly<Record<WorkArtifactKind, readonly RequiredContentField[]>> = {
  site_diary: ['workDate', 'progress'],
  work_report: ['visitStartedAt', 'visitEndedAt', 'performedWork'],
  measurement: ['measurementDate', 'measurementLocation', 'measurementLines'],
  defect: ['defectDescription', 'defectLocation', 'defectSeverity'],
  change_work: ['changeDescription', 'changeReason', 'requestedByContext'],
};

/** A draft keeps the kind's meaningful content; a measurement needs a location or a line. */
const DRAFT_REQUIRED: Readonly<Record<WorkArtifactKind, readonly RequiredContentField[]>> = {
  site_diary: ['progress'],
  work_report: ['performedWork'],
  measurement: [],
  defect: ['defectDescription', 'defectLocation', 'defectSeverity'],
  change_work: ['changeDescription', 'changeReason', 'requestedByContext'],
};

const REQUIRED_CODES: Readonly<Record<RequiredContentField, string>> = {
  workDate: 'work_date_required',
  progress: 'progress_required',
  visitStartedAt: 'visit_start_required',
  visitEndedAt: 'visit_end_required',
  performedWork: 'performed_work_required',
  measurementDate: 'measurement_date_required',
  measurementLocation: 'measurement_location_required',
  measurementLines: 'measurement_lines_required',
  defectDescription: 'defect_description_required',
  defectLocation: 'defect_location_required',
  defectSeverity: 'defect_severity_required',
  changeDescription: 'change_description_required',
  changeReason: 'change_reason_required',
  requestedByContext: 'requested_by_context_required',
};

/** The fields the form marks as required for a kind: everything its submit needs. */
export function requiredWorkArtifactFields(kind: WorkArtifactKind): ReadonlySet<WorkArtifactRuleField> {
  return new Set<WorkArtifactRuleField>(['title', ...SUBMIT_REQUIRED[kind]]);
}

function filled(value: WorkArtifactRuleDraft['content'][RequiredContentField]): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'string' ? value.trim() !== '' : value !== undefined;
}

/** Every rule the draft breaks; the visit window must also run forward. */
export function workArtifactFieldIssues(draft: WorkArtifactRuleDraft): WorkArtifactFieldIssue[] {
  const { kind, content } = draft;
  const issues: WorkArtifactFieldIssue[] = [];
  if (draft.title.trim().length < WORK_ARTIFACT_TITLE_MIN_LENGTH)
    issues.push({ field: 'title', code: 'title_too_short' });
  const required = draft.submit ? SUBMIT_REQUIRED[kind] : DRAFT_REQUIRED[kind];
  for (const field of SUBMIT_REQUIRED[kind]) {
    if (required.includes(field) && !filled(content[field]))
      issues.push({ field, code: REQUIRED_CODES[field] });
  }
  const { visitStartedAt, visitEndedAt } = content;
  if (visitStartedAt && visitEndedAt && new Date(visitEndedAt) <= new Date(visitStartedAt))
    issues.push({ field: 'visitEndedAt', code: 'visit_end_must_be_after_start' });
  if (
    kind === 'measurement' &&
    !draft.submit &&
    !filled(content.measurementLocation) &&
    !filled(content.measurementLines)
  )
    issues.push({ field: 'measurementLocation', code: 'meaningful_content_required' });
  (content.measurementLines ?? []).forEach((line, index) => {
    if (line.description.trim() === '')
      issues.push({
        field: 'measurementLineDescription',
        line: index,
        code: 'measurement_line_description_required',
      });
  });
  return issues;
}
