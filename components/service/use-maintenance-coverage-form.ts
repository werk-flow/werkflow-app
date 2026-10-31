'use client';

import { describeFailure } from '@/lib/action-messages';
import { useRef, useState } from 'react';

import { useServerAction } from '@/hooks/use-server-action';
import { createMaintenanceCoverage } from '@/lib/maintenance/actions';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import type { MaintenanceCoverageCreateSubmission } from './maintenance-coverage-dialog';
import { useClientOption } from './use-client-option';

const GENERIC_ERROR = 'Die operative Abdeckung konnte nicht gespeichert werden.';

const COVERAGE_ERROR_MESSAGES: Record<string, string> = {
  maintenance_coverage_site_mismatch: 'Der Einsatzort gehört nicht zum gewählten Kunden.',
};

function coverageErrorMessage(code: string): string {
  return describeFailure(code, COVERAGE_ERROR_MESSAGES, GENERIC_ERROR);
}

/** The coverage's own fields, each with its setter. */
function useCoverageFields() {
  const [clientId, setClientId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [noticeDate, setNoticeDate] = useState('');
  const [renewalDate, setRenewalDate] = useState('');
  const [reviewDueDate, setReviewDueDate] = useState('');
  const [operationalNote, setOperationalNote] = useState('');
  return {
    clientId,
    setClientId,
    siteId,
    setSiteId,
    reference,
    setReference,
    description,
    setDescription,
    validFrom,
    setValidFrom,
    validUntil,
    setValidUntil,
    noticeDate,
    setNoticeDate,
    renewalDate,
    setRenewalDate,
    reviewDueDate,
    setReviewDueDate,
    operationalNote,
    setOperationalNote,
  };
}

type CoverageFields = ReturnType<typeof useCoverageFields>;

function coverageInput(fields: CoverageFields, identity: { coverageId: string; idempotencyKey: string }) {
  return {
    coverageId: identity.coverageId,
    clientId: fields.clientId,
    siteId: fields.siteId,
    reference: fields.reference || null,
    description: fields.description || null,
    status: 'active' as const,
    validFrom: fields.validFrom || null,
    validUntil: fields.validUntil || null,
    noticeDate: fields.noticeDate || null,
    renewalDate: fields.renewalDate || null,
    reviewDueDate: fields.reviewDueDate || null,
    operationalNote: fields.operationalNote || null,
    idempotencyKey: identity.idempotencyKey,
  };
}

/** The create's outcome for the caller's banner; it never rejects. */
function coverageSubmissionResult(
  created: ReturnType<typeof createMaintenanceCoverage>,
): MaintenanceCoverageCreateSubmission['result'] {
  return created.then(
    (outcome) =>
      outcome.success
        ? { success: true as const }
        : {
            success: false as const,
            error: outcome.error,
            message: coverageErrorMessage(outcome.error),
          },
    () => ({ success: false as const, error: 'unexpected_error', message: GENERIC_ERROR }),
  );
}

/** Form state, validation and both submit paths of the coverage create dialog. */
export function useMaintenanceCoverageForm({
  onOpenChange,
  onSubmitted,
}: {
  onOpenChange: (open: boolean) => void;
  onSubmitted: ((submission: MaintenanceCoverageCreateSubmission) => void) | undefined;
}) {
  const fields = useCoverageFields();
  const { clientId, siteId, reference } = fields;
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const mutationIdentity = useRef({
    coverageId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  });
  // The chosen customer's sites, read when the customer is chosen.
  const clientOption = useClientOption(clientId);
  const client = clientOption.client;
  const { run, isPending } = useServerAction(async () => {
    setError(null);
    const result = await createMaintenanceCoverage(coverageInput(fields, mutationIdentity.current));
    if (!result.success) {
      setError(coverageErrorMessage(result.error));
      return;
    }
    // The action's response renders the route with the new coverage.
    onOpenChange(false);
  });
  const clientError = clientId ? undefined : 'Bitte wähle einen Kunden.';
  const siteError = siteId ? undefined : 'Bitte wähle einen Einsatzort.';

  function submit(): void {
    setAttempted(true);
    if (focusFirstInvalidField({ 'coverage-client': clientError, 'coverage-site': siteError })) return;
    if (onSubmitted) {
      onSubmitted({
        draft: {
          kind: 'coverage',
          id: mutationIdentity.current.coverageId,
          clientName: client?.name ?? '',
          siteName: client?.sites.find((site) => site.id === siteId)?.name ?? '',
          reference: reference || null,
        },
        result: coverageSubmissionResult(
          createMaintenanceCoverage(coverageInput(fields, mutationIdentity.current)),
        ),
      });
      onOpenChange(false);
      return;
    }
    void run();
  }

  return {
    ...fields,
    error,
    isPending,
    client,
    clientOption,
    clientError: attempted ? clientError : undefined,
    siteError: attempted ? siteError : undefined,
    submit,
  };
}
