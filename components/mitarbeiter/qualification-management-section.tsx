'use client';

import { useMemo, useState, useTransition } from 'react';
import { Award, Loader2, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<CapabilityKind>('skill');
  const [definitionName, setDefinitionName] = useState('');
  const [warningDays, setWarningDays] = useState('30');
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
        <Card className="grid gap-3 p-4 md:grid-cols-[180px_1fr_150px_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="capability-kind">Art</Label>
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as CapabilityKind)}
            >
              <SelectTrigger id="capability-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skill">Fähigkeit</SelectItem>
                <SelectItem value="certification">Zertifizierung</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="capability-name">Name</Label>
            <Input
              id="capability-name"
              value={definitionName}
              onChange={(event) => setDefinitionName(event.target.value)}
              placeholder="z. B. Wärmepumpen-Inbetriebnahme"
              maxLength={160}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="capability-warning-days">
              Hinweis vorher (Tage)
            </Label>
            <Input
              id="capability-warning-days"
              type="number"
              min={0}
              max={365}
              value={kind === 'skill' ? '0' : warningDays}
              onChange={(event) => setWarningDays(event.target.value)}
              disabled={kind === 'skill'}
            />
          </div>
          <Button
            className="self-end"
            disabled={!definitionName.trim() || pendingAction !== null}
            onClick={async () => {
              const expiryWarningDays =
                kind === 'certification' ? Number(warningDays) : 0;
              if (
                !Number.isInteger(expiryWarningDays) ||
                expiryWarningDays < 0 ||
                expiryWarningDays > 365
              ) {
                toast.error('Bitte gib eine ganze Zahl zwischen 0 und 365 Tagen ein.');
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
                  toast.error(
                    result.error === 'duplicate_name'
                      ? 'Dieser Begriff ist bereits vorhanden.'
                      : 'Der Begriff konnte nicht angelegt werden.'
                  );
                  return;
                }
                setDefinitionName('');
                refresh();
              } catch {
                toast.error('Der Begriff konnte nicht angelegt werden.');
              } finally {
                setPendingAction(null);
              }
            }}
          >
            <Plus className="size-4" />
            Anlegen
          </Button>
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
                <div>
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
                  onClick={async () => {
                    const result = await retireCapabilityDefinition(
                      capability.id
                    );
                    if (!result.success) {
                      toast.error('Der Begriff konnte nicht archiviert werden.');
                      return;
                    }
                    refresh();
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
          <div className="space-y-1.5">
            <Label>Mitarbeiter</Label>
            <Select
              value={employeeRecordId}
              onValueChange={setEmployeeRecordId}
              disabled={isRecordIdentityLocked}
            >
              <SelectTrigger aria-label="Mitarbeiter für Qualifikation">
                <SelectValue placeholder="Mitarbeiter auswählen" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((employee) => (
                  <SelectItem
                    key={employee.employeeRecordId}
                    value={employee.employeeRecordId}
                  >
                    {employee.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Fähigkeit oder Zertifizierung</Label>
            <Select
              value={capabilityId}
              onValueChange={setCapabilityId}
              disabled={isRecordIdentityLocked}
            >
              <SelectTrigger aria-label="Qualifikation auswählen">
                <SelectValue placeholder="Begriff auswählen" />
              </SelectTrigger>
              <SelectContent>
                {activeCapabilities.map((capability) => (
                  <SelectItem key={capability.id} value={capability.id}>
                    {capability.name} · {getCapabilityKindLabel(capability.kind)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qualification-valid-from">Gültig ab</Label>
            <Input
              id="qualification-valid-from"
              type="date"
              value={validFrom}
              onChange={(event) => setValidFrom(event.target.value)}
              aria-label="Qualifikation gültig ab"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qualification-valid-until">
              Gültig bis (optional)
            </Label>
            <Input
              id="qualification-valid-until"
              type="date"
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
              aria-label="Qualifikation gültig bis"
            />
          </div>
          {selectedDefinition?.kind === 'certification' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="qualification-issuer">Ausstellende Stelle</Label>
                <Input
                  id="qualification-issuer"
                  value={issuer}
                  onChange={(event) => setIssuer(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qualification-renewal-date">
                  Erneuerung vorgesehen (optional)
                </Label>
                <Input
                  id="qualification-renewal-date"
                  type="date"
                  value={renewalDueDate}
                  onChange={(event) => setRenewalDueDate(event.target.value)}
                  aria-label="Erneuerung vorgesehen"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Nachweisstatus</Label>
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
              </div>
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
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="qualification-operational-note">
              Operativer Hinweis (optional)
            </Label>
            <Textarea
              id="qualification-operational-note"
              value={operationalNote}
              onChange={(event) => setOperationalNote(event.target.value)}
              maxLength={1000}
              placeholder="Nur Hinweise für die interne Planung"
            />
          </div>
          {supersedesId && (
            <p className="self-center text-sm text-muted-foreground">
              Erneuerung eines bestehenden Zertifizierungseintrags.
            </p>
          )}
          <div className="flex justify-end gap-2 md:col-span-2">
            {isRecordIdentityLocked && (
              <Button variant="ghost" onClick={resetGrantForm}>
                Abbrechen
              </Button>
            )}
            <Button
              disabled={
                !employeeRecordId ||
                !capabilityId ||
                !validFrom ||
                pendingAction !== null
              }
              onClick={async () => {
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
                    toast.error(
                      result.error === 'overlap'
                        ? 'Der Zeitraum überschneidet sich mit einem bestehenden Eintrag.'
                        : 'Der Eintrag konnte nicht gespeichert werden.'
                    );
                    return;
                  }
                  resetGrantForm();
                  refresh();
                } catch {
                  toast.error('Der Eintrag konnte nicht gespeichert werden.');
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
                    <div className="flex items-start gap-2">
                      <Award className="mt-0.5 size-4 text-muted-foreground" />
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
                        }}
                      >
                        Bearbeiten
                      </Button>
                      {definition.kind === 'certification' && (
                        <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
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
                              toast.error(
                                'Die Bestätigung konnte nicht geändert werden.'
                              );
                              return;
                            }
                            refresh();
                          }}
                        >
                          {record.confirmationStatus === 'confirmed'
                            ? 'Bestätigung aufheben'
                            : 'Bestätigen'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
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
          disabled={!isAdmin}
          aria-label="Ausbildungs-Hinweis aktivieren"
          onCheckedChange={async (checked) => {
            const enabled = checked === true;
            const result = await setApprenticeWarningEnabled(enabled);
            if (!result.success) {
              toast.error(
                isAdmin
                  ? 'Die Einstellung konnte nicht gespeichert werden.'
                  : 'Nur Admins können diese Einstellung ändern.'
              );
              return;
            }
            refresh();
          }}
        />
      </section>

      {isPending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Ansicht wird aktualisiert…
        </p>
      )}
    </div>
  );
}
