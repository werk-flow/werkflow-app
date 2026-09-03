'use client';

import { useMemo, useState, useTransition } from 'react';
import { Award, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { ErrorText } from '@/components/ui/error-text';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  addEmployeeCapability,
  createCapability,
  retireCapabilityDefinition,
  setApprenticeWarningEnabled,
  updateEmployeeCapability,
} from '@/lib/qualifications/actions';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import {
  getCapabilityKindLabel,
  type CapabilityKind,
  type EvidenceState,
  type QualificationWorkspace,
} from '@/lib/qualifications/types';
import { parseDecimalInput } from '@/lib/ui/decimal';
import { toLocalDateString } from '@/lib/utils';

function isoToLocalDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function QualificationManagementSection({
  capabilities,
  employeeCapabilities,
  employees,
  apprenticeWarningEnabled,
  isAdmin,
}: Pick<
  QualificationWorkspace,
  | 'capabilities'
  | 'employeeCapabilities'
  | 'employees'
  | 'apprenticeWarningEnabled'
  | 'isAdmin'
>) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [, startTransition] = useTransition();
  const [kind, setKind] = useState<CapabilityKind>('skill');
  const [definitionName, setDefinitionName] = useState('');
  const [warningDays, setWarningDays] = useState('30');
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [employeeRecordId, setEmployeeRecordId] = useState('');
  const [capabilityId, setCapabilityId] = useState('');
  const [validFrom, setValidFrom] = useState(getBusinessTodayIso());
  const [validUntil, setValidUntil] = useState('');
  const [issuer, setIssuer] = useState('');
  const [renewalDueDate, setRenewalDueDate] = useState('');
  const [operationalNote, setOperationalNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [evidenceState, setEvidenceState] =
    useState<EvidenceState>('not_required');
  const [supersedesId, setSupersedesId] = useState<string | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [definitionFieldErrors, setDefinitionFieldErrors] = useState<{
    name?: string;
    warningDays?: string;
  }>({});
  const [grantFieldErrors, setGrantFieldErrors] = useState<{
    employee?: string;
    capability?: string;
    validFrom?: string;
    validUntil?: string;
  }>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const definitionById = useMemo(
    () => new Map(capabilities.map((capability) => [capability.id, capability])),
    [capabilities]
  );
  const employeeById = useMemo(
    () =>
      new Map(
        employees.map((employee) => [employee.employeeRecordId, employee])
      ),
    [employees]
  );
  const activeCapabilities = capabilities.filter(
    (capability) => !capability.retiredAt
  );
  const selectedDefinition = definitionById.get(capabilityId) ?? null;
  const isRecordIdentityLocked = Boolean(editingRecordId || supersedesId);

  const employeeOptions = useMemo(
    () =>
      employees.map((employee) => ({
        value: employee.employeeRecordId,
        label: employee.displayName,
      })),
    [employees]
  );
  const capabilityOptions = useMemo(
    () =>
      activeCapabilities.map((capability) => ({
        value: capability.id,
        label: `${capability.name} · ${getCapabilityKindLabel(capability.kind)}`,
      })),
    [activeCapabilities]
  );

  const refresh = () => startTransition(() => router.refresh());

  const resetGrantForm = () => {
    setEmployeeRecordId('');
    setCapabilityId('');
    setValidFrom(getBusinessTodayIso());
    setValidUntil('');
    setIssuer('');
    setRenewalDueDate('');
    setOperationalNote('');
    setConfirmed(false);
    setEvidenceState('not_required');
    setSupersedesId(null);
    setEditingRecordId(null);
    setGrantError(null);
    setGrantFieldErrors({});
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Organisationsvokabular</h2>
          <p className="text-sm text-muted-foreground">
            Lege nur Begriffe an, die ihr in der täglichen Planung verwendet.
            WerkFlow liefert keine rechtliche Bewertung.
          </p>
        </div>
        <Card className="grid gap-3 p-4 md:grid-cols-[180px_1fr_180px_auto]">
          <Field label="Art" htmlFor="capability-kind" className="min-w-0 gap-1.5">
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as CapabilityKind)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skill">Fähigkeit</SelectItem>
                <SelectItem value="certification">Zertifizierung</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Name"
            htmlFor="capability-name"
            required
            error={definitionFieldErrors.name}
            className="min-w-0 gap-1.5"
          >
            <Input
              value={definitionName}
              onChange={(event) => setDefinitionName(event.target.value)}
              placeholder="z. B. Wärmepumpen-Inbetriebnahme"
              maxLength={160}
            />
          </Field>
          <Field
            label="Hinweis vorher (Tage)"
            htmlFor="capability-warning-days"
            error={definitionFieldErrors.warningDays}
            className="min-w-0 gap-1.5"
          >
            <QuantityStepper
              min={0}
              value={kind === 'skill' ? '0' : warningDays}
              onChange={setWarningDays}
              disabled={kind === 'skill'}
            />
          </Field>
          <Button
            className="self-end"
            disabled={pendingAction !== null}
            onClick={async () => {
              setDefinitionError(null);
              const expiryWarningDays =
                kind === 'certification' ? parseDecimalInput(warningDays) : 0;
              const nextFieldErrors = {
                name: definitionName.trim() ? undefined : 'Bitte gib einen Namen an.',
                warningDays:
                  !Number.isInteger(expiryWarningDays) ||
                  expiryWarningDays < 0 ||
                  expiryWarningDays > 365
                    ? 'Bitte gib eine ganze Zahl zwischen 0 und 365 Tagen ein.'
                    : undefined,
              };
              setDefinitionFieldErrors(nextFieldErrors);
              if (nextFieldErrors.name || nextFieldErrors.warningDays) {
                document
                  .getElementById(
                    nextFieldErrors.name ? 'capability-name' : 'capability-warning-days'
                  )
                  ?.focus();
                return;
              }
              setPendingAction('create-definition');
              try {
                const result = await createCapability({
                  kind,
                  name: definitionName,
                  expiryWarningDays,
                });
                if (!result.success) {
                  setDefinitionError(
                    result.error === 'duplicate_name'
                      ? 'Dieser Begriff ist bereits vorhanden.'
                      : 'Der Begriff konnte nicht angelegt werden.'
                  );
                  return;
                }
                setDefinitionName('');
                showBanner({
                  variant: 'success',
                  message: 'Der Begriff wurde angelegt.',
                });
                refresh();
              } catch {
                setDefinitionError('Der Begriff konnte nicht angelegt werden.');
              } finally {
                setPendingAction(null);
              }
            }}
          >
            <Plus className="size-4" />
            Anlegen
          </Button>
          <div className="md:col-span-4">
            <ErrorText>{definitionError}</ErrorText>
          </div>
        </Card>

        <div className="divide-y rounded-lg border">
          {activeCapabilities.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Noch keine Fähigkeiten oder Zertifizierungen angelegt.
            </p>
          ) : (
            activeCapabilities.map((capability) => (
              <div
                key={capability.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
                data-testid="capability-definition-row"
                data-capability-name={capability.name}
              >
                <div className="min-w-0">
                  <p className="font-medium">{capability.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {getCapabilityKindLabel(capability.kind)}
                    {capability.kind === 'certification'
                      ? ' · Hinweis ' +
                        capability.defaultExpiryWarningDays +
                        ' Tage vorher'
                      : ''}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pendingAction !== null}
                  onClick={async () => {
                    setPendingAction(`retire:${capability.id}`);
                    try {
                      const result = await retireCapabilityDefinition(
                        capability.id
                      );
                      if (!result.success) {
                        showBanner({
                          variant: 'error',
                          message: 'Der Begriff konnte nicht archiviert werden.',
                        });
                        return;
                      }
                      showBanner({
                        variant: 'success',
                        message: 'Der Begriff wurde archiviert.',
                      });
                      refresh();
                    } catch {
                      showBanner({
                        variant: 'error',
                        message: 'Der Begriff konnte nicht archiviert werden.',
                      });
                    } finally {
                      setPendingAction(null);
                    }
                  }}
                >
                  Archivieren
                </Button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Eintrag zuordnen</h2>
          <p className="text-sm text-muted-foreground">
            „Bestätigt“ ist eine interne Prüfung und keine rechtliche Aussage.
            Nachweise werden in diesem Schritt nur als Status geführt.
          </p>
        </div>
        <Card className="grid gap-3 p-4 md:grid-cols-2">
          <Field
            label="Mitarbeiter"
            htmlFor="qualification-employee"
            required
            error={grantFieldErrors.employee}
            className="gap-1.5"
          >
            <SearchableSelect
              ariaLabel="Mitarbeiter für Qualifikation"
              options={employeeOptions}
              value={employeeRecordId}
              onChange={setEmployeeRecordId}
              disabled={isRecordIdentityLocked}
              placeholder="Mitarbeiter auswählen"
              searchPlaceholder="Mitarbeiter suchen …"
              emptyMessage="Kein Mitarbeiter gefunden"
            />
          </Field>
          <Field
            label="Fähigkeit oder Zertifizierung"
            htmlFor="qualification-capability"
            required
            error={grantFieldErrors.capability}
            className="gap-1.5"
          >
            <SearchableSelect
              ariaLabel="Qualifikation auswählen"
              options={capabilityOptions}
              value={capabilityId}
              onChange={setCapabilityId}
              disabled={isRecordIdentityLocked}
              placeholder="Begriff auswählen"
              searchPlaceholder="Begriff suchen …"
              emptyMessage="Kein Begriff gefunden"
            />
          </Field>
          <Field
            label="Gültig ab"
            htmlFor="qualification-valid-from"
            required
            error={grantFieldErrors.validFrom}
            className="gap-1.5"
          >
            <DatePicker
              ariaLabel="Qualifikation gültig ab"
              value={isoToLocalDate(validFrom)}
              onChange={(date) =>
                setValidFrom(date ? toLocalDateString(date) : '')
              }
            />
          </Field>
          <Field
            label="Gültig bis (optional)"
            htmlFor="qualification-valid-until"
            error={grantFieldErrors.validUntil}
            className="gap-1.5"
          >
            <DatePicker
              ariaLabel="Qualifikation gültig bis"
              value={isoToLocalDate(validUntil)}
              onChange={(date) =>
                setValidUntil(date ? toLocalDateString(date) : '')
              }
            />
          </Field>
          {selectedDefinition?.kind === 'certification' && (
            <>
              <Field label="Ausstellende Stelle" htmlFor="qualification-issuer" className="gap-1.5">
                <Input
                  value={issuer}
                  onChange={(event) => setIssuer(event.target.value)}
                />
              </Field>
              <Field
                label="Erneuerung vorgesehen (optional)"
                htmlFor="qualification-renewal-date"
                className="gap-1.5"
              >
                <DatePicker
                  ariaLabel="Erneuerung vorgesehen"
                  value={isoToLocalDate(renewalDueDate)}
                  onChange={(date) =>
                    setRenewalDueDate(date ? toLocalDateString(date) : '')
                  }
                />
              </Field>
              <Field label="Nachweisstatus" htmlFor="qualification-evidence-state" className="gap-1.5">
                <Select
                  value={evidenceState}
                  onValueChange={(value) =>
                    setEvidenceState(value as EvidenceState)
                  }
                >
                  <SelectTrigger aria-label="Nachweisstatus">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_required">Nicht erforderlich</SelectItem>
                    <SelectItem value="pending">Ausstehend</SelectItem>
                    <SelectItem value="received">Erhalten</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="qualification-confirmed"
                  checked={confirmed}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                />
                <Label htmlFor="qualification-confirmed">
                  Intern bestätigt
                </Label>
              </div>
            </>
          )}
          <Field
            label="Operativer Hinweis (optional)"
            htmlFor="qualification-operational-note"
            className="min-w-0 gap-1.5 md:col-span-2"
          >
            <Textarea
              className="min-w-0"
              value={operationalNote}
              onChange={(event) => setOperationalNote(event.target.value)}
              maxLength={1000}
              placeholder="Nur Hinweise für die interne Planung"
            />
          </Field>
          {supersedesId && (
            <p className="self-center text-sm text-muted-foreground">
              Erneuerung eines bestehenden Zertifizierungseintrags.
            </p>
          )}
          <div className="md:col-span-2">
            <ErrorText>{grantError}</ErrorText>
          </div>
          <div className="flex justify-end gap-2 md:col-span-2">
            {isRecordIdentityLocked && (
              <Button variant="ghost" onClick={resetGrantForm}>
                Abbrechen
              </Button>
            )}
            <Button
              disabled={pendingAction !== null}
              onClick={async () => {
                setGrantError(null);
                const nextFieldErrors = {
                  employee: employeeRecordId ? undefined : 'Bitte wähle einen Mitarbeiter aus.',
                  capability: capabilityId ? undefined : 'Bitte wähle einen Begriff aus.',
                  validFrom: validFrom ? undefined : 'Bitte gib ein Datum an.',
                  validUntil:
                    validUntil && validUntil < validFrom
                      ? '„Gültig bis“ darf nicht vor „Gültig ab“ liegen.'
                      : undefined,
                };
                setGrantFieldErrors(nextFieldErrors);
                const firstInvalidId = nextFieldErrors.employee
                  ? 'qualification-employee'
                  : nextFieldErrors.capability
                    ? 'qualification-capability'
                    : nextFieldErrors.validFrom
                      ? 'qualification-valid-from'
                      : nextFieldErrors.validUntil
                        ? 'qualification-valid-until'
                        : null;
                if (firstInvalidId) {
                  document.getElementById(firstInvalidId)?.focus();
                  return;
                }
                const sharedInput = {
                  validFrom,
                  validUntil: validUntil || null,
                  issuer,
                  renewalDueDate: renewalDueDate || null,
                  confirmationStatus: confirmed
                    ? ('confirmed' as const)
                    : ('unconfirmed' as const),
                  evidenceState,
                  operationalNote,
                };
                setPendingAction('save-record');
                try {
                  const result = editingRecordId
                    ? await updateEmployeeCapability({
                        recordId: editingRecordId,
                        ...sharedInput,
                      })
                    : await addEmployeeCapability({
                        employeeRecordId,
                        capabilityId,
                        ...sharedInput,
                        supersedesId,
                      });
                  if (!result.success) {
                    setGrantError(
                      result.error === 'overlap'
                        ? 'Der Zeitraum überschneidet sich mit einem bestehenden Eintrag.'
                        : 'Der Eintrag konnte nicht gespeichert werden.'
                    );
                    return;
                  }
                  resetGrantForm();
                  showBanner({
                    variant: 'success',
                    message: 'Der Eintrag wurde gespeichert.',
                  });
                  refresh();
                } catch {
                  setGrantError('Der Eintrag konnte nicht gespeichert werden.');
                } finally {
                  setPendingAction(null);
                }
              }}
            >
              {editingRecordId
                ? 'Änderungen speichern'
                : supersedesId
                  ? 'Erneuerung speichern'
                  : 'Eintrag speichern'}
            </Button>
          </div>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Aktuelle Einträge</h2>
        <div className="divide-y rounded-lg border">
          {employeeCapabilities.filter((record) => !record.supersededAt)
            .length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Noch keine Einträge zugeordnet.
            </p>
          ) : (
            employeeCapabilities
              .filter((record) => !record.supersededAt)
              .map((record) => {
                const definition = definitionById.get(record.capabilityId);
                const employee = employeeById.get(record.employeeRecordId);
                if (!definition || !employee) return null;
                return (
                  <div
                    key={record.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    data-testid="employee-capability-row"
                    data-employee-name={employee.displayName}
                    data-capability-name={definition.name}
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <Award className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="font-medium">
                          {definition.name} · {employee.displayName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          ab {record.validFrom}
                          {record.validUntil ? ' bis ' + record.validUntil : ''}
                          {definition.kind === 'certification'
                            ? ' · ' +
                              (record.confirmationStatus === 'confirmed'
                                ? 'intern bestätigt'
                                : 'nicht bestätigt') +
                              ' · Nachweis: ' +
                              (record.evidenceState === 'received'
                                ? 'erhalten'
                                : record.evidenceState === 'pending'
                                  ? 'ausstehend'
                                  : 'nicht erforderlich')
                            : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pendingAction !== null}
                        onClick={() => {
                          setEmployeeRecordId(record.employeeRecordId);
                          setCapabilityId(record.capabilityId);
                          setValidFrom(record.validFrom);
                          setValidUntil(record.validUntil ?? '');
                          setIssuer(record.issuer ?? '');
                          setRenewalDueDate(record.renewalDueDate ?? '');
                          setConfirmed(
                            record.confirmationStatus === 'confirmed'
                          );
                          setEvidenceState(record.evidenceState);
                          setOperationalNote(record.operationalNote ?? '');
                          setSupersedesId(null);
                          setEditingRecordId(record.id);
                          setGrantError(null);
                        }}
                      >
                        Bearbeiten
                      </Button>
                      {definition.kind === 'certification' && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pendingAction !== null}
                            onClick={async () => {
                              setPendingAction(`confirm:${record.id}`);
                              try {
                                const result = await updateEmployeeCapability({
                                  recordId: record.id,
                                  validFrom: record.validFrom,
                                  validUntil: record.validUntil,
                                  issuer: record.issuer,
                                  renewalDueDate: record.renewalDueDate,
                                  confirmationStatus:
                                    record.confirmationStatus === 'confirmed'
                                      ? 'unconfirmed'
                                      : 'confirmed',
                                  evidenceState: record.evidenceState,
                                  operationalNote: record.operationalNote,
                                });
                                if (!result.success) {
                                  showBanner({
                                    variant: 'error',
                                    message:
                                      'Die Bestätigung konnte nicht geändert werden.',
                                  });
                                  return;
                                }
                                showBanner({
                                  variant: 'success',
                                  message: 'Die Bestätigung wurde geändert.',
                                });
                                refresh();
                              } catch {
                                showBanner({
                                  variant: 'error',
                                  message:
                                    'Die Bestätigung konnte nicht geändert werden.',
                                });
                              } finally {
                                setPendingAction(null);
                              }
                            }}
                          >
                            {record.confirmationStatus === 'confirmed'
                              ? 'Bestätigung aufheben'
                              : 'Bestätigen'}
                          </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pendingAction !== null}
                          onClick={() => {
                            setEmployeeRecordId(record.employeeRecordId);
                            setCapabilityId(record.capabilityId);
                            setValidFrom(getBusinessTodayIso());
                            setValidUntil('');
                            setIssuer(record.issuer ?? '');
                            setRenewalDueDate('');
                            setOperationalNote(record.operationalNote ?? '');
                            setConfirmed(false);
                            setEvidenceState('pending');
                            setSupersedesId(record.id);
                            setEditingRecordId(null);
                            setGrantError(null);
                          }}
                        >
                          Erneuern
                        </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </section>

      <section className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div>
          <h2 className="text-sm font-semibold">Ausbildungs-Hinweis</h2>
          <p className="text-sm text-muted-foreground">
            Warnt, wenn eine Auswahl nur aus Personen mit Beschäftigungsart
            „Ausbildung“ besteht oder Angaben fehlen. Keine Quote, kein Block.
          </p>
        </div>
        <Checkbox
          checked={apprenticeWarningEnabled}
          disabled={!isAdmin || pendingAction !== null}
          aria-label="Ausbildungs-Hinweis aktivieren"
          onCheckedChange={async (checked) => {
            const enabled = checked === true;
            setPendingAction('apprentice-warning');
            try {
              const result = await setApprenticeWarningEnabled(enabled);
              if (!result.success) {
                showBanner({
                  variant: 'error',
                  message: 'Die Einstellung konnte nicht gespeichert werden.',
                });
                return;
              }
              showBanner({
                variant: 'success',
                message: 'Einstellung gespeichert.',
              });
              refresh();
            } catch {
              showBanner({
                variant: 'error',
                message: 'Die Einstellung konnte nicht gespeichert werden.',
              });
            } finally {
              setPendingAction(null);
            }
          }}
        />
      </section>
    </div>
  );
}
