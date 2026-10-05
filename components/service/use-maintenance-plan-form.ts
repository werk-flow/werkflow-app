'use client';

import type { ActionFailure } from '@/lib/action-result';
import { describeFailure } from '@/lib/action-messages';
import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';

import { useServerAction } from '@/hooks/use-server-action';
import { createMaintenancePlan, reviseMaintenancePlan } from '@/lib/maintenance/actions';
import type {
  MaintenanceClientOption,
  MaintenancePlanInput,
  MaintenancePlanItem,
  MaintenanceTemplateOption,
} from '@/lib/maintenance/types';
import {
  EMPTY_MAINTENANCE_PLAN_FORM,
  GENERIC_MAINTENANCE_PLAN_ERROR,
  MAINTENANCE_PLAN_ERROR_MESSAGES,
  MAINTENANCE_PLAN_REQUIRED_FIELD_IDS,
  formFromPlan,
  missingFields,
  toMaintenancePlanInput,
  type MaintenancePlanFormState,
  type MaintenancePlanRequiredField,
} from './maintenance-plan-form-state';

/** The values the workspace can show for a plan before the server confirms it. */
export type MaintenancePlanPendingDraft = {
  kind: 'plan';
  id: string;
  clientName: string;
  siteName: string;
  templateName: string;
  intervalMonths: number;
  status: 'draft' | 'active';
};

export type MaintenancePlanCreateSubmission = {
  draft: MaintenancePlanPendingDraft;
  /** Never rejects; a failure carries the German message for the caller's banner. */
  result: Promise<{ success: true } | (ActionFailure & { message: string })>;
};

type UseMaintenancePlanFormOptions = {
  onOpenChange: (open: boolean) => void;
  clients: MaintenanceClientOption[];
  templates: MaintenanceTemplateOption[];
  initial: MaintenancePlanItem | undefined;
  onSubmitted: ((submission: MaintenancePlanCreateSubmission) => void) | undefined;
  onSaved: (() => void) | undefined;
};

export type MaintenancePlanFormController = {
  form: MaintenancePlanFormState;
  setForm: Dispatch<SetStateAction<MaintenancePlanFormState>>;
  error: string | null;
  fieldErrors: Partial<Record<MaintenancePlanRequiredField, string>>;
  isPending: boolean;
  client: MaintenanceClientOption | undefined;
  site: MaintenanceClientOption['sites'][number] | undefined;
  submit: () => void;
};

/** Form state and the create/revise submit of the maintenance plan dialog. */
export function useMaintenancePlanForm({
  onOpenChange,
  clients,
  templates,
  initial,
  onSubmitted,
  onSaved,
}: UseMaintenancePlanFormOptions): MaintenancePlanFormController {
  const router = useRouter();
  const [form, setForm] = useState<MaintenancePlanFormState>(() =>
    initial ? formFromPlan(initial) : EMPTY_MAINTENANCE_PLAN_FORM,
  );
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const mutationIdentity = useRef({
    planId: initial?.id ?? crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  });
  const client = clients.find((item) => item.id === form.clientId);
  const site = client?.sites.find((item) => item.id === form.siteId);
  function buildInput(): MaintenancePlanInput {
    return toMaintenancePlanInput(form, mutationIdentity.current);
  }
  const { run, isPending } = useServerAction(
    async (submittedCreate?: ReturnType<typeof createMaintenancePlan>) => {
      setError(null);
      const result = submittedCreate
        ? await submittedCreate
        : initial
          ? await reviseMaintenancePlan({
              ...buildInput(),
              expectedVersion: initial.version,
            })
          : await createMaintenancePlan(buildInput());
      if (!result.success) {
        setError(
          describeFailure(result.error, MAINTENANCE_PLAN_ERROR_MESSAGES, GENERIC_MAINTENANCE_PLAN_ERROR),
        );
        return;
      }
      onOpenChange(false);
      if (initial && onSaved) {
        onSaved();
      } else if (!onSubmitted) {
        router.refresh();
      }
    },
  );
  const fieldErrors = attempted ? missingFields(form, Boolean(initial)) : {};

  function submit(): void {
    setError(null);
    setAttempted(true);
    const errors = missingFields(form, Boolean(initial));
    const firstInvalid = MAINTENANCE_PLAN_REQUIRED_FIELD_IDS.find(([key]) => errors[key]);
    if (firstInvalid) {
      document.getElementById(firstInvalid[1])?.focus();
      return;
    }
    if (!initial && onSubmitted) {
      const createResult = createMaintenancePlan(buildInput());
      onSubmitted({
        draft: {
          kind: 'plan',
          id: mutationIdentity.current.planId,
          clientName: client?.name ?? '',
          siteName: site?.name ?? '',
          templateName:
            templates.find((template) => template.versionId === form.templateVersionId)?.name ?? '',
          intervalMonths: Number(form.intervalMonths),
          status: form.status,
        },
        result: createResult.then(
          (created) =>
            created.success
              ? { success: true as const }
              : {
                  success: false as const,
                  error: created.error,
                  message: describeFailure(
                    created.error,
                    MAINTENANCE_PLAN_ERROR_MESSAGES,
                    GENERIC_MAINTENANCE_PLAN_ERROR,
                  ),
                },
          () => ({
            success: false as const,
            error: 'unexpected_error',
            message: GENERIC_MAINTENANCE_PLAN_ERROR,
          }),
        ),
      });
      // The pending list and this dialog observe the same request. Keep the
      // form mounted until the server accepts it so a correctable domain
      // error (for example a missing overlap reason) remains beside the
      // user's filled values.
      void run(createResult);
      return;
    }
    void run();
  }

  return { form, setForm, error, fieldErrors, isPending, client, site, submit };
}
