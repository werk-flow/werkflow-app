'use client';

import type { Dispatch, SetStateAction } from 'react';

import { useBanner } from '@/components/ui/banner';
import type { useBusyIds } from '@/hooks/use-busy-id';
import type { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useServerAction } from '@/hooks/use-server-action';
import type { ActionResult } from '@/lib/action-result';
import {
  createJobMaterialLine,
  createProjectMaterialLine,
  deleteJobMaterialLine,
  returnJobMaterial,
  takeJobMaterial,
  takeProjectMaterial,
  updateJobMaterialLine,
} from '@/lib/inventory/actions';
import {
  applyMaterialLinePlan,
  buildPlannedMaterialLineDraft,
  type MaterialLinePlan,
} from '@/lib/inventory/material-line-echo';
import type { InventoryLocation, InventoryPickerOption, JobMaterialLine } from '@/lib/inventory/types';
import {
  getActionErrorMessage,
  NO_LOCATION_VALUE,
  validateDialogRows,
  type MaterialDialogMode,
  type MaterialDialogRow,
  type MaterialDialogState,
} from './job-material-dialog-model';

type MaterialBookingResult = ActionResult<{ lineId?: string }>;

type MaterialContext = {
  jobId: string | undefined;
  projectId: string | undefined;
};

type OptimisticMaterialLines = ReturnType<typeof useOptimisticList<JobMaterialLine>>;

/** Books one dialog row with the action its mode and context call for. */
async function bookMaterialRow(
  mode: MaterialDialogMode,
  row: MaterialDialogRow,
  quantity: number,
  { jobId, projectId }: MaterialContext,
): Promise<MaterialBookingResult> {
  const preferredLocationId = row.locationId && row.locationId !== NO_LOCATION_VALUE ? row.locationId : null;

  return mode === 'plan' && jobId
    ? await createJobMaterialLine({
        jobId,
        itemId: row.itemId,
        preferredLocationId,
        plannedQuantity: quantity,
        notes: row.notes,
      })
    : mode === 'plan' && projectId
      ? await createProjectMaterialLine({
          projectId,
          itemId: row.itemId,
          preferredLocationId,
          plannedQuantity: quantity,
          notes: row.notes,
        })
      : mode === 'take' && jobId
        ? await takeJobMaterial({
            jobId,
            lineId: row.lineId,
            itemId: row.itemId,
            locationId: row.locationId,
            quantity,
            reason: row.notes,
          })
        : mode === 'take' && projectId
          ? await takeProjectMaterial({
              projectId,
              lineId: row.lineId,
              itemId: row.itemId,
              locationId: row.locationId,
              quantity,
              reason: row.notes,
            })
          : mode === 'return'
            ? await returnJobMaterial({
                lineId: row.lineId ?? '',
                locationId: row.locationId,
                quantity,
                reason: row.notes,
              })
            : await updateJobMaterialLine({
                lineId: row.lineId ?? '',
                itemId: row.itemId,
                preferredLocationId,
                plannedQuantity: quantity,
                notes: row.notes,
              });
}

/** Shows a planned or edited row in the list before its write resolves. */
function showPlanEcho(
  mode: 'plan' | 'edit',
  row: MaterialDialogRow,
  plannedQuantity: number,
  {
    lines,
    pickerItems,
    pickerLocations,
    jobId,
    projectId,
  }: MaterialContext & {
    lines: OptimisticMaterialLines;
    pickerItems: InventoryPickerOption[];
    pickerLocations: InventoryLocation[];
  },
): JobMaterialLine | null {
  const item = pickerItems.find((entry) => entry.id === row.itemId);
  const line = lines.items.find((entry) => entry.item.id === row.lineId)?.item;
  if (!item || (mode === 'edit' && !line)) return null;
  const preferredLocationId = row.locationId && row.locationId !== NO_LOCATION_VALUE ? row.locationId : null;
  const plan: MaterialLinePlan = {
    item,
    preferredLocationId,
    preferredLocationName:
      pickerLocations.find((location) => location.id === preferredLocationId)?.name ?? null,
    plannedQuantity,
    notes: row.notes,
  };
  if (line) {
    const edited = applyMaterialLinePlan(line, plan);
    lines.update(line.id, edited);
    return edited;
  }
  const draft = buildPlannedMaterialLineDraft(
    { id: `pending-${row.key}`, jobId: jobId ?? null, projectId: projectId ?? null },
    plan,
  );
  lines.insert(draft.id, draft);
  return draft;
}

/**
 * Saving the material dialog and removing a line. A plan or its edit shows at
 * once; a booking waits for the server and then marks the booked lines until
 * the fresh lines are on screen.
 */
