'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Loader2, ShieldCheck } from 'lucide-react';

import { useBanner } from '@/components/ui/banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import {
  applyResponsibilityConfiguration,
  createResponsibilityDelegation,
  endResponsibilityDelegation,
  previewResponsibilityConfiguration,
  type ResponsibilityPreview,
} from '@/lib/responsibilities/actions';
import type {
  EffectiveResponsibilityHolder,
  ResponsibilityDelegation,
} from '@/lib/responsibilities/resolution';
import type { ResponsibilitySettingsData } from '@/lib/responsibilities/server';
import {
  formatResponsibilityPersonName,
  ORGANIZATION_RESPONSIBILITIES,
  RESPONSIBILITY_DESCRIPTIONS,
  RESPONSIBILITY_LABELS,
  type OrganizationResponsibility,
  type ResponsibilityConfigurationMode,
  type ResponsibilityPerson,
} from '@/lib/responsibilities/types';
import { ROLE_LABELS } from '@/lib/roles';
import { toLocalDateString } from '@/lib/utils';

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'Nur der Admin kann Verantwortlichkeiten ändern.',
  organization_not_found: 'Die aktive Organisation wurde nicht gefunden.',
  load_failed: 'Die Verantwortlichkeiten konnten nicht geladen werden.',
  responsibility_configuration_changed:
    'Die Verantwortlichkeit wurde zwischenzeitlich geändert. Bitte prüfe die aktuelle Wirkung erneut.',
  responsibility_requires_active_holder:
    'Mindestens eine aktive Person muss verantwortlich bleiben.',
  responsibility_holder_not_active_member:
    'Eine ausgewählte Person ist kein aktives Organisationsmitglied mehr.',
  responsibility_delegation_invalid_dates:
    'Bitte wähle einen gültigen Zeitraum ab heute.',
  responsibility_delegator_not_current_holder:
    'Die vertretene Person trägt diese Verantwortung nicht mehr.',
  responsibility_substitute_not_active_member:
    'Die Vertretung ist kein aktives Organisationsmitglied mehr.',
  responsibility_delegation_same_person:
    'Verantwortliche Person und Vertretung müssen verschieden sein.',
  responsibility_delegation_overlap:
    'Für diese Vertretung besteht in diesem Zeitraum bereits eine Überschneidung.',
  responsibility_delegation_not_found:
    'Die Vertretung wurde nicht gefunden.',
  save_failed: 'Die Änderung konnte nicht gespeichert werden.',
};

function personName(
  people: ResponsibilityPerson[],
  employeeRecordId: string
): string {
  const person = people.find(
    (candidate) => candidate.employeeRecordId === employeeRecordId
  );
  return person ? formatResponsibilityPersonName(person) : 'Unbekannte Person';
}

function formatDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString('de-DE');
}

function holderSourceLabel(holder: EffectiveResponsibilityHolder): string {
  if (holder.source.kind === 'direct_assignment') return 'Direkt zugewiesen';
  if (holder.source.kind === 'delegation') {
    return `Vertretung bis ${formatDate(holder.source.validUntil)}`;
  }
  return `Standard: ${ROLE_LABELS[holder.source.role]}`;
}

function isoToDate(value: string): Date | undefined {
  if (!value) return undefined;
  return new Date(`${value}T12:00:00`);
}

