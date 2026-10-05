'use client';

import { Coffee, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/time-tracking/helpers';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { EntryDetailsDateTimePicker } from './entry-details-date-time-picker';
import { formatDateTime, getEntryLabel, getStatusConfig, type StatusConfig } from './entry-details-labels';
import { buildDraftEntry, getBreakDurationMinutes, type EditableBreak } from './entry-details-timeline';
import type { EntryDetailsDraft } from './use-entry-details-draft';

/** The stored or drafted entries of one break and their review status. */
type EntryDetailsBreakEntries = {
  index: number;
  breakStartEntry: TimeEntry;
  breakEndEntry: TimeEntry | null;
  breakStartStatus: StatusConfig;
  breakEndStatus: StatusConfig;
};

type EntryDetailsBreakEditFieldsProps = EntryDetailsBreakEntries & {
  workBreak: EditableBreak;
  editedBlockDate: Date | null;
  onBreakChange: EntryDetailsDraft['handleBreakChange'];
};

function EntryDetailsBreakEditFields({
  index,
  breakStartEntry,
  breakEndEntry,
  breakStartStatus,
  breakEndStatus,
  workBreak,
  editedBlockDate,
  onBreakChange,
}: EntryDetailsBreakEditFieldsProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <EntryDetailsDateTimePicker
            value={workBreak.breakStart}
            onChange={(value) => onBreakChange(workBreak.key, 'breakStart', value)}
            label={getEntryLabel(breakStartEntry, index)}
            dateLabel={
              editedBlockDate?.toLocaleDateString('de-DE') ?? workBreak.breakStart.toLocaleDateString('de-DE')
            }
            disableDateEditing
          />
        </div>
        <span
          className={cn(
            'mt-7 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
            breakStartStatus.className,
          )}
        >
          {breakStartStatus.label}
        </span>
      </div>

      {workBreak.breakEnd ? (
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <EntryDetailsDateTimePicker
              value={workBreak.breakEnd}
              onChange={(value) => onBreakChange(workBreak.key, 'breakEnd', value)}
              label={breakEndEntry ? getEntryLabel(breakEndEntry, index) : ''}
              dateLabel={
                editedBlockDate?.toLocaleDateString('de-DE') ?? workBreak.breakEnd.toLocaleDateString('de-DE')
              }
              disableDateEditing
            />
          </div>
          <span
            className={cn(
              'mt-7 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
              breakEndStatus.className,
            )}
          >
            {breakEndStatus.label}
          </span>
        </div>
      ) : (
        <div className="space-y-1">
          <Label>{getEntryLabel({ ...breakStartEntry, entryType: 'break_end' }, index)}</Label>
          <p className="text-sm text-muted-foreground">Noch in Pause</p>
        </div>
      )}
    </div>
  );
}

type EntryDetailsBreakReadViewProps = EntryDetailsBreakEntries & {
  isAutomaticBreakMode: boolean;
};

function EntryDetailsBreakReadView({
  index,
  breakStartEntry,
  breakEndEntry,
  breakStartStatus,
  breakEndStatus,
  isAutomaticBreakMode,
}: EntryDetailsBreakReadViewProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label>{getEntryLabel(breakStartEntry, index)}</Label>
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', breakStartStatus.className)}>
            {breakStartStatus.label}
          </span>
        </div>
        <p className="text-sm">{formatDateTime(new Date(breakStartEntry.timestamp))}</p>
        {breakStartEntry.isManual && <p className="text-xs text-muted-foreground">Manuell eingetragen</p>}
        {isAutomaticBreakMode && (
          <p className="text-xs text-muted-foreground">Automatisch aus der aktiven Pausenregel abgeleitet</p>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label>
            {breakEndEntry
              ? getEntryLabel(breakEndEntry, index)
              : getEntryLabel(
                  {
                    ...breakStartEntry,
                    entryType: 'break_end',
                  },
                  index,
                )}
          </Label>
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', breakEndStatus.className)}>
            {breakEndStatus.label}
          </span>
        </div>
        <p className="text-sm">
          {breakEndEntry ? formatDateTime(new Date(breakEndEntry.timestamp)) : 'Noch in Pause'}
        </p>
        {breakEndEntry?.isManual && <p className="text-xs text-muted-foreground">Manuell eingetragen</p>}
        {isAutomaticBreakMode && (
          <p className="text-xs text-muted-foreground">
            Passt sich beim Bearbeiten von Arbeitsbeginn oder Arbeitsende automatisch an
          </p>
        )}
      </div>
    </div>
  );
}

type EntryDetailsBreakCardProps = {
  workBreak: EditableBreak;
  index: number;
  isEditing: boolean;
  canEdit: boolean;
  isAutomaticBreakMode: boolean;
  editedBlockDate: Date | null;
  entryUserId: string | undefined;
  entryOrganizationId: string | null;
  onRemoveBreak: EntryDetailsDraft['handleRemoveBreak'];
  onBreakChange: EntryDetailsDraft['handleBreakChange'];
};

export function EntryDetailsBreakCard({
  workBreak,
  index,
  isEditing,
  canEdit,
  isAutomaticBreakMode,
  editedBlockDate,
  entryUserId,
  entryOrganizationId,
  onRemoveBreak,
  onBreakChange,
}: EntryDetailsBreakCardProps) {
  const breakStartStatus = getStatusConfig(workBreak.breakStartEntry);
  const breakEndStatus = getStatusConfig(workBreak.breakEndEntry);
  const breakStartEntry =
    workBreak.breakStartEntry ??
    buildDraftEntry(workBreak.key, 'break_start', workBreak.breakStart, entryUserId, entryOrganizationId);
  const breakEndEntry = workBreak.breakEnd
    ? (workBreak.breakEndEntry ??
      buildDraftEntry(
        `${workBreak.key}-end`,
        'break_end',
        workBreak.breakEnd,
        entryUserId,
        entryOrganizationId,
      ))
    : null;
  const breakEntries = {
    index,
    breakStartEntry,
    breakEndEntry,
    breakStartStatus,
    breakEndStatus,
  };

  return (
    <div className="space-y-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Coffee className="h-4 w-4 text-warning-soft-foreground" />
          <span>Pause</span>
        </div>
        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-soft-foreground">
          {formatDuration(getBreakDurationMinutes(workBreak))}
        </span>
        {isEditing && canEdit && !isAutomaticBreakMode && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onRemoveBreak(workBreak.key)}
            className="h-7 px-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Entfernen
          </Button>
        )}
      </div>

      {isEditing && !isAutomaticBreakMode ? (
        <EntryDetailsBreakEditFields
          {...breakEntries}
          workBreak={workBreak}
          editedBlockDate={editedBlockDate}
          onBreakChange={onBreakChange}
        />
      ) : (
        <EntryDetailsBreakReadView {...breakEntries} isAutomaticBreakMode={isAutomaticBreakMode} />
      )}
    </div>
  );
}
