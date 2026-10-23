import type { CalendarBoardRow } from '@/lib/calendar/board';
import type { CalendarJob } from '@/lib/jobs/types';
import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';
import type { ClosedTimePeriod } from '@/lib/time-tracking/closed-period-dates';

/** What a view needs from the container to open, create and park things. */
export type CalendarSurfaceActions = {
  isManager: boolean;
  /** Opens the card popover anchored to the element that was activated. */
  onOpenCard: (job: CalendarJob, element: HTMLElement, row: CalendarBoardRow | null) => void;
  /** Opens the create dialog preset to a person, a date and, from the day view, a time span. */
  onAddEntry: (input: {
    date: string;
    time?: string | undefined;
    endTime?: string | undefined;
    userId?: string | undefined;
  }) => void;
  /** Starts the park flow (the card leaves the grid, the context dialog opens). */
  onPark: (job: CalendarJob) => void;
  /** The organization's closed periods: recorded time in them is locked. */
  closedPeriods: readonly ClosedTimePeriod[];
  /** The caller's `time_approval` holder: whose recorded blocks a manager may correct (`canManageBlock`). */
  approvalHolder: EffectiveResponsibilityHolder | null;
};

export const BOARD_NAME_COLUMN_PX = 160;
export const BOARD_COLUMN_MIN_PX = 140;
export const BOARD_LANE_HEIGHT = { comfortable: 46, compact: 26 } as const;
