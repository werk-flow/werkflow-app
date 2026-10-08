'use client';

import type { ActionFailure } from '@/lib/action-result';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';

import { useJobEntityOptions, type JobEntityOptionsState } from '@/hooks/use-job-entity-options';
import { useServerAction } from '@/hooks/use-server-action';
import {
  createInstalledEquipment,
  replaceInstalledEquipment,
  updateInstalledEquipment,
} from '@/lib/installed-equipment/actions';
import type { EquipmentDetail, EquipmentFormInput, EquipmentListItem } from '@/lib/installed-equipment/types';
import {
  EQUIPMENT_REQUIRED_FIELD_IDS,
  GENERIC_EQUIPMENT_FORM_ERROR,
  errorMessage,
  initialEquipmentForm,
  missingFields,
  toEquipmentFormPayload,
  equipmentParentOptions,
  equipmentSiteOptions,
  type EquipmentFormMode,
  type EquipmentFormState,
  type EquipmentParentOption,
  type EquipmentRequiredField,
  type EquipmentSiteOption,
} from './equipment-form-state';
import { useClientOption } from './use-client-option';

/** The values a list can show for a record before the server confirms it. */
export type EquipmentPendingDraft = Pick<
  EquipmentListItem,
  'id' | 'name' | 'category' | 'state' | 'clientName' | 'siteName' | 'manufacturer' | 'model'
>;

export type EquipmentCreateSubmission = {
  draft: EquipmentPendingDraft;
  /** Never rejects; a failure carries the German message for the caller's banner. */
  result: Promise<{ success: true } | (ActionFailure & { message: string })>;
};

type UseEquipmentFormOptions = {
  onOpenChange: (open: boolean) => void;
  mode: EquipmentFormMode;
  initial: EquipmentDetail | null | undefined;
  onSubmitted: ((submission: EquipmentCreateSubmission) => void) | undefined;
  onSaved: (() => void) | undefined;
};

export type EquipmentFormController = {
  form: EquipmentFormState;
  setForm: Dispatch<SetStateAction<EquipmentFormState>>;
  updateField: <Key extends keyof EquipmentFormState>(key: Key, value: EquipmentFormState[Key]) => void;
  error: string | null;
  fieldErrors: Partial<Record<EquipmentRequiredField, string>>;
  isPending: boolean;
  clientSearch: JobEntityOptionsState;
  clientOption: ReturnType<typeof useClientOption>;
  siteOptions: EquipmentSiteOption[];
  parentOptions: EquipmentParentOption[];
  handleSubmit: () => Promise<void>;
};

/** Form state, dependent option lists and the create/edit/replace submit of the equipment dialog. */
export function useEquipmentForm({
  onOpenChange,
  mode,
  initial,
  onSubmitted,
  onSaved,
}: UseEquipmentFormOptions): EquipmentFormController {
  const router = useRouter();
  const { run: runCreate, isPending: isCreating } = useServerAction(createInstalledEquipment);
  const { run: runUpdate, isPending: isUpdating } = useServerAction(updateInstalledEquipment);
  const { run: runReplace, isPending: isReplacing } = useServerAction(replaceInstalledEquipment);
  const [form, setForm] = useState<EquipmentFormState>(() => initialEquipmentForm(mode, initial));
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  // The customer is searched on the server; its sites and equipment load
  // when it is chosen. A record under edit keeps its own labels meanwhile.
  const clientSearch = useJobEntityOptions(
    { kind: 'clients' },
    form.clientId ? [form.clientId] : [],
    initial ? [{ value: initial.clientId, label: initial.clientName }] : [],
  );
  const clientOption = useClientOption(form.clientId);
  const sites = clientOption.client?.sites ?? [];
  const siteOptions = equipmentSiteOptions(sites, form, initial);
  const parentOptions = equipmentParentOptions(sites, form, initial);
  const isPending = isCreating || isUpdating || isReplacing;
  const fieldErrors = attempted ? missingFields(form, mode) : {};

  const payload = useMemo<EquipmentFormInput>(() => toEquipmentFormPayload(form), [form]);

  function updateField<Key extends keyof EquipmentFormState>(key: Key, value: EquipmentFormState[Key]): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(): Promise<void> {
    setError(null);
    setAttempted(true);
    const errors = missingFields(form, mode);
    const firstInvalid = EQUIPMENT_REQUIRED_FIELD_IDS.find(([key]) => errors[key]);
    if (firstInvalid) {
      document.getElementById(firstInvalid[1])?.focus();
      return;
    }
    const idempotencyKey = crypto.randomUUID();
    const effectiveAt = new Date().toISOString();
    if (mode === 'create' && onSubmitted) {
      const equipmentId = crypto.randomUUID();
      onSubmitted({
        draft: {
          id: equipmentId,
          name: form.name.trim(),
          category: form.category,
          state: form.state,
          clientName: clientSearch.options.find((client) => client.value === form.clientId)?.label ?? '',
          siteName: siteOptions.find((site) => site.value === form.siteId)?.label ?? '',
          manufacturer: form.manufacturer || null,
          model: form.model || null,
        },
        result: runCreate({
          ...payload,
          equipmentId,
          idempotencyKey,
          effectiveAt,
        }).then(
          (created) =>
            created.success
              ? { success: true as const }
              : { success: false as const, error: created.error, message: errorMessage(created.error) },
          () => ({
            success: false as const,
            error: 'unexpected_error',
            message: GENERIC_EQUIPMENT_FORM_ERROR,
          }),
        ),
      });
      onOpenChange(false);
      return;
    }
    const result =
      mode === 'create'
        ? await runCreate({
            ...payload,
            equipmentId: crypto.randomUUID(),
            idempotencyKey,
            effectiveAt,
          })
        : mode === 'edit' && initial
          ? await runUpdate({
              ...payload,
              equipmentId: initial.id,
              expectedVersion: initial.version,
              reason: form.reason ?? '',
              idempotencyKey,
            })
          : initial
            ? await runReplace({
                ...payload,
                predecessorId: initial.id,
                successorId: crypto.randomUUID(),
                expectedVersion: initial.version,
                effectiveAt,
                reason: form.reason ?? '',
                idempotencyKey,
              })
            : {
                success: false as const,
                error: 'installed_equipment_action_failed',
              };
    if (!result.success) {
      setError(errorMessage(result.error));
      return;
    }
    onOpenChange(false);
    if (mode === 'edit' && onSaved) {
      onSaved();
      return;
    }
    // The action revalidates, so its response already carries fresh route data.
    router.push(`/service/anlagen/${encodeURIComponent(result.equipment.equipment_number)}`);
  }

  return {
    form,
    setForm,
    updateField,
    error,
    fieldErrors,
    isPending,
    clientSearch,
    clientOption,
    siteOptions,
    parentOptions,
    handleSubmit,
  };
}
