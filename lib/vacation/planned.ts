import { addLocalDays } from '@/lib/date-time/berlin';
import { countVacationDaysByYear, type VacationCountingContext } from './balance';
import type { VacationRequest } from './types';

/**
 * The approved vacation days of a year that still lie after `today`
 * („verplant“): approved, but not yet taken. A request that starts after today
 * counts its whole approval-time snapshot for the year; one that runs over
 * today counts its remaining days, at most its snapshot. So taken plus planned
 * stays the approved total the balance consumes.
 */
export function plannedVacationDays(
  year: number,
  requests: readonly VacationRequest[],
  context: VacationCountingContext,
  today: string,
): number {
  const yearKey = String(year);
  const tomorrow = addLocalDays(today, 1);
  let planned = 0;
  for (const request of requests) {
    if (request.status !== 'approved' || request.endDate < tomorrow) continue;
    const approvedDays = request.approvedDaysByYear?.[yearKey] ?? 0;
    if (request.startDate >= tomorrow) {
      planned += approvedDays;
      continue;
    }
    const remainingDays = countVacationDaysByYear({ ...request, startDate: tomorrow }, context)[yearKey] ?? 0;
    planned += Math.min(approvedDays, remainingDays);
  }
  return planned;
}
