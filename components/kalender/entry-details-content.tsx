'use client';

import { Coffee, Info, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { formatDuration } from '@/lib/time-tracking/helpers';
import type { WorkSession } from '@/lib/time-tracking/types';
import { EntryDetailsBreakCard } from './entry-details-break-card';
import { EntryDetailsClockEntryCard } from './entry-details-clock-entry-card';
import { EntryDetailsSummary } from './entry-details-summary';
import type { EntryDetailsDisplayedBreaks } from './use-entry-details-displayed-breaks';
import type { EntryDetailsDraft } from './use-entry-details-draft';
import type { EntryDetailsResolvedJob } from './use-entry-details-resolved-job';
import type { EntryDetailsSnapshot } from './use-entry-details-session';

type EntryDetailsBreakControlsProps = {
  snapshot: EntryDetailsSnapshot;
  draft: EntryDetailsDraft;
  breaks: EntryDetailsDisplayedBreaks;
  canEdit: boolean;
};

/** The break total and the ways to add a break, below the break cards. */
function EntryDetailsBreakControls({ snapshot, draft, breaks, canEdit }: EntryDetailsBreakControlsProps) {
  const { isAutomaticBreakMode, sessionBreaks, clockInDate, clockOutDate, isOrphan } = snapshot;
  const { isEditing, editedBreaks, editedClockIn, editedClockOut, handleAddBreak, handleStartEditWithBreak } =
    draft;
  const { displayedBreaks, totalBreakMinutes } = breaks;
  const canAddBreak =
    canEdit &&
    !isAutomaticBreakMode &&
    isEditing &&
    editedBreaks.length === 0 &&
    !!editedClockIn &&
    !!editedClockOut &&
    !isOrphan;
  const canOfferAddBreak =
    canEdit &&
    !isAutomaticBreakMode &&
    !isEditing &&
    sessionBreaks.length === 0 &&
    !!clockInDate &&
    !!clockOutDate &&
    !isOrphan;

  return (
    <>
      {displayedBreaks.length > 1 && (
        <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Coffee className="h-4 w-4 text-warning-soft-foreground" />
              <span className="text-sm font-medium">Pausenzeit gesamt</span>
            </div>
            <span className="text-base font-semibold text-warning-soft-foreground">
              {formatDuration(totalBreakMinutes)}
            </span>
          </div>
        </div>
      )}

      {isAutomaticBreakMode && canEdit && !isOrphan && (
        <div className="space-y-2 rounded-md border border-warning/20 bg-warning-soft px-3 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            className="w-full gap-2 border-border/70 bg-background/40 text-muted-foreground opacity-70"
          >
            <Plus className="h-4 w-4" />
            Pause hinzufügen
          </Button>
          <p className="text-xs text-muted-foreground">
            Pausen werden in dieser Organisation automatisch abgezogen. Deshalb kann in diesem Dialog keine
            manuelle Pause hinzugefügt werden.
          </p>
        </div>
      )}

      {canAddBreak && (
        <Button type="button" variant="outline" size="sm" onClick={handleAddBreak} className="w-full gap-2">
          <Plus className="h-4 w-4" />
          Pause hinzufügen
        </Button>
      )}

      {canOfferAddBreak && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleStartEditWithBreak}
          className="w-full gap-2"
        >
          <Plus className="h-4 w-4" />
          Pause hinzufügen
        </Button>
      )}
    </>
  );
}

type EntryDetailsNoticesProps = {
  session: WorkSession;
  snapshot: EntryDetailsSnapshot;
  isEditing: boolean;
  hasActualBreaks: boolean;
};

function EntryDetailsNotices({ session, snapshot, isEditing, hasActualBreaks }: EntryDetailsNoticesProps) {
  const { interactiveSession, actualClockOutEntry, hasCanonicalSegment, isOrphan } = snapshot;
  const showBoundaryExplanation =
    !isOrphan &&
    !actualClockOutEntry &&
    !interactiveSession.isOnBreakBlock &&
    (session.endEntryType === 'break_start' || session.clockOut !== null);

  return (
    <>
      {!actualClockOutEntry &&
        !interactiveSession.isOnBreakBlock &&
        !isOrphan &&
        !hasActualBreaks &&
        !isEditing && (
          <div className="space-y-2 rounded-md border border-border/60 px-3 py-3">
            <div className="flex items-center justify-between">
              <Label>Arbeitsende</Label>
            </div>
            <p className="text-sm text-muted-foreground">Noch aktiv</p>
          </div>
        )}

      {showBoundaryExplanation && (
        <div className="rounded-md border border-info/30 bg-info-soft px-3 py-3">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-info-soft-foreground" />
            <p className="text-xs text-muted-foreground">
              Dieser Arbeitsblock endet hier, weil danach die Arbeit in einem neuen Arbeitsblock oder Auftrag
              weitergeführt wurde. Das ist kein Arbeitsende des gesamten Arbeitstages.
            </p>
          </div>
        </div>
      )}

      {hasCanonicalSegment && (
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-3">
          <p className="text-xs text-muted-foreground">
            Aktivitätsabschnitte werden in der Zeiterfassung korrigiert und sind im Kalender schreibgeschützt.
          </p>
        </div>
      )}
    </>
  );
}

