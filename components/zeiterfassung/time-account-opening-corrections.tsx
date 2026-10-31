'use client';

import type { ReactNode } from 'react';

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
import { correctTimeAccountOpeningDate } from '@/lib/time-accounts/actions';
import type { TimeAccountSettingsData } from '@/lib/time-accounts/queries';
import { formatGermanDate } from '@/lib/utils';

type OpenedAccount = TimeAccountSettingsData['accounts'][number];

const LOCKED = 'Ein abgeschlossener Monat hängt von diesem Datum ab.';

/** The opening date and every earlier one, with the reason of each correction. */
function OpeningDateHistory({ account }: { account: OpenedAccount }) {
  return (
    <span className="block text-xs font-normal text-muted-foreground">
      Eröffnet am {formatGermanDate(account.openedOn)}
      {account.openingCorrections.map((correction) => (
        <span key={correction.id} className="block wrap-anywhere">
          Korrigiert von {formatGermanDate(correction.previousOpenedOn)} auf{' '}
          {formatGermanDate(correction.correctedOpenedOn)} · {correction.reason}
        </span>
      ))}
    </span>
  );
}

function OpeningDateName({ account }: { account: OpenedAccount }) {
  return (
    <>
      {account.employeeName}
      <OpeningDateHistory account={account} />
    </>
  );
}

/** An opening date a closed month depends on: shown, never offered for correction. */
function LockedOpeningDate({ account, layout }: { account: OpenedAccount; layout: PersonLayout }) {
  return (
    <PersonRow
      layout={layout}
      name={<OpeningDateName account={account} />}
      form={null}
      cells={[
        { key: 'openedOn', content: <p className="text-sm text-muted-foreground">{LOCKED}</p> },
        { key: 'reason', content: null },
        { key: 'submit', content: null },
      ]}
      error={null}
    />
  );
}

/** The date, reason and submit cells: bare in the table row, labelled on the phone card. */
function correctionCells(
  layout: PersonLayout,
  controls: { openedOn: ReactNode; reason: ReactNode; submit: ReactNode },
): Array<{ key: string; content: ReactNode }> {
  if (layout === 'row')
    return [
      { key: 'openedOn', content: controls.openedOn },
      { key: 'reason', content: controls.reason },
      { key: 'submit', content: <div className="flex justify-end">{controls.submit}</div> },
    ];
  return [
    {
      key: 'openedOn',
      content: (
        <Field label="Neues Eröffnungsdatum" required>
          {controls.openedOn}
        </Field>
      ),
    },
    {
      key: 'reason',
      content: (
        <Field label="Grund" required>
          {controls.reason}
        </Field>
      ),
    },
    { key: 'submit', content: controls.submit },
  ];
}

function OpeningDateCorrection({
  account,
  suggestedStartDate,
  layout,
}: {
  account: OpenedAccount;
  suggestedStartDate: string;
  layout: PersonLayout;
}) {
  const { handleSubmit, isPending, pendingValue, error } = useTimeAccountForm({
    action: 'correctOpening',
    serverAction: correctTimeAccountOpeningDate,
    fallback: 'correction_failed',
    successMessage: () => 'Das Eröffnungsdatum ist korrigiert. Bereite betroffene Monate neu vor.',
  });
  const formId = `opening-correction-${layout}-${account.id}`;
  const openedOn = (
    <TimeAccountDateField
      form={formId}
      name="openedOn"
      initialValue={suggestedStartDate === account.openedOn ? account.openedOn : suggestedStartDate}
      ariaLabel={`Neues Eröffnungsdatum für ${account.employeeName}`}
    />
  );
  const reason = (
    <Input
      form={formId}
      name="reason"
      aria-label={`Korrekturgrund des Eröffnungsdatums für ${account.employeeName}`}
      required
    />
  );
  const submit = (
    <TimeAccountSubmitButton
      form={formId}
      variant="outline"
      isPending={isPending}
      pendingValue={pendingValue}
      pendingLabel="Eröffnungsdatum wird korrigiert"
    >
      Datum korrigieren
    </TimeAccountSubmitButton>
  );
  return (
    <PersonRow
      layout={layout}
      name={<OpeningDateName account={account} />}
      form={
        <form id={formId} onSubmit={handleSubmit} className="contents">
          <input type="hidden" name="accountId" value={account.id} />
        </form>
      }
      cells={correctionCells(layout, { openedOn, reason, submit })}
      error={error}
    />
  );
}

/**
 * Opened accounts with their opening date. A wrong date is corrected with a
 * reason while no closed month depends on it; the history keeps every date.
 */
export function OpeningDateCorrections({
  accounts,
  suggestedStartDate,
}: {
  accounts: TimeAccountSettingsData['accounts'];
  suggestedStartDate: string;
}) {
  if (accounts.length === 0) return null;
  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-semibold">Eröffnungsdatum korrigieren</h3>
      <p className="text-sm text-muted-foreground">
        Ein Zeitkonto zählt erst ab seinem Eröffnungsdatum. Der Anfangssaldo wandert mit dem Datum, frühere
        Daten bleiben mit Grund in der Historie.
      </p>
      <PersonTable
        heads={[
          { label: 'Mitarbeiter' },
          { label: 'Neues Eröffnungsdatum', className: 'w-48' },
          { label: 'Grund' },
          { label: 'Aktion', className: 'sr-only' },
        ]}
        renderPeople={(layout) =>
          accounts.map((account) =>
            account.canCorrectOpenedOn ? (
              <OpeningDateCorrection
                key={account.id}
                account={account}
                suggestedStartDate={suggestedStartDate}
                layout={layout}
              />
            ) : (
              <LockedOpeningDate key={account.id} account={account} layout={layout} />
            ),
          )
        }
      />
    </div>
  );
}
