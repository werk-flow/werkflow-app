'use client';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { EntryDetailsDateTimePicker } from './entry-details-date-time-picker';
import { formatDateTime, getEntryLabel, getStatusConfig } from './entry-details-labels';

type EntryDetailsClockEntryCardProps = {
  entry: TimeEntry;
  /** The entry's stored instant; null only for an orphan boundary. */
  originalDate: Date | null;
  editedValue: Date | null;
  onEditedValueChange: (date: Date) => void;
  isEditing: boolean;
  editedBlockDate: Date | null;
};

/** The work start or work end of the block, read-only or as a time field. */
export function EntryDetailsClockEntryCard({
  entry,
  originalDate,
  editedValue,
  onEditedValueChange,
  isEditing,
  editedBlockDate,
}: EntryDetailsClockEntryCardProps) {
  return (
    <div className="space-y-2 rounded-md border border-border/60 px-3 py-3">
      {isEditing && editedValue ? (
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <EntryDetailsDateTimePicker
              value={editedValue}
              onChange={onEditedValueChange}
              label={getEntryLabel(entry)}
              dateLabel={
                editedBlockDate?.toLocaleDateString('de-DE') ?? originalDate?.toLocaleDateString('de-DE')
              }
              disableDateEditing
            />
          </div>
          <span
            className={cn(
              'mt-7 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
              getStatusConfig(entry).className,
            )}
          >
            {getStatusConfig(entry).label}
          </span>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <Label>{getEntryLabel(entry)}</Label>
            <span
              className={cn('rounded-full px-2 py-0.5 text-xs font-medium', getStatusConfig(entry).className)}
            >
              {getStatusConfig(entry).label}
            </span>
          </div>
          <p className="text-sm">{originalDate ? formatDateTime(originalDate) : '-'}</p>
        </>
      )}
      {entry.isManual && !isEditing && <p className="text-xs text-muted-foreground">Manuell eingetragen</p>}
    </div>
  );
}
