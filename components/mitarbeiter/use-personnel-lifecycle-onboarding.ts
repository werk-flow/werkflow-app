'use client';

import { useMemo, useState } from 'react';

import {
  createPersonnelOnboardingPlan,
  savePersonnelOnboardingRequirement,
  type PersonnelLifecycleView,
} from '@/lib/personnel/lifecycle-actions';
import type { PersonnelRequirementState, PersonnelRequirementType } from '@/lib/personnel/lifecycle';
import { toLocalDateString } from '@/lib/utils';

import { ERROR_MESSAGES, focusFirstInvalid } from './personnel-lifecycle-errors';
import type { PersonnelLifecycleController } from './use-personnel-lifecycle-view';
import { logError } from '@/lib/logging';

export type PersonnelLifecyclePlan = ReturnType<typeof usePersonnelLifecyclePlan>;
export type PersonnelLifecycleRequirements = ReturnType<typeof usePersonnelLifecycleRequirements>;

export function usePersonnelLifecyclePlan(lifecycle: PersonnelLifecycleController) {
  const {
    data,
    run,
    mutationDisabled,
    showBanner,
    setError,
    setFieldErrors,
    reconcileMutation,
    failureMessage,
  } = lifecycle;
  const [planOpen, setPlanOpen] = useState(false);
  const [planName, setPlanName] = useState('Onboarding');
  const [planTemplateVersionId, setPlanTemplateVersionId] = useState<string>('');
  const [planStartDate, setPlanStartDate] = useState<Date | undefined>();

  async function submitPlan(): Promise<void> {
    if (mutationDisabled) return;
    setError(null);
    const nextErrors: Record<string, string> = {};
    if (!planName.trim()) nextErrors['plan-name'] = 'Bitte gib eine Bezeichnung an.';
    setFieldErrors(nextErrors);
    if (focusFirstInvalid(nextErrors)) return;
    try {
      await run(async () => {
        const result = await createPersonnelOnboardingPlan({
          employeeRecordId: data.employeeRecordId,
          templateVersionId: planTemplateVersionId || null,
          name: planName,
          targetStartDate: planStartDate ? toLocalDateString(planStartDate) : null,
          operationId: crypto.randomUUID(),
        });
        if (!result.success) {
          setError(failureMessage(result.error));
          return;
        }
        setPlanOpen(false);
        showBanner({
          variant: 'success',
          message: 'Onboardingplan wurde angelegt.',
        });
        reconcileMutation();
      });
    } catch (submitError) {
      logError('Unexpected error creating the onboarding plan:', submitError);
      setError(ERROR_MESSAGES.mutation_failed);
    }
  }

  return {
    planOpen,
    setPlanOpen,
    planName,
    setPlanName,
    planTemplateVersionId,
    setPlanTemplateVersionId,
    planStartDate,
    setPlanStartDate,
    submitPlan,
  };
}

export function usePersonnelLifecycleRequirements(lifecycle: PersonnelLifecycleController) {
  const {
    data,
    run,
    mutationDisabled,
    rowBusy,
    showBanner,
    setError,
    setFieldErrors,
    reconcileMutation,
    failureMessage,
  } = lifecycle;
  const [requirementOpen, setRequirementOpen] = useState(false);
  const [requirementTitle, setRequirementTitle] = useState('');
  const [requirementType, setRequirementType] = useState<PersonnelRequirementType>('manual');
  const [requirementRequired, setRequirementRequired] = useState(true);
  const [requirementBlocksAccess, setRequirementBlocksAccess] = useState(false);
  const currentPlan = data.plans[0] ?? null;
  const incompleteRequirements = useMemo(
    () =>
      currentPlan?.requirements.filter(
        (item) => !['fulfilled', 'waived', 'cancelled'].includes(item.state),
      ) ?? [],
    [currentPlan],
  );

  async function submitRequirement(): Promise<void> {
    if (mutationDisabled) return;
    if (!currentPlan) return;
    setError(null);
    const nextErrors: Record<string, string> = {};
    if (!requirementTitle.trim()) nextErrors['requirement-title'] = 'Bitte gib einen Titel an.';
    setFieldErrors(nextErrors);
    if (focusFirstInvalid(nextErrors)) return;
    try {
      await run(async () => {
        const result = await savePersonnelOnboardingRequirement({
          planId: currentPlan.id,
          requirementId: null,
          expectedVersion: 0,
          requirementType,
          title: requirementTitle,
          description: null,
          isRequired: requirementRequired,
          blocksAccess: requirementBlocksAccess,
          ownerEmployeeRecordId: null,
          dueDate: null,
          state: 'missing',
          blockerReason: null,
          operationId: crypto.randomUUID(),
        });
        if (!result.success) {
          setError(failureMessage(result.error));
          return;
        }
        setRequirementOpen(false);
        setRequirementTitle('');
        showBanner({
          variant: 'success',
          message: 'Anforderung wurde ergänzt.',
        });
        reconcileMutation();
      });
    } catch (submitError) {
      logError('Unexpected error creating the onboarding requirement:', submitError);
      setError(ERROR_MESSAGES.mutation_failed);
    }
  }

  async function resolveRequirement(
    requirement: PersonnelLifecycleView['plans'][number]['requirements'][number],
    state: Extract<PersonnelRequirementState, 'fulfilled' | 'waived' | 'cancelled'>,
  ): Promise<void> {
    if (mutationDisabled) return;
    setError(null);
    await rowBusy
      .run(requirement.id, async () => {
        const result = await savePersonnelOnboardingRequirement({
          planId: requirement.planId,
          requirementId: requirement.id,
          expectedVersion: requirement.version,
          requirementType: requirement.requirementType,
          title: requirement.title,
          description: requirement.description,
          isRequired: requirement.isRequired,
          blocksAccess: requirement.blocksAccess,
          ownerEmployeeRecordId: requirement.ownerEmployeeRecordId,
          dueDate: requirement.dueDate,
          state,
          blockerReason: null,
          operationId: crypto.randomUUID(),
        });
        if (!result.success) {
          showBanner({ variant: 'error', message: failureMessage(result.error) });
          return;
        }
        showBanner({
          variant: 'success',
          message: 'Anforderung wurde aktualisiert.',
        });
        reconcileMutation();
      })
      .catch((submitError: unknown) => {
        logError('Unexpected error updating the onboarding requirement:', submitError);
        showBanner({
          variant: 'error',
          message: ERROR_MESSAGES.mutation_failed,
        });
      });
  }

  return {
    currentPlan,
    incompleteRequirements,
    requirementOpen,
    setRequirementOpen,
    requirementTitle,
    setRequirementTitle,
    requirementType,
    setRequirementType,
    requirementRequired,
    setRequirementRequired,
    requirementBlocksAccess,
    setRequirementBlocksAccess,
    submitRequirement,
    resolveRequirement,
  };
}
