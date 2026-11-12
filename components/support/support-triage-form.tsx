'use client';

import { useState, type FormEvent } from 'react';

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
// overwrite nothing of each other.

const RESPONSE_ID = 'support-triage-response';
const NO_BUCKET = 'ohne';

type Draft = { status: string; bucket: string; assigneeId: string; response: string };

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

type TriageFieldsProps = {
  report: SupportReport;
  draft: Draft;
  onChange: (change: Partial<Draft>) => void;
  disabled: boolean;
  responseError: string | undefined;
};

function TriageFields({ report, draft, onChange, disabled, responseError }: TriageFieldsProps) {
  return (
    <>
      <div className="grid gap-4">
        <Field label="Status">
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
        <Field label="Einordnung">
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
      <Field label="Zuständig">
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
        label="Antwort an die Person"
        htmlFor={RESPONSE_ID}
        description="Sie liest das in „Meine Meldungen“, zum Beispiel „Behoben, ab morgen live“ oder warum es so bleibt."
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

/**
 * The form's fields: the loaded report with the support person's unsaved
 * edits on top. A refresh that brings the report anew, such as the one after
 * „Original öffnen“, keeps the edits. They leave when the save that sent them
 * shows in the report.
 */
function useTriageDraft(report: SupportReport) {
  const [edits, setEdits] = useState<Partial<Draft>>({});
  // The report a save was accepted on: the next report is that save's result.
  const [savedOn, setSavedOn] = useState<SupportReport | null>(null);
  if (savedOn !== null && savedOn !== report) {
    setSavedOn(null);
    setEdits({});
  }
  return {
    draft: { ...draftOf(report), ...edits },
    change: (change: Partial<Draft>) =>
      setEdits((current) => withoutUnchanged(report, { ...current, ...change })),
    markSaved: () => setSavedOn(report),
  };
}

const DRAFT_FIELDS = ['status', 'bucket', 'assigneeId', 'response'] as const;

/**
 * The edits that still differ from the loaded report. A field set back to its
 * loaded value is no edit: a colleague's later change of it then shows, and a
 * save of another field does not send the old value.
 */
function withoutUnchanged(report: SupportReport, edits: Partial<Draft>): Partial<Draft> {
  const loaded = draftOf(report);
  const kept: Partial<Draft> = {};
  for (const field of DRAFT_FIELDS) {
    const value = edits[field];
    if (value === undefined) continue;
    const same = field === 'response' ? value.trim() === loaded.response.trim() : value === loaded[field];
    if (!same) kept[field] = value;
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
  const { draft, change, markSaved } = useTriageDraft(report);
  const [error, setError] = useState<string | null>(null);
  const [responseError, setResponseError] = useState<string | undefined>(undefined);

  const save = async (changes: TriageProblemReportInput['changes']): Promise<void> => {
    let result: Awaited<ReturnType<typeof triageProblemReport>>;
    try {
      result = await run({ reportId: report.id, changes });
    } catch (thrown) {
      // The request itself failed: the fields keep what was typed, and „Speichern“ tries again.
      logError('SupportTriageForm: save failed', thrown);
      setError(supportFailureMessage('request_failed'));
      return;
    }
    if (!result.success) {
      setError(supportFailureMessage(result.error));
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
    void save(changes);
  };

  // The fields rest from the press until the saved report is on screen.
  const busy = isPending || isSettling;
  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
      <TriageFields
        report={report}
        draft={draft}
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