type EntryDetailsContentProps = {
  session: WorkSession;
  snapshot: EntryDetailsSnapshot;
  draft: EntryDetailsDraft;
  breaks: EntryDetailsDisplayedBreaks;
  resolvedJob: EntryDetailsResolvedJob | null;
  jobDetailUrl: string | null;
  canEdit: boolean;
  /** Closes the dialog and opens the linked detail page. */
  onNavigate: (url: string) => void;
};

/**
 * The body of the entry details dialog. The same content renders read-only
 * and, while editing, inside the dialog's form.
 */
export function EntryDetailsContent({
  session,
  snapshot,
  draft,
  breaks,
  resolvedJob,
  jobDetailUrl,
  canEdit,
  onNavigate,
}: EntryDetailsContentProps) {
  const {
    isAutomaticBreakMode,
    actualClockOutEntry,
    startEntry,
    clockInDate,
    clockOutDate,
    employeeName,
    entryUserId,
    entryOrganizationId,
    isOrphan,
    isActiveBlock,
  } = snapshot;
  const {
    isEditing,
    error,
    editedClockIn,
    setEditedClockIn,
    editedClockOut,
    setEditedClockOut,
    editedBlockDate,
    handleRemoveBreak,
    handleBreakChange,
    handleBlockDateChange,
  } = draft;
  const { displayedBreaks, totalWorkMinutes } = breaks;
  const employeeDetailUrl = entryUserId ? `/mitarbeiter/${entryUserId}` : null;
  const hasActualBreaks = displayedBreaks.length > 0;

  return (
    <>
      <EntryDetailsSummary
        employeeName={employeeName}
        employeeDetailUrl={employeeDetailUrl}
        resolvedJob={resolvedJob}
        jobDetailUrl={jobDetailUrl}
        isOrphan={isOrphan}
        isActiveBlock={isActiveBlock}
        totalWorkMinutes={totalWorkMinutes}
        onNavigate={onNavigate}
      />

      {isEditing && editedBlockDate && (
        <Field
          label="Datum des Arbeitsblocks"
          description="Dieses Datum gilt für alle Zeiten dieses Arbeitsblocks."
          className="rounded-md border border-border/60 px-3 py-3"
        >
          <DatePicker value={editedBlockDate} onChange={handleBlockDateChange} />
        </Field>
      )}

      {startEntry && (
        <EntryDetailsClockEntryCard
          entry={startEntry}
          originalDate={clockInDate}
          editedValue={editedClockIn}
          onEditedValueChange={setEditedClockIn}
          isEditing={isEditing}
          editedBlockDate={editedBlockDate}
        />
      )}

      {displayedBreaks.map((workBreak, index) => (
        <EntryDetailsBreakCard
          key={workBreak.key}
          workBreak={workBreak}
          index={index}
          isEditing={isEditing}
          canEdit={canEdit}
          isAutomaticBreakMode={isAutomaticBreakMode}
          editedBlockDate={editedBlockDate}
          entryUserId={entryUserId}
          entryOrganizationId={entryOrganizationId}
          onRemoveBreak={handleRemoveBreak}
          onBreakChange={handleBreakChange}
        />
      ))}

      <EntryDetailsBreakControls snapshot={snapshot} draft={draft} breaks={breaks} canEdit={canEdit} />

      {actualClockOutEntry && (
        <EntryDetailsClockEntryCard
          entry={actualClockOutEntry}
          originalDate={clockOutDate}
          editedValue={editedClockOut}
          onEditedValueChange={setEditedClockOut}
          isEditing={isEditing}
          editedBlockDate={editedBlockDate}
        />
      )}

      <EntryDetailsNotices
        session={session}
        snapshot={snapshot}
        isEditing={isEditing}
        hasActualBreaks={hasActualBreaks}
      />

      <ErrorText>{error}</ErrorText>
    </>
  );
}
