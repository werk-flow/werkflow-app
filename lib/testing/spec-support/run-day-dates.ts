import { monthGridRange, monthWeeks } from '../../calendar/month-layout';
import { addLocalDays } from '../../date-time/berlin';

/**
 * The run-day offsets of a month-view drag onto the next day: `first` and the
 * day after it. A month grid ends with the week of the month's last day, so a
 * month that ends on a Sunday shows no next day, and neither month shows both
 * days. On that run day the pair moves one day back, in the same order.
 */
export function monthDragOffsets(businessDate: string, first: number): readonly [number, number] {
  const source = addLocalDays(businessDate, first);
  const lastShown = monthGridRange(monthWeeks(source, businessDate)).to;
  return addLocalDays(source, 1) <= lastShown ? [first, first + 1] : [first - 1, first];
}

/**
 * The run-day offset that keeps a window ending at `lastOffset` inside the
 * business year. Near December 31 the whole window moves before the run day, by
 * one distance, so its dates keep their order and stay distinct. It serves a
 * fact that only the shown year reads, such as the entitlement of the own
 * vacation balance, which ignores a condition dated after December 31.
 */
export function businessYearOffset(businessDate: string, offset: number, lastOffset: number): number {
  const windowEnd = addLocalDays(businessDate, lastOffset);
  return windowEnd.slice(0, 4) === businessDate.slice(0, 4) ? offset : offset - 2 * (lastOffset + 1);
}
