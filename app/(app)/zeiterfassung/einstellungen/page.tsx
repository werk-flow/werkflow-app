import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { TimeAccountDateField } from "@/components/zeiterfassung/time-account-date-field";
import {
  assignEmployeeTimePolicy,
  createDefaultPayrollMapping,
  createStarterTimePolicy,
  decideTimeAccountAdjustment,
  getTimeAccountAccess,
  getTimeAccountSettings,
  openMissingTimeAccounts,
  submitTimeAccountAdjustment,
  type TimeAccountSettingsData,
} from "@/lib/time-accounts/actions";
import { formatMinutes, todayBerlin } from "@/lib/time-accounts/presentation";

function AdjustmentRequestForms({
  accounts,
}: {
  accounts: TimeAccountSettingsData["accounts"];
}) {
  return accounts.map((account) => (
    <form
      key={account.id}
      action={submitTimeAccountAdjustment}
      className="grid gap-3 border-b pb-4 last:border-b-0 sm:grid-cols-[1fr_10rem_8rem_11rem_1.5fr_auto] sm:items-end"
    >
      <input type="hidden" name="accountId" value={account.id} />
      <input type="hidden" name="expectedVersion" value={account.version} />
      <div className="pb-2 text-sm font-medium">
        {account.employeeName}
        <span className="block text-xs font-normal text-muted-foreground">
          Saldo {formatMinutes(account.currentBalanceMinutes)}
        </span>
      </div>
      <div className="grid gap-1.5 text-sm font-medium">
        Art
        <div className="flex flex-wrap gap-1">
          <PendingSubmitButton
            name="adjustmentKind"
            value="manual_adjustment"
            variant="outline"
            size="sm"
            pendingLabel="Korrektur wird beantragt"
          >
            Korrektur
          </PendingSubmitButton>
          <PendingSubmitButton
            name="adjustmentKind"
            value="expiry"
            variant="outline"
            size="sm"
            pendingLabel="Verfall wird beantragt"
          >
            Verfall
          </PendingSubmitButton>
          <PendingSubmitButton
            name="adjustmentKind"
            value="payout"
            variant="outline"
            size="sm"
            pendingLabel="Auszahlung wird beantragt"
          >
            Auszahlung
          </PendingSubmitButton>
        </div>
      </div>
      <Field label="Minuten" htmlFor={`adjustment-minutes-${account.id}`} required>
        <Input
          name="minutes"
          type="text"
          inputMode="numeric"
          pattern="-?[0-9]+"
          aria-label={`Korrektur in Minuten für ${account.employeeName}`}
          required
        />
      </Field>
      <Field
        label="Wirksam am"
        htmlFor={`adjustment-effective-date-${account.id}`}
        required
      >
        <TimeAccountDateField
          name="effectiveDate"
          initialValue={todayBerlin()}
          ariaLabel={`Wirksamkeitsdatum für ${account.employeeName}`}
        />
      </Field>
      <Field label="Grund" htmlFor={`adjustment-reason-${account.id}`} required>
        <Input
          name="reason"
          aria-label={`Korrekturgrund für ${account.employeeName}`}
          required
        />
      </Field>
      <span className="pb-2 text-xs text-muted-foreground">
        Art wählen, um zu beantragen
      </span>
    </form>
  ));
}

