'use client';

import type { ReactElement } from 'react';

import { ErrorText } from '@/components/ui/error-text';
import { SectionError } from '@/components/ui/section-error';
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
  const {
    dialog,
    setDialog,
    sectionError,
    pickerItems,
    pickerLocations,
    isPickerLoading,
    searchFailed,
    retrySearch,
    openDialog,
  } = useJobMaterialDialog({ jobId, isAdminOrManager, inventoryItems, locations });
  const isProjectContext = Boolean(projectId && !jobId);
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
    dialog,
    setDialog,
    lines,
    busyLines,
    readFreshLines,
    markLines: waitForLines.markChange,
    pickerItems,
    pickerLocations,
    jobId,
    projectId,
  });

  const hasDirectLines = lines.items.length > 0;
  const hasInheritedLines = inheritedJobGroups.length > 0;

  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <JobMaterialsHeader
        isUpdating={isSettling && !busyLines.anyBusy}
        isProjectContext={isProjectContext}
        totalCount={totals.length}
        isAdminOrManager={isAdminOrManager}
        readOnly={readOnly}
        isPickerLoading={isPickerLoading}
        inventoryItemCount={inventoryItems.length}
        onPlan={() => void openDialog('plan')}
        onTake={() => void openDialog('take')}
      />

      {!hasDirectLines ? (
        <div className="rounded-md border border-dashed bg-muted/20 px-4 py-6 text-center">
          <p className="text-sm font-medium">
            {isProjectContext ? 'Noch kein direktes Projektmaterial erfasst.' : 'Noch kein Material erfasst.'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Planen speichert nur den Bedarf. Entnehmen bucht die tatsächliche Bewegung im Lager.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {lines.items.map(({ item: line, isOptimistic }) => (
            <MaterialLineRow
              key={line.id}
              line={line}
              isAdminOrManager={isAdminOrManager}
              isBusy={isOptimistic || busyLines.isBusy(line.id)}
              locations={pickerLocations}
              readOnly={readOnly}
              onTake={() => void busyLines.run(line.id, () => openDialog('take', line))}
              onReturn={() => void busyLines.run(line.id, () => openDialog('return', line))}
              onEdit={() => void busyLines.run(line.id, () => openDialog('edit', line))}
              onDelete={() => handleDelete(line.id)}
            />
          ))}
        </div>
      )}

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

      <ErrorText className="mt-3">{sectionError}</ErrorText>
      {fieldView.isStale && (
        <SectionError
          className="mt-3"
          onRetry={() => void fieldView.refresh()}
          retryPending={fieldView.isRefreshing}
        >
          Der aktuelle Materialstand konnte nicht geladen werden. Die letzten bekannten Angaben bleiben
          sichtbar.
        </SectionError>
      )}

      <MaterialSelectionDialog
        dialog={dialog}
        setDialog={setDialog}
        items={pickerItems}
        locations={pickerLocations}
        isSaving={isSaving}
        isSearching={isPickerLoading}
        searchFailed={searchFailed}
        onRetrySearch={retrySearch}
        onSave={handleDialogSave}
      />
    </div>
  );
}
