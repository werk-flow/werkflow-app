import type { CalendarBoardRow } from '@/lib/calendar/board';
import type { CalendarJob } from '@/lib/jobs/types';

/** What a view needs from the container to open, create and park things. */
export type CalendarSurfaceActions = {
  readOnly: boolean;
  isManager: boolean;
  /** Opens the card popover anchored to the element that was activated. */
  onOpenCard: (job: CalendarJob, element: HTMLElement, row: CalendarBoardRow | null) => void;
  /** Opens the create dialog preset to a person and a date, as a visit or as a note. */
  onAddEntry: (input: { date: string; time?: string | undefined; endTime?: string | undefined; userId?: string | undefined; kind: 'termin' | 'notiz' }) => void;
  /** Starts the park flow (the card leaves the grid, the context dialog opens). */
  onPark: (job: CalendarJob) => void;
};

/** The day view's row for visits without a person; never a user id. */
export const UNASSIGNED_USER = 'unassigned';
export const BOARD_NAME_COLUMN_PX = 160;
export const BOARD_COLUMN_MIN_PX = 140;
export const BOARD_LANE_HEIGHT = { comfortable: 46, compact: 26 } as const;
