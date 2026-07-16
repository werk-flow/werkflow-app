export interface CalendarEntryDraft {
  date: Date | undefined;
  startTime: string;
  durationMinutes: number | null;
  userIds: string[];
}
