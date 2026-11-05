'use client';

import { useEffect, useState } from 'react';
import { usePlanningOptions } from '@/hooks/use-planning-options';
import { usePendingTask } from '@/hooks/use-server-action';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { errorsByControlId, focusFirstInvalidField, REASON_MIN_8_MESSAGE } from '@/lib/ui/field-validation';
import { formatMinutesAsHoursInput } from '@/lib/jobs/planned-working';
import type { CalendarJob } from '@/lib/jobs/types';
import {
  reschedulePlanningSeries,
  setPlanningOccurrenceStatus,
  updatePlanningCalendarEntry,
} from '@/lib/planning/actions';
import type { PlanningConflict } from '@/lib/planning/types';
import { calendarRefusalMessage } from '@/lib/calendar/messages';
import {
  checkPlanningOccurrenceEdit,
  planningEditSuccessMessage,
  planningStatusChangeMessage,
  type PlanningEditScope,
  type PlanningOccurrenceFieldErrors,
  type PlanningStatusIntent,
} from '@/lib/calendar/planning-occurrence-edit';
import {
  PlanningOccurrenceConflictWarning,
  PlanningOccurrenceScheduleFields,
  PlanningOccurrenceStatusPanel,
  PlanningSeriesScopeField,
} from './planning-occurrence-edit-sections';
import { usePlanningSeriesExtension } from './use-planning-series-extension';

interface PlanningOccurrenceEditDialogProps {
  job: CalendarJob;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

/** The occurrence's edit state, refilled each time the dialog opens, and its series extension. */
function usePlanningOccurrenceEdit({
  job,
  open,
  onSuccess,
}: {
  job: CalendarJob;
  open: boolean;
  onSuccess: PlanningOccurrenceEditDialogProps['onSuccess'];
}) {
  const { showBanner } = useBanner();
  const assignedEmployeeRecordKey = (job.assignedEmployeeRecordIds ?? []).join(',');
  const [date, setDate] = useState(job.plannedDate ?? '');
  const [time, setTime] = useState(job.plannedTime ?? '09:00');
  const [durationHours, setDurationHours] = useState(
    formatMinutesAsHoursInput(job.estimatedDurationMinutes ?? 60),
  );
  const [scope, setScope] = useState<PlanningEditScope>('one');
  const [employeeRecordIds, setEmployeeRecordIds] = useState(job.assignedEmployeeRecordIds ?? []);
  const employeeSearch = usePlanningOptions('employees', employeeRecordIds, [], open);
  const [conflicts, setConflicts] = useState<PlanningConflict[]>([]);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const { run: runSubmit, isPending: submitting } = usePendingTask();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [statusIntent, setStatusIntent] = useState<PlanningStatusIntent | null>(null);
  const [statusReasonError, setStatusReasonError] = useState<string | undefined>();
  const extension = usePlanningSeriesExtension({ seriesId: job.seriesId, showBanner, onSuccess });
  const { resetSeriesExtension } = extension;

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the form is refilled from the occurrence each time the dialog opens
    setDate(job.plannedDate ?? '');
    setTime(job.plannedTime ?? '09:00');
    setDurationHours(formatMinutesAsHoursInput(job.estimatedDurationMinutes ?? 60));
    setScope('one');
    setEmployeeRecordIds(assignedEmployeeRecordKey ? assignedEmployeeRecordKey.split(',') : []);
    setConflicts([]);
    setFingerprint(null);
    setReason('');
    setSubmitError(null);
    setStatusIntent(null);
    setStatusReasonError(undefined);
    resetSeriesExtension();
  }, [
    assignedEmployeeRecordKey,
    job.estimatedDurationMinutes,
    job.occurrenceId,
    job.plannedDate,
    job.plannedTime,
    open,
    resetSeriesExtension,
  ]);

  const [fieldErrors, setFieldErrors] = useState<PlanningOccurrenceFieldErrors>({});
  return {
    showBanner,
    fields: { date, setDate, time, setTime, durationHours, setDurationHours, scope, setScope },
    employees: { employeeRecordIds, setEmployeeRecordIds, employeeSearch },
    review: { conflicts, setConflicts, fingerprint, setFingerprint, reason, setReason },
    submit: { runSubmit, submitting, submitError, setSubmitError },
    status: { statusIntent, setStatusIntent, statusReasonError, setStatusReasonError },
    fieldErrors,
    setFieldErrors,
    extension,
  };
}

