'use client';

import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
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

type AdjustmentKey = 'hours' | 'date' | 'reason';

type AdjustmentErrors = Record<AdjustmentKey, string | null>;

const NO_ADJUSTMENT_ERRORS: AdjustmentErrors = { hours: null, date: null, reason: null };

/** The column head of each field: a card shows it as the label, the table row hides it behind the header. */
const ADJUSTMENT_LABELS: Record<AdjustmentKey, string> = {
  hours: HOURS_HEAD,
  date: 'Wirksam am',
  reason: 'Grund',
};

/** What a submitted adjustment lacks, in the order of the row. */
function checkAdjustment(data: FormData): AdjustmentErrors {
  return {
    hours: adjustmentHoursError(String(data.get('hours') ?? '')),
    date: data.get('effectiveDate') ? null : 'Wähle das Datum, ab dem die Korrektur gilt.',
    reason: String(data.get('reason') ?? '').trim() ? null : 'Gib einen Grund für die Korrektur an.',
  };
}

/**
 * The fields of one adjustment form, each in a `Field` that carries its
 * error. The hours take „±HH:MM“ like the opening balance. On submit, wrong or
 * zero hours, a missing date and a missing reason mark their fields, focus the
 * first and send nothing; editing a field clears its mark. The form takes
 * `noValidate`, so no browser bubble runs before this check. Enter in a field
 * must not submit through the first kind button.
 */
function useAdjustmentFields({
  formId,
  layout,
  account,
  today,
  handleKeyDown,
  handleSubmit,
}: {
  formId: string;
  layout: PersonLayout;
  account: Pick<TimeAccountSettingsData['accounts'][number], 'employeeName' | 'version'>;
  today: string;
  handleKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const ids = { hours: `${formId}-hours`, date: `${formId}-date`, reason: `${formId}-reason` };
  const [errors, setErrors] = useState<AdjustmentErrors>(NO_ADJUSTMENT_ERRORS);
  // The account version a draft was started against, by its first edit of any
  // field: a live refresh that changes the balance must not carry the draft
  // over to it, so its save is refused as stale, again on every retry. Only an
  // accepted save, which empties the fields, ends the draft.
  const [draftVersion, setDraftVersion] = useState<number | null>(null);
  const edit = (key: AdjustmentKey): void => {
    setErrors((previous) => ({ ...previous, [key]: null }));
    setDraftVersion((previous) => previous ?? account.version);
  };
  const submitChecked = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    const form = event.currentTarget;
    const next = checkAdjustment(new FormData(form));
    setErrors(next);
    const invalid = (['hours', 'date', 'reason'] as const).filter((key) => next[key] !== null);
    if (invalid.length > 0) {
      event.preventDefault();
      focusFirstVisibleInvalid(invalid.map((key) => ids[key]));
      return;
    }
    await handleSubmit(event);
    if (!new FormData(form).get('hours')) setDraftVersion(null);
  };
  // The table header labels a row's controls; the hidden label keeps the error wiring.
  const field = (key: AdjustmentKey, control: ReactNode) => (
    <Field
      label={ADJUSTMENT_LABELS[key]}
      htmlFor={ids[key]}
      required
      hideLabel={layout === 'row'}
      error={errors[key]}
    >
      {control}
    </Field>
  );
  const text = (key: 'hours' | 'reason', label: string, extra: { placeholder?: string } = {}) =>
    field(
      key,
      <Input
        form={formId}
        name={key}
        type="text"
        autoComplete="off"
        aria-label={`${label} für ${account.employeeName}`}
        onChange={() => edit(key)}
        onKeyDown={handleKeyDown}
        {...extra}
      />,
    );
  return {
    hours: text('hours', 'Stunden der Korrektur', { placeholder: '+0:00' }),
    effectiveDate: field(
      'date',
      <TimeAccountDateField
        form={formId}
        name="effectiveDate"
        id={ids.date}
        initialValue={today}
        ariaLabel={`Wirksamkeitsdatum für ${account.employeeName}`}
        onPick={() => edit('date')}
      />,
    ),
    reason: text('reason', 'Korrekturgrund'),
    expectedVersion: draftVersion ?? account.version,
    submitChecked,
  };
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
  const { hours, effectiveDate, reason, expectedVersion, submitChecked } = useAdjustmentFields({
    formId,
    layout,
    account,
    today,
    handleKeyDown,
    handleSubmit,
  });
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
        <form id={formId} onSubmit={submitChecked} noValidate className="contents">
          <input type="hidden" name="accountId" value={account.id} />
          <input type="hidden" name="expectedVersion" value={expectedVersion} />
        </form>
      }
      cells={[
        { key: 'hours', content: hours },
        { key: 'effectiveDate', content: effectiveDate },
        { key: 'reason', content: reason },
        {
          key: 'kind',
          content: (
            <AdjustmentKindButtons
              formId={formId}
              employeeName={account.employeeName}
              isPending={isPending}
              pendingValue={pendingValue}
            />
          ),
        },
      ]}
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
