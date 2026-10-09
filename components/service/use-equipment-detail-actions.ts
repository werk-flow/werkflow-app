'use client';

import { useState } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useLiveView, type LiveViewState } from '@/hooks/use-live-view';
import { readInBackground } from '@/lib/data/background-read-client';
import { getEquipmentMutationErrorMessage, type EquipmentDetail } from '@/lib/installed-equipment/types';
import { focusFirstInvalidField, REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';

// One key per card or row that can be mid-change, so only the touched part of
// the page shows pending and each dialog reports its own failure.
type EquipmentActionScope =
  | 'details'
  | 'state'
  | 'work-link'
  | 'source'
  | 'correction'
  | 'archive'
  | `unlink:${string}`;

type EquipmentActionError = { scope: EquipmentActionScope; message: string };

export type EquipmentDetailActions = {
  busy: ReturnType<typeof useBusyIds<EquipmentActionScope>>;
  live: LiveViewState<EquipmentDetail>;
  item: EquipmentDetail;
  /** The reason text shared by the dialogs; cleared on open and after a save. */
  reason: string;
  setReason: (value: string) => void;
  reasonError: string | undefined;
  attempted: EquipmentActionScope | null;
  setAttempted: (scope: EquipmentActionScope | null) => void;
  setError: (error: EquipmentActionError | null) => void;
  errorFor: (scope: EquipmentActionScope) => string | null;
  pageError: string | null;
  rejectInvalid: (
    scope: EquipmentActionScope,
    errors: Readonly<Record<string, string | undefined>>,
  ) => boolean;
  clearReason: () => void;
  perform: (
    scope: EquipmentActionScope,
    task: () => Promise<{ success: boolean; error?: string }>,
    onSuccess?: () => void,
  ) => void;
};

/** Live record, scoped pending state and the shared reason/error state of the equipment detail page. */
export function useEquipmentDetailActions(initial: EquipmentDetail): EquipmentDetailActions {
  const busy = useBusyIds<EquipmentActionScope>();
  const [reason, setReason] = useState('');
  // The dialog whose submit was refused for missing input; its fields show
  // their errors until the dialog is reopened or saved.
  const [attempted, setAttempted] = useState<EquipmentActionScope | null>(null);
  const reasonError = reason.trim().length < 3 ? REASON_MIN_3_MESSAGE : undefined;
  const [error, setError] = useState<EquipmentActionError | null>(null);
  const { activeOrgId } = useOrganization();
  // Reads over GET, outside the Server Action queue the dialogs' saves use.
  const live = useLiveView({
    tables: ['installed_equipment'],
    initialData: initial,
    resetKey: initial.id,
    read: async ({ signal }) => {
      if (!activeOrgId) return { ok: false as const };
      const result = await readInBackground(
        'equipment-detail',
        { organizationId: activeOrgId, equipmentNumber: initial.equipmentNumber },
        signal,
      );
      return result.success
        ? { ok: true as const, data: result.equipment }
        : { ok: false as const, error: result.error };
    },
  });
  const item = live.data ?? initial;
  const errorFor = (scope: EquipmentActionScope): string | null =>
    error?.scope === scope ? error.message : null;
  // Row and button actions outside a dialog report here; dialog actions
  // report inside their dialog.
  const pageError = error?.scope.startsWith('unlink:') ? error.message : null;

  function rejectInvalid(
    scope: EquipmentActionScope,
    errors: Readonly<Record<string, string | undefined>>,
  ): boolean {
    setAttempted(scope);
    return focusFirstInvalidField(errors);
  }

  function clearReason(): void {
    setReason('');
    setAttempted(null);
  }

  // The scope stays busy through the settle read, so the touched card shows
  // pending until the live view is authoritative again.
  function perform(
    scope: EquipmentActionScope,
    task: () => Promise<{ success: boolean; error?: string }>,
    onSuccess?: () => void,
  ): void {
    setError(null);
    void busy.run(scope, async () => {
      const result = await task().catch(() => ({
        success: false as const,
        error: undefined,
      }));
      if (!result.success) {
        setError({
          scope,
          message: getEquipmentMutationErrorMessage(
            result.error,
            'Die Änderung konnte nicht gespeichert werden.',
          ),
        });
        return;
      }
      clearReason();
      onSuccess?.();
      await live.refresh();
    });
  }

  return {
    busy,
    live,
    item,
    reason,
    setReason,
    reasonError,
    attempted,
    setAttempted,
    setError,
    errorFor,
    pageError,
    rejectInvalid,
    clearReason,
    perform,
  };
}
