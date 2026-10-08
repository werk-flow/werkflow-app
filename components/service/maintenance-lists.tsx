'use client';

import { EmptyState } from '@/components/ui/empty-state';
import type { ReactElement } from 'react';
import { CalendarClock, FileCheck2, MapPin } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { ListRow } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import type { SkeletonColumn } from '@/components/ui/skeleton-table';
import { unconfirmedMarker } from '@/lib/ui/unconfirmed';
import { cn } from '@/lib/utils';
import {
  MAINTENANCE_COVERAGE_STATUS_LABELS,
  MAINTENANCE_DUE_STATUS_LABELS,
  MAINTENANCE_RENEWAL_SIGNAL_LABELS,
  type MaintenanceDueItem,
  type MaintenanceWorkspace,
} from '@/lib/maintenance/types';
import type { MaintenanceCoveragePendingDraft } from './maintenance-coverage-dialog';

const dateFormatter = new Intl.DateTimeFormat('de-DE');
export function formatMaintenanceDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(`${value}T12:00:00Z`)) : 'Nicht festgelegt';
}

// One column definition for the due list header and its skeleton (design canon).
const TWO_LINE_CELL = (
  <span className="block space-y-1.5">
    <Skeleton className="h-4 w-40 max-w-full" />
    <Skeleton className="h-3 w-24 max-w-full" />
  </span>
);
const MAINTENANCE_DUE_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'due', header: 'Fälligkeit', className: 'w-32', skeleton: TWO_LINE_CELL },
  { id: 'plan', header: 'Plan & Anlage', skeleton: TWO_LINE_CELL },
  { id: 'client', header: 'Kunde & Auftrag', skeleton: TWO_LINE_CELL },
  { id: 'action', header: 'Aktion', className: 'w-40', skeleton: <Skeleton className="h-8 w-28" /> },
];

// Fixed trailing tracks keep independent row grids aligned. The local 48rem
// breakpoint leaves sidebar tablets in the card layout until content fits.
const DUE_GRID_COLUMNS = '@3xl/maintenance:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_10rem]';
const COVERAGE_GRID_COLUMNS = '@3xl/maintenance:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_11rem_10rem]';
const DUE_ROW_CLASS = cn(
  'grid min-w-0 gap-3 @3xl/maintenance:items-center @3xl/maintenance:gap-4',
  DUE_GRID_COLUMNS,
);
const COVERAGE_ROW_CLASS = cn(
  'grid min-w-0 gap-2 px-4 py-3 @3xl/maintenance:items-center @3xl/maintenance:gap-4',
  COVERAGE_GRID_COLUMNS,
);

function MaintenanceDueHeader(): ReactElement {
  return (
    <div
      data-testid="maintenance-due-header"
      className={cn(
        'hidden gap-4 border-b bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide @3xl/maintenance:grid',
        DUE_GRID_COLUMNS,
      )}
    >
      {MAINTENANCE_DUE_COLUMNS.map((column) => (
        <span key={column.id} className={column.id === 'action' ? 'text-right' : undefined}>
          {column.header}
        </span>
      ))}
    </div>
  );
}

export function MaintenanceDueListSkeleton(): ReactElement {
  return (
    <div aria-hidden="true" className="@container/maintenance overflow-hidden rounded-lg border shadow-xs">
      <MaintenanceDueHeader />
      <div className="divide-y">
        {Array.from({ length: 6 }, (_, index) => (
          <ListRow key={index} variant="plain" skeleton className={DUE_ROW_CLASS}>
            {MAINTENANCE_DUE_COLUMNS.map((column) => (
              <span key={column.id} className="min-w-0">
                {column.skeleton}
              </span>
            ))}
          </ListRow>
        ))}
      </div>
    </div>
  );
}

export type DueAction = {
  due: MaintenanceDueItem;
  defaultAction: 'create_visit' | 'schedule' | 'complete';
};

export function MaintenanceDueList({
  openDue,
  hasAnyDue,
  isBusy,
  onDueActionClick,
}: {
  openDue: MaintenanceDueItem[];
  /** False while the organization has no open due work at all, whatever the search. */
  hasAnyDue: boolean;
  isBusy: (id: string) => boolean;
  onDueActionClick: (action: DueAction) => void;
}): ReactElement {
  if (openDue.length === 0 && hasAnyDue) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Keine Fälligkeiten gefunden"
        description="Zur Suche gibt es auf dieser Seite keine offene Fälligkeit. Ändere die Suche."
      />
    );
  }
  return openDue.length === 0 ? (
    <EmptyState
      icon={CalendarClock}
      title="Keine offenen Wartungsfälligkeiten"
      description="Aktiviere einen Wartungsplan, damit Fälligkeiten für die nächsten 18 Monate erzeugt werden."
    />
  ) : (
    <div className="@container/maintenance overflow-hidden rounded-lg border shadow-xs">
      <MaintenanceDueHeader />
      <div className="divide-y">
        {openDue.map((due) => (
          <ListRow
            key={due.id}
            variant="plain"
            data-testid="maintenance-due-row"
            data-due-date={due.dueDate}
            className={DUE_ROW_CLASS}
          >
            <span>
              <span className="block font-medium">{formatMaintenanceDate(due.dueDate)}</span>
              <span className="text-xs text-muted-foreground">
                {MAINTENANCE_DUE_STATUS_LABELS[due.status]}
              </span>
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{due.planNumber}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {due.equipment.map((item) => item.name).join(', ')}
              </span>
            </span>
            <span className="min-w-0 text-sm">
              <span className="block truncate">{due.clientName}</span>
              <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                <MapPin className="size-3 shrink-0" />
                {due.siteName}
                {due.jobNumber ? ` · Auftrag ${due.jobNumber}` : ''}
              </span>
            </span>
            <fieldset
              disabled={isBusy(due.id)}
              className="flex min-w-0 flex-wrap items-center gap-2 @3xl/maintenance:justify-end"
            >
              <InlinePending active={isBusy(due.id)} label="Änderungen werden übernommen" />
              {due.status === 'open' ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onDueActionClick({ due, defaultAction: 'create_visit' })}
                >
                  Auftrag anlegen
                </Button>
              ) : !due.planningOccurrenceId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onDueActionClick({ due, defaultAction: 'schedule' })}
                >
                  Termin planen
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onDueActionClick({ due, defaultAction: 'complete' })}
                >
                  Abschließen
                </Button>
              )}
              {due.status === 'visit_created' && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onDueActionClick({ due, defaultAction: 'complete' })}
                >
                  Weitere Aktionen
                </Button>
              )}
            </fieldset>
          </ListRow>
        ))}
      </div>
    </div>
  );
}

