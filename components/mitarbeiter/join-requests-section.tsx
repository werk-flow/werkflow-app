'use client';

import { Button } from '@/components/ui/button';
import { useBanner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { InlinePending } from '@/components/ui/inline-pending';
import { ListRow } from '@/components/ui/list-row';
import { useRouterRefresh } from '@/components/ui/refresh-button';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { describeFailure } from '@/lib/action-messages';
import type { ActionResult } from '@/lib/action-result';
import {
  approveOrganizationJoinRequest,
  declineOrganizationJoinRequest,
} from '@/lib/org/join-request-actions';
import type { PendingJoinRequest } from '@/lib/org/types';
import { formatBerlinDateTime } from '@/lib/utils';

const DECISION_MESSAGES: Readonly<Record<string, string>> = {
  request_not_pending: 'Die Anfrage ist nicht mehr offen. Sie wurde schon entschieden oder zurückgezogen.',
  admin_mismatch:
    'Diese Person gehört schon zu einer Organisation eines anderen Inhabers und kann nicht freigegeben werden.',
};
const DECISION_FALLBACK = 'Die Anfrage konnte nicht bearbeitet werden. Bitte versuche es erneut.';

const getRequestId = (request: PendingJoinRequest) => request.id;

/**
 * Open join requests of the organization. Admin and Büro approve a person, who
 * then joins as Handwerker/in, or decline the request. The section exists only
 * while a request is open.
 */
export function JoinRequestsSection({ requests }: { requests: PendingJoinRequest[] }) {
  const list = useOptimisticList({ items: requests, getId: getRequestId });
  const busy = useBusyIds();
  const { showBanner } = useBanner();
  const { refresh } = useRouterRefresh();

  if (list.items.length === 0) return null;

  const decide = (request: PendingJoinRequest, approve: boolean) =>
    busy.run(request.id, async () => {
      const decision = approve ? approveOrganizationJoinRequest : declineOrganizationJoinRequest;
      const result: ActionResult = await decision(request.id).catch(() => ({
        success: false as const,
        error: 'unexpected_error',
      }));
      if (!result.success) {
        showBanner({
          variant: 'error',
          message: describeFailure(result.error, DECISION_MESSAGES, DECISION_FALLBACK),
        });
        return;
      }
      // The row leaves now; the member list gains the person with the route refresh.
      list.remove(request.id);
      refresh();
      showBanner({
        variant: 'success',
        message: approve
          ? `${request.name} ist jetzt Mitglied deiner Organisation.`
          : `Die Anfrage von ${request.name} wurde abgelehnt.`,
      });
    });

  return (
    <section id="beitrittsanfragen" aria-labelledby="beitrittsanfragen-heading" className="mb-4 space-y-2">
      <div className="space-y-1 px-1">
        <h2 id="beitrittsanfragen-heading" className="text-sm font-semibold">
          Beitrittsanfragen ({list.items.length})
        </h2>
        <p className="text-sm text-muted-foreground">
          Diese Personen haben euren Organisationscode eingegeben. Wenn du sie freigibst, kommen sie als
          Handwerker/in dazu.
        </p>
      </div>
      <Card className="gap-0 divide-y py-0">
        {list.items.map(({ item: request }) => {
          const isBusy = busy.isBusy(request.id);
          return (
            <ListRow
              key={request.id}
              variant="plain"
              className="flex flex-wrap items-center justify-between gap-3"
              data-join-request={request.id}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{request.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {request.email ? `${request.email} · ` : ''}angefragt{' '}
                  {formatBerlinDateTime(request.requestedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => void decide(request, false)}
                  aria-label={`Anfrage von ${request.name} ablehnen`}
                >
                  Ablehnen
                </Button>
                <Button
                  size="sm"
                  disabled={isBusy}
                  onClick={() => void decide(request, true)}
                  aria-label={`${request.name} freigeben`}
                >
                  Freigeben
                </Button>
                <InlinePending active={isBusy} label="Anfrage wird bearbeitet" keepSpace />
              </div>
            </ListRow>
          );
        })}
      </Card>
    </section>
  );
}
