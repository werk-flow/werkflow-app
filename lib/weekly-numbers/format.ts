import { formatGermanDate } from '@/lib/utils';

// The admin's weekly company numbers as the page shows them. One row list
// feeds the desktop table, the phone cards and their skeleton. Every number
// is the whole company's; none names or compares a person.

/** One Berlin week, Monday to Sunday, as `read_weekly_outcome_numbers` counts it. */
export type WeeklyNumbers = {
  weekStart: string;
  /** Sunday of the week, or today while the week runs. */
  lastDay: string;
  overdue: {
    followUps: number;
    requestCallbacks: number;
    maintenance: number;
    staleRequests: number;
    waitingHandovers: number;
    blockerReviews: number;
  };
  handover: { released: number; medianWorkdays: number | null; withinTwoWorkdays: number };
  workReports: { finished: number; withReport: number };
  timeCapture: { entries: number; byEmployee: number };
};

/** A cell: the number, and the counts behind a share. */
export type WeeklyCell = { value: string; detail?: string };

type WeeklyNumberRow = {
  id: string;
  label: string;
  /** The sum row of a section stands out. */
  total?: boolean;
  cell: (week: WeeklyNumbers) => WeeklyCell;
};

export type WeeklyNumberSection = { id: string; title: string; hint: string; rows: WeeklyNumberRow[] };

const NONE = '–';
const decimal = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 0 });

/**
 * A share of a total with its counts; a dash when the week has nothing to share.
 */
function shareCell(part: number, total: number): WeeklyCell {
  if (total === 0) return { value: NONE };
  return { value: percent.format(part / total), detail: `${part} von ${total}` };
}

/**
 * Median workdays with one decimal at most; a dash when no handover was released.
 */
function workdaysCell(median: number | null): WeeklyCell {
  return { value: median === null ? NONE : decimal.format(median) };
}

const countCell = (value: number): WeeklyCell => ({ value: String(value) });

function overdueTotal({ overdue }: WeeklyNumbers): number {
  return (
    overdue.requestCallbacks +
    overdue.followUps +
    overdue.staleRequests +
    overdue.maintenance +
    overdue.waitingHandovers +
    overdue.blockerReviews
  );
}

export const WEEKLY_NUMBER_SECTIONS: readonly WeeklyNumberSection[] = [
  {
    id: 'ueberfaellig',
    title: 'Überfällig am Ende der Woche',
    hint: 'Was am Sonntagabend offen war, in der laufenden Woche bis jetzt.',
    rows: [
      {
        id: 'rueckrufe',
        label: 'Rückrufe zu Anfragen',
        cell: (week) => countCell(week.overdue.requestCallbacks),
      },
      { id: 'nachfassen', label: 'Nachfassaktionen', cell: (week) => countCell(week.overdue.followUps) },
      {
        id: 'anfragen',
        label: 'Anfragen länger als 3 Werktage offen',
        cell: (week) => countCell(week.overdue.staleRequests),
      },
      {
        id: 'wartungen',
        label: 'Wartungen nach ihrem Zeitfenster',
        cell: (week) => countCell(week.overdue.maintenance),
      },
      {
        id: 'uebergaben-offen',
        label: 'Übergaben länger als 2 Werktage offen',
        cell: (week) => countCell(week.overdue.waitingHandovers),
      },
      {
        id: 'pruefdatum',
        label: 'Blockiert oder geparkt nach Prüfdatum',
        cell: (week) => countCell(week.overdue.blockerReviews),
      },
      {
        id: 'ueberfaellig-gesamt',
        label: 'Zusammen',
        total: true,
        cell: (week) => countCell(overdueTotal(week)),
      },
    ],
  },
  {
    id: 'uebergabe',
    title: 'Vom Abschluss zur Übergabe',
    hint: 'Aufträge, deren Übergabe in dieser Woche freigegeben wurde.',
    rows: [
      {
        id: 'freigegeben',
        label: 'Übergaben freigegeben',
        cell: (week) => countCell(week.handover.released),
      },
      {
        id: 'median',
        label: 'Werktage bis zur Übergabe (Median)',
        cell: (week) => workdaysCell(week.handover.medianWorkdays),
      },
      {
        id: 'zwei-werktage',
        label: 'Innerhalb von 2 Werktagen',
        cell: (week) => shareCell(week.handover.withinTwoWorkdays, week.handover.released),
      },
    ],
  },
  {
    id: 'nutzung',
    title: 'Digital erfasst',
    hint: 'Ob die Arbeit in WerkFlow ankommt, für die ganze Firma.',
    rows: [
      {
        id: 'arbeitsberichte',
        label: 'Abgeschlossene Aufträge mit Arbeitsbericht',
        cell: (week) => shareCell(week.workReports.withReport, week.workReports.finished),
      },
      {
        id: 'selbst-erfasst',
        label: 'Zeiten selbst gestempelt',
        cell: (week) => shareCell(week.timeCapture.byEmployee, week.timeCapture.entries),
      },
    ],
  },
];

function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

/** „23.02.“: the calendar day without its year. */
function dayMonth(isoDate: string): string {
  return formatGermanDate(isoDate).slice(0, 6);
}

/**
 * The ISO 8601 week number of a Monday: the week of its Thursday.
 */
function isoWeekNumber(weekStart: string): number {
  const thursday = utcDate(weekStart);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const firstOfYear = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.round((thursday.getTime() - firstOfYear) / 86_400_000);
  return Math.floor(dayOfYear / 7) + 1;
}

/** „KW 9“ and „23.02.–01.03.“ for the week; the running week ends today. */
export function weekLabel(week: Pick<WeeklyNumbers, 'weekStart' | 'lastDay'>): {
  title: string;
  range: string;
} {
  return {
    title: `KW ${isoWeekNumber(week.weekStart)}`,
    range: `${dayMonth(week.weekStart)}–${dayMonth(week.lastDay)}`,
  };
}
