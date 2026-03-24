'use client';

import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  CalendarPlus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ManualEntryDialog } from '@/components/manual-entry-dialog';
import type { TimeEntry } from '@/lib/time-tracking/types';
import type { CalendarView } from './calendar-container';

interface CalendarHeaderProps {
  currentDate: Date;
  view: CalendarView;
  isLoading?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onRefresh: () => void;
  onManualEntrySuccess?: (entries: TimeEntry[]) => void | Promise<void>;
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
  'Dezember'
];

const DAY_NAMES = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag'
];

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatDateDisplay(date: Date, view: CalendarView): string {
  if (view === 'day') {
    return `${DAY_NAMES[date.getDay()]}, ${date.getDate()}. ${
      MONTH_NAMES[date.getMonth()]
    } ${date.getFullYear()}`;
  }

  if (view === 'week') {
    const startOfWeek = getStartOfWeek(date);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    const kw = getISOWeekNumber(startOfWeek);

    if (startOfWeek.getMonth() === endOfWeek.getMonth()) {
      return `${startOfWeek.getDate()}. - ${endOfWeek.getDate()}. ${
        MONTH_NAMES[startOfWeek.getMonth()]
      } ${startOfWeek.getFullYear()} · KW ${kw}`;
    }

    return `${startOfWeek.getDate()}. ${
      MONTH_NAMES[startOfWeek.getMonth()]
    } - ${endOfWeek.getDate()}. ${
      MONTH_NAMES[endOfWeek.getMonth()]
    } ${endOfWeek.getFullYear()} · KW ${kw}`;
  }

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
  isLoading = false,
  onPrevious,
  onNext,
  onToday,
  onRefresh,
  onManualEntrySuccess
}: CalendarHeaderProps) {
  const now = new Date();
  const isCurrentPeriod =
    (view === 'day' && currentDate.toDateString() === now.toDateString()) ||
    (view === 'week' &&
      getStartOfWeek(currentDate).toDateString() ===
        getStartOfWeek(now).toDateString()) ||
    (view === 'month' &&
      currentDate.getFullYear() === now.getFullYear() &&
      currentDate.getMonth() === now.getMonth());

  const todayLabel =
    view === 'day' ? 'Heute' : view === 'week' ? 'Diese Woche' : 'Dieser Monat';

  return (
    <header className="flex flex-col gap-3 border-b bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4 sticky top-0 z-10">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold sm:text-2xl">Kalender</h1>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onPrevious}
            title="Zurück"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onNext}
            title="Weiter"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onRefresh()}
            disabled={isLoading}
            title="Aktualisieren"
            className="ml-2"
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
            />
          </Button>
          <span className="ml-2 text-sm font-medium text-muted-foreground sm:text-base whitespace-nowrap">
            {formatDateDisplay(currentDate, view)}
          </span>
          {!isCurrentPeriod && (
            <Button
              variant="outline"
              size="sm"
              onClick={onToday}
              className="ml-2"
            >
              {todayLabel}
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <ManualEntryDialog
          preselectedDate={currentDate}
          onSuccess={onManualEntrySuccess}
          trigger={
            <Button size="default" className="gap-2">
              <CalendarPlus className="size-4" />
              <span>Kalendereintrag</span>
            </Button>
          }
        />
      </div>
    </header>
  );
}