export default async function TimeAccountSettingsPage() {
  const [settings, access] = await Promise.all([
    getTimeAccountSettings(),
    getTimeAccountAccess(),
  ]);
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          Zeitregeln & Lohnexport
        </h2>
        <p className="text-sm text-muted-foreground">
          Organisationseinstellungen mit versionierter, datumswirksamer
          Historie.
        </p>
      </div>
      {!access.isAdmin ? (
        access.canProposeAdjustments ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Zeitkonto korrigieren</CardTitle>
              <CardDescription>
                Büro-Nutzer können Korrekturen, Verfall und Auszahlung
                beantragen. Eine getrennte Freigabe ist erforderlich.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <AdjustmentRequestForms accounts={settings.accounts} />
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nur Administratoren können diese Einstellungen ändern.
          </p>
        )
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Arbeitszeitregel</CardTitle>
              <CardDescription>
                Der Startsatz nutzt die sechs Aktivitätsarten und 0, 50 oder 100
                Prozent. Weitere Sätze und Prozentwerte können später ergänzt
                werden.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {settings.policies.map((policy) => (
                <div
                  key={policy.id}
                  className="flex justify-between border-b pb-3 text-sm"
                >
                  <span>
                    {policy.name}
                    {policy.isDefault ? " · Standard" : ""}
                  </span>
                  <span className="text-muted-foreground">
                    Version {policy.version}
                    {policy.effectiveFrom
                      ? ` · ab ${policy.effectiveFrom}`
                      : ""}
                  </span>
                </div>
              ))}
              <form
                action={createStarterTimePolicy}
                className="flex flex-wrap items-end gap-3"
              >
                <Field label="Name" htmlFor="time-policy-name" required>
                  <Input
                    name="name"
                    defaultValue="Standard-Arbeitszeit"
                    required
                  />
                </Field>
                <Field label="Gültig ab" htmlFor="time-policy-effective-from" required>
                  <TimeAccountDateField
                    name="effectiveFrom"
                    initialValue={todayBerlin()}
                    ariaLabel="Gültig ab"
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <PendingSubmitButton
                    name="policyKind"
                    value="default"
                    pendingLabel="Standardversion wird gespeichert"
                  >
                    Standardversion bestätigen
                  </PendingSubmitButton>
                  <PendingSubmitButton
                    name="policyKind"
                    value="exception"
                    variant="outline"
                    pendingLabel="Ausnahmeregel wird angelegt"
                  >
                    Neue Ausnahmeregel anlegen
                  </PendingSubmitButton>
                </div>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Individuelle Regeln</CardTitle>
              <CardDescription>
                Standardmäßig gilt die Organisationsregel. Bei Bedarf kann für
                einzelne Mitarbeitende eine datumswirksame Ausnahme festgelegt
                werden.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {settings.policies.length < 2 ? (
                <p className="text-sm text-muted-foreground">
                  Legen Sie zuerst einen weiteren Regelsatz an, um eine
                  individuelle Ausnahme zuzuweisen.
                </p>
              ) : (
                settings.employees.map((employee) => (
                  <form
                    key={employee.employeeRecordId}
                    action={assignEmployeeTimePolicy}
                    className="grid gap-3 border-b pb-4 last:border-b-0 sm:grid-cols-[1fr_1fr_11rem_1.5fr_auto] sm:items-end"
                  >
                    <input
                      type="hidden"
                      name="employeeRecordId"
                      value={employee.employeeRecordId}
                    />
                    <div className="pb-2 text-sm font-medium">
                      {employee.employeeName}
                    </div>
                    <div className="grid gap-1.5 text-sm font-medium">
                      Regel
                      <div className="flex flex-wrap gap-2">
                        {settings.policies
                          .filter((policy) => !policy.isDefault)
                          .map((policy) => (
                            <PendingSubmitButton
                              key={policy.id}
                              name="policyId"
                              value={policy.id}
                              variant={
                                employee.assignedPolicyId === policy.id
                                  ? "secondary"
                                  : "outline"
                              }
                              size="sm"
                              pendingLabel="Regel wird ausgewählt"
                            >
                              {policy.name} · V{policy.version}
                            </PendingSubmitButton>
                          ))}
                      </div>
                    </div>
                    <Field
                      label="Gültig ab"
                      htmlFor={`policy-valid-from-${employee.employeeRecordId}`}
                      required
                    >
                      <TimeAccountDateField
                        name="validFrom"
                        initialValue={todayBerlin()}
                        ariaLabel={`Regel gültig ab für ${employee.employeeName}`}
                      />
                    </Field>
                    <Field
                      label="Grund"
                      htmlFor={`policy-reason-${employee.employeeRecordId}`}
                      required
                    >
                      <Input
                        name="reason"
                        defaultValue="Individuelle Arbeitszeitregel"
                        required
                      />
                    </Field>
                    <PendingSubmitButton pendingLabel="Regel wird zugewiesen">
                      Zuweisen
                    </PendingSubmitButton>
                  </form>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Zeitkonten eröffnen</CardTitle>
              <CardDescription>
                {settings.openAccountCount} von {settings.employeeCount}{" "}
                Zeitkonten sind eröffnet. Jeder Anfangssaldo wird mit Datum und
                Grund ausdrücklich bestätigt.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settings.missingAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Alle Zeitkonten sind eröffnet.
                </p>
              ) : (
                <div className="space-y-4">
                  {settings.missingAccounts.map((employee) => (
                    <form
                      key={employee.employeeRecordId}
                      action={openMissingTimeAccounts}
                      className="grid gap-3 border-b pb-4 last:border-b-0 sm:grid-cols-[1fr_8rem_11rem_1.5fr_auto] sm:items-end"
                    >
                      <input
                        type="hidden"
                        name="employeeRecordId"
                        value={employee.employeeRecordId}
                      />
                      <div className="pb-2 text-sm font-medium">
                        {employee.employeeName}
                      </div>
                      <Field
                        label="Anfangssaldo"
                        htmlFor={`opening-minutes-${employee.employeeRecordId}`}
                        required
                      >
                        <Input
                          name="openingMinutes"
                          type="text"
                          inputMode="numeric"
                          pattern="-?[0-9]+"
                          defaultValue="0"
                          aria-label={`Anfangssaldo in Minuten für ${employee.employeeName}`}
                          required
                        />
                      </Field>
                      <Field
                        label="Eröffnungsdatum"
                        htmlFor={`opened-on-${employee.employeeRecordId}`}
                        required
                      >
                        <TimeAccountDateField
                          name="openedOn"
                          initialValue={todayBerlin()}
                          ariaLabel={`Eröffnungsdatum für ${employee.employeeName}`}
                        />
                      </Field>
                      <Field
                        label="Grund"
                        htmlFor={`opening-reason-${employee.employeeRecordId}`}
                        required
                      >
                        <Input
                          name="reason"
                          defaultValue="Einführung des Zeitkontos"
                          aria-label={`Eröffnungsgrund für ${employee.employeeName}`}
                          required
                        />
                      </Field>
                      <PendingSubmitButton pendingLabel="Zeitkonto wird eröffnet">
                        Konto eröffnen
                      </PendingSubmitButton>
                    </form>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Zeitkonto korrigieren</CardTitle>
              <CardDescription>
                Korrekturen, Verfall und Auszahlung werden beantragt und erst
                nach einer getrennten Freigabe in den Saldo übernommen.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <AdjustmentRequestForms accounts={settings.accounts} />
              {settings.pendingAdjustments.length > 0 ? (
                <div className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-semibold">Offene Freigaben</h3>
                  {settings.pendingAdjustments.map((request) => (
                    <div
                      key={request.id}
                      className="flex flex-wrap items-end justify-between gap-3 border-b pb-3 last:border-b-0"
                    >
                      <div className="text-sm">
                        <p className="font-medium">
                          {request.employeeName} ·{" "}
                          {formatMinutes(request.minutes)}
                        </p>
                        <p className="text-muted-foreground">
                          {request.effectiveDate} · {request.reason}
                        </p>
                      </div>
                      <form
                        action={decideTimeAccountAdjustment}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input
                          type="hidden"
                          name="requestId"
                          value={request.id}
                        />
                        <input
                          type="hidden"
                          name="expectedVersion"
                          value={request.version}
                        />
                        <Input
                          name="reason"
                          aria-label={`Entscheidungsgrund für ${request.employeeName}`}
                          placeholder="Entscheidungsgrund"
                          required
                        />
                        <PendingSubmitButton
                          name="decision"
                          value="rejected"
                          variant="outline"
                          pendingLabel="Antrag wird abgelehnt"
                        >
                          Ablehnen
                        </PendingSubmitButton>
                        <PendingSubmitButton
                          name="decision"
                          value="approved"
                          pendingLabel="Antrag wird freigegeben"
                        >
                          Freigeben
                        </PendingSubmitButton>
                      </form>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lohnarten-Zuordnung</CardTitle>
              <CardDescription>
                Versionierte Zuordnung für alle Mitarbeitenden und
                Klassifikationen. Aktuell:{" "}
                {settings.mappingVersion
                  ? `Version ${settings.mappingVersion}`
                  : "nicht eingerichtet"}
                .
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={createDefaultPayrollMapping}>
                <PendingSubmitButton pendingLabel="Standardzuordnung wird gespeichert">
                  Standardzuordnung bestätigen
                </PendingSubmitButton>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
