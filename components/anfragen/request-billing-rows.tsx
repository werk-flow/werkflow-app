'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';

import { RecipientFact, partyName } from '@/components/auftraege/shared/work-billing-parties-section';
import { lazyWorkBillingPartiesDialog } from '@/components/auftraege/shared/work-billing-parties-lazy-dialog';
import {
  WORK_BILLING_PARTIES_LOAD_FAILED,
  WORK_BILLING_PARTIES_STALE,
  useWorkBillingParties,
} from '@/components/auftraege/shared/use-work-billing-parties';
import { Button } from '@/components/ui/button';
import { SectionError } from '@/components/ui/section-error';
import type { WorkBillingParties } from '@/lib/billing-parties/types';
import { partyLinks, resolveBillingVersions } from '@/lib/billing-parties/resolve';

/**
 * The request's Auftraggeber and Rechnungsempfänger as rows of its Details
 * card. A conversion carries a recipient the office chose here to the new
 * work. While the request is open, „Ändern“ chooses both.
 */
export function RequestBillingRows({
  requestId,
  clientId,
  initialParties,
  isEditable,
}: {
  requestId: string;
  clientId: string | null;
  initialParties: WorkBillingParties | undefined;
  isEditable: boolean;
}) {
  const view = useWorkBillingParties('request', requestId, initialParties);
  const [editing, setEditing] = useState(false);
  const parties = view.data;
  if (parties === undefined) {
    return view.isLoading ? null : (
      <div className="py-1">
        <SectionError onRetry={() => void view.refresh()} retryPending={view.isRefreshing}>
          {view.error ?? WORK_BILLING_PARTIES_LOAD_FAILED}
        </SectionError>
      </div>
    );
  }
  // A request's read names both parties in every version.
  const [current = null] = resolveBillingVersions(parties.versions, null);
  // The customer card links the request's customer already.
  const links = current ? partyLinks(current, clientId) : null;
  return (
    <>
      <div className="flex gap-2">
        <dt className="w-28 shrink-0 text-muted-foreground">Auftraggeber</dt>
        <dd className="min-w-0">
          {current && links ? partyName(current.auftraggeber, links.auftraggeber) : '—'}
        </dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-28 shrink-0 text-muted-foreground">Rechnung an</dt>
        <dd className="min-w-0 flex-1">
          {view.isStale && (
            // A failed refresh keeps the last parties; say so and offer the read again.
            <SectionError
              className="mb-1.5"
              onRetry={() => void view.refresh()}
              retryPending={view.isRefreshing}
            >
              {WORK_BILLING_PARTIES_STALE}
            </SectionError>
          )}
          {current && links ? <RecipientFact current={current} linked={links.recipient} /> : '—'}
          {isEditable && parties.hasClient && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1.5"
              aria-label="Auftraggeber und Rechnungsempfänger ändern"
              onClick={() => setEditing(true)}
              onPointerEnter={lazyWorkBillingPartiesDialog.preload}
              onFocus={lazyWorkBillingPartiesDialog.preload}
              disabled={view.isStale}
            >
              <Pencil className="size-4" />
              Ändern
            </Button>
          )}
        </dd>
      </div>
      <lazyWorkBillingPartiesDialog.Dialog
        open={editing}
        onOpenChange={setEditing}
        kind="request"
        workId={requestId}
        current={current}
        onSaved={view.refresh}
      />
    </>
  );
}
