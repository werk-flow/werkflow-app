'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ERROR_MESSAGES, responsibilityErrorMessage } from '@/components/settings/responsibility-display';
import { useBanner } from '@/components/ui/banner';
import { useServerAction } from '@/hooks/use-server-action';
import { createResponsibilityDelegation } from '@/lib/responsibilities/actions';
import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';
import type { ResponsibilitySettingsData } from '@/lib/responsibilities/server';
import type { OrganizationResponsibility } from '@/lib/responsibilities/types';

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
  const router = useRouter();
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

  const selectDelegator = (value: string) => {
    setDelegatorId(value);
    setPersonErrors((current) => ({ ...current, delegator: undefined }));
  };
  const selectSubstitute = (value: string) => {
    setSubstituteId(value);
    setPersonErrors((current) => ({ ...current, substitute: undefined }));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    const nextPersonErrors = {
      delegator: delegatorId ? undefined : 'Bitte wähle die verantwortliche Person aus.',
      substitute: substituteId ? undefined : 'Bitte wähle eine Vertretung aus.',
    };
    setPersonErrors(nextPersonErrors);
    const firstInvalidId = nextPersonErrors.delegator
      ? `${responsibility}-delegator`
      : nextPersonErrors.substitute
        ? `${responsibility}-substitute`
        : hasInvalidDateRange
          ? `${responsibility}-valid-until`
          : null;
    if (firstInvalidId) {
      document.getElementById(firstInvalidId)?.focus();
      return;
    }
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
      handleOpenChange(false);
      router.refresh();
      showBanner({ message: 'Die Vertretung wurde eingetragen.', variant: 'success' });
    } catch {
      setSaveError(ERROR_MESSAGES.save_failed);
    }
  };

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