export function useJobMaterialMutations({
  dialog,
  setDialog,
  lines,
  busyLines,
  readFreshLines,
  pickerItems,
  pickerLocations,
  jobId,
  projectId,
}: MaterialContext & {
  dialog: MaterialDialogState | null;
  setDialog: Dispatch<SetStateAction<MaterialDialogState | null>>;
  lines: OptimisticMaterialLines;
  busyLines: ReturnType<typeof useBusyIds<string>>;
  /** Starts the authoritative read of the lines and resolves when it landed. */
  readFreshLines: () => Promise<void>;
  pickerItems: InventoryPickerOption[];
  pickerLocations: InventoryLocation[];
}): {
  handleDialogSave: () => void;
  handleDelete: (lineId: string) => void;
  isSaving: boolean;
  isSettling: boolean;
} {
  const { showBanner } = useBanner();
  // The dialog save: `isSaving` drives the dialog's button spinner; after the
  // dialog closes, the booked lines (or the section header, when new lines
  // were planned) stay marked until the fresh lines are on screen.
  const {
    run: runDialogSave,
    isPending: isSaving,
    isSettling,
  } = useServerAction(async (task: () => Promise<string[] | null>) => task(), {
    settle: async (savedLineIds) => {
      if (!savedLineIds) return;
      // The fresh lines are the authority; an edit echo must not outlive them.
      for (const lineId of savedLineIds) lines.settle(lineId);
      const read = readFreshLines();
      for (const lineId of savedLineIds) void busyLines.run(lineId, () => read);
      await read;
    },
  });

  function updateDialogError(error: string, mode: MaterialDialogMode) {
    setDialog((current) => (current ? { ...current, error: getActionErrorMessage(error, mode) } : current));
  }

  function handleDialogSave() {
    if (!dialog) return;

    setDialog({ ...dialog, error: null });
    // Resolves with the booked line ids on success (the settle read marks
    // them), null when the dialog stays open with an error.
    void runDialogSave(async () => {
      const validation = validateDialogRows(dialog);
      if (!validation.ok) {
        updateDialogError(validation.error, dialog.mode);
        return null;
      }

      const validatedRows = validation.rows;
      const { mode } = dialog;

      // A plan or its edit books nothing and has no correctable server answer,
      // so the dialog closes and the lines show the outcome in the first frame.
      const echoContext = { lines, pickerItems, pickerLocations, jobId, projectId };
      const echoes =
        mode === 'plan' || mode === 'edit'
          ? validatedRows.map(({ row, quantity }) => showPlanEcho(mode, row, quantity, echoContext))
          : [];
      if (echoes.length > 0) setDialog(null);

      for (const [rowIndex, { row, quantity }] of validatedRows.entries()) {
        let result: MaterialBookingResult;
        try {
          result = await bookMaterialRow(mode, row, quantity, { jobId, projectId });
        } catch {
          result = { success: false, error: 'unexpected_error' };
        }

        if (!result.success) {
          // The refused row and the rows behind it leave the list and come
          // back in the dialog with the reason; saved rows stay.
          for (const echo of echoes.slice(rowIndex)) if (echo) lines.rollback(echo.id);
          setDialog({
            ...dialog,
            rows: dialog.rows.slice(rowIndex),
            error: getActionErrorMessage(result.error, mode),
          });
          return rowIndex > 0 ? [] : null;
        }
        const echo = echoes[rowIndex];
        if (echo && mode === 'plan' && result.lineId) {
          lines.commit(echo.id, { ...echo, id: result.lineId });
        }
      }

      setDialog(null);
      showBanner({
        variant: 'success',
        message:
          dialog.mode === 'take'
            ? 'Die Entnahme wurde gebucht.'
            : dialog.mode === 'return'
              ? 'Das Material wurde zurückgelegt.'
              : 'Die Materialplanung wurde gespeichert.',
      });
      return dialog.rows.flatMap((row) => (row.lineId ? [row.lineId] : []));
    }).catch(() => updateDialogError('unexpected_error', dialog.mode));
  }

  function handleDelete(lineId: string) {
    // The line leaves at once and comes back with the reason when refused.
    lines.remove(lineId);
    void (async () => {
      const result = await deleteJobMaterialLine(lineId).catch(() => null);
      if (!result?.success) {
        lines.rollback(lineId);
        showBanner({
          variant: 'error',
          message: getActionErrorMessage(result?.error ?? 'delete_failed', 'edit'),
        });
        return;
      }
      showBanner({
        variant: 'success',
        message: 'Die Materialposition wurde entfernt.',
      });
      await readFreshLines();
    })();
  }

  return { handleDialogSave, handleDelete, isSaving, isSettling };
}
