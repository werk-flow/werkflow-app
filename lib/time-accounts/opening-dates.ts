import { addLocalDays } from '@/lib/date-time/berlin';
import { formatGermanDate } from '@/lib/utils';

const monthStart = (localDate: string): string => `${localDate.slice(0, 7)}-01`;

/**
 * The start date the rule and account setup proposes: the first day of the
 * oldest month without a closed period. A period counts a policy and an
 * account only from their start on, so a later start blocks that month.
 * Months before the oldest recorded time or open period need no account; with
 * neither, the current month is the first one to close. Months up to the last
 * closed period are already settled.
 */
export function suggestTimeAccountStartDate(input: {
  today: string;
  latestClosedPeriodEnd: string | null;
  /** The earliest day with recorded time or an open period, if any. */
  earliestActivityDate: string | null;
}): string {
  const currentMonth = monthStart(input.today);
  const earliest = input.earliestActivityDate ? monthStart(input.earliestActivityDate) : currentMonth;
  const candidate = earliest < currentMonth ? earliest : currentMonth;
  const afterClose = input.latestClosedPeriodEnd ? addLocalDays(input.latestClosedPeriodEnd, 1) : null;
  return afterClose && afterClose > candidate ? afterClose : candidate;
}

/**
 * Whether an account's opening date may still move: no closed period ends on
 * or after it. The database function refuses the same case
 * (`opening_date_locked`), and also any new date on or before that end.
 */
export function canCorrectOpeningDate(openedOn: string, latestClosedPeriodEnd: string | null): boolean {
  return latestClosedPeriodEnd === null || openedOn > latestClosedPeriodEnd;
}

/** Why the proposed start date is what it is, next to the date field. */
export function startDateHint(suggestedStartDate: string): string {
  return `Vorschlag ${formatGermanDate(suggestedStartDate)}: der erste Tag des ältesten Monats ohne Abschluss. Ein Monat lässt sich nur abschließen, wenn Regel und Zeitkonto spätestens an seinem ersten Tag beginnen.`;
}
