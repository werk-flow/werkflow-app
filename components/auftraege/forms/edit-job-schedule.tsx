'use client';

import { DatePicker } from '@/components/ui/date-picker';
import { DurationHoursInput } from '@/components/ui/duration-hours-input';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { TextLink } from '@/components/ui/text-link';
import { TimeInput } from '@/components/ui/time-input';
import {
  jobFormEditsSchedule,
  jobPlanningHref,
  type JobVisit,
  type JobVisitPlan,
} from '@/lib/jobs/visit-schedule';
import { formatBerlinTime, formatGermanDate } from '@/lib/utils';
import type { EditJobForm } from './use-edit-job-form';

/**
 * Date, time and duration of the job. They describe one visit only, so the
 * form edits them while the job has at most one visit; with several it lists
 * the visits and links to the Plantafel.
 */
export function EditJobScheduleFields({ form }: { form: EditJobForm }): React.JSX.Element {
  const {
    visitPlan,
    plannedDate,
    setPlannedDate,
    plannedTime,
    setPlannedTime,
    estimatedHours,
    handleEstimatedHoursChange,
    formDisabled,
  } = form;
  if (visitPlan && !jobFormEditsSchedule(visitPlan.total)) return <EditJobVisits plan={visitPlan} />;
  return (
    <>
      <Field label="Geplantes Datum" htmlFor="edit-job-date">
        <DatePicker value={plannedDate} onChange={setPlannedDate} disabled={formDisabled} />
      </Field>

      <Field label="Geplante Uhrzeit" htmlFor="edit-job-time">
        <TimeInput value={plannedTime} onChange={setPlannedTime} disabled={formDisabled} />
      </Field>

      <Field label="Geschätzte Dauer (Stunden)" htmlFor="edit-job-duration">
        <DurationHoursInput
          id="edit-job-duration"
          placeholder="z.B. 2.5"
          value={estimatedHours}
          onChange={handleEstimatedHoursChange}
          disabled={formDisabled}
        />
      </Field>
    </>
  );
}

function visitLabel(visit: JobVisit): string {
  const day = formatGermanDate(visit.date);
  if (!visit.startAt || !visit.endAt) return `${day}, ganztägig`;
  return `${day}, ${formatBerlinTime(visit.startAt)}–${formatBerlinTime(visit.endAt)}`;
}

/** The job's upcoming visits, read-only, and the way to the Plantafel. */
function EditJobVisits({ plan }: { plan: JobVisitPlan }): React.JSX.Element {
  const more = plan.upcomingTotal - plan.upcoming.length;
  return (
    <div role="group" aria-labelledby="edit-job-visits-title" className="grid gap-2">
      <p id="edit-job-visits-title" className="text-sm font-medium">
        Termine
      </p>
      {plan.upcoming.length > 0 ? (
        <ul className="divide-y rounded-md border text-sm">
          {plan.upcoming.map((visit) => (
            <li
              key={visit.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2"
            >
              <span className="tabular-nums">{visitLabel(visit)}</span>
              <span className="min-w-0 text-muted-foreground">
                {visit.people.length > 0 ? visit.people.join(', ') : 'Noch niemand eingeplant'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState size="compact" title="Keine anstehenden Termine" />
      )}
      {more > 0 && <p className="text-xs text-muted-foreground">und {more} weitere</p>}
      <p className="text-sm text-muted-foreground">
        Dieser Auftrag hat {plan.total} Termine. Datum, Uhrzeit und Dauer änderst du für jeden Termin einzeln:{' '}
        <TextLink href={jobPlanningHref(plan)}>In der Plantafel planen</TextLink>
      </p>
    </div>
  );
}
