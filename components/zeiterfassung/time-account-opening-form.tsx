'use client';

import { useState, type FormEvent } from 'react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { InlinePending } from '@/components/ui/inline-pending';
import { Input } from '@/components/ui/input';
import { OpeningDateCorrections } from '@/components/zeiterfassung/time-account-opening-corrections';
import {
  focusFirstVisibleInvalid,
  PersonRow,
  PersonTable,
  type PersonLayout,
} from '@/components/zeiterfassung/time-account-person-table';
import { TimeAccountSubmitButton } from '@/components/zeiterfassung/time-account-submit-button';
import { useServerAction } from '@/hooks/use-server-action';
import { openTimeAccounts } from '@/lib/time-accounts/actions';
import {
  BALANCE_INPUT_ERROR,
  parseSignedHoursMinutes,
  ZERO_BALANCE_INPUT,
} from '@/lib/time-accounts/balance-input';
import { getTimeAccountFailureMessage } from '@/lib/time-accounts/messages';
import { startDateHint } from '@/lib/time-accounts/opening-dates';
import type { TimeAccountSettingsData } from '@/lib/time-accounts/queries';
import { formatGermanDate, toLocalDateString } from '@/lib/utils';

type MissingAccount = TimeAccountSettingsData['missingAccounts'][number];

const OPEN_ALL = 'all';
const OPENED_ON_ID = 'open-accounts-opened-on';
const REASON_ID = 'open-accounts-reason';
// Each person's balance and „Eröffnen“ are one native form, so Enter in a
// balance opens that person's account only. The shared date and reason sit
// outside every form, and „Alle eröffnen“ is a plain button: no key ever
// opens every account while other balances may still read 0:00.

const balanceInputId = (layout: PersonLayout, employeeRecordId: string): string =>
  `opening-balance-${layout}-${employeeRecordId}`;

