import { toEmploymentCondition } from '@/lib/personnel/types';
import { toWorkSchedule } from '@/lib/personnel/schedule';
import { resolveDailyTargets, type DailyTarget } from '@/lib/personnel/targets';
import type { PeriodEmployee, PeriodPolicies, PeriodShared } from './period-sources';
import type { DailyTargetInput } from './types';

// The period's daily targets per employee: the P1-04 target resolution over
// the period's dates, with the policy's absence treatment applied.

/**
 * One employee's resolved targets for the period's dates, bounded by the
 * record's entry and exit dates (werk-flow/werkflow-planning#79), and the
 * daily target rows the calculation reads.
 */
export function resolveEmployeeDailyTargets(
  employee: Pick<PeriodEmployee, 'id' | 'entry_date' | 'exit_date'>,
  policiesByDate: PeriodPolicies,
  shared: {
    sources: Pick<
      PeriodShared['sources'],
      'schedules' | 'conditions' | 'vacations' | 'sickness' | 'calendar'
    >;
    index: Pick<PeriodShared['index'], 'dates'>;
  },
): { resolvedTargets: DailyTarget[]; dailyTargets: DailyTargetInput[] } {
  const { schedules, conditions, vacations, sickness, calendar } = shared.sources;
  const { dates } = shared.index;
  const employeeSchedules = (schedules ?? [])
    .filter((schedule) => schedule.employee_record_id === employee.id)
    .map(toWorkSchedule);
  const employeeConditions = (conditions ?? [])
    .filter((condition) => condition.employee_record_id === employee.id)
    .map(toEmploymentCondition);
  const absenceSpans = [...(vacations.get(employee.id) ?? []), ...(sickness.get(employee.id) ?? [])];
  const resolvedTargets = resolveDailyTargets(dates, {
    schedules: employeeSchedules,
    conditions: employeeConditions,
    calendar,
    employment: { entryDate: employee.entry_date, exitDate: employee.exit_date },
    absences: absenceSpans,
  });
  const dailyTargets: DailyTargetInput[] = resolvedTargets.map((target) => {
    const vacationMinutes =
      target.absence?.type === 'vacation' ? target.baseTargetMinutes - target.targetMinutes : 0;
    const sicknessMinutes =
      target.absence?.type === 'sickness' ? target.baseTargetMinutes - target.targetMinutes : 0;
    const treatment =
      target.absence?.type === 'vacation'
        ? policiesByDate.get(target.date)?.vacationTreatment
        : policiesByDate.get(target.date)?.sicknessTreatment;
    const targetMinutes =
      target.absence && treatment === 'informational' ? target.baseTargetMinutes : target.targetMinutes;
    return {
      localDate: target.date,
      targetMinutes,
      source:
        target.source === 'schedule'
          ? 'schedule'
          : target.source === 'derived'
            ? 'employment_condition'
            : 'default',
      vacationMinutes,
      sicknessMinutes,
    };
  });
  return { resolvedTargets, dailyTargets };
}
