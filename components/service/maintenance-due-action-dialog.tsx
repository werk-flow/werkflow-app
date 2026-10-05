'use client';

import type { ReactElement } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DurationHoursInput } from '@/components/ui/duration-hours-input';
import { ErrorText } from '@/components/ui/error-text';
import { SectionError } from '@/components/ui/section-error';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { TimeInput } from '@/components/ui/time-input';
import {
  MAINTENANCE_SCOPE_OUTCOMES,
  MAINTENANCE_SCOPE_OUTCOME_LABELS,
  type MaintenanceDueItem,
  type MaintenanceScopeOutcome,
  type MaintenanceWorkspace,
} from '@/lib/maintenance/types';
import { formatBerlinLocalDate } from '@/lib/planning/date-time';
import type { MaintenanceDueActionKind } from './maintenance-due-action-state';
import { useMaintenanceDueAction, type MaintenanceDueActionController } from './use-maintenance-due-action';
import { parseIsoLocalDate } from '@/lib/utils';

const EVIDENCE_LIST_CLASS = 'max-h-40 space-y-2 overflow-y-auto rounded-md border p-3';
const EVIDENCE_ROW_CLASS = 'flex items-center gap-2 text-sm';

type DueActionFieldsProps = { controller: MaintenanceDueActionController };

