'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { TimeAccountDateField } from '@/components/zeiterfassung/time-account-date-field';
import {
  focusFirstVisibleInvalid,
  PersonRow,
  PersonTable,
  type PersonLayout,
} from '@/components/zeiterfassung/time-account-person-table';
import { TimeAccountSubmitButton } from '@/components/zeiterfassung/time-account-submit-button';
import { useTimeAccountForm } from '@/components/zeiterfassung/use-time-account-form';
import { createStarterTimePolicy, submitTimeAccountAdjustment } from '@/lib/time-accounts/actions';
import { adjustmentHoursError } from '@/lib/time-accounts/balance-input';
import { startDateHint } from '@/lib/time-accounts/opening-dates';
import { formatMinutes } from '@/lib/time-accounts/presentation';
import type { TimeAccountSettingsData } from '@/lib/time-accounts/queries';

/** Confirms the default policy version or creates an exception policy, from the proposed start date on. */
export function StarterTimePolicyForm({ startDate }: { startDate: string }) {
  const { handleSubmit, handleKeyDown, isPending, pendingValue, error } = useTimeAccountForm({
    action: 'createPolicy',
    serverAction: createStarterTimePolicy,
    fallback: 'policy_save_failed',
    successMessage: (formData) =>
      formData.get('policyKind') === 'exception'
        ? 'Die Ausnahmeregel ist angelegt.'
        : 'Die Standardversion ist gespeichert.',
  });
  return (
    <form onSubmit={handleSubmit} className="space-y-2" aria-label="Zeitregel anlegen">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Name" htmlFor="time-policy-name" required>
          <Input name="name" defaultValue="Standard-Arbeitszeit" onKeyDown={handleKeyDown} required />
        </Field>
        <Field label="Gültig ab" htmlFor="time-policy-effective-from" required>
          <TimeAccountDateField name="effectiveFrom" initialValue={startDate} ariaLabel="Gültig ab" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <TimeAccountSubmitButton
            name="policyKind"
            value="default"
            isPending={isPending}
            pendingValue={pendingValue}
            pendingLabel="Standardversion wird gespeichert"
          >
            Standardversion bestätigen
          </TimeAccountSubmitButton>
          <TimeAccountSubmitButton
            name="policyKind"
            value="exception"
            variant="outline"
            isPending={isPending}
            pendingValue={pendingValue}
            pendingLabel="Ausnahmeregel wird angelegt"
          >
            Neue Ausnahmeregel anlegen
          </TimeAccountSubmitButton>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{startDateHint(startDate)}</p>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

const ADJUSTMENT_KINDS = [
  { value: 'manual_adjustment', label: 'Korrektur', pendingLabel: 'Korrektur wird beantragt' },
  { value: 'expiry', label: 'Verfall', pendingLabel: 'Verfall wird beantragt' },
  { value: 'payout', label: 'Auszahlung', pendingLabel: 'Auszahlung wird beantragt' },
] as const;

/** The kind buttons: each submits the account's correction with its kind. */
function AdjustmentKindButtons({
  formId,
  employeeName,
  isPending,
  pendingValue,
}: {
  formId: string;
  employeeName: string;
  isPending: boolean;
  pendingValue: string | null;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={`Art der Korrektur für ${employeeName}`}>
      {ADJUSTMENT_KINDS.map((kind) => (
        <TimeAccountSubmitButton
          key={kind.value}
          form={formId}
          name="adjustmentKind"
          value={kind.value}
          variant="outline"
          size="sm"
          isPending={isPending}
          pendingValue={pendingValue}
          pendingLabel={kind.pendingLabel}
        >
          {kind.label}
        </TimeAccountSubmitButton>
      ))}
    </div>
  );
}

const HOURS_HEAD = 'Stunden (Std:Min)';

/** The table row takes the bare controls; a card labels each one. */
function adjustmentCells(
  layout: PersonLayout,
  controls: { hoursId: string; hours: ReactNode; effectiveDate: ReactNode; reason: ReactNode; kinds: ReactNode },
): Parameters<typeof PersonRow>[0]['cells'] {
  const { hoursId, hours, effectiveDate, reason, kinds } = controls;
  return layout === 'row'
    ? [
        { key: 'hours', content: hours },
        { key: 'effectiveDate', content: effectiveDate },
        { key: 'reason', content: reason },
        { key: 'kind', content: kinds },
      ]
    : [
        {
          key: 'hours',
          content: (
            <Field label={HOURS_HEAD} htmlFor={hoursId} required>
              {hours}
            </Field>
          ),
        },
        {
          key: 'effectiveDate',
          content: (
            <Field label="Wirksam am" required>
              {effectiveDate}
            </Field>
          ),
        },
        {
          key: 'reason',
          content: (
            <Field label="Grund" required>
              {reason}
            </Field>
          ),
        },
        { key: 'kind', content: kinds },
      ];
}

function AdjustmentRequestForm({
  account,
  today,
  layout,
}: {
  account: TimeAccountSettingsData['accounts'][number];
  today: string;
  layout: PersonLayout;
}) {
  const { handleSubmit, handleKeyDown, isPending, pendingValue, error } = useTimeAccountForm({
    action: 'submitAdjustment',
    serverAction: submitTimeAccountAdjustment,
    fallback: 'adjustment_failed',
    successMessage: () => 'Der Antrag ist gespeichert. Er wird nach der Freigabe in den Saldo übernommen.',
  });
  const formId = `adjustment-${layout}-${account.id}`;
  const kinds = (
    <AdjustmentKindButtons
      formId={formId}
      employeeName={account.employeeName}
      isPending={isPending}
      pendingValue={pendingValue}
    />
  );
  // The hours take „±HH:MM“ like the opening balance; a wrong value marks the
  // field and sends nothing. Enter in a text field must not submit through
  // the first kind button.
  const hoursId = `adjustment-hours-${layout}-${account.id}`;
  const [hoursError, setHoursError] = useState<string | null>(null);
  const submitChecked = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    const message = adjustmentHoursError(String(new FormData(event.currentTarget).get('hours') ?? ''));
    setHoursError(message);
    if (message) {
      event.preventDefault();
      focusFirstVisibleInvalid([hoursId]);
      return;
    }
    await handleSubmit(event);
  };
  const hours = (
    <Input
      id={hoursId}
      form={formId}
      name="hours"
      type="text"
      autoComplete="off"
      placeholder="+0:00"
      aria-label={`Stunden der Korrektur für ${account.employeeName}`}
      aria-invalid={hoursError ? true : undefined}
      onChange={() => setHoursError(null)}
      onKeyDown={handleKeyDown}
      required
    />
  );
  const effectiveDate = (
    <TimeAccountDateField
      form={formId}
      name="effectiveDate"
      initialValue={today}
      ariaLabel={`Wirksamkeitsdatum für ${account.employeeName}`}
    />
  );
  const reason = (
    <Input
      form={formId}
      name="reason"
      aria-label={`Korrekturgrund für ${account.employeeName}`}
      onKeyDown={handleKeyDown}
      required
    />
  );
  return (
    <PersonRow
      layout={layout}
      name={
        <>
          {account.employeeName}
          <span className="block text-xs font-normal text-muted-foreground">
            Saldo {formatMinutes(account.currentBalanceMinutes)}
          </span>
        </>
      }
      form={
        <form id={formId} onSubmit={submitChecked} className="contents">
          <input type="hidden" name="accountId" value={account.id} />
          <input type="hidden" name="expectedVersion" value={account.version} />
        </form>
      }
      cells={adjustmentCells(layout, { hoursId, hours, effectiveDate, reason, kinds })}
      error={hoursError ?? error}
    />
  );
}

/** One request per time account: a click on the kind submits the correction. */
export function AdjustmentRequestForms({
  accounts,
  today,
}: {
  accounts: TimeAccountSettingsData['accounts'];
  today: string;
}) {
  if (accounts.length === 0) return null;
  return (
    <PersonTable
      heads={[
        { label: 'Mitarbeiter' },
        { label: HOURS_HEAD, className: 'w-36' },
        { label: 'Wirksam am', className: 'w-48' },
        { label: 'Grund' },
        { label: 'Art beantragen' },
      ]}
      renderPeople={(layout) =>
        accounts.map((account) => (
          <AdjustmentRequestForm key={account.id} account={account} today={today} layout={layout} />
        ))
      }
    />
  );
}
