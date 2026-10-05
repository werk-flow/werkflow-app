'use client';

import { useState } from 'react';

import { parseBerlinDateTimeInput } from '@/lib/customer-relationships/date-time';
import {
  setPersonnelAccessTransition,
  setPersonnelEmploymentTransition,
} from '@/lib/personnel/lifecycle-actions';
import type {
  PersonnelAccessTransitionKind,
  PersonnelEmploymentTransitionKind,
} from '@/lib/personnel/lifecycle';
import { toLocalDateString } from '@/lib/utils';

import { defaultAccessDateTime, todayDate } from './personnel-lifecycle-dates';
import { ERROR_MESSAGES, focusFirstInvalid } from './personnel-lifecycle-errors';
import { isScheduledAccessTransition } from './personnel-lifecycle-options';
import type { PersonnelLifecycleController } from './use-personnel-lifecycle-view';
import { logError } from '@/lib/logging';

export type PersonnelLifecycleTransitions = ReturnType<typeof usePersonnelLifecycleTransitions>;

/** Access and employment transition dialogs; both share one reason text. */
export function usePersonnelLifecycleTransitions(lifecycle: PersonnelLifecycleController) {
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
  const [accessOpen, setAccessOpen] = useState(false);
  const [employmentOpen, setEmploymentOpen] = useState(false);
  const [accessKind, setAccessKind] = useState<PersonnelAccessTransitionKind>('schedule_activation');
  const [accessAt, setAccessAt] = useState(defaultAccessDateTime);
  const [employmentKind, setEmploymentKind] = useState<PersonnelEmploymentTransitionKind>('record_notice');
  const [employmentDate, setEmploymentDate] = useState<Date | undefined>(todayDate());
  const [reason, setReason] = useState('');
  const [acceptUnresolved, setAcceptUnresolved] = useState(false);

  async function submitAccess(): Promise<void> {
    if (mutationDisabled) return;
    setError(null);
    const instant = isScheduledAccessTransition(accessKind)
      ? parseBerlinDateTimeInput(accessAt)?.toISOString()
      : new Date().toISOString();
    const nextErrors: Record<string, string> = {};
    if (!instant) nextErrors['access-transition-date'] = 'Bitte gib einen Zeitpunkt an.';
    if (reason.trim().length < 2) nextErrors['access-reason'] = 'Bitte gib einen Grund an.';
    setFieldErrors(nextErrors);
    if (focusFirstInvalid(nextErrors)) return;
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

  async function submitEmployment(): Promise<void> {
    if (mutationDisabled) return;
    setError(null);
    const nextErrors: Record<string, string> = {};
    if (!employmentDate) nextErrors['employment-date'] = 'Bitte gib ein Datum an.';
    if (reason.trim().length < 2) nextErrors['employment-reason'] = 'Bitte gib einen Grund an.';
    setFieldErrors(nextErrors);
    if (focusFirstInvalid(nextErrors) || !employmentDate) return;
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
    submitAccess,
    submitEmployment,
  };
}