function DueActionSelect({
  controller,
  due,
  hasServiceCases,
}: DueActionFieldsProps & {
  due: MaintenanceDueItem;
  hasServiceCases: boolean;
}): ReactElement {
  const canSchedule = due.status === 'visit_created' && !due.planningOccurrenceId;
  const canComplete = due.status === 'visit_created';
  return (
    <Field label="Aktion" htmlFor="due-action">
      <Select
        value={controller.action}
        onValueChange={(value) => controller.setAction(value as MaintenanceDueActionKind)}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {due.status === 'open' && <SelectItem value="create_visit">Wartungsauftrag anlegen</SelectItem>}
          {canSchedule && <SelectItem value="schedule">Termin im Kalender planen</SelectItem>}
          {canComplete && <SelectItem value="complete">Wartung abschließen</SelectItem>}
          {hasServiceCases && (
            <SelectItem value="link_service_case">Reaktiven Servicefall verknüpfen</SelectItem>
          )}
          <SelectItem value="skipped">Fälligkeit überspringen</SelectItem>
          <SelectItem value="cancelled">Fälligkeit absagen</SelectItem>
          <SelectItem value="superseded">Durch andere Fälligkeit ersetzen</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

function DueScheduleFields({ controller }: DueActionFieldsProps): ReactElement {
  const { date, setDate, time, setTime, durationHours, setDurationHours, fieldErrors } = controller;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Datum" htmlFor="due-date" required error={fieldErrors.date}>
        <DatePicker
          ariaLabel="Datum"
          value={parseIsoLocalDate(date)}
          onChange={(value) => setDate(value ? formatBerlinLocalDate(value) : '')}
        />
      </Field>
      <Field label="Uhrzeit" htmlFor="due-time" required>
        <TimeInput value={time} onChange={setTime} />
      </Field>
      <Field label="Dauer (Stunden)" htmlFor="due-duration" required error={fieldErrors.durationHours}>
        <DurationHoursInput id="due-duration" value={durationHours} onChange={setDurationHours} />
      </Field>
    </div>
  );
}

// Stays in this file: lib/ui/contextual-documents-layout.test.ts pins both
// evidence classes to the loading and the loaded list here.
function DueCompletionFields({ controller }: DueActionFieldsProps): ReactElement {
  const { scopeOutcome, setScopeOutcome, completedOn, setCompletedOn, fieldErrors } = controller;
  const { evidence, evidenceIds, setEvidenceIds, isEvidenceLoading, evidenceLoadFailed } = controller;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ergebnis" htmlFor="due-outcome">
          <Select
            value={scopeOutcome}
            onValueChange={(value) => setScopeOutcome(value as MaintenanceScopeOutcome)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MAINTENANCE_SCOPE_OUTCOMES.map((value) => (
                <SelectItem key={value} value={value}>
                  {MAINTENANCE_SCOPE_OUTCOME_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Abgeschlossen am" htmlFor="due-completed" required error={fieldErrors.completedOn}>
          <DatePicker
            ariaLabel="Abgeschlossen am"
            value={parseIsoLocalDate(completedOn)}
            onChange={(value) => setCompletedOn(value ? formatBerlinLocalDate(value) : '')}
          />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Versionierte Arbeitsnachweise</legend>
        {isEvidenceLoading ? (
          <div className={EVIDENCE_LIST_CLASS} role="status" aria-busy="true">
            <span className="sr-only">Arbeitsnachweise werden geladen.</span>
            {[0, 1].map((index) => (
              <div key={index} className={EVIDENCE_ROW_CLASS} aria-hidden="true">
                <Skeleton className="size-4 shrink-0" />
                <Skeleton className="h-5 w-2/3" />
              </div>
            ))}
          </div>
        ) : evidenceLoadFailed ? (
          <SectionError onRetry={controller.retryEvidence}>
            Die Arbeitsnachweise konnten nicht geladen werden.
          </SectionError>
        ) : evidence.length ? (
          <div id="due-evidence" tabIndex={-1} className={EVIDENCE_LIST_CLASS}>
            {evidence.map((option) => (
              <label key={option.revisionId} className={EVIDENCE_ROW_CLASS}>
                <Checkbox
                  checked={evidenceIds.includes(option.revisionId)}
                  onCheckedChange={(checked) =>
                    setEvidenceIds((ids) =>
                      checked ? [...ids, option.revisionId] : ids.filter((id) => id !== option.revisionId),
                    )
                  }
                />
                <span>
                  {option.title} · Revision {option.revisionNumber}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
            Für diesen Auftrag liegt noch kein versionierter Arbeitsnachweis vor.
          </p>
        )}
        <ErrorText>{fieldErrors.evidenceIds}</ErrorText>
      </fieldset>
    </>
  );
}

export function MaintenanceDueActionDialog({
  open,
  onOpenChange,
  due,
  defaultAction,
  plannedDurationMinutes,
  serviceCases,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  due: MaintenanceDueItem;
  defaultAction: MaintenanceDueActionKind;
  plannedDurationMinutes: number;
  serviceCases: MaintenanceWorkspace['serviceCases'];
  /** Settled by the caller (a live-view refresh) instead of a route refresh. */
  onSaved?: () => void;
}): ReactElement {
  const controller = useMaintenanceDueAction({
    open,
    onOpenChange,
    due,
    defaultAction,
    plannedDurationMinutes,
    onSaved,
  });
  const { action, fieldErrors, isPending, showReason, reasonRequired } = controller;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Fälligkeit bearbeiten</DialogTitle>
          <DialogDescription>
            {due.planNumber} · fällig am{' '}
            {new Intl.DateTimeFormat('de-DE').format(new Date(`${due.dueDate}T12:00:00Z`))}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <DueActionSelect controller={controller} due={due} hasServiceCases={serviceCases.length > 0} />
          {action === 'schedule' && <DueScheduleFields controller={controller} />}
          {action === 'complete' && <DueCompletionFields controller={controller} />}
          {action === 'link_service_case' && (
            <Field
              label="Servicefall"
              htmlFor="maintenance-service-case"
              required
              error={fieldErrors.serviceCaseId}
            >
              <SearchableSelect
                value={controller.serviceCaseId}
                onChange={controller.setServiceCaseId}
                options={serviceCases.map((serviceCase) => ({
                  value: serviceCase.id,
                  label: `${serviceCase.caseNumber} · ${serviceCase.summary}`,
                }))}
                placeholder="Servicefall suchen"
                emptyMessage="Kein passender Servicefall gefunden"
              />
            </Field>
          )}
          {showReason && (
            <Field
              label={reasonRequired ? 'Begründung' : 'Notiz (optional)'}
              htmlFor="due-reason"
              required={reasonRequired}
              error={fieldErrors.reason}
            >
              <Textarea
                value={controller.reason}
                onChange={(event) => controller.setReason(event.target.value)}
              />
            </Field>
          )}
        </div>
        <ErrorText>{controller.error}</ErrorText>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Abbrechen
          </Button>
          <Button
            type="button"
            onClick={controller.submit}
            disabled={
              isPending ||
              (action === 'complete' && (controller.isEvidenceLoading || controller.evidenceLoadFailed))
            }
          >
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Aktion ausführen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
