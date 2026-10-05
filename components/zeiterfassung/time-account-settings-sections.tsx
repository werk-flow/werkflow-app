'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  assignEmployeeTimePolicy,
  decideTimeAccountAdjustment,
  openMissingTimeAccounts,
} from '@/lib/time-accounts/actions';
import type { TimeAccountSettingsData } from '@/lib/time-accounts/queries';
import { formatMinutes } from '@/lib/time-accounts/presentation';
import { formatGermanDate } from '@/lib/utils';

type SettingsEmployee = TimeAccountSettingsData['employees'][number];
type MissingAccount = TimeAccountSettingsData['missingAccounts'][number];
function EmployeeTimePolicyAssignment({
  employee,
  policies,
  today,
  layout,
}: {
  employee: SettingsEmployee;
  policies: TimeAccountSettingsData['policies'];
  today: string;
  layout: PersonLayout;
}) {
  const { handleSubmit, handleKeyDown, isPending, pendingValue, error } = useTimeAccountForm({
    action: 'assignPolicy',
    serverAction: assignEmployeeTimePolicy,
    fallback: 'assignment_failed',
    successMessage: () => 'Die Regel ist zugewiesen.',
  });
  const formId = `policy-assignment-${layout}-${employee.employeeRecordId}`;
  const choices = (
    <div className="flex flex-wrap gap-2" role="group" aria-label={`Regel für ${employee.employeeName}`}>
      {policies
        .filter((policy) => !policy.isDefault)
        .map((policy) => (
          <TimeAccountSubmitButton
            key={policy.id}
            form={formId}
            name="policyId"
            value={policy.id}
            variant={employee.assignedPolicyId === policy.id ? 'secondary' : 'outline'}
            size="sm"
            isPending={isPending}
            pendingValue={pendingValue}
            pendingLabel="Regel wird zugewiesen"
          >
            {policy.name} · V{policy.version}
          </TimeAccountSubmitButton>
        ))}
    </div>
  );
  const validFrom = (
    <TimeAccountDateField
      form={formId}
      name="validFrom"
      initialValue={today}
      ariaLabel={`Regel gültig ab für ${employee.employeeName}`}
    />
  );
  // Enter in the text field must not submit through the first rule button.
  const reason = (
    <Input
      form={formId}
      name="reason"
      defaultValue="Individuelle Arbeitszeitregel"
      aria-label={`Grund der Regel für ${employee.employeeName}`}
      onKeyDown={handleKeyDown}
      required
    />
  );
  return (
    <PersonRow
      layout={layout}
      name={employee.employeeName}
      form={
        <form id={formId} onSubmit={handleSubmit} className="contents">
          <input type="hidden" name="employeeRecordId" value={employee.employeeRecordId} />
        </form>
      }
      cells={
        layout === 'row'
          ? [
              { key: 'policy', content: choices },
              { key: 'validFrom', content: validFrom },
              { key: 'reason', content: reason },
            ]
          : [
              {
                key: 'validFrom',
                content: (
                  <Field label="Gültig ab" required>
                    {validFrom}
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
              { key: 'policy', content: choices },
            ]
      }
      error={error}
    />
  );
}

export function EmployeeTimePolicyAssignmentCard({
  settings,
  today,
}: {
  settings: TimeAccountSettingsData;
  today: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Individuelle Regeln</CardTitle>
        <CardDescription>
          Standardmäßig gilt die Organisationsregel. Bei Bedarf kann für einzelne Mitarbeitende eine
          datumswirksame Ausnahme festgelegt werden. Ein Klick auf eine Regel weist sie zu.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {settings.policies.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Lege zuerst einen weiteren Regelsatz an, um eine individuelle Ausnahme zuzuweisen.
          </p>
        ) : (
          <PersonTable
            heads={[
              { label: 'Mitarbeiter' },
              { label: 'Regel' },
              { label: 'Gültig ab', className: 'w-48' },
              { label: 'Grund' },
            ]}
            renderPeople={(layout) =>
              settings.employees.map((employee) => (
                <EmployeeTimePolicyAssignment
                  key={employee.employeeRecordId}
                  employee={employee}
                  policies={settings.policies}
                  today={today}
                  layout={layout}
                />
              ))
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

function MissingTimeAccount({
  employee,
  today,
  layout,
}: {
  employee: MissingAccount;
  today: string;
  layout: PersonLayout;
}) {
  const { handleSubmit, isPending, pendingValue, error } = useTimeAccountForm({
    action: 'openAccount',
    serverAction: openMissingTimeAccounts,
    fallback: 'open_failed',
    successMessage: () => 'Das Zeitkonto ist eröffnet.',
  });
  const formId = `open-account-${layout}-${employee.employeeRecordId}`;
  const openingMinutes = (
    <Input
      form={formId}
      name="openingMinutes"
      type="text"
      inputMode="numeric"
      pattern="-?[0-9]+"
      defaultValue="0"
      aria-label={`Anfangssaldo in Minuten für ${employee.employeeName}`}
      required
    />
  );
  const openedOn = (
    <TimeAccountDateField
      form={formId}
      name="openedOn"
      initialValue={today}
      ariaLabel={`Eröffnungsdatum für ${employee.employeeName}`}
    />
  );
  const reason = (
    <Input
      form={formId}
      name="reason"
      defaultValue="Einführung des Zeitkontos"
      aria-label={`Eröffnungsgrund für ${employee.employeeName}`}
      required
    />
  );
  // One row per person: a repeated row action stays quiet, so orange keeps marking the one primary step.
  const submit = (
    <TimeAccountSubmitButton
      form={formId}
      variant="outline"
      isPending={isPending}
      pendingValue={pendingValue}
      pendingLabel="Zeitkonto wird eröffnet"
    >
      Konto eröffnen
    </TimeAccountSubmitButton>
  );
  return (
    <PersonRow
      layout={layout}
      name={employee.employeeName}
      form={
        <form id={formId} onSubmit={handleSubmit} className="contents">
          <input type="hidden" name="employeeRecordId" value={employee.employeeRecordId} />
        </form>
      }
      cells={
        layout === 'row'
          ? [
              { key: 'openingMinutes', content: openingMinutes },
              { key: 'openedOn', content: openedOn },
              { key: 'reason', content: reason },
              { key: 'submit', content: <div className="flex justify-end">{submit}</div> },
            ]
          : [
              {
                key: 'openingMinutes',
                content: (
                  <Field label="Anfangssaldo (Minuten)" required>
                    {openingMinutes}
                  </Field>
                ),
              },
              {
                key: 'openedOn',
                content: (
                  <Field label="Eröffnungsdatum" required>
                    {openedOn}
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
              { key: 'submit', content: submit },
            ]
      }
      error={error}
    />
  );
}

export function MissingTimeAccountsCard({
  settings,
  today,
}: {
  settings: TimeAccountSettingsData;
  today: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Zeitkonten eröffnen</CardTitle>
        <CardDescription>
          {settings.openAccountCount} von {settings.employeeCount} Zeitkonten sind eröffnet. Jeder
          Anfangssaldo wird mit Datum und Grund ausdrücklich bestätigt.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {settings.missingAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Alle Zeitkonten sind eröffnet.</p>
        ) : (
          <PersonTable
            heads={[
              { label: 'Mitarbeiter' },
              { label: 'Anfangssaldo (Minuten)', className: 'w-44' },
              { label: 'Eröffnungsdatum', className: 'w-48' },
              { label: 'Grund' },
              { label: 'Aktion', className: 'sr-only' },
            ]}
            renderPeople={(layout) =>
              settings.missingAccounts.map((employee) => (
                <MissingTimeAccount
                  key={employee.employeeRecordId}
                  employee={employee}
                  today={today}
                  layout={layout}
                />
              ))
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

function PendingTimeAccountAdjustment({
  request,
}: {
  request: TimeAccountSettingsData['pendingAdjustments'][number];
}) {
  const { handleSubmit, handleKeyDown, isPending, pendingValue, error } = useTimeAccountForm({
    action: 'decideAdjustment',
    serverAction: decideTimeAccountAdjustment,
    fallback: 'decision_failed',
    successMessage: (formData) =>
      formData.get('decision') === 'approved' ? 'Der Antrag ist freigegeben.' : 'Der Antrag ist abgelehnt.',
  });
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3 last:border-b-0">
      <div className="text-sm">
        <p className="font-medium">
          {request.employeeName} · {formatMinutes(request.minutes)}
        </p>
        <p className="text-muted-foreground">
          {formatGermanDate(request.effectiveDate)} · {request.reason}
        </p>
      </div>
      <form
        onSubmit={handleSubmit}
        onKeyDown={handleKeyDown}
        className="space-y-2"
        aria-label={`Entscheidung für ${request.employeeName}`}
      >
        <div className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="requestId" value={request.id} />
          <input type="hidden" name="expectedVersion" value={request.version} />
          <Input
            name="reason"
            aria-label={`Entscheidungsgrund für ${request.employeeName}`}
            placeholder="Entscheidungsgrund"
            required
          />
          <TimeAccountSubmitButton
            name="decision"
            value="rejected"
            variant="outline"
            isPending={isPending}
            pendingValue={pendingValue}
            pendingLabel="Antrag wird abgelehnt"
          >
            Ablehnen
          </TimeAccountSubmitButton>
          <TimeAccountSubmitButton
            name="decision"
            value="approved"
            isPending={isPending}
            pendingValue={pendingValue}
            pendingLabel="Antrag wird freigegeben"
          >
            Freigeben
          </TimeAccountSubmitButton>
        </div>
        <ErrorText>{error}</ErrorText>
      </form>
    </div>
  );
}

export function PendingTimeAccountAdjustments({
  pendingAdjustments,
}: {
  pendingAdjustments: TimeAccountSettingsData['pendingAdjustments'];
}) {
  return pendingAdjustments.length > 0 ? (
    <div className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-semibold">Offene Freigaben</h3>
      {pendingAdjustments.map((request) => (
        <PendingTimeAccountAdjustment key={request.id} request={request} />
      ))}
    </div>
  ) : null;
}
