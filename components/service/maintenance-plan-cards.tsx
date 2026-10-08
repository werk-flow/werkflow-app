'use client';

import { EmptyState } from '@/components/ui/empty-state';
import type { ReactElement } from 'react';
import { ClipboardList, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { MAINTENANCE_PLAN_STATUS_LABELS, type MaintenancePlanItem } from '@/lib/maintenance/types';
import { unconfirmedMarker } from '@/lib/ui/unconfirmed';
import { formatMaintenanceDate } from './maintenance-lists';
import type { MaintenancePlanPendingDraft } from './maintenance-plan-dialog';

export type PlanAction = {
  plan: MaintenancePlanItem;
  toStatus?: 'active' | 'suspended' | 'terminated';
  archived?: boolean;
};

export function MaintenancePlanCards({
  plans,
  hasAnyPlan,
  pendingPlans,
  isBusy,
  onEditClick,
  onActionClick,
}: {
  plans: MaintenancePlanItem[];
  /** False while the organization has no plan at all, whatever the search. */
  hasAnyPlan: boolean;
  pendingPlans: MaintenancePlanPendingDraft[];
  isBusy: (id: string) => boolean;
  onEditClick: (plan: MaintenancePlanItem) => void;
  onActionClick: (action: PlanAction) => void;
}): ReactElement {
  if (plans.length === 0 && pendingPlans.length === 0 && hasAnyPlan) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Keine Wartungspläne gefunden"
        description="Zur Suche gibt es auf dieser Seite keinen Wartungsplan. Ändere die Suche."
      />
    );
  }
  return plans.length === 0 && pendingPlans.length === 0 ? (
    <EmptyState
      icon={ClipboardList}
      title="Noch keine Wartungspläne"
      description="Lege den ersten Plan aus Kunde, Einsatzort, Anlagen und einer veröffentlichten Arbeitsvorlage an."
    />
  ) : (
    <div className="grid gap-3 lg:grid-cols-2">
      {pendingPlans.map((draft) => (
        <section
          key={draft.id}
          {...unconfirmedMarker(true)}
          role="status"
          aria-label="Wird gespeichert"
          data-pending-row=""
          className="rounded-lg border p-4 opacity-70 shadow-xs"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 font-semibold">
                <InlinePending active />
                Wartungsplan wird gespeichert
              </h2>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {draft.clientName} · {draft.siteName}
              </p>
            </div>
            <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
              {MAINTENANCE_PLAN_STATUS_LABELS[draft.status]}
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Arbeitsvorlage</dt>
              <dd>{draft.templateName}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Rhythmus</dt>
              <dd>Alle {draft.intervalMonths} Monate</dd>
            </div>
          </dl>
        </section>
      ))}
      {plans.map((plan) => (
        <section
          key={plan.id}
          data-testid="maintenance-plan-card"
          className="rounded-lg border p-4 shadow-xs"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate font-semibold">{plan.planNumber}</h2>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {plan.clientName} · {plan.siteName}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-2">
              <InlinePending active={isBusy(plan.id)} label="Änderungen werden übernommen" />
              <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                {plan.archivedAt ? 'Archiviert' : MAINTENANCE_PLAN_STATUS_LABELS[plan.status]}
              </span>
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Arbeitsvorlage</dt>
              <dd>
                {plan.templateName} · Rev. {plan.revisionNumber}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Rhythmus</dt>
              <dd>Alle {plan.intervalMonths} Monate</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Nächste Fälligkeit</dt>
              <dd>{formatMaintenanceDate(plan.nextDueDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Offene Fälligkeiten</dt>
              <dd>{plan.openDueCount}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Anlagen</dt>
              <dd>{plan.equipment.map((item) => `${item.equipmentNumber} · ${item.name}`).join(', ')}</dd>
            </div>
          </dl>
          <fieldset disabled={isBusy(plan.id)} className="mt-4 flex flex-wrap gap-2 border-t pt-3">
            {!plan.archivedAt && plan.status !== 'terminated' && (
              <Button type="button" size="sm" variant="outline" onClick={() => onEditClick(plan)}>
                <Pencil className="size-3.5" />
                Überarbeiten
              </Button>
            )}
            {plan.status === 'draft' && (
              <Button type="button" size="sm" onClick={() => onActionClick({ plan, toStatus: 'active' })}>
                Aktivieren
              </Button>
            )}
            {plan.status === 'active' && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onActionClick({ plan, toStatus: 'suspended' })}
              >
                Pausieren
              </Button>
            )}
            {plan.status === 'suspended' && (
              <Button type="button" size="sm" onClick={() => onActionClick({ plan, toStatus: 'active' })}>
                Fortsetzen
              </Button>
            )}
            {plan.status !== 'terminated' && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onActionClick({ plan, toStatus: 'terminated' })}
              >
                Beenden
              </Button>
            )}
            {plan.status === 'terminated' && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onActionClick({ plan, archived: !plan.archivedAt })}
              >
                {plan.archivedAt ? 'Wiederherstellen' : 'Archivieren'}
              </Button>
            )}
          </fieldset>
        </section>
      ))}
    </div>
  );
}