/** Why a period covers this person or not: the recorded entry and exit dates. */
function employmentHint(employee: MissingAccount): string | null {
  const parts = [
    employee.entryDate ? `Eintritt ${formatGermanDate(employee.entryDate)}` : null,
    employee.exitDate ? `Austritt ${formatGermanDate(employee.exitDate)}` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function MissingAccountRow({
  employee,
  layout,
  balance,
  invalid,
  onBalanceChange,
  onSubmit,
  isPending,
  pendingValue,
}: {
  employee: MissingAccount;
  layout: PersonLayout;
  balance: string;
  invalid: boolean;
  onBalanceChange: (balance: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  isPending: boolean;
  pendingValue: string | null;
}) {
  const hint = employmentHint(employee);
  const formId = `open-account-${layout}-${employee.employeeRecordId}`;
  const balanceInput = (
    <Input
      id={balanceInputId(layout, employee.employeeRecordId)}
      form={formId}
      value={balance}
      onChange={(event) => onBalanceChange(event.target.value)}
      autoComplete="off"
      aria-label={`Anfangssaldo für ${employee.employeeName}`}
      aria-invalid={invalid || undefined}
    />
  );
  // One button per person stays quiet, so orange keeps marking „Alle eröffnen“.
  const submit = (
    <TimeAccountSubmitButton
      form={formId}
      value={employee.employeeRecordId}
      variant="outline"
      isPending={isPending}
      pendingValue={pendingValue}
      pendingLabel="Zeitkonto wird eröffnet"
      aria-label={`Zeitkonto für ${employee.employeeName} eröffnen`}
    >
      Eröffnen
    </TimeAccountSubmitButton>
  );
  return (
    <PersonRow
      layout={layout}
      name={
        <>
          {employee.employeeName}
          {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
        </>
      }
      form={<form id={formId} onSubmit={onSubmit} noValidate className="contents" />}
      cells={[
        {
          key: 'balance',
          content:
            layout === 'row' ? (
              balanceInput
            ) : (
              <Field
                label="Anfangssaldo (Std:Min)"
                htmlFor={balanceInputId(layout, employee.employeeRecordId)}
                required
              >
                {balanceInput}
              </Field>
            ),
        },
        {
          key: 'submit',
          content: layout === 'row' ? <div className="flex justify-end">{submit}</div> : submit,
        },
      ]}
      error={invalid ? BALANCE_INPUT_ERROR : null}
    />
  );
}

// A field without an error holds undefined, so typing clears it.
type OpeningErrors = {
  openedOn?: string | undefined;
  reason?: string | undefined;
  balances: readonly string[];
};

/** What the submission lacks, and the controls to mark, in the order of the form. */
function checkOpening(input: {
  openedOn: Date | undefined;
  reason: string;
  people: readonly MissingAccount[];
  balanceOf: (employeeRecordId: string) => string;
}): { errors: OpeningErrors; invalidControlIds: string[] } {
  const errors: OpeningErrors = {
    ...(input.openedOn ? {} : { openedOn: 'Wähle das Eröffnungsdatum.' }),
    ...(input.reason.trim() ? {} : { reason: 'Gib einen Grund für die Eröffnung an.' }),
    balances: input.people
      .map((employee) => employee.employeeRecordId)
      .filter((id) => parseSignedHoursMinutes(input.balanceOf(id)) === null),
  };
  return {
    errors,
    invalidControlIds: [
      ...(errors.openedOn ? [OPENED_ON_ID] : []),
      ...(errors.reason ? [REASON_ID] : []),
      ...errors.balances.flatMap((id) => [balanceInputId('row', id), balanceInputId('card', id)]),
    ],
  };
}

/**
 * The state and submission of the opening form: the clicked button names one
 * person or everyone listed, a missing input marks its fields and sends
 * nothing, and a refusal stays at the form.
 */
function useOpenTimeAccounts(missingAccounts: readonly MissingAccount[], suggestedStartDate: string) {
  const { showBanner } = useBanner();
  const [openedOn, setOpenedOn] = useState<Date | undefined>(
    () => new Date(`${suggestedStartDate}T12:00:00`),
  );
  const [reason, setReason] = useState('Einführung des Zeitkontos');
  const [balances, setBalances] = useState<Readonly<Record<string, string>>>({});
  const [errors, setErrors] = useState<OpeningErrors>({ balances: [] });
  const [error, setError] = useState<string | null>(null);
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const { run, isPending } = useServerAction(openTimeAccounts);
  const balanceOf = (employeeRecordId: string): string => balances[employeeRecordId] ?? ZERO_BALANCE_INPUT;

  const changeOpenedOn = (date: Date | undefined): void => {
    setOpenedOn(date);
    setErrors((previous) => ({ ...previous, openedOn: undefined }));
  };
  const changeReason = (text: string): void => {
    setReason(text);
    setErrors((previous) => ({ ...previous, reason: undefined }));
  };

  const changeBalance = (employeeRecordId: string, balance: string): void => {
    setBalances((previous) => ({ ...previous, [employeeRecordId]: balance }));
    setErrors((previous) => ({
      ...previous,
      balances: previous.balances.filter((id) => id !== employeeRecordId),
    }));
  };

  /** Opens one person's account, or every listed one for `OPEN_ALL`. */
  const submit = async (target: string): Promise<void> => {
    setError(null);
    const people =
      target === OPEN_ALL
        ? missingAccounts
        : missingAccounts.filter((employee) => employee.employeeRecordId === target);
    const check = checkOpening({ openedOn, reason, people, balanceOf });
    setErrors(check.errors);
    if (!openedOn || check.invalidControlIds.length > 0) {
      focusFirstVisibleInvalid(check.invalidControlIds);
      return;
    }
    setPendingValue(target);
    try {
      const result = await run({
        openedOn: toLocalDateString(openedOn),
        reason,
        openings: people.map((employee) => ({
          employeeRecordId: employee.employeeRecordId,
          openingBalance: balanceOf(employee.employeeRecordId),
        })),
      });
      if (!result.success) {
        setError(getTimeAccountFailureMessage('openAccount', result.error));
        return;
      }
      showBanner({
        variant: 'success',
        message:
          people.length === 1 ? 'Das Zeitkonto ist eröffnet.' : `${people.length} Zeitkonten sind eröffnet.`,
      });
    } catch {
      setError(getTimeAccountFailureMessage('openAccount', 'open_failed'));
    }
  };

  const submitPerson =
    (employeeRecordId: string) =>
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      await submit(employeeRecordId);
    };

  return {
    shared: { openedOn, changeOpenedOn, reason, changeReason },
    balanceOf,
    changeBalance,
    errors,
    error,
    isPending,
    pendingValue,
    submitPerson,
    submitAll: () => submit(OPEN_ALL),
  };
}

/**
 * Opens missing accounts with one shared date and reason and each person's
 * balance as „±HH:MM“: one person from their row, or everyone listed
 * through „Alle eröffnen“, all or none.
 */
function OpenTimeAccountsForm({
  missingAccounts,
  suggestedStartDate,
}: {
  missingAccounts: TimeAccountSettingsData['missingAccounts'];
  suggestedStartDate: string;
}) {
  const {
    shared,
    balanceOf,
    changeBalance,
    errors,
    error,
    isPending,
    pendingValue,
    submitPerson,
    submitAll,
  } = useOpenTimeAccounts(missingAccounts, suggestedStartDate);
  const openingAll = isPending && pendingValue === OPEN_ALL;
  return (
    <section className="space-y-3" aria-label="Zeitkonten eröffnen">
      <div className="flex flex-wrap items-start gap-3">
        <Field label="Eröffnungsdatum" htmlFor={OPENED_ON_ID} required error={errors.openedOn}>
          <DatePicker value={shared.openedOn} onChange={shared.changeOpenedOn} />
        </Field>
        <Field label="Grund" htmlFor={REASON_ID} required error={errors.reason} className="min-w-56 flex-1">
          <Input value={shared.reason} onChange={(event) => shared.changeReason(event.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">{startDateHint(suggestedStartDate)}</p>
      <PersonTable
        heads={[
          { label: 'Mitarbeiter' },
          { label: 'Anfangssaldo (Std:Min)', className: 'w-44' },
          { label: 'Aktion', className: 'sr-only' },
        ]}
        renderPeople={(layout) =>
          missingAccounts.map((employee) => (
            <MissingAccountRow
              key={employee.employeeRecordId}
              employee={employee}
              layout={layout}
              balance={balanceOf(employee.employeeRecordId)}
              invalid={errors.balances.includes(employee.employeeRecordId)}
              onBalanceChange={(balance) => changeBalance(employee.employeeRecordId, balance)}
              onSubmit={submitPerson(employee.employeeRecordId)}
              isPending={isPending}
              pendingValue={pendingValue}
            />
          ))
        }
      />
      <Button type="button" onClick={submitAll} disabled={isPending} aria-busy={openingAll || undefined}>
        <InlinePending active={openingAll} label="Zeitkonten werden eröffnet" />
        Alle eröffnen
      </Button>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

/** Opens the missing accounts and corrects the opening date of an opened one. */
export function MissingTimeAccountsCard({
  settings,
}: {
  settings: Pick<
    TimeAccountSettingsData,
    'openAccountCount' | 'employeeCount' | 'missingAccounts' | 'accounts' | 'suggestedStartDate'
  >;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Zeitkonten</CardTitle>
        <CardDescription>
          {settings.openAccountCount} von {settings.employeeCount} Zeitkonten sind eröffnet. Ein Monat umfasst
          jede Person, die in ihm beschäftigt ist: Eintritt spätestens an seinem letzten Tag, Austritt
          frühestens an seinem ersten. Jeder Anfangssaldo wird mit Datum und Grund ausdrücklich bestätigt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {settings.missingAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Alle Zeitkonten sind eröffnet.</p>
        ) : (
          <OpenTimeAccountsForm
            missingAccounts={settings.missingAccounts}
            suggestedStartDate={settings.suggestedStartDate}
          />
        )}
        <OpeningDateCorrections
          accounts={settings.accounts}
          suggestedStartDate={settings.suggestedStartDate}
        />
      </CardContent>
    </Card>
  );
}
