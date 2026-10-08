'use client';

import type { ActionFailure } from '@/lib/action-result';
import { describeFailure } from '@/lib/action-messages';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';

import { useServerAction } from '@/hooks/use-server-action';
import { createServiceCase, updateServiceCase } from '@/lib/service-cases/actions';
import type {
  ServiceCaseClientOption,
  ServiceCaseCreateInput,
  ServiceCaseDetail,
  ServiceCaseJobOption,
  ServiceCaseListItem,
} from '@/lib/service-cases/types';
import {
  EMPTY_SERVICE_CASE_FORM,
  GENERIC_SERVICE_CASE_ERROR,
  SERVICE_CASE_ERRORS,
  SERVICE_CASE_REQUIRED_FIELD_IDS,
  fromDetail,
  missingFields,
  type ServiceCaseFormState,
  type ServiceCaseRequiredField,
} from './service-case-form-state';
import { useClientOption } from './use-client-option';

/** The values a list can show for a record before the server confirms it. */
export type ServiceCasePendingDraft = Pick<
  ServiceCaseListItem,
  'id' | 'summary' | 'urgency' | 'status' | 'clientName' | 'siteName'
>;

export type ServiceCaseCreateSubmission = {
  draft: ServiceCasePendingDraft;
  /** Never rejects; a failure carries the German message for the caller's banner. */
  result: Promise<{ success: true } | (ActionFailure & { message: string })>;
};

type UseServiceCaseFormOptions = {
  onOpenChange: (open: boolean) => void;
  preloadedClient: ServiceCaseClientOption | null | undefined;
  initial: ServiceCaseDetail | undefined;
  jobs: ServiceCaseJobOption[];
  onSubmitted: ((submission: ServiceCaseCreateSubmission) => void) | undefined;
  onSaved: (() => void) | undefined;
};

export type ServiceCaseFormController = {
  form: ServiceCaseFormState;
  setForm: Dispatch<SetStateAction<ServiceCaseFormState>>;
  error: string | null;
  fieldErrors: Partial<Record<ServiceCaseRequiredField, string>>;
  isPending: boolean;
  clientOption: ReturnType<typeof useClientOption>;
  client: ServiceCaseClientOption | null;
  site: ServiceCaseClientOption['sites'][number] | undefined;
  availableJobs: ServiceCaseJobOption[];
  /** The chosen status closes the case, so a resolution note is required. */
  terminal: boolean;
  submit: () => void;
};

/** Form state, the chosen customer's options and the create/update submit of the service case dialog. */
export function useServiceCaseForm({
  onOpenChange,
  preloadedClient,
  initial,
  jobs,
  onSubmitted,
  onSaved,
}: UseServiceCaseFormOptions): ServiceCaseFormController {
  const router = useRouter();
  const [form, setForm] = useState<ServiceCaseFormState>(() =>
    initial ? fromDetail(initial) : EMPTY_SERVICE_CASE_FORM,
  );
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  function createInput(serviceCaseId: string): ServiceCaseCreateInput {
    return {
      serviceCaseId,
      idempotencyKey: crypto.randomUUID(),
      clientId: form.clientId,
      siteId: form.siteId,
      contactId: form.contactId || null,
      originalStatement: form.originalStatement,
      originalDetails: form.originalDetails,
      summary: form.summary,
      urgency: form.urgency,
      chargeContext: form.chargeContext,
      accessInstructions: form.accessInstructions,
      triageNote: form.triageNote,
      equipmentIds: form.equipmentIds,
    };
  }
  const { run, isPending } = useServerAction(async () => {
    const result = initial
      ? await updateServiceCase({
          serviceCaseId: initial.id,
          expectedVersion: initial.version,
          summary: form.summary,
          urgency: form.urgency,
          status: form.status,
          chargeContext: form.chargeContext,
          accessInstructions: form.accessInstructions,
          triageNote: form.triageNote,
          resolutionNote: form.resolutionNote,
          jobId: form.jobId || null,
          equipmentIds: form.equipmentIds,
          reason: form.reason,
          idempotencyKey: crypto.randomUUID(),
        })
      : await createServiceCase(createInput(crypto.randomUUID()));
    if (!result.success) {
      setError(describeFailure(result.error, SERVICE_CASE_ERRORS, GENERIC_SERVICE_CASE_ERROR));
      return;
    }
    onOpenChange(false);
    // Without a caller's live read, the action's response renders the route.
    if (!initial) {
      router.push(`/service/faelle/${result.serviceCase.case_number}`);
    } else if (onSaved) {
      onSaved();
    }
  });
  // Sites, contacts and equipment of the chosen customer only.
  const clientOption = useClientOption(form.clientId, preloadedClient);
  const client = clientOption.client;
  const site = client?.sites.find((item) => item.id === form.siteId);
  const availableJobs = useMemo(
    () => jobs.filter((job) => job.clientId === form.clientId && job.siteId === form.siteId),
    [form.clientId, form.siteId, jobs],
  );
  const terminal = ['resolved', 'closed_without_visit', 'duplicate'].includes(form.status);
  const fieldErrors = attempted ? missingFields(form, Boolean(initial), terminal) : {};

  function submit(): void {
    setError(null);
    setAttempted(true);
    const errors = missingFields(form, Boolean(initial), terminal);
    const firstInvalid = SERVICE_CASE_REQUIRED_FIELD_IDS.find(([key]) => errors[key]);
    if (firstInvalid) {
      document.getElementById(firstInvalid[1])?.focus();
      return;
    }
    if (!initial && onSubmitted) {
      const serviceCaseId = crypto.randomUUID();
      onSubmitted({
        draft: {
          id: serviceCaseId,
          summary: form.summary.trim(),
          urgency: form.urgency,
          status: 'new',
          clientName: client?.name ?? '',
          siteName: site?.name ?? '',
        },
        result: createServiceCase(createInput(serviceCaseId)).then(
          (created) =>
            created.success
              ? { success: true as const }
              : {
                  success: false as const,
                  error: created.error,
                  message: describeFailure(created.error, SERVICE_CASE_ERRORS, GENERIC_SERVICE_CASE_ERROR),
                },
          () => ({ success: false as const, error: 'unexpected_error', message: GENERIC_SERVICE_CASE_ERROR }),
        ),
      });
      onOpenChange(false);
      return;
    }
    void run();
  }

  return {
    form,
    setForm,
    error,
    fieldErrors,
    isPending,
    clientOption,
    client,
    site,
    availableJobs,
    terminal,
    submit,
  };
}
