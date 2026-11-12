'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';

import { RecipientFact } from '@/components/auftraege/shared/work-billing-parties-section';
import { lazyWorkBillingPartiesDialog } from '@/components/auftraege/shared/work-billing-parties-lazy-dialog';
import {
  WORK_BILLING_PARTIES_LOAD_FAILED,
  useWorkBillingParties,
} from '@/components/auftraege/shared/use-work-billing-parties';
import { Button } from '@/components/ui/button';
import { SectionError } from '@/components/ui/section-error';
import { TextLink } from '@/components/ui/text-link';
import type { WorkBillingParties } from '@/lib/billing-parties/types';

/**
 * The request's Auftraggeber and Rechnungsempfänger as rows of its Details
 * card. A conversion carries a recipient the office chose here to the new
 * work. While the request is open, „Ändern“ chooses both.
 */
export function RequestBillingRows({
  requestId,
  initialParties,
  isEditable,
}: {
  requestId: string;
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
  const [current = null] = parties.versions;
  return (
    <>
      <div className="flex gap-2">
        <dt className="w-28 shrink-0 text-muted-foreground">Auftraggeber</dt>
        <dd className="min-w-0">
          {current ? <TextLink href={`/kunden/${current.clientId}`}>{current.clientName}</TextLink> : '—'}
        </dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-28 shrink-0 text-muted-foreground">Rechnung an</dt>
        <dd className="min-w-0 flex-1">
          {current ? <RecipientFact current={current} /> : '—'}
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
