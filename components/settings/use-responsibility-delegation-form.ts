'use client';

import { useState } from 'react';

import { ERROR_MESSAGES, responsibilityErrorMessage } from '@/components/settings/responsibility-display';
import { useBanner } from '@/components/ui/banner';
import { useServerAction } from '@/hooks/use-server-action';
import { createResponsibilityDelegation } from '@/lib/responsibilities/actions';
import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';
import type { ResponsibilitySettingsData } from '@/lib/responsibilities/server';
import type { OrganizationResponsibility } from '@/lib/responsibilities/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

type DelegationPersonErrors = {
  delegator?: string | undefined;
  substitute?: string | undefined;
};

type ResponsibilityDelegationForm = {
  baseHolders: EffectiveResponsibilityHolder[];
  delegatorId: string;
  substituteId: string;
  validFrom: string;
  validUntil: string;
  note: string;
  isSaving: boolean;
  saveError: string | null;
  personErrors: DelegationPersonErrors;
  dateRangeError: string | null;
  canSave: boolean;
  selectDelegator: (value: string) => void;
  selectSubstitute: (value: string) => void;
  setValidFrom: (value: string) => void;
  setValidUntil: (value: string) => void;
  setNote: (value: string) => void;
  handleOpenChange: (nextOpen: boolean) => void;
  handleSave: (event: React.FormEvent) => Promise<void>;
};

/** Choosing a person clears that field's error. */
function personSelectors(
  setDelegatorId: (value: string) => void,
  setSubstituteId: (value: string) => void,
  setPersonErrors: React.Dispatch<React.SetStateAction<DelegationPersonErrors>>,
): Pick<ResponsibilityDelegationForm, 'selectDelegator' | 'selectSubstitute'> {
  const selectDelegator = (value: string) => {
    setDelegatorId(value);
    setPersonErrors((current) => ({ ...current, delegator: undefined }));
  };
  const selectSubstitute = (value: string) => {
    setSubstituteId(value);
    setPersonErrors((current) => ({ ...current, substitute: undefined }));
  };
  return { selectDelegator, selectSubstitute };
}

type DelegationSaveContext = {
  responsibility: OrganizationResponsibility;
  delegatorId: string;
  substituteId: string;
  validFrom: string;
  validUntil: string;
  note: string;
  isSaving: boolean;
  dateRangeError: string | null;
  runSave: typeof createResponsibilityDelegation;
  setSaveError: (error: string | null) => void;
  setPersonErrors: (errors: DelegationPersonErrors) => void;
  handleOpenChange: (nextOpen: boolean) => void;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
};

/**
 * The delegation dialog's submit: validation, then the save. Rebuilt on every
 * render like the inline handler it replaced, so it always reads the current fields.
 */
function createDelegationSave({
  responsibility,
  delegatorId,
  substituteId,
  validFrom,
  validUntil,
  note,
  isSaving,
  dateRangeError,
  runSave,
  setSaveError,
  setPersonErrors,
  handleOpenChange,
  showBanner,
}: DelegationSaveContext): (event: React.FormEvent) => Promise<void> {
  return async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    const nextPersonErrors = {
      delegator: delegatorId ? undefined : 'Bitte wähle die verantwortliche Person aus.',
      substitute: substituteId ? undefined : 'Bitte wähle eine Vertretung aus.',
    };
    setPersonErrors(nextPersonErrors);
    const invalid = focusFirstInvalidField({
      [`${responsibility}-delegator`]: nextPersonErrors.delegator,
      [`${responsibility}-substitute`]: nextPersonErrors.substitute,
      [`${responsibility}-valid-until`]: dateRangeError ?? undefined,
    });
    if (invalid) return;
    setSaveError(null);
    try {
      const result = await runSave({
        responsibility,
        delegatorEmployeeRecordId: delegatorId,
        substituteEmployeeRecordId: substituteId,
        validFrom,
        validUntil,
        note,
      });
      if (!result.success) {
        setSaveError(responsibilityErrorMessage(result.error));
        return;
      }
      // The action's response renders the route with the new delegation.
      handleOpenChange(false);
      showBanner({ message: 'Die Vertretung wurde eingetragen.', variant: 'success' });
    } catch {
      setSaveError(ERROR_MESSAGES.save_failed);
    }
  };
}

/** Field state, validation and submission of one responsibility's delegation dialog. */
export function useResponsibilityDelegationForm({
  data,
  responsibility,
  onOpenChange,
}: {
  data: ResponsibilitySettingsData;
  responsibility: OrganizationResponsibility;
  onOpenChange: (open: boolean) => void;
}): ResponsibilityDelegationForm {
  const { showBanner } = useBanner();
  const baseHolders = data.effective[responsibility].holders.filter(
    (holder) => holder.source.kind !== 'delegation',
  );
  const [delegatorId, setDelegatorId] = useState(baseHolders[0]?.employeeRecordId ?? '');
  const [substituteId, setSubstituteId] = useState('');
  const [validFrom, setValidFrom] = useState(data.businessDate);
  const [validUntil, setValidUntil] = useState(data.businessDate);
  const [note, setNote] = useState('');
  const { run: runSave, isPending: isSaving } = useServerAction(createResponsibilityDelegation);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [personErrors, setPersonErrors] = useState<DelegationPersonErrors>({});
  const hasInvalidDateRange = validUntil < validFrom;
  const dateRangeError = hasInvalidDateRange ? 'Das Enddatum darf nicht vor dem Startdatum liegen.' : null;
  const canSave = Boolean(delegatorId) && Boolean(substituteId) && !hasInvalidDateRange;

  const reset = () => {
    setDelegatorId(baseHolders[0]?.employeeRecordId ?? '');
    setSubstituteId('');
    setValidFrom(data.businessDate);
    setValidUntil(data.businessDate);
    setNote('');
    setSaveError(null);
    setPersonErrors({});
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const { selectDelegator, selectSubstitute } = personSelectors(
    setDelegatorId,
    setSubstituteId,
    setPersonErrors,
  );

  const handleSave = createDelegationSave({
    responsibility,
    delegatorId,
    substituteId,
    validFrom,
    validUntil,
    note,
    isSaving,
    dateRangeError,
    runSave,
    setSaveError,
    setPersonErrors,
    handleOpenChange,
    showBanner,
  });

  return {
    baseHolders,
    delegatorId,
    substituteId,
    validFrom,
    validUntil,
    note,
    isSaving,
    saveError,
    personErrors,
    dateRangeError,
    canSave,
    selectDelegator,
    selectSubstitute,
    setValidFrom,
    setValidUntil,
    setNote,
    handleOpenChange,
    handleSave,
  };
}