export function ResponsibilitySettings({
  data,
}: {
  data: ResponsibilitySettingsData;
}) {
  useRealtimeRouterRefresh({
    tables: [
      'organization_responsibility_configurations',
      'organization_responsibility_assignments',
      'organization_responsibility_delegations',
      'organization_members',
      'employee_records',
    ],
  });

  const isCurrentUserAffected =
    data.currentEmployeeRecordId !== null &&
    (ORGANIZATION_RESPONSIBILITIES.some((responsibility) =>
      data.effective[responsibility].holders.some(
        (holder) => holder.employeeRecordId === data.currentEmployeeRecordId
      )
    ) ||
      data.delegations.some(
        (delegation) =>
          delegation.delegatorEmployeeRecordId ===
            data.currentEmployeeRecordId ||
          delegation.substituteEmployeeRecordId === data.currentEmployeeRecordId
      ));

  if (data.currentUserRole === 'employee') {
    return isCurrentUserAffected ? (
      <OwnResponsibilitySummary data={data} />
    ) : (
      <Card>
        <CardHeader>
          <CardTitle>Meine Verantwortlichkeiten und Vertretungen</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Für dich sind derzeit keine Verantwortlichkeiten oder Vertretungen
            eingetragen.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {isCurrentUserAffected ? <OwnResponsibilitySummary data={data} /> : null}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-muted-foreground" />
            Verantwortlichkeiten und Freigaben
          </CardTitle>
          <CardDescription>
            Feste Rollen bleiben verständlich. Einzelne Freigaben können
            gezielt übertragen werden, ohne weitere Verwaltungsrechte zu
            vergeben.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Änderungen gelten ab der Speicherung. Vergangene Zuständigkeiten
            und Vertretungszeiträume bleiben im Verlauf erhalten.
          </p>
        </CardContent>
      </Card>

      {ORGANIZATION_RESPONSIBILITIES.map((responsibility) => (
        <ResponsibilityCard
          key={responsibility}
          data={data}
          responsibility={responsibility}
        />
      ))}
    </div>
  );
}

function OwnResponsibilitySummary({
  data,
}: {
  data: ResponsibilitySettingsData;
}) {
  const ownRecordId = data.currentEmployeeRecordId;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Meine Verantwortlichkeiten und Vertretungen</CardTitle>
        <CardDescription>
          Hier siehst du Freigaben und Vertretungen, die dich betreffen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {ORGANIZATION_RESPONSIBILITIES.map((responsibility) => {
          const holder = data.effective[responsibility].holders.find(
            (candidate) => candidate.employeeRecordId === ownRecordId
          );
          const relatedDelegations = data.delegations.filter(
            (delegation) =>
              delegation.responsibility === responsibility &&
              (delegation.delegatorEmployeeRecordId === ownRecordId ||
                delegation.substituteEmployeeRecordId === ownRecordId)
          );
          return (
            <section key={responsibility} className="space-y-2 border-b pb-5 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium">
                  {RESPONSIBILITY_LABELS[responsibility]}
                </h2>
                <Badge variant={holder ? 'default' : 'secondary'}>
                  {holder ? 'Aktuell verantwortlich' : 'Nicht verantwortlich'}
                </Badge>
              </div>
              {holder ? (
                <p className="text-sm text-muted-foreground">
                  {holderSourceLabel(holder)}
                </p>
              ) : null}
              {relatedDelegations.map((delegation) => (
                <p key={delegation.id} className="text-sm text-muted-foreground">
                  {delegation.substituteEmployeeRecordId === ownRecordId
                    ? `Vertretung für ${personName(data.people, delegation.delegatorEmployeeRecordId)}`
                    : `Vertreten durch ${personName(data.people, delegation.substituteEmployeeRecordId)}`}{' '}
                  vom {formatDate(delegation.validFrom)} bis{' '}
                  {formatDate(delegation.validUntil)}
                </p>
              ))}
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ResponsibilityCard({
  data,
  responsibility,
}: {
  data: ResponsibilitySettingsData;
  responsibility: OrganizationResponsibility;
}) {
  const effective = data.effective[responsibility];
  const delegations = data.delegations
    .filter((delegation) => delegation.responsibility === responsibility)
    .toSorted((left, right) => right.validFrom.localeCompare(left.validFrom));
  const canEdit = data.isOwner;
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [delegationOpen, setDelegationOpen] = useState(false);

  return (
    <Card data-testid={`responsibility-${responsibility}`}>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle>{RESPONSIBILITY_LABELS[responsibility]}</CardTitle>
            <CardDescription>
              {RESPONSIBILITY_DESCRIPTIONS[responsibility]}
            </CardDescription>
          </div>
          <Badge variant="secondary">
            {effective.mode === 'role_default'
              ? 'Standardrollen'
              : 'Bestimmte Personen'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Aktuell verantwortlich</h3>
          <ul className="grid gap-2">
            {effective.holders.length > 0 ? (
              effective.holders.map((holder) => (
                <li
                  key={holder.employeeRecordId}
                  className="flex flex-col gap-1 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-sm font-medium">
                    {personName(data.people, holder.employeeRecordId)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {holderSourceLabel(holder)}
                  </span>
                </li>
              ))
            ) : (
              <li className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                Aktuell ist keine aktive Person verfügbar. Bitte prüfe die
                Verantwortlichkeit.
              </li>
            )}
          </ul>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Vertretungen</h3>
          {delegations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine Vertretung eingetragen.
            </p>
          ) : (
            <DelegationList
              data={data}
              delegations={delegations}
              canEdit={canEdit}
            />
          )}
        </section>
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-3 border-t sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? 'Vor dem Speichern wird die effektive Wirkung angezeigt.'
            : 'Du kannst die Regel einsehen. Nur der Admin kann sie ändern.'}
        </p>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDelegationOpen(true)}
            >
              Vertretung eintragen
            </Button>
            <Button type="button" onClick={() => setConfigurationOpen(true)}>
              Verantwortung ändern
            </Button>
          </div>
        ) : null}
      </CardFooter>

      <ConfigurationDialog
        key={`configuration-${effective.configurationId ?? 'default'}`}
        data={data}
        responsibility={responsibility}
        open={configurationOpen}
        onOpenChange={setConfigurationOpen}
      />
      <DelegationDialog
        key={`delegation-${effective.configurationId ?? 'default'}`}
        data={data}
        responsibility={responsibility}
        open={delegationOpen}
        onOpenChange={setDelegationOpen}
      />
    </Card>
  );
}

function DelegationList({
  data,
  delegations,
  canEdit,
}: {
  data: ResponsibilitySettingsData;
  delegations: ResponsibilityDelegation[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [endingId, setEndingId] = useState<string | null>(null);

  const handleEnd = async (delegationId: string) => {
    setEndingId(delegationId);
    try {
      const result = await endResponsibilityDelegation(delegationId);
      if (!result.success) {
        showBanner({
          message: ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.save_failed,
          variant: 'error',
        });
        return;
      }
      router.refresh();
      showBanner({ message: 'Die Vertretung wurde beendet.', variant: 'success' });
    } catch (error) {
      console.error('Unexpected error ending responsibility delegation:', error);
      showBanner({ message: ERROR_MESSAGES.save_failed, variant: 'error' });
    } finally {
      setEndingId(null);
    }
  };

  return (
    <ul className="grid gap-2">
      {delegations.map((delegation) => {
        const effectiveUntil = delegation.revokedFrom
          ? delegation.revokedFrom
          : delegation.validUntil;
        const isEnded =
          effectiveUntil < data.businessDate ||
          delegation.revokedFrom === data.businessDate;
        return (
          <li
            key={delegation.id}
            className="flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="text-sm">
              <p className="font-medium">
                {personName(
                  data.people,
                  delegation.substituteEmployeeRecordId
                )}
              </p>
              <p className="text-muted-foreground">
                Für{' '}
                {personName(data.people, delegation.delegatorEmployeeRecordId)} ·{' '}
                {formatDate(delegation.validFrom)}–{formatDate(delegation.validUntil)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={isEnded ? 'secondary' : 'outline'}>
                {isEnded ? 'Beendet' : 'Zeitlich begrenzt'}
              </Badge>
              {canEdit && !isEnded ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={endingId !== null}
                  onClick={() => void handleEnd(delegation.id)}
                >
                  {endingId === delegation.id
                    ? 'Wird beendet…'
                    : 'Heute beenden'}
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ConfigurationDialog({
  data,
  responsibility,
  open,
  onOpenChange,
}: {
  data: ResponsibilitySettingsData;
  responsibility: OrganizationResponsibility;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const current = data.effective[responsibility];
  const baseHolderIds = useMemo(
    () =>
      current.holders
        .filter((holder) => holder.source.kind !== 'delegation')
        .map((holder) => holder.employeeRecordId),
    [current.holders]
  );
  const [mode, setMode] = useState<ResponsibilityConfigurationMode>(
    current.mode
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(baseHolderIds);
  const [preview, setPreview] = useState<ResponsibilityPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const reset = () => {
    setMode(current.mode);
    setSelectedIds(baseHolderIds);
    setPreview(null);
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const handlePreview = async () => {
    setIsLoadingPreview(true);
    try {
      const result = await previewResponsibilityConfiguration({
        responsibility,
        mode,
        employeeRecordIds: mode === 'selected' ? selectedIds : [],
      });
      if (!result.success) {
        showBanner({
          message: ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.save_failed,
          variant: 'error',
        });
        return;
      }
      setPreview(result.preview);
    } catch (error) {
      console.error('Unexpected error previewing responsibility configuration:', error);
      showBanner({ message: ERROR_MESSAGES.save_failed, variant: 'error' });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleSave = async () => {
    if (!preview) return;
    setIsSaving(true);
    try {
      const result = await applyResponsibilityConfiguration({
        responsibility,
        mode,
        employeeRecordIds: mode === 'selected' ? selectedIds : [],
        expectedConfigurationId: preview.expectedConfigurationId,
      });
      if (!result.success) {
        showBanner({
          message: ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.save_failed,
          variant: 'error',
        });
        return;
      }
      handleOpenChange(false);
      router.refresh();
      showBanner({
        message: `${RESPONSIBILITY_LABELS[responsibility]} wurden gespeichert.`,
        variant: 'success',
      });
    } catch (error) {
      console.error('Unexpected error applying responsibility configuration:', error);
      showBanner({ message: ERROR_MESSAGES.save_failed, variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{RESPONSIBILITY_LABELS[responsibility]} ändern</DialogTitle>
          <DialogDescription>
            Wähle zuerst die Regel. Danach zeigt WerkFlow die effektive Wirkung,
            bevor etwas gespeichert wird.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor={`${responsibility}-mode`}>Verantwortliche Personen</Label>
            <Select
              value={mode}
              onValueChange={(value) => {
                setMode(value as ResponsibilityConfigurationMode);
                setPreview(null);
              }}
            >
              <SelectTrigger id={`${responsibility}-mode`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="role_default">
                  Standardrollen: Admin und Büro
                </SelectItem>
                <SelectItem value="selected">Bestimmte Personen</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === 'selected' ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Personen auswählen</legend>
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2">
                {data.people.map((person) => {
                  const checked = selectedIds.includes(person.employeeRecordId);
                  const checkboxId = `${responsibility}-${person.employeeRecordId}`;
                  return (
                    <label
                      key={person.employeeRecordId}
                      htmlFor={checkboxId}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={checked}
                        onCheckedChange={(nextChecked) => {
                          setSelectedIds((currentIds) =>
                            nextChecked
                              ? [...currentIds, person.employeeRecordId]
                              : currentIds.filter(
                                  (id) => id !== person.employeeRecordId
                                )
                          );
                          setPreview(null);
                        }}
                      />
                      <span className="min-w-0 text-sm">
                        <span className="font-medium">
                          {formatResponsibilityPersonName(person)}
                        </span>{' '}
                        <span className="text-muted-foreground">
                          · {ROLE_LABELS[person.role]}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          {preview ? (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3" data-testid="effective-access-preview">
              <div>
                <p className="text-sm font-medium">Wirkung ab heute</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(preview.businessDate)} · erst nach Bestätigung
                </p>
              </div>
              <PreviewNames
                label="Erhält Zugriff"
                testId="preview-gained"
                ids={preview.gainedHolderIds}
                people={data.people}
                emptyLabel="Niemand zusätzlich"
              />
              <PreviewNames
                label="Verliert Zugriff"
                testId="preview-lost"
                ids={preview.lostHolderIds}
                people={data.people}
                emptyLabel="Niemand"
              />
              <PreviewNames
                label="Danach verantwortlich"
                testId="preview-effective"
                ids={preview.effectiveHolderIds}
                people={data.people}
              />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Abbrechen
          </Button>
          {preview ? (
            <Button type="button" disabled={isSaving} onClick={() => void handleSave()}>
              {isSaving && <Loader2 className="animate-spin" />}
              Änderung bestätigen
            </Button>
          ) : (
            <Button
              type="button"
              disabled={isLoadingPreview}
              onClick={() => void handlePreview()}
            >
              {isLoadingPreview && <Loader2 className="animate-spin" />}
              Wirkung prüfen
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewNames({
  label,
  testId,
  ids,
  people,
  emptyLabel = 'Niemand',
}: {
  label: string;
  testId: string;
  ids: string[];
  people: ResponsibilityPerson[];
  emptyLabel?: string;
}) {
  return (
    <div className="text-sm" data-testid={testId}>
      <p className="font-medium">{label}</p>
      <p className="text-muted-foreground">
        {ids.length > 0
          ? ids.map((id) => personName(people, id)).join(', ')
          : emptyLabel}
      </p>
    </div>
  );
}

function DelegationDialog({
  data,
  responsibility,
  open,
  onOpenChange,
}: {
  data: ResponsibilitySettingsData;
  responsibility: OrganizationResponsibility;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const baseHolders = data.effective[responsibility].holders.filter(
    (holder) => holder.source.kind !== 'delegation'
  );
  const [delegatorId, setDelegatorId] = useState(
    baseHolders[0]?.employeeRecordId ?? ''
  );
  const [substituteId, setSubstituteId] = useState('');
  const [validFrom, setValidFrom] = useState(data.businessDate);
  const [validUntil, setValidUntil] = useState(data.businessDate);
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const hasInvalidDateRange = validUntil < validFrom;
  const canSave =
    Boolean(delegatorId) && Boolean(substituteId) && !hasInvalidDateRange;

  const reset = () => {
    setDelegatorId(baseHolders[0]?.employeeRecordId ?? '');
    setSubstituteId('');
    setValidFrom(data.businessDate);
    setValidUntil(data.businessDate);
    setNote('');
    setSaveError(null);
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (hasInvalidDateRange || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await createResponsibilityDelegation({
        responsibility,
        delegatorEmployeeRecordId: delegatorId,
        substituteEmployeeRecordId: substituteId,
        validFrom,
        validUntil,
        note,
      });
      if (!result.success) {
        setSaveError(ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.save_failed);
        return;
      }
      handleOpenChange(false);
      router.refresh();
      showBanner({ message: 'Die Vertretung wurde eingetragen.', variant: 'success' });
    } catch (error) {
      console.error('Unexpected error creating responsibility delegation:', error);
      setSaveError(ERROR_MESSAGES.save_failed);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Vertretung für {RESPONSIBILITY_LABELS[responsibility]}</DialogTitle>
          <DialogDescription>
            Die verantwortliche Person behält ihre Freigabe. Die Vertretung
            erhält sie nur im gewählten Zeitraum.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} noValidate className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor={`${responsibility}-delegator`}>Verantwortliche Person</Label>
            <SearchableSelect
              id={`${responsibility}-delegator`}
              options={baseHolders.map((holder) => ({
                value: holder.employeeRecordId,
                label: personName(data.people, holder.employeeRecordId),
              }))}
              value={delegatorId}
              onChange={setDelegatorId}
              placeholder="Person wählen"
              searchPlaceholder="Person suchen …"
              emptyMessage="Keine Person gefunden"
            />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor={`${responsibility}-substitute`}>Vertretung</Label>
            <SearchableSelect
              id={`${responsibility}-substitute`}
              options={data.people
                .filter((person) => person.employeeRecordId !== delegatorId)
                .map((person) => ({
                  value: person.employeeRecordId,
                  label: formatResponsibilityPersonName(person),
                }))}
              value={substituteId}
              onChange={setSubstituteId}
              placeholder="Vertretung wählen"
              searchPlaceholder="Person suchen …"
              emptyMessage="Keine Person gefunden"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${responsibility}-valid-from`}>Gültig ab</Label>
            <DatePicker
              id={`${responsibility}-valid-from`}
              ariaLabel="Gültig ab"
              value={isoToDate(validFrom)}
              onChange={(date) => date && setValidFrom(toLocalDateString(date))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${responsibility}-valid-until`}>Gültig bis</Label>
            <DatePicker
              id={`${responsibility}-valid-until`}
              ariaLabel="Gültig bis"
              value={isoToDate(validUntil)}
              onChange={(date) => date && setValidUntil(toLocalDateString(date))}
            />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor={`${responsibility}-delegation-note`}>Hinweis (optional)</Label>
            <Textarea
              id={`${responsibility}-delegation-note`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Zum Beispiel: Urlaubsvertretung"
              maxLength={500}
            />
          </div>
          {canSave ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm sm:col-span-2">
              <p className="flex items-center gap-2 font-medium">
                <CalendarClock className="size-4" /> Wirkung
              </p>
              <p className="mt-1 text-muted-foreground">
                Die Vertretung gilt einschließlich {formatDate(validFrom)} und{' '}
                {formatDate(validUntil)}. Ab dem Folgetag endet der Zugriff
                automatisch.
              </p>
            </div>
          ) : null}
          <ErrorText className="sm:col-span-2">
            {hasInvalidDateRange
              ? 'Das Enddatum darf nicht vor dem Startdatum liegen.'
              : null}
          </ErrorText>
          <ErrorText className="sm:col-span-2">{saveError}</ErrorText>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={isSaving || !canSave}>
              {isSaving && <Loader2 className="animate-spin" />}
              Vertretung speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
