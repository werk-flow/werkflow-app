'use client';

import { useState } from 'react';
import { useBanner } from '@/components/ui/banner';
import type { useOptimisticList } from '@/hooks/use-optimistic-list';
import { addEmployeeCapability, updateEmployeeCapability } from '@/lib/qualifications/actions';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import type {
  EmployeeCapabilityRecord,
  EvidenceState,
  QualificationWorkspace,
} from '@/lib/qualifications/types';
import { describeFailure } from '@/lib/action-messages';

export type QualificationManagementRecordListState = ReturnType<
  typeof useOptimisticList<EmployeeCapabilityRecord>
>;
export type QualificationManagementGrantFormState = ReturnType<typeof useQualificationManagementGrantForm>;

function useQualificationManagementGrantFields() {
  const [employeeRecordId, setEmployeeRecordId] = useState('');
  const [capabilityId, setCapabilityId] = useState('');
  const [validFrom, setValidFrom] = useState(getBusinessTodayIso());
  const [validUntil, setValidUntil] = useState('');
  const [issuer, setIssuer] = useState('');
  const [renewalDueDate, setRenewalDueDate] = useState('');
  const [operationalNote, setOperationalNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [evidenceState, setEvidenceState] = useState<EvidenceState>('not_required');
  const [supersedesId, setSupersedesId] = useState<string | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [grantFieldErrors, setGrantFieldErrors] = useState<{
    employee?: string | undefined;
    capability?: string | undefined;
    validFrom?: string | undefined;
    validUntil?: string | undefined;
  }>({});

  const resetGrantForm = () => {
    setEmployeeRecordId('');
    setCapabilityId('');
    setValidFrom(getBusinessTodayIso());
    setValidUntil('');
    setIssuer('');
    setRenewalDueDate('');
    setOperationalNote('');
    setConfirmed(false);
    setEvidenceState('not_required');
    setSupersedesId(null);
    setEditingRecordId(null);
    setGrantError(null);
    setGrantFieldErrors({});
  };

  return {
    employeeRecordId,
    setEmployeeRecordId,
    capabilityId,
    setCapabilityId,
    validFrom,
    setValidFrom,
    validUntil,
    setValidUntil,
    issuer,
    setIssuer,
    renewalDueDate,
    setRenewalDueDate,
    operationalNote,
    setOperationalNote,
    confirmed,
    setConfirmed,
    evidenceState,
    setEvidenceState,
    supersedesId,
    setSupersedesId,
    editingRecordId,
    setEditingRecordId,
    grantError,
    setGrantError,
    grantFieldErrors,
    setGrantFieldErrors,
    resetGrantForm,
  };
}

type QualificationManagementGrantFormOptions = {
  definitionById: Map<string, QualificationWorkspace['capabilities'][number]>;
  recordList: QualificationManagementRecordListState;
  settleRecord: (recordId: string) => void;
  setPendingAction: (action: string | null) => void;
};

/**
 * The grant form doubles as the edit and renewal form: the entry list fills it
 * through the setters, and saving echoes the draft into the optimistic list.
 */
export function useQualificationManagementGrantForm({
  definitionById,
  recordList,
  settleRecord,
  setPendingAction,
}: QualificationManagementGrantFormOptions) {
  const { showBanner } = useBanner();
  const fields = useQualificationManagementGrantFields();
  const {
    employeeRecordId,
    capabilityId,
    validFrom,
    validUntil,
    issuer,
    renewalDueDate,
    operationalNote,
    confirmed,
    evidenceState,
    supersedesId,
    editingRecordId,
    setGrantError,
    setGrantFieldErrors,
    resetGrantForm,
  } = fields;
  const selectedDefinition = definitionById.get(capabilityId) ?? null;
  const isRecordIdentityLocked = Boolean(editingRecordId || supersedesId);

  const saveGrant = async () => {
    setGrantError(null);
    const nextFieldErrors = {
      employee: employeeRecordId ? undefined : 'Bitte wähle einen Mitarbeiter aus.',
      capability: capabilityId ? undefined : 'Bitte wähle einen Begriff aus.',
      validFrom: validFrom ? undefined : 'Bitte gib ein Datum an.',
      validUntil:
        validUntil && validUntil < validFrom ? '„Gültig bis“ darf nicht vor „Gültig ab“ liegen.' : undefined,
    };
    setGrantFieldErrors(nextFieldErrors);
    const firstInvalidId = nextFieldErrors.employee
      ? 'qualification-employee'
      : nextFieldErrors.capability
        ? 'qualification-capability'
        : nextFieldErrors.validFrom
          ? 'qualification-valid-from'
          : nextFieldErrors.validUntil
            ? 'qualification-valid-until'
            : null;
    if (firstInvalidId) {
      document.getElementById(firstInvalidId)?.focus();
      return;
    }
    const sharedInput = {
      validFrom,
      validUntil: validUntil || null,
      issuer,
      renewalDueDate: renewalDueDate || null,
      confirmationStatus: confirmed ? ('confirmed' as const) : ('unconfirmed' as const),
      evidenceState,
      operationalNote,
    };
    const draft: EmployeeCapabilityRecord = {
      id: editingRecordId ?? crypto.randomUUID(),
      employeeRecordId,
      capabilityId,
      capabilityKind: selectedDefinition?.kind ?? 'skill',
      validFrom,
      validUntil: validUntil || null,
      issuer: issuer.trim() || null,
      renewalDueDate: renewalDueDate || null,
      confirmationStatus: sharedInput.confirmationStatus,
      evidenceState,
      operationalNote: operationalNote.trim() || null,
      supersedesId,
      supersededAt: null,
    };
    if (editingRecordId) recordList.update(draft.id, draft);
    else recordList.insert(draft.id, draft);
    setPendingAction('save-record');
    try {
      const result = editingRecordId
        ? await updateEmployeeCapability({
            recordId: editingRecordId,
            ...sharedInput,
          })
        : await addEmployeeCapability({
            employeeRecordId,
            capabilityId,
            ...sharedInput,
            supersedesId,
          });
      if (!result.success) {
        recordList.rollback(draft.id);
        setGrantError(
          describeFailure(
            result.error,
            { overlap: 'Der Zeitraum überschneidet sich mit einem bestehenden Eintrag.' },
            'Der Eintrag konnte nicht gespeichert werden.',
          ),
        );
        return;
      }
      const savedId =
        'recordId' in result && typeof result.recordId === 'string' ? result.recordId : draft.id;
      if (savedId !== draft.id) recordList.commit(draft.id, { ...draft, id: savedId });
      resetGrantForm();
      showBanner({
        variant: 'success',
        message: 'Der Eintrag wurde gespeichert.',
      });
      settleRecord(savedId);
    } catch {
      recordList.rollback(draft.id);
      setGrantError('Der Eintrag konnte nicht gespeichert werden.');
    } finally {
      setPendingAction(null);
    }
  };

  return { ...fields, selectedDefinition, isRecordIdentityLocked, saveGrant };
}