type PlanningOccurrenceEdit = ReturnType<typeof usePlanningOccurrenceEdit>;
type OccurrenceCommand = {
  job: CalendarJob;
  onOpenChange: (open: boolean) => void;
  onSuccess: PlanningOccurrenceEditDialogProps['onSuccess'];
  edit: PlanningOccurrenceEdit;
};

/** Saves the edit for the chosen scope; a warning answer asks for a reason before the next try. */
async function submitOccurrenceEdit({
  job,
  onOpenChange,
  onSuccess,
  edit,
}: OccurrenceCommand): Promise<void> {
  const { showBanner, fields, employees, review, submit, setFieldErrors } = edit;
  const { date, time, durationHours, scope } = fields;
  const { conflicts, setConflicts, fingerprint, setFingerprint, reason } = review;
  const { runSubmit, setSubmitError } = submit;
  const { occurrenceId } = job;
  if (!occurrenceId) return;
  setFieldErrors({});
  const editCheck = checkPlanningOccurrenceEdit({
    date,
    time,
    durationHours,
    timeKind: job.timeKind,
    employeeRecordIds: employees.employeeRecordIds,
    conflicts,
    fingerprint,
    reason,
  });
  if (editCheck.kind === 'missing') {
    setFieldErrors(Object.fromEntries(editCheck.inputs.map(({ field, message }) => [field, message])));
    focusFirstInvalidField(errorsByControlId(editCheck.inputs));
    return;
  }
  setSubmitError(null);
  const { input } = editCheck;
  await runSubmit(async () => {
    try {
      const result =
        scope === 'one'
          ? await updatePlanningCalendarEntry(occurrenceId, input)
          : await reschedulePlanningSeries(occurrenceId, scope, input);
      if (result.success) {
        onOpenChange(false);
        showBanner({ variant: 'success', message: planningEditSuccessMessage(scope) });
        onSuccess?.();
        return;
      }
      if (
        (result.error === 'planning_warning' || result.error === 'stale_assessment') &&
        result.conflicts !== undefined &&
        result.fingerprint !== undefined
      ) {
        setConflicts(result.conflicts);
        setFingerprint(result.fingerprint);
        if (result.error === 'stale_assessment') {
          showBanner({
            variant: 'info',
            message: 'Die Planungslage hat sich geändert. Bitte erneut prüfen.',
          });
        }
        return;
      }
      setSubmitError(calendarRefusalMessage(result.error) ?? 'Die Änderung konnte nicht gespeichert werden.');
    } catch {
      setSubmitError('Die Änderung konnte nicht gespeichert werden.');
    }
  });
}

/** Skips or cancels the occurrence once its reason holds. */
async function submitOccurrenceStatus({
  job,
  onOpenChange,
  onSuccess,
  edit,
}: OccurrenceCommand): Promise<void> {
  const { showBanner, review, submit, status } = edit;
  const { reason } = review;
  const { runSubmit, setSubmitError } = submit;
  const { statusIntent, setStatusReasonError } = status;
  const { occurrenceId } = job;
  if (!occurrenceId || !statusIntent) return;
  const reasonError = reason.trim().length < 8 ? REASON_MIN_8_MESSAGE : undefined;
  setStatusReasonError(reasonError);
  if (focusFirstInvalidField({ 'planning-status-reason': reasonError })) return;
  setSubmitError(null);
  await runSubmit(async () => {
    try {
      const result = await setPlanningOccurrenceStatus(occurrenceId, statusIntent, reason);
      if (!result.success) {
        setSubmitError('Der Terminstatus konnte nicht geändert werden.');
        return;
      }
      onOpenChange(false);
      showBanner({ variant: 'success', message: planningStatusChangeMessage(statusIntent) });
      onSuccess?.();
    } catch {
      setSubmitError('Der Terminstatus konnte nicht geändert werden.');
    }
  });
}

