'use client';

import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { TimeAccountDateField } from '@/components/zeiterfassung/time-account-date-field';
import {
  PersonRow,
  PersonTable,
  type PersonLayout,
} from '@/components/zeiterfassung/time-account-person-table';
import { TimeAccountSubmitButton } from '@/components/zeiterfassung/time-account-submit-button';
import { useTimeAccountForm } from '@/components/zeiterfassung/use-time-account-form';
import {
  createDefaultPayrollMapping,
  createStarterTimePolicy,
  submitTimeAccountAdjustment,
} from '@/lib/time-accounts/actions';
import { formatMinutes } from '@/lib/time-accounts/presentation';
import type { TimeAccountSettingsData } from '@/lib/time-accounts/queries';

/** Confirms the default policy version or creates an exception policy. */
export function StarterTimePolicyForm({ today }: { today: string }) {
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
    <form
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className="space-y-2"
      aria-label="Zeitregel anlegen"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Name" htmlFor="time-policy-name" required>
          <Input name="name" defaultValue="Standard-Arbeitszeit" required />
        </Field>
        <Field label="Gültig ab" htmlFor="time-policy-effective-from" required>
          <TimeAccountDateField name="effectiveFrom" initialValue={today} ariaLabel="Gültig ab" />
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
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

const ADJUSTMENT_KINDS = [
  { value: 'manual_adjustment', label: 'Korrektur', pendingLabel: 'Korrektur wird beantragt' },
  { value: 'expiry', label: 'Verfall', pendingLabel: 'Verfall wird beantragt' },
  { value: 'payout', label: 'Auszahlung', pendingLabel: 'Auszahlung wird beantragt' },
] as const;

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
    <div
      className="flex flex-wrap gap-1"
      role="group"
      aria-label={`Art der Korrektur für ${account.employeeName}`}
    >
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
  // Enter in a text field must not submit through the first kind button.
  const minutes = (
    <Input
      form={formId}
      name="minutes"
      type="text"
      inputMode="numeric"
      pattern="-?[0-9]+"
      aria-label={`Korrektur in Minuten für ${account.employeeName}`}
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
        <form id={formId} onSubmit={handleSubmit} className="contents">
          <input type="hidden" name="accountId" value={account.id} />
          <input type="hidden" name="expectedVersion" value={account.version} />
        </form>
      }
      cells={
        layout === 'row'
          ? [
              { key: 'minutes', content: minutes },
              { key: 'effectiveDate', content: effectiveDate },
              { key: 'reason', content: reason },
              { key: 'kind', content: kinds },
            ]
          : [
              {
                key: 'minutes',
                content: (
                  <Field label="Minuten" required>
                    {minutes}
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
            ]
      }
      error={error}
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
        { label: 'Minuten', className: 'w-32' },
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

/** Confirms the default payroll mapping as a new version. */
export function DefaultPayrollMappingForm() {
  const { handleSubmit, isPending, pendingValue, error } = useTimeAccountForm({
    action: 'createMapping',
    serverAction: async () => createDefaultPayrollMapping(),
    fallback: 'mapping_failed',
    successMessage: () => 'Die Lohnarten-Zuordnung ist gespeichert.',
  });
  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <TimeAccountSubmitButton
        isPending={isPending}
        pendingValue={pendingValue}
        pendingLabel="Standardzuordnung wird gespeichert"
      >
        Standardzuordnung bestätigen
      </TimeAccountSubmitButton>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