type MaintenanceCoverage = MaintenanceWorkspace['coverages'][number];

export function MaintenanceCoverageList({
  coverages,
  hasAnyCoverage,
  pendingCoverages,
  onFollowUpClick,
  onDocumentsClick,
}: {
  coverages: MaintenanceCoverage[];
  /** False while the organization has no coverage at all, whatever the search. */
  hasAnyCoverage: boolean;
  pendingCoverages: MaintenanceCoveragePendingDraft[];
  onFollowUpClick: (coverage: MaintenanceCoverage) => void;
  onDocumentsClick: (coverage: MaintenanceCoverage) => void;
}): ReactElement {
  if (coverages.length === 0 && pendingCoverages.length === 0 && hasAnyCoverage) {
    return (
      <EmptyState
        icon={FileCheck2}
        title="Keine Abdeckungen gefunden"
        description="Zur Suche gibt es auf dieser Seite keine Abdeckung. Ändere die Suche."
      />
    );
  }
  return coverages.length === 0 && pendingCoverages.length === 0 ? (
    <EmptyState
      icon={FileCheck2}
      title="Keine operativen Abdeckungen"
      description="Erfasse bestätigte Vertrags- und Fristdaten, wenn ein Plan darauf Bezug nehmen soll."
    />
  ) : (
    <div className="@container/maintenance overflow-hidden rounded-lg border shadow-xs">
      <div
        data-testid="maintenance-coverage-header"
        className={cn(
          'hidden gap-4 border-b bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground @3xl/maintenance:grid',
          COVERAGE_GRID_COLUMNS,
        )}
      >
        <span>Abdeckung</span>
        <span>Kunde & Einsatzort</span>
        <span>Wiedervorlage</span>
        <span className="text-right">Aktion</span>
      </div>
      <div className="divide-y">
        {pendingCoverages.map((draft) => (
          <div
            key={draft.id}
            {...unconfirmedMarker(true)}
            role="status"
            aria-label="Wird gespeichert"
            data-pending-row=""
            className={cn(COVERAGE_ROW_CLASS, 'opacity-70')}
          >
            <span className="flex min-w-0 items-center gap-2 break-words">
              <InlinePending active />
              <span className="min-w-0">
                <span className="block font-medium">Abdeckung wird gespeichert</span>
                <span className="text-xs text-muted-foreground">{draft.reference ?? 'Keine Referenz'}</span>
              </span>
            </span>
            <span className="min-w-0 break-words text-sm">
              <span className="block">{draft.clientName}</span>
              <span className="text-xs text-muted-foreground">{draft.siteName}</span>
            </span>
          </div>
        ))}
        {coverages.map((coverage) => (
          <div key={coverage.id} data-testid="maintenance-coverage-row" className={COVERAGE_ROW_CLASS}>
            <span className="min-w-0 break-words">
              <span className="block font-medium">{coverage.coverageNumber}</span>
              <span className="text-xs text-muted-foreground">
                {coverage.reference ?? 'Keine Referenz'} ·{' '}
                {MAINTENANCE_COVERAGE_STATUS_LABELS[coverage.status]}
              </span>
            </span>
            <span className="min-w-0 break-words text-sm">
              <span className="block">{coverage.clientName}</span>
              <span className="text-xs text-muted-foreground">{coverage.siteName}</span>
            </span>
            <span className="min-w-0 break-words text-sm">
              <span className="block">{MAINTENANCE_RENEWAL_SIGNAL_LABELS[coverage.renewalSignal]}</span>
              <span className="text-xs text-muted-foreground">
                {formatMaintenanceDate(coverage.reviewDueDate)}
              </span>
            </span>
            <span className="flex min-w-0 flex-wrap gap-2 @3xl/maintenance:justify-end">
              <Button type="button" size="sm" variant="outline" onClick={() => onFollowUpClick(coverage)}>
                Wiedervorlage
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => onDocumentsClick(coverage)}>
                Dokumente
              </Button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
