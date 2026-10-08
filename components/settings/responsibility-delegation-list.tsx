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
import type { ResponsibilityDelegation } from '@/lib/responsibilities/resolution';
import type { ResponsibilitySettingsData } from '@/lib/responsibilities/server';

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

  const handleEnd = async (delegationId: string) => {
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
        showBanner({ message: 'Die Vertretung wurde beendet.', variant: 'success' });
      } catch {
        showBanner({ message: ERROR_MESSAGES.save_failed, variant: 'error' });
      }
    });
  };

  return (
    <ul className="grid gap-2">
      {delegations.map((delegation) => {
        const effectiveUntil = delegation.revokedFrom ? delegation.revokedFrom : delegation.validUntil;
        const isEnded = effectiveUntil < data.businessDate || delegation.revokedFrom === data.businessDate;
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
              <Badge variant={isEnded ? 'secondary' : 'outline'}>
                {isEnded ? 'Beendet' : 'Zeitlich begrenzt'}
              </Badge>
              {canEdit && !isEnded ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={ending.anyBusy}
                  onClick={() => void handleEnd(delegation.id)}
                >
                  {ending.isBusy(delegation.id) ? 'Wird beendet…' : 'Heute beenden'}
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
