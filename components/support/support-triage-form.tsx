'use client';

import { createContext, useContext, useMemo, useState, type FormEvent, type ReactNode } from 'react';

import { AutomaticAnswerBadge } from '@/components/problem-reports/automatic-answer-badge';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { useRouterRefresh } from '@/components/ui/refresh-button';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useServerAction } from '@/hooks/use-server-action';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { logError } from '@/lib/logging';
import { PROBLEM_REPORT_STATUS_LABELS } from '@/lib/problem-reports/messages';
import type { TriageProblemReportInput } from '@/lib/problem-reports/schemas';
import { triageProblemReport } from '@/lib/problem-reports/support-actions';
import { PROBLEM_REPORT_BUCKET_LABELS, supportFailureMessage } from '@/lib/problem-reports/support-messages';
import {
  PROBLEM_REPORT_BUCKETS,
  PROBLEM_REPORT_RESPONSE_MAX_LENGTH,
  PROBLEM_REPORT_STATUSES,
  type SupportReport,
} from '@/lib/problem-reports/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { NOT_SORTED } from './report-labels';

// Support's triage of one report: status, bucket, assignee and the answer
// the reporter reads. A save sends only the fields that differ from the
// loaded report, so two support persons who change different fields
// overwrite nothing of each other. It names, for each of those fields, the
// value the page showed when the edit began; the database refuses the save
// when someone else changed that field since. The page then shows what is
// saved under the field, keeps the edit, and the next press saves over it.

const RESPONSE_ID = 'support-triage-response';
const NO_BUCKET = 'ohne';

type Draft = { status: string; bucket: string; assigneeId: string; response: string };
type DraftField = keyof Draft;
/** An unsaved edit: its value, and the loaded value it began from. */
type Edit = { value: string; basis: string };
type Edits = Partial<Record<DraftField, Edit>>;

function draftOf(report: SupportReport): Draft {
  return {
    status: report.status,
    bucket: report.bucket ?? NO_BUCKET,
    assigneeId: report.assigneeId ?? '',
    response: report.response ?? '',
  };
}

/** The fields of the draft that differ from the loaded report. */
function changesOf(report: SupportReport, draft: Draft): TriageProblemReportInput['changes'] {
  const loaded = draftOf(report);
  const status = PROBLEM_REPORT_STATUSES.find((candidate) => candidate === draft.status);
  const bucket = PROBLEM_REPORT_BUCKETS.find((candidate) => candidate === draft.bucket) ?? null;
  return {
    ...(status !== undefined && draft.status !== loaded.status ? { status } : {}),
    ...(draft.bucket !== loaded.bucket ? { bucket } : {}),
    ...(draft.assigneeId !== loaded.assigneeId ? { assigneeId: draft.assigneeId || null } : {}),
    ...(draft.response.trim() !== loaded.response.trim() ? { response: draft.response } : {}),
  };
}

/** For the changed fields, the values a save is based on, as the report holds them. */
function expectedOf(
  changes: TriageProblemReportInput['changes'],
  basisOf: (field: DraftField) => string,
): TriageProblemReportInput['expected'] {
  const status = PROBLEM_REPORT_STATUSES.find((candidate) => candidate === basisOf('status'));
  return {
    ...(changes.status === undefined || status === undefined ? {} : { status }),
    ...(changes.bucket === undefined
      ? {}
      : { bucket: PROBLEM_REPORT_BUCKETS.find((candidate) => candidate === basisOf('bucket')) ?? null }),
    ...(changes.assigneeId === undefined ? {} : { assigneeId: basisOf('assigneeId') || null }),
    ...(changes.response === undefined ? {} : { response: basisOf('response') || null }),
  };
}

/** How a saved value reads in the note under a field someone else changed. */
function savedValueLabel(report: SupportReport, field: DraftField): string {
  const status = PROBLEM_REPORT_STATUSES.find((candidate) => candidate === report.status);
  switch (field) {
    case 'status':
      return status === undefined ? report.status : PROBLEM_REPORT_STATUS_LABELS[status];
    case 'bucket':
      return report.bucket === null ? NOT_SORTED : PROBLEM_REPORT_BUCKET_LABELS[report.bucket];
    case 'assigneeId':
      return report.assigneeName ?? 'Niemand';
    case 'response':
      return report.response === null ? 'keine Antwort' : `„${report.response}“`;
  }
}

