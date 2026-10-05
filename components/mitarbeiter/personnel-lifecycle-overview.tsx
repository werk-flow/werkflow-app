'use client';

import { FileDown, Loader2, UserRoundCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import { ACCESS_STATE_LABELS, EMPLOYMENT_LIFECYCLE_LABELS } from '@/lib/personnel/lifecycle';

import { formatLifecycleDate } from './personnel-lifecycle-dates';
import type { PersonnelLifecycleTransitions } from './use-personnel-lifecycle-transitions';
import type { PersonnelLifecycleController } from './use-personnel-lifecycle-view';
import { SectionTitle } from '@/components/shared/section-title';

type PersonnelLifecycleHeaderProps = {
  lifecycle: PersonnelLifecycleController;
  canAdministerAccess: boolean;
};

export function PersonnelLifecycleHeader({ lifecycle, canAdministerAccess }: PersonnelLifecycleHeaderProps) {
  const { view, isPending, downloadManifest } = lifecycle;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionTitle as="h2" id="personnel-lifecycle-title" icon={<UserRoundCheck className="size-4" />}>
            Personalprozess
          </SectionTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Zugang, Onboarding und Übergänge bleiben getrennt und nachvollziehbar.
          </p>
        </div>
        {isPending ? (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-label="Änderung wird gespeichert"
          />
        ) : null}
        {canAdministerAccess ? (
          <Button size="sm" variant="outline" onClick={() => void downloadManifest()} disabled={isPending}>
            <FileDown className="size-4" /> Arbeitsstand exportieren
          </Button>
        ) : null}
      </div>

      <InlinePending active={view.isRefreshing} label="Personalprozess wird aktualisiert" />
      {view.isStale ? (
        <div className="flex flex-wrap items-center gap-2">
          <ErrorText>
            Der Personalprozess konnte nicht aktualisiert werden. Der zuletzt geladene Stand bleibt sichtbar.
            Bitte lade die Ansicht erneut.
          </ErrorText>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void view.refresh()}
            disabled={view.isRefreshing}
          >
            Erneut laden
          </Button>
        </div>
      ) : null}
    </>
  );
}

type PersonnelLifecycleStatusCardsProps = {
  lifecycle: PersonnelLifecycleController;
  transitions: PersonnelLifecycleTransitions;
  canAdministerAccess: boolean;
  hasUnresolvedWork: boolean;
};

export function PersonnelLifecycleStatusCards({
  lifecycle,
  transitions,
  canAdministerAccess,
  hasUnresolvedWork,
}: PersonnelLifecycleStatusCardsProps) {
  const { data, mutationDisabled, setError, setFieldErrors } = lifecycle;
  const { setAccessOpen, setEmploymentOpen } = transitions;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">Organisationszugang</span>
            <Badge
              variant={
                data.access.state === 'suspended' || data.access.state === 'ended'
                  ? 'destructive'
                  : 'secondary'
              }
            >
              {ACCESS_STATE_LABELS[data.access.state]}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {data.access.scheduledState
              ? `${ACCESS_STATE_LABELS[data.access.scheduledState]} ab ${formatLifecycleDate(data.access.scheduledFor)}`
              : data.access.storedState === null
                ? 'Noch keine kontrollierte Zugangsregel. Bestehender Mitgliedszugang bleibt unverändert.'
                : `Wirksam seit ${formatLifecycleDate(data.access.effectiveAt)}`}
          </p>
          {canAdministerAccess ? (
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              disabled={mutationDisabled}
              onClick={() => {
                setError(null);
                setFieldErrors({});
                setAccessOpen(true);
              }}
            >
              Zugang steuern
            </Button>
          ) : null}
        </div>

        <div className="rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">Beschäftigung</span>
            <Badge variant="secondary">
              {data.employment.state
                ? EMPLOYMENT_LIFECYCLE_LABELS[data.employment.state]
                : 'Nicht eingerichtet'}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {data.employment.scheduledState
              ? `${EMPLOYMENT_LIFECYCLE_LABELS[data.employment.scheduledState]} ab ${formatLifecycleDate(data.employment.scheduledFor)}`
              : data.employment.state
                ? `Wirksam seit ${formatLifecycleDate(data.employment.effectiveOn)}`
                : 'Eintritts- und Austrittsdaten bleiben bis zum ersten kontrollierten Übergang maßgeblich.'}
          </p>
          {canAdministerAccess ? (
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              disabled={mutationDisabled}
              onClick={() => {
                setError(null);
                setFieldErrors({});
                setEmploymentOpen(true);
              }}
            >
              Übergang erfassen
            </Button>
          ) : null}
        </div>
      </div>

      {hasUnresolvedWork ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
          <p className="font-medium">Vor einem Austritt prüfen</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.transitionInventory.activeJobs.length} aktive Auftragszuweisungen,{' '}
            {data.transitionInventory.strandedResponsibilities.length} nicht ersetzte Verantwortungen.
          </p>
        </div>
      ) : null}
    </>
  );
}
