'use client';

import { describeFailure } from '@/lib/action-messages';
import { useRef, useState } from 'react';

import { useServerAction } from '@/hooks/use-server-action';
import { createMaintenanceCoverage } from '@/lib/maintenance/actions';
import type { MaintenanceCoverageCreateSubmission } from './maintenance-coverage-dialog';
import { useClientOption } from './use-client-option';

const GENERIC_ERROR = 'Die operative Abdeckung konnte nicht gespeichert werden.';

const COVERAGE_ERROR_MESSAGES: Record<string, string> = {
  maintenance_coverage_site_mismatch: 'Der Einsatzort gehört nicht zum gewählten Kunden.',
};

function errorMessage(code: string): string {
  return describeFailure(code, COVERAGE_ERROR_MESSAGES, GENERIC_ERROR);
}

/** Form state, validation and both submit paths of the coverage create dialog. */
export function useMaintenanceCoverageForm({
  onOpenChange,
  onSubmitted,
}: {
  onOpenChange: (open: boolean) => void;
  onSubmitted: ((submission: MaintenanceCoverageCreateSubmission) => void) | undefined;
}) {
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
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const mutationIdentity = useRef({
    coverageId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  });
  // The chosen customer's sites, read when the customer is chosen.
  const clientOption = useClientOption(clientId);
  const client = clientOption.client;
  function buildInput() {
    return {
      coverageId: mutationIdentity.current.coverageId,
      clientId,
      siteId,
      reference: reference || null,
      description: description || null,
      status: 'active' as const,
      validFrom: validFrom || null,
      validUntil: validUntil || null,
      noticeDate: noticeDate || null,
      renewalDate: renewalDate || null,
      reviewDueDate: reviewDueDate || null,
      operationalNote: operationalNote || null,
      idempotencyKey: mutationIdentity.current.idempotencyKey,
    };
  }
  const { run, isPending } = useServerAction(async () => {
    setError(null);
    const result = await createMaintenanceCoverage(buildInput());
    if (!result.success) {
      setError(errorMessage(result.error));
      return;
    }
    // The action's response renders the route with the new coverage.
    onOpenChange(false);
  });
  const clientError = attempted && !clientId ? 'Bitte wähle einen Kunden.' : undefined;
  const siteError = attempted && !siteId ? 'Bitte wähle einen Einsatzort.' : undefined;

  function submit(): void {
    setAttempted(true);
    if (!clientId || !siteId) {
      document.getElementById(clientId ? 'coverage-site' : 'coverage-client')?.focus();
      return;
    }
    if (onSubmitted) {
      onSubmitted({
        draft: {
          kind: 'coverage',
          id: mutationIdentity.current.coverageId,
          clientName: client?.name ?? '',
          siteName: client?.sites.find((site) => site.id === siteId)?.name ?? '',
          reference: reference || null,
        },
        result: createMaintenanceCoverage(buildInput()).then(
          (created) =>
            created.success
              ? { success: true as const }
              : { success: false as const, error: created.error, message: errorMessage(created.error) },
          () => ({ success: false as const, error: 'unexpected_error', message: GENERIC_ERROR }),
        ),
      });
      onOpenChange(false);
      return;
    }
    void run();
  }

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
    error,
    isPending,
    client,
    clientOption,
    clientError,
    siteError,
    submit,
  };
}
