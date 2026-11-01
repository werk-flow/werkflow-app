'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { OwnResponsibilitySummary } from '@/components/settings/own-responsibility-summary';
import {
  ResponsibilityEffectPreview,
  ResponsibilityHolderChecklist,
} from '@/components/settings/responsibility-configuration-sections';
import { DelegationDialog } from '@/components/settings/responsibility-delegation-dialog';
import { DelegationList } from '@/components/settings/responsibility-delegation-list';
import { holderSourceLabel, personName } from '@/components/settings/responsibility-display';
import { useResponsibilityConfigurationForm } from '@/components/settings/use-responsibility-configuration-form';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';
import type { ResponsibilitySettingsData } from '@/lib/responsibilities/server';
import {
  ORGANIZATION_RESPONSIBILITIES,
  RESPONSIBILITY_DESCRIPTIONS,
  RESPONSIBILITY_LABELS,
  type OrganizationResponsibility,
  type ResponsibilityPerson,
} from '@/lib/responsibilities/types';
import { Constants } from '@/lib/supabase/database.types';

export function ResponsibilitySettings({ data }: { data: ResponsibilitySettingsData }) {
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
        (holder) => holder.employeeRecordId === data.currentEmployeeRecordId,
      ),
    ) ||
      data.delegations.some(
        (delegation) =>
          delegation.delegatorEmployeeRecordId === data.currentEmployeeRecordId ||
          delegation.substituteEmployeeRecordId === data.currentEmployeeRecordId,
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
            Für dich sind derzeit keine Verantwortlichkeiten oder Vertretungen eingetragen.
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
            Feste Rollen bleiben verständlich. Einzelne Freigaben können gezielt übertragen werden, ohne
            weitere Verwaltungsrechte zu vergeben.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Änderungen gelten ab der Speicherung. Vergangene Zuständigkeiten und Vertretungszeiträume bleiben
            im Verlauf erhalten.
          </p>
        </CardContent>
      </Card>

      {ORGANIZATION_RESPONSIBILITIES.map((responsibility) => (
        <ResponsibilityCard key={responsibility} data={data} responsibility={responsibility} />
      ))}
    </div>
  );
}

function CurrentHolderSection({
  people,
  holders,
}: {
  people: ResponsibilityPerson[];
  holders: EffectiveResponsibilityHolder[];
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Aktuell verantwortlich</h3>
      <ul className="grid gap-2">
        {holders.length > 0 ? (
          holders.map((holder) => (
            <li
              key={holder.employeeRecordId}
              className="flex flex-col gap-1 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-sm font-medium">{personName(people, holder.employeeRecordId)}</span>
              <span className="text-xs text-muted-foreground">{holderSourceLabel(holder)}</span>
            </li>
          ))
        ) : (
          <li className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
            Aktuell ist keine aktive Person verfügbar. Bitte prüfe die Verantwortlichkeit.
          </li>
        )}
      </ul>
    </section>
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
            <CardDescription>{RESPONSIBILITY_DESCRIPTIONS[responsibility]}</CardDescription>
          </div>
          <Badge variant="secondary">
            {effective.mode === 'role_default' ? 'Standardrollen' : 'Bestimmte Personen'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 wrap-anywhere">
        <CurrentHolderSection people={data.people} holders={effective.holders} />

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Vertretungen</h3>
          {delegations.length === 0 ? (
            <EmptyState size="compact" title="Keine Vertretung eingetragen." />
          ) : (
            <DelegationList data={data} delegations={delegations} canEdit={canEdit} />
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
            <Button type="button" variant="outline" onClick={() => setDelegationOpen(true)}>
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
  const {
    mode,
    selectedIds,
    preview,
    isLoadingPreview,
    isSaving,
    changeMode,
    togglePerson,
    handleOpenChange,
    handlePreview,
    handleSave,
  } = useResponsibilityConfigurationForm({ data, responsibility, onOpenChange });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} pending={isSaving || isLoadingPreview}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{RESPONSIBILITY_LABELS[responsibility]} ändern</DialogTitle>
          <DialogDescription>
            Wähle zuerst die Regel. Danach zeigt WerkFlow die effektive Wirkung, bevor etwas gespeichert wird.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Verantwortliche Personen" htmlFor={`${responsibility}-mode`}>
            <Select
              value={mode}
              onValueChange={(value) => {
                const nextMode = Constants.public.Enums.responsibility_configuration_mode.find(
                  (candidate) => candidate === value,
                );
                if (nextMode) changeMode(nextMode);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="role_default">Standardrollen: Admin und Büro</SelectItem>
                <SelectItem value="selected">Bestimmte Personen</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {mode === 'selected' ? (
            <ResponsibilityHolderChecklist
              responsibility={responsibility}
              people={data.people}
              selectedIds={selectedIds}
              onToggle={togglePerson}
            />
          ) : null}

          {preview ? <ResponsibilityEffectPreview preview={preview} people={data.people} /> : null}
        </div>

        <ConfigurationDialogFooter
          hasPreview={preview !== null}
          isSaving={isSaving}
          isLoadingPreview={isLoadingPreview}
          onCancel={() => handleOpenChange(false)}
          onPreview={handlePreview}
          onSave={handleSave}
        />
      </DialogContent>
    </Dialog>
  );
}

function ConfigurationDialogFooter({
  hasPreview,
  isSaving,
  isLoadingPreview,
  onCancel,
  onPreview,
  onSave,
}: {
  hasPreview: boolean;
  isSaving: boolean;
  isLoadingPreview: boolean;
  onCancel: () => void;
  onPreview: () => Promise<void>;
  onSave: () => Promise<void>;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving || isLoadingPreview}>
        Abbrechen
      </Button>
      {hasPreview ? (
        <Button pending={isSaving} type="button" disabled={isSaving} onClick={() => void onSave()}>
          Änderung bestätigen
        </Button>
      ) : (
        <Button
          pending={isLoadingPreview}
          type="button"
          disabled={isLoadingPreview}
          onClick={() => void onPreview()}
        >
          Wirkung prüfen
        </Button>
      )}
    </DialogFooter>
  );
}
