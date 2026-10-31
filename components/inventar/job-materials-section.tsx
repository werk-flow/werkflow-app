'use client';

import type { ReactElement } from 'react';

import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { StaleRegion } from '@/components/shared/stale-region';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { readInBackground } from '@/lib/data/background-read-client';
import type {
  InventoryLocation,
  InventoryPickerOption,
  JobMaterialLine,
  ProjectMaterialSummary,
} from '@/lib/inventory/types';
import { MaterialLineRow } from './job-material-line-row';
import { MaterialSelectionDialog } from './job-material-selection-dialog';
import { JobMaterialsHeader } from './job-materials-header';
import { InheritedJobMaterialGroups, ProjectMaterialTotals } from './project-material-sections';
import { useJobMaterialDialog } from './use-job-material-dialog';
import { useJobMaterialMutations } from './use-job-material-mutations';

type JobMaterialsSectionProps = {
  jobId?: string;
  projectId?: string;
  initialLines: JobMaterialLine[];
  inventoryItems: InventoryPickerOption[];
  locations: InventoryLocation[];
  isAdminOrManager: boolean;
  inheritedJobGroups?: ProjectMaterialSummary['jobGroups'];
  totals?: ProjectMaterialSummary['totals'];
  readOnly?: boolean;
};

const getLineId = (line: JobMaterialLine) => line.id;

/**
 * The lines the section shows, with the optimistic overlay, the busy marks,
 * the read a booking waits for, and the dialog save and line removal.
 */
function useJobMaterialLines({
  jobId,
  projectId,
  initialLines,
  isAdminOrManager,
  materialDialog,
}: {
  jobId: string | undefined;
  projectId: string | undefined;
  initialLines: JobMaterialLine[];
  isAdminOrManager: boolean;
  materialDialog: ReturnType<typeof useJobMaterialDialog>;
}) {
  // Field workers cannot router.refresh their way to fresh lines, so their
  // view refetches; managers keep the server-rendered props.
  const fieldView = useLiveView<JobMaterialLine[]>({
    tables: ['job_material_lines', 'inventory_movements', 'inventory_stock_levels'],
    read: async ({ signal }): Promise<LiveViewResult<JobMaterialLine[]>> => {
      if (!jobId) return { ok: false };
      const result = await readInBackground('job-material-lines', { jobId }, signal);
      return result.success ? { ok: true, data: result.lines } : { ok: false };
    },
    initialData: initialLines,
    enabled: !isAdminOrManager && Boolean(jobId),
    resetKey: jobId ?? null,
  });
  // Planning, editing and removing show at once; the overlay expires when
  // the refreshed lines carry the change and rolls back when it is refused.
  const lines = useOptimisticList({
    items: isAdminOrManager ? initialLines : (fieldView.data ?? initialLines),
    getId: getLineId,
  });

  // The authoritative read after a booking: managers wait for the route
  // props that the booking's Server Action renders into its response (it
  // revalidates the Auftrag pages), field workers for the live view's own read.
  const waitForLines = useSettleOnChange(initialLines);
  const busyLines = useBusyIds();
  function readFreshLines(since?: number): Promise<void> {
    if (!isAdminOrManager) return fieldView.refresh();
    return waitForLines(since);
  }
  const { handleDialogSave, handleDelete, isSaving, isSettling } = useJobMaterialMutations({
    dialog: materialDialog.dialog,
    setDialog: materialDialog.setDialog,
    lines,
    busyLines,
    readFreshLines,
    markLines: waitForLines.markChange,
    pickerItems: materialDialog.pickerItems,
    pickerLocations: materialDialog.pickerLocations,
    jobId,
    projectId,
  });
  return { fieldView, lines, busyLines, handleDialogSave, handleDelete, isSaving, isSettling };
}

