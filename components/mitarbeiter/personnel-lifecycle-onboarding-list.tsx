'use client';

import { Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import type { PersonnelLifecycleView } from '@/lib/personnel/lifecycle-actions';
import { REQUIREMENT_STATE_LABELS } from '@/lib/personnel/lifecycle';

import { formatLifecycleDate } from './personnel-lifecycle-dates';
import type {
  PersonnelLifecyclePlan,
  PersonnelLifecycleRequirements,
} from './use-personnel-lifecycle-onboarding';
import type { PersonnelLifecycleController } from './use-personnel-lifecycle-view';

type PersonnelLifecycleOnboardingListProps = {
  lifecycle: PersonnelLifecycleController;
  plan: PersonnelLifecyclePlan;
  requirements: PersonnelLifecycleRequirements;
  canManage: boolean;
};

export function PersonnelLifecycleOnboardingList({
  lifecycle,
  plan,
  requirements,
  canManage,
}: PersonnelLifecycleOnboardingListProps) {
  const { mutationDisabled, setError, setFieldErrors } = lifecycle;
  const { setPlanOpen } = plan;
  const { currentPlan, incompleteRequirements, setRequirementOpen } = requirements;

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Onboarding</h3>
          <p className="text-xs text-muted-foreground">Fehlende Konfiguration gilt nicht als erledigt.</p>
        </div>
        {canManage ? (
          currentPlan ? (
            <Button
              size="sm"
              variant="outline"
              disabled={mutationDisabled}
              onClick={() => {
                setError(null);
                setFieldErrors({});
                setRequirementOpen(true);
              }}
            >
              <Plus className="size-4" /> Anforderung
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={mutationDisabled}
              onClick={() => {
                setError(null);
                setFieldErrors({});
                setPlanOpen(true);
              }}
            >
              <Plus className="size-4" /> Plan anlegen
            </Button>
          )
        ) : null}
      </div>
      {!currentPlan ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Nicht eingerichtet. Es wurde kein Plan aus Bestandsdaten abgeleitet.
        </p>
      ) : incompleteRequirements.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Keine offenen Anforderungen.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {incompleteRequirements.map((requirement) => (
            <PersonnelLifecycleRequirementRow
              key={requirement.id}
              requirement={requirement}
              lifecycle={lifecycle}
              requirements={requirements}
              canManage={canManage}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

type PersonnelLifecycleRequirementRowProps = {
  requirement: PersonnelLifecycleView['plans'][number]['requirements'][number];
  lifecycle: PersonnelLifecycleController;
  requirements: PersonnelLifecycleRequirements;
  canManage: boolean;
};

function PersonnelLifecycleRequirementRow({
  requirement,
  lifecycle,
  requirements,
  canManage,
}: PersonnelLifecycleRequirementRowProps) {
  const { mutationDisabled, rowBusy } = lifecycle;
  const { resolveRequirement } = requirements;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{requirement.title}</p>
        <p className="text-xs text-muted-foreground">
          {requirement.isRequired ? 'Erforderlich' : 'Optional'}
          {requirement.blocksAccess ? ' · blockiert Aktivierung' : ''}
          {requirement.dueDate ? ` · fällig ${formatLifecycleDate(requirement.dueDate)}` : ''}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1">
        <InlinePending active={rowBusy.isBusy(requirement.id)} label="Anforderung wird aktualisiert" />
        <Badge variant={requirement.state === 'blocked' ? 'destructive' : 'secondary'}>
          {REQUIREMENT_STATE_LABELS[requirement.state]}
        </Badge>
        {canManage ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void resolveRequirement(requirement, 'fulfilled')}
              disabled={mutationDisabled || rowBusy.isBusy(requirement.id)}
            >
              Erledigen
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void resolveRequirement(requirement, 'waived')}
              disabled={mutationDisabled || rowBusy.isBusy(requirement.id)}
            >
              Erlassen
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void resolveRequirement(requirement, 'cancelled')}
              disabled={mutationDisabled || rowBusy.isBusy(requirement.id)}
            >
              Abbrechen
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}
