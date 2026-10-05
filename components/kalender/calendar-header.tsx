'use client';

import { useState } from 'react';
import { useHydrated } from '@/hooks/use-hydrated';
import { formatCompactCalendarRange } from '@/lib/calendar/header-labels';
import { isCurrentCalendarPeriod } from '@/lib/calendar/navigation';
import { ChevronLeft, ChevronRight, CalendarPlus, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { ManualEntryDialog } from '@/components/manual-entry-dialog';
import { CalendarEntryDialog } from './calendar-entry-dialog';
import { ParkplatzButton } from './parkplatz-button';
import type { TimeEntry } from '@/lib/time-tracking/types';
import type { CalendarView } from './calendar-container';

interface CalendarHeaderProps {
  currentDate: Date;
  view: CalendarView;
  /** The container's one "today"; "Heute" is inactive while its period shows. */
  todayIso: string;
  /** The board's horizon; the date display names the whole span (P1-24a). */
  horizonWeeks: number;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  /** Awaited by the RefreshButton; the container owns the fetches. */
  onRefresh: () => Promise<void>;
  onManualEntrySuccess?: (entries: TimeEntry[]) => void | Promise<void>;
  isAdminOrManager?: boolean;
  onJobSuccess?: () => void | Promise<void>;
  parkedJobCount?: number;
  parkplatzOpen?: boolean;
  onParkplatzToggle?: () => void;
  parkplatzButtonRef?: React.RefObject<HTMLButtonElement | null>;
  dispatchPanelOpen?: boolean;
  onDispatchPanelToggle?: () => void;
}

const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

const DAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatDateDisplay(date: Date, view: CalendarView, horizonWeeks: number, compact = false): string {
  if (view === 'day') {
    if (compact)
      return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', year: '2-digit' });
    return `${DAY_NAMES[date.getDay()]}, ${date.getDate()}. ${
      MONTH_NAMES[date.getMonth()]
    } ${date.getFullYear()}`;
  }

  if (view === 'week') {
    const startOfWeek = getStartOfWeek(date);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7 * horizonWeeks - 1);
    if (compact) return formatCompactCalendarRange(startOfWeek, endOfWeek);
    const firstWeek = getISOWeekNumber(startOfWeek);
    const lastWeek = getISOWeekNumber(endOfWeek);
    const kw = firstWeek === lastWeek ? `KW ${firstWeek}` : `KW ${firstWeek}–${lastWeek}`;

    if (startOfWeek.getMonth() === endOfWeek.getMonth()) {
      return `${startOfWeek.getDate()}. - ${endOfWeek.getDate()}. ${
        MONTH_NAMES[startOfWeek.getMonth()]
      } ${startOfWeek.getFullYear()} · ${kw}`;
    }

    return `${startOfWeek.getDate()}. ${MONTH_NAMES[startOfWeek.getMonth()]} - ${endOfWeek.getDate()}. ${
      MONTH_NAMES[endOfWeek.getMonth()]
    } ${endOfWeek.getFullYear()} · ${kw}`;
  }

  if (compact) return date.toLocaleDateString('de-DE', { month: 'short', year: 'numeric' });
  // Month view
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function CalendarHeader({
  currentDate,
  view,
  todayIso,
  horizonWeeks,
  onPrevious,
  onNext,
  onToday,
  onRefresh,
  onManualEntrySuccess,
  isAdminOrManager = false,
  onJobSuccess,
  parkedJobCount = 0,
  parkplatzOpen = false,
  onParkplatzToggle,
  parkplatzButtonRef,
  dispatchPanelOpen = false,
  onDispatchPanelToggle,
}: CalendarHeaderProps) {
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const hydrated = useHydrated();
  const isCurrentPeriod = isCurrentCalendarPeriod(currentDate, view, todayIso);

  const todayLabel =
    view === 'day'
      ? 'Heute'
      : view === 'week'
        ? horizonWeeks > 1
          ? 'Aktueller Zeitraum'
          : 'Diese Woche'
        : 'Dieser Monat';

  return (
    <header className="sticky top-0 z-10 grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 border-b bg-background px-4 py-2 sm:flex sm:flex-wrap sm:justify-between sm:gap-x-6 sm:gap-y-3 sm:px-6 sm:py-3">
      <div className="contents sm:flex sm:min-w-0 sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-2">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Kalender</h1>
        <div className="order-last col-span-2 flex min-w-0 items-center justify-between gap-1 sm:order-none sm:flex-wrap sm:justify-start">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-11 sm:size-8"
            onClick={onPrevious}
            disabled={!hydrated}
            title="Zurück"
            aria-label="Zurück"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-11 sm:size-8"
            onClick={onNext}
            disabled={!hydrated}
            title="Weiter"
            aria-label="Weiter"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <RefreshButton
            onRefresh={onRefresh}
            withRouteRefresh={false}
            className="size-11 sm:ml-2 sm:size-8"
          />
          <span className="hidden min-w-0 text-sm font-medium tabular-nums sm:mx-2 sm:inline">
            {formatDateDisplay(currentDate, view, horizonWeeks)}
          </span>
          <span className="min-w-0 text-center text-sm font-medium tabular-nums sm:hidden">
            {formatDateDisplay(currentDate, view, horizonWeeks, true)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToday}
            disabled={!hydrated || isCurrentPeriod}
            className="h-11 text-muted-foreground sm:h-8"
          >
            <span className="sm:hidden">Heute</span>
            <span className="hidden sm:inline">{todayLabel}</span>
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        {isAdminOrManager && onDispatchPanelToggle && (
          <Button
            variant={dispatchPanelOpen ? 'secondary' : 'ghost'}
            size="default"
            className="h-11 gap-2 sm:h-9"
            onClick={onDispatchPanelToggle}
            disabled={!hydrated}
            data-testid="dispatch-panel-toggle"
            aria-label={dispatchPanelOpen ? 'Einsätze schließen' : 'Einsätze öffnen'}
            title={dispatchPanelOpen ? 'Einsätze schließen' : 'Einsätze öffnen'}
            aria-pressed={dispatchPanelOpen}
          >
            <Send className="size-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Einsätze</span>
          </Button>
        )}
        {isAdminOrManager && onParkplatzToggle && (
          <ParkplatzButton
            ref={parkplatzButtonRef}
            count={parkedJobCount}
            isOpen={parkplatzOpen}
            onToggle={onParkplatzToggle}
          />
        )}
        <Button
          size="default"
          className="h-11 gap-2 sm:h-9"
          disabled={!hydrated}
          onClick={() => setEntryDialogOpen(true)}
        >
          <CalendarPlus className="size-4" />
          <span>Kalendereintrag</span>
        </Button>

        {isAdminOrManager ? (
          <CalendarEntryDialog
            open={entryDialogOpen}
            onOpenChange={setEntryDialogOpen}
            preselectedDate={currentDate}
            onManualEntrySuccess={onManualEntrySuccess}
            onJobSuccess={onJobSuccess}
          />
        ) : (
          <ManualEntryDialog
            controlledOpen={entryDialogOpen}
            onOpenChange={setEntryDialogOpen}
            preselectedDate={currentDate}
            onSuccess={onManualEntrySuccess}
          />
        )}
      </div>
    </header>
  );
}
