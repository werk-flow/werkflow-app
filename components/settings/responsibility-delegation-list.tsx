'use client';

import {
  ERROR_MESSAGES,
  responsibilityErrorMessage,
  formatDelegationDate,
  personName,
} from '@/components/settings/responsibility-display';
import { useBanner } from '@/components/ui/banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useBusyIds } from '@/hooks/use-busy-id';
import { endResponsibilityDelegation } from '@/lib/responsibilities/actions';
import { delegationWindowState, type DelegationWindowState } from '@/lib/responsibilities/delegation-window';
import type { ResponsibilityDelegation } from '@/lib/responsibilities/resolution';
import type { ResponsibilitySettingsData } from '@/lib/responsibilities/server';

const DELEGATION_BADGES = {
  planned: { label: 'Geplant', variant: 'outline' },
  active: { label: 'Zeitlich begrenzt', variant: 'outline' },
  ended: { label: 'Beendet', variant: 'secondary' },
  removed: { label: 'Entfernt', variant: 'secondary' },
} as const satisfies Record<DelegationWindowState, { label: string; variant: 'outline' | 'secondary' }>;

/** A window that has not started is removed, so it never takes effect; a running one ends today. */
const PLANNED_ACTION = { label: 'Entfernen', pending: 'Wird entfernt…' };
const ACTIVE_ACTION = { label: 'Heute beenden', pending: 'Wird beendet…' };

export function DelegationList({
  data,
  delegations,
  canEdit,
}: {
  data: ResponsibilitySettingsData;
  delegations: ResponsibilityDelegation[];
  canEdit: boolean;
}) {
  const { showBanner } = useBanner();
  const ending = useBusyIds();

  const handleEnd = async (delegationId: string, state: DelegationWindowState) => {
    await ending.run(delegationId, async () => {
      try {
        const result = await endResponsibilityDelegation(delegationId);
        if (!result.success) {
          showBanner({
            message: responsibilityErrorMessage(result.error),
            variant: 'error',
          });
          return;
        }
        // The action's response renders the route with the ended delegation.
        showBanner({
          message: state === 'planned' ? 'Die Vertretung wurde entfernt.' : 'Die Vertretung wurde beendet.',
          variant: 'success',
        });
      } catch {
        showBanner({ message: ERROR_MESSAGES.save_failed, variant: 'error' });
      }
    });
  };

  return (
    <ul className="grid gap-2">
      {delegations.map((delegation) => {
        const state = delegationWindowState(delegation, data.businessDate);
        const badge = DELEGATION_BADGES[state];
        const action = state === 'planned' ? PLANNED_ACTION : state === 'active' ? ACTIVE_ACTION : null;
        return (
          <li
            key={delegation.id}
            className="flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="text-sm">
              <p className="font-medium">{personName(data.people, delegation.substituteEmployeeRecordId)}</p>
              <p className="text-muted-foreground">
                Für {personName(data.people, delegation.delegatorEmployeeRecordId)} ·{' '}
                {formatDelegationDate(delegation.validFrom)}–{formatDelegationDate(delegation.validUntil)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={badge.variant}>{badge.label}</Badge>
              {canEdit && action ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={ending.anyBusy}
                  onClick={() => void handleEnd(delegation.id, state)}
                >
                  {ending.isBusy(delegation.id) ? action.pending : action.label}
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