type TriageFieldsProps = {
  report: SupportReport;
  draft: Draft;
  /** What is saved by now in a field someone else changed during the edit. */
  notes: Partial<Record<DraftField, string>>;
  onChange: (change: Partial<Draft>) => void;
  disabled: boolean;
  responseError: string | undefined;
};

function TriageFields({ report, draft, notes, onChange, disabled, responseError }: TriageFieldsProps) {
  return (
    <>
      <div className="grid gap-4">
        <Field label="Status" description={notes.status}>
          <Select value={draft.status} disabled={disabled} onValueChange={(status) => onChange({ status })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROBLEM_REPORT_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {PROBLEM_REPORT_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Einordnung" description={notes.bucket}>
          <Select value={draft.bucket} disabled={disabled} onValueChange={(bucket) => onChange({ bucket })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_BUCKET}>{NOT_SORTED}</SelectItem>
              {PROBLEM_REPORT_BUCKETS.map((bucket) => (
                <SelectItem key={bucket} value={bucket}>
                  {PROBLEM_REPORT_BUCKET_LABELS[bucket]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Zuständig" description={notes.assigneeId}>
        <SearchableSelect
          value={draft.assigneeId}
          onChange={(assigneeId) => onChange({ assigneeId })}
          options={report.assignees.map((assignee) => ({ value: assignee.userId, label: assignee.name }))}
          placeholder="Niemand"
          searchPlaceholder="Person suchen"
          allowNone
          noneLabel="Niemand"
          disabled={disabled}
        />
      </Field>
      <Field
        label={
          <>
            Antwort an die Person
            {report.responseByAgent ? <AutomaticAnswerBadge className="ml-2 align-middle" /> : null}
          </>
        }
        htmlFor={RESPONSE_ID}
        description={
          notes.response ??
          'Sie liest das in „Meine Meldungen“, zum Beispiel „Behoben, ab morgen live“ oder warum es so bleibt.'
        }
        error={responseError}
      >
        <Textarea
          value={draft.response}
          disabled={disabled}
          onChange={(event) => onChange({ response: event.target.value })}
        />
      </Field>
    </>
  );
}

type DraftStore = {
  edits: Readonly<Record<string, Edits>>;
  update: (reportId: string, next: (current: Edits) => Edits) => void;
};

const TriageDraftContext = createContext<DraftStore | null>(null);

/**
 * Holds the unsaved triage edits of support's report pages above the region
 * that reads the report. A read that fails replaces the form with its retry;
 * the form that comes back takes the edits up again.
 */
export function TriageDraftProvider({ children }: { children: ReactNode }) {
  const [edits, setEdits] = useState<Readonly<Record<string, Edits>>>({});
  const store = useMemo<DraftStore>(
    () => ({
      edits,
      update: (reportId, next) => setEdits((all) => ({ ...all, [reportId]: next(all[reportId] ?? {}) })),
    }),
    [edits],
  );
  return <TriageDraftContext value={store}>{children}</TriageDraftContext>;
}

/**
 * The form's fields: the loaded report with the support person's unsaved
 * edits on top. A refresh that brings the report anew, such as the one after
 * „Original öffnen“, keeps the edits, and so does a failed read that replaced
 * the form for a while. They leave when the save that sent them shows in the
 * report.
 */
function useTriageDraft(report: SupportReport) {
  const store = useContext(TriageDraftContext);
  if (store === null) throw new Error('SupportTriageForm renders inside TriageDraftProvider.');
  // What an accepted save sent shows until the report it saved arrives; the store forgets it at once.
  const [sent, setSent] = useState<{ edits: Edits; on: SupportReport } | null>(null);
  if (sent !== null && sent.on !== report) setSent(null);
  const edits = sent !== null && sent.on === report ? sent.edits : (store.edits[report.id] ?? {});
  const loaded = draftOf(report);
  const draft: Draft = { ...loaded };
  const notes: Partial<Record<DraftField, string>> = {};
  for (const field of DRAFT_FIELDS) {
    const edit = edits[field];
    if (edit === undefined) continue;
    draft[field] = edit.value;
    if (edit.basis !== loaded[field])
      notes[field] = `Inzwischen gespeichert: ${savedValueLabel(report, field)}`;
  }
  return {
    draft,
    notes,
    /** The loaded value an edit of the field began from. */
    basisOf: (field: DraftField): string => edits[field]?.basis ?? loaded[field],
    change: (change: Partial<Draft>) =>
      store.update(report.id, (current) => withoutUnchanged(report, withChange(current, change, loaded))),
    markSaved: () => {
      setSent({ edits, on: report });
      store.update(report.id, () => ({}));
    },
  };
}

const DRAFT_FIELDS = ['status', 'bucket', 'assigneeId', 'response'] as const;

/** The edits with a change on top; a field's first edit begins from its loaded value. */
function withChange(edits: Edits, change: Partial<Draft>, loaded: Draft): Edits {
  const next: Edits = { ...edits };
  for (const field of DRAFT_FIELDS) {
    const value = change[field];
    if (value !== undefined) next[field] = { value, basis: edits[field]?.basis ?? loaded[field] };
  }
  return next;
}

/**
 * The edits that still differ from the loaded report. A field set back to its
 * loaded value is no edit: a colleague's later change of it then shows, and a
 * save of another field does not send the old value.
 */
function withoutUnchanged(report: SupportReport, edits: Edits): Edits {
  const loaded = draftOf(report);
  const kept: Edits = {};
  for (const field of DRAFT_FIELDS) {
    const edit = edits[field];
    if (edit === undefined) continue;
    const same =
      field === 'response' ? edit.value.trim() === loaded.response.trim() : edit.value === loaded[field];
    if (!same) kept[field] = edit;
  }
  return kept;
}

export function SupportTriageForm({ report }: { report: SupportReport }) {
  const { showBanner } = useBanner();
  const { refresh } = useRouterRefresh();
  const settle = useSettleOnChange(report);
  const { run, isPending, isSettling } = useServerAction(triageProblemReport, {
    settle: (result) => (result.success ? settle() : Promise.resolve()),
  });
  const { draft, notes, basisOf, change, markSaved } = useTriageDraft(report);
  const [error, setError] = useState<string | null>(null);
  const [responseError, setResponseError] = useState<string | undefined>(undefined);
  // A refused save showed what is saved now: the next press saves over what is on screen.
  const [saveOverShown, setSaveOverShown] = useState(false);

  const save = async (input: TriageProblemReportInput): Promise<void> => {
    let result: Awaited<ReturnType<typeof triageProblemReport>>;
    try {
      result = await run(input);
    } catch (thrown) {
      // The request itself failed: the fields keep what was typed, and „Speichern“ tries again.
      logError('SupportTriageForm: save failed', thrown);
      setError(supportFailureMessage('request_failed'));
      return;
    }
    if (!result.success) {
      setError(supportFailureMessage(result.error));
      if (result.error === 'triage_conflict') {
        setSaveOverShown(true);
        refresh();
      }
      return;
    }
    markSaved();
    refresh();
    showBanner({ variant: 'success', message: 'Gespeichert. Die Person sieht es in „Meine Meldungen“.' });
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);
    const errors = {
      [RESPONSE_ID]:
        draft.response.trim().length > PROBLEM_REPORT_RESPONSE_MAX_LENGTH
          ? `Die Antwort ist zu lang. Kürze sie auf höchstens ${PROBLEM_REPORT_RESPONSE_MAX_LENGTH} Zeichen.`
          : undefined,
    };
    setResponseError(errors[RESPONSE_ID]);
    if (focusFirstInvalidField(errors)) return;
    const changes = changesOf(report, draft);
    if (Object.keys(changes).length === 0) {
      showBanner({ variant: 'info', message: 'Es gibt nichts zu speichern: Du hast nichts geändert.' });
      return;
    }
    const loaded = draftOf(report);
    const expected = expectedOf(changes, (field) => (saveOverShown ? loaded[field] : basisOf(field)));
    setSaveOverShown(false);
    void save({ reportId: report.id, changes, expected });
  };

  // The fields rest from the press until the saved report is on screen.
  const busy = isPending || isSettling;
  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
      <TriageFields
        report={report}
        draft={draft}
        notes={notes}
        onChange={change}
        disabled={busy}
        responseError={responseError}
      />
      <ErrorText>{error}</ErrorText>
      <Button type="submit" pending={isPending} disabled={busy}>
        Speichern
      </Button>
    </form>
  );
}
