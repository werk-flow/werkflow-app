'use client';

import { useState } from 'react';

import { parseBerlinDateTimeInput } from '@/lib/date-time/berlin';
import {
  setPersonnelAccessTransition,
  setPersonnelEmploymentTransition,
} from '@/lib/personnel/lifecycle-actions';
import type {
  PersonnelAccessTransitionKind,
  PersonnelEmploymentTransitionKind,
} from '@/lib/personnel/lifecycle';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { toLocalDateString } from '@/lib/utils';

import { defaultAccessDateTime, todayDate } from './personnel-lifecycle-dates';
import { ERROR_MESSAGES } from './personnel-lifecycle-errors';
import { isScheduledAccessTransition } from './personnel-lifecycle-options';
import type { PersonnelLifecycleController } from './use-personnel-lifecycle-view';
import { logError } from '@/lib/logging';

export type PersonnelLifecycleTransitions = ReturnType<typeof usePersonnelLifecycleTransitions>;

/** The chosen step while it still fits the person's state, otherwise the first step that fits. */
function fittingStep<Kind extends string>(chosen: Kind | null, steps: readonly Kind[]): Kind | undefined {
  return chosen !== null && steps.includes(chosen) ? chosen : steps[0];
}

/**
 * The open state and fields of both transition dialogs; both share one reason
 * text. A step is chosen only among the steps that fit (`data.steps`); until
 * the admin picks one, and after a save, the first of them is preselected.
 */
function usePersonnelTransitionFields(steps: PersonnelLifecycleController['data']['steps']) {
  const [accessOpen, setAccessOpen] = useState(false);
  const [employmentOpen, setEmploymentOpen] = useState(false);
  const [accessChoice, setAccessKind] = useState<PersonnelAccessTransitionKind | null>(null);
  const [accessAt, setAccessAt] = useState(defaultAccessDateTime);
  const [employmentChoice, setEmploymentKind] = useState<PersonnelEmploymentTransitionKind | null>(null);
  const [employmentDate, setEmploymentDate] = useState<Date | undefined>(todayDate());
  const [reason, setReason] = useState('');
  const accessKind = fittingStep(accessChoice, steps.access);
  const employmentKind = fittingStep(employmentChoice, steps.employment);

  return {
    accessOpen,
    setAccessOpen,
    employmentOpen,
    setEmploymentOpen,
    accessKind,
    setAccessKind,
    accessAt,
    setAccessAt,
    employmentKind,
    setEmploymentKind,
    employmentDate,
    setEmploymentDate,
    reason,
    setReason,
  };
}

type PersonnelTransitionFields = ReturnType<typeof usePersonnelTransitionFields>;

async function saveAccessTransition(
  lifecycle: PersonnelLifecycleController,
  fields: PersonnelTransitionFields,
): Promise<void> {
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
  const { accessKind, accessAt, reason, setAccessOpen, setAccessKind, setReason } = fields;
  if (mutationDisabled) return;
  setError(null);
  const instant =
    accessKind && isScheduledAccessTransition(accessKind)
      ? parseBerlinDateTimeInput(accessAt)?.toISOString()
      : new Date().toISOString();
  const nextErrors: Record<string, string> = {};
  if (!accessKind) nextErrors['access-transition-kind'] = 'Bitte wähle einen Übergang.';
  if (!instant) nextErrors['access-transition-date'] = 'Bitte gib einen Zeitpunkt an.';
  if (reason.trim().length < 2) nextErrors['access-reason'] = 'Bitte gib einen Grund an.';
  setFieldErrors(nextErrors);
  if (focusFirstInvalidField(nextErrors) || !accessKind) return;
  try {
    await run(async () => {
      const result = await setPersonnelAccessTransition({
        employeeRecordId: data.employeeRecordId,
        expectedVersion: data.access.version,
        transitionKind: accessKind,
        effectiveAt: instant,
        reason,
        operationId: crypto.randomUUID(),
      });
      if (!result.success) {
        setError(failureMessage(result.error));
        return;
      }
      setAccessOpen(false);
      setAccessKind(null);
      setReason('');
      showBanner({
        variant: 'success',
        message: 'Zugangsstatus wurde gespeichert.',
      });
      reconcileMutation();
    });
  } catch (submitError) {
    logError('Unexpected error saving the access transition:', submitError);
    setError(ERROR_MESSAGES.mutation_failed);
  }
}

async function saveEmploymentTransition(
  lifecycle: PersonnelLifecycleController,
  fields: PersonnelTransitionFields,
): Promise<void> {
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
  const { employmentKind, employmentDate, reason, setEmploymentOpen, setEmploymentKind, setReason } = fields;
  if (mutationDisabled) return;
  setError(null);
  const nextErrors: Record<string, string> = {};
  if (!employmentKind) nextErrors['employment-transition-kind'] = 'Bitte wähle einen Übergang.';
  if (!employmentDate) nextErrors['employment-date'] = 'Bitte gib ein Datum an.';
  if (reason.trim().length < 2) nextErrors['employment-reason'] = 'Bitte gib einen Grund an.';
  setFieldErrors(nextErrors);
  if (focusFirstInvalidField(nextErrors) || !employmentDate || !employmentKind) return;
  try {
    await run(async () => {
      const result = await setPersonnelEmploymentTransition({
        employeeRecordId: data.employeeRecordId,
        expectedVersion: data.employment.version,
        transitionKind: employmentKind,
        effectiveOn: toLocalDateString(employmentDate),
        reason,
        operationId: crypto.randomUUID(),
      });
      if (!result.success) {
        setError(failureMessage(result.error));
        return;
      }
      setEmploymentOpen(false);
      setEmploymentKind(null);
      setReason('');
      showBanner({
        variant: 'success',
        message: 'Beschäftigungsübergang wurde gespeichert.',
      });
      reconcileMutation();
    });
  } catch (submitError) {
    logError('Unexpected error saving the employment transition:', submitError);
    setError(ERROR_MESSAGES.mutation_failed);
  }
}

/**
 * Access and employment transition dialogs; both share one reason text. A
 * transition that takes the person away offers the handover of their open
 * work (`openHandover`, from a Berlin date on).
 */
export function usePersonnelLifecycleTransitions(
  lifecycle: PersonnelLifecycleController,
  openHandover: (from?: string) => void,
) {
  const fields = usePersonnelTransitionFields(lifecycle.data.steps);

  return {
    ...fields,
    openHandover,
    submitAccess: (): Promise<void> => saveAccessTransition(lifecycle, fields),
    submitEmployment: (): Promise<void> => saveEmploymentTransition(lifecycle, fields),
  };
}