export function JobMaterialsSection({
  jobId,
  projectId,
  initialLines,
  inventoryItems,
  locations,
  isAdminOrManager,
  inheritedJobGroups = [],
  totals = [],
  readOnly = false,
}: JobMaterialsSectionProps): ReactElement {
  const materialDialog = useJobMaterialDialog({ jobId, isAdminOrManager, inventoryItems, locations });
  const isProjectContext = Boolean(projectId && !jobId);
  const { fieldView, lines, busyLines, handleDialogSave, handleDelete, isSaving, isSettling } =
    useJobMaterialLines({ jobId, projectId, initialLines, isAdminOrManager, materialDialog });

  const hasInheritedLines = inheritedJobGroups.length > 0;

  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <JobMaterialsHeader
        isUpdating={isSettling && !busyLines.anyBusy}
        isProjectContext={isProjectContext}
        totalCount={totals.length}
        isAdminOrManager={isAdminOrManager}
        readOnly={readOnly}
        isPickerLoading={materialDialog.isPickerLoading}
        inventoryItemCount={inventoryItems.length}
        onPlan={() => void materialDialog.openDialog('plan')}
        onTake={() => void materialDialog.openDialog('take')}
      />

      <StaleRegion
        stale={fieldView.isStale}
        onRetry={fieldView.refresh}
        notice="Der aktuelle Materialstand konnte nicht geladen werden. Die letzten bekannten Angaben bleiben sichtbar."
      >
        <JobMaterialLineList
          lines={lines}
          busyLines={busyLines}
          isProjectContext={isProjectContext}
          isAdminOrManager={isAdminOrManager}
          locations={materialDialog.pickerLocations}
          readOnly={readOnly}
          openDialog={materialDialog.openDialog}
          onDelete={handleDelete}
        />
      </StaleRegion>

      {hasInheritedLines && (
        <InheritedJobMaterialGroups
          groups={inheritedJobGroups}
          locations={locations}
          isAdminOrManager={isAdminOrManager}
        />
      )}

      {isProjectContext && totals.length > 0 && (
        <ProjectMaterialTotals totals={totals} isAdminOrManager={isAdminOrManager} />
      )}

      <ErrorText className="mt-3">{materialDialog.sectionError}</ErrorText>

      <MaterialSelectionDialog
        dialog={materialDialog.dialog}
        setDialog={materialDialog.setDialog}
        items={materialDialog.pickerItems}
        locations={materialDialog.pickerLocations}
        isSaving={isSaving}
        isSearching={materialDialog.isPickerLoading}
        searchFailed={materialDialog.searchFailed}
        onRetrySearch={materialDialog.retrySearch}
        onSave={handleDialogSave}
      />
    </div>
  );
}

type JobMaterialLines = ReturnType<typeof useJobMaterialLines>;

/** The section's own lines; take, return and edit open the dialog while the line shows busy. */
function JobMaterialLineList({
  lines,
  busyLines,
  isProjectContext,
  isAdminOrManager,
  locations,
  readOnly,
  openDialog,
  onDelete,
}: Pick<JobMaterialLines, 'lines' | 'busyLines'> & {
  isProjectContext: boolean;
  isAdminOrManager: boolean;
  locations: InventoryLocation[];
  readOnly: boolean;
  openDialog: ReturnType<typeof useJobMaterialDialog>['openDialog'];
  onDelete: (lineId: string) => void;
}) {
  if (lines.items.length === 0) {
    return (
      <EmptyState
        size="compact"
        title={
          isProjectContext ? 'Noch kein direktes Projektmaterial erfasst.' : 'Noch kein Material erfasst.'
        }
        description="Planen speichert nur den Bedarf. Entnehmen bucht die tatsächliche Bewegung im Lager."
      />
    );
  }
  return (
    <div className="space-y-3">
      {lines.items.map(({ item: line, isOptimistic }) => (
        <MaterialLineRow
          key={line.id}
          line={line}
          isAdminOrManager={isAdminOrManager}
          isBusy={isOptimistic || busyLines.isBusy(line.id)}
          locations={locations}
          readOnly={readOnly}
          onTake={() => void busyLines.run(line.id, () => openDialog('take', line))}
          onReturn={() => void busyLines.run(line.id, () => openDialog('return', line))}
          onEdit={() => void busyLines.run(line.id, () => openDialog('edit', line))}
          onDelete={() => onDelete(line.id)}
        />
      ))}
    </div>
  );
}