/** The occurrence's schedule and people, bound to the edit state. */
function OccurrenceEditSchedule({
  job,
  edit,
}: {
  job: CalendarJob;
  edit: PlanningOccurrenceEdit;
}): React.JSX.Element {
  const { fields, employees, review, fieldErrors } = edit;
  return (
    <PlanningOccurrenceScheduleFields
      timeKind={job.timeKind}
      date={fields.date}
      dateError={fieldErrors.date}
      onDateChange={fields.setDate}
      time={fields.time}
      onTimeChange={fields.setTime}
      durationHours={fields.durationHours}
      durationError={fieldErrors.duration}
      onDurationHoursChange={fields.setDurationHours}
      employeeSelect={employees.employeeSearch.select}
      employeeRecordIds={employees.employeeRecordIds}
      onEmployeeRecordIdsChange={employees.setEmployeeRecordIds}
      onConflictsChange={review.setConflicts}
    />
  );
}

export function PlanningOccurrenceEditDialog({
  job,
  open,
  onOpenChange,
  onSuccess,
}: PlanningOccurrenceEditDialogProps) {
  const edit = usePlanningOccurrenceEdit({ job, open, onSuccess });
  const { fields, review, submit, status, fieldErrors, extension } = edit;
  const { conflicts, setConflicts, reason, setReason } = review;
  const { submitting, submitError, setSubmitError } = submit;
  const { statusIntent, setStatusIntent } = status;
  const command = { job, onOpenChange, onSuccess, edit };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={submitting}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Geplanten Termin bearbeiten</DialogTitle>
          <DialogDescription>Die Planung ändert keine bereits erfasste Arbeitszeit.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void (statusIntent ? submitOccurrenceStatus(command) : submitOccurrenceEdit(command));
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody className="space-y-4">
            {job.seriesId && (
              <PlanningSeriesScopeField
                scope={fields.scope}
                onScopeChange={fields.setScope}
                onConflictsChange={setConflicts}
                extension={extension}
              />
            )}
            <OccurrenceEditSchedule job={job} edit={edit} />
            {conflicts.length > 0 && (
              <PlanningOccurrenceConflictWarning
                conflicts={conflicts}
                reason={reason}
                reasonError={fieldErrors.reason}
                onReasonChange={setReason}
              />
            )}
            {statusIntent && (
              <PlanningOccurrenceStatusPanel
                statusIntent={statusIntent}
                onStatusIntentChange={setStatusIntent}
                reason={reason}
                reasonError={status.statusReasonError}
                onReasonChange={setReason}
                onSubmitErrorChange={setSubmitError}
              />
            )}
            <ErrorText>{submitError}</ErrorText>
          </DialogBody>
          <PlanningOccurrenceEditFooter
            isSeries={Boolean(job.seriesId)}
            submitting={submitting}
            statusIntent={statusIntent}
            onStatusIntentChange={setStatusIntent}
            onReasonChange={setReason}
            onConflictsChange={setConflicts}
            onSubmitErrorChange={setSubmitError}
            onOpenChange={onOpenChange}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface PlanningOccurrenceEditFooterProps {
  isSeries: boolean;
  submitting: boolean;
  statusIntent: PlanningStatusIntent | null;
  onStatusIntentChange: (statusIntent: PlanningStatusIntent | null) => void;
  onReasonChange: (reason: string) => void;
  onConflictsChange: (conflicts: PlanningConflict[]) => void;
  onSubmitErrorChange: (submitError: string | null) => void;
  onOpenChange: (open: boolean) => void;
}

/** Skip and cancel start the status step; the submit saves the edit or the status change. */
function PlanningOccurrenceEditFooter({
  isSeries,
  submitting,
  statusIntent,
  onStatusIntentChange,
  onReasonChange,
  onConflictsChange,
  onSubmitErrorChange,
  onOpenChange,
}: PlanningOccurrenceEditFooterProps) {
  return (
    <DialogFooter className="pt-4">
      <div className="flex flex-col gap-2 sm:mr-auto sm:flex-row">
        {isSeries && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onStatusIntentChange('skipped');
              onReasonChange('');
              onConflictsChange([]);
              onSubmitErrorChange(null);
            }}
          >
            Auslassen
          </Button>
        )}
        <Button
          type="button"
          variant="destructive"
          onClick={() => {
            onStatusIntentChange('cancelled');
            onReasonChange('');
            onConflictsChange([]);
            onSubmitErrorChange(null);
          }}
        >
          Termin absagen
        </Button>
      </div>
      <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
        Schließen
      </Button>
      <Button pending={submitting} type="submit" disabled={submitting}>
        {submitting ? 'Wird geprüft …' : statusIntent ? 'Status speichern' : 'Änderung speichern'}
      </Button>
    </DialogFooter>
  );
}
