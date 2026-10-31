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

/** The open state and fields of both transition dialogs; both share one reason text. */
function usePersonnelTransitionFields() {
  const [accessOpen, setAccessOpen] = useState(false);
  const [employmentOpen, setEmploymentOpen] = useState(false);
  const [accessKind, setAccessKind] = useState<PersonnelAccessTransitionKind>('schedule_activation');
  const [accessAt, setAccessAt] = useState(defaultAccessDateTime);
  const [employmentKind, setEmploymentKind] = useState<PersonnelEmploymentTransitionKind>('record_notice');
  const [employmentDate, setEmploymentDate] = useState<Date | undefined>(todayDate());
  const [reason, setReason] = useState('');
  const [acceptUnresolved, setAcceptUnresolved] = useState(false);

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
    acceptUnresolved,
    setAcceptUnresolved,
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
  const { accessKind, accessAt, reason, setAccessOpen, setReason } = fields;
  if (mutationDisabled) return;
  setError(null);
  const instant = isScheduledAccessTransition(accessKind)
    ? parseBerlinDateTimeInput(accessAt)?.toISOString()
    : new Date().toISOString();
  const nextErrors: Record<string, string> = {};
  if (!instant) nextErrors['access-transition-date'] = 'Bitte gib einen Zeitpunkt an.';
  if (reason.trim().length < 2) nextErrors['access-reason'] = 'Bitte gib einen Grund an.';
  setFieldErrors(nextErrors);
  if (focusFirstInvalidField(nextErrors)) return;
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
  const {
    employmentKind,
    employmentDate,
    reason,
    acceptUnresolved,
    setEmploymentOpen,
    setReason,
    setAcceptUnresolved,
  } = fields;
  if (mutationDisabled) return;
  setError(null);
  const nextErrors: Record<string, string> = {};
  if (!employmentDate) nextErrors['employment-date'] = 'Bitte gib ein Datum an.';
  if (reason.trim().length < 2) nextErrors['employment-reason'] = 'Bitte gib einen Grund an.';
  setFieldErrors(nextErrors);
  if (focusFirstInvalidField(nextErrors) || !employmentDate) return;
  try {
    await run(async () => {
      const result = await setPersonnelEmploymentTransition({
        employeeRecordId: data.employeeRecordId,
        expectedVersion: data.employment.version,
        transitionKind: employmentKind,
        effectiveOn: toLocalDateString(employmentDate),
        reason,
        acceptUnresolvedWork: acceptUnresolved,
        operationId: crypto.randomUUID(),
      });
      if (!result.success) {
        setError(failureMessage(result.error));
        return;
      }
      setEmploymentOpen(false);
      setReason('');
      setAcceptUnresolved(false);
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

/** Access and employment transition dialogs; both share one reason text. */
export function usePersonnelLifecycleTransitions(lifecycle: PersonnelLifecycleController) {
  const fields = usePersonnelTransitionFields();

  return {
    ...fields,
    submitAccess: (): Promise<void> => saveAccessTransition(lifecycle, fields),
    submitEmployment: (): Promise<void> => saveEmploymentTransition(lifecycle, fields),
  };
}
