'use client';

import { useState } from 'react';
import { Pencil, ReceiptText } from 'lucide-react';

import { SectionTitle } from '@/components/shared/section-title';
import { StaleRegion } from '@/components/shared/stale-region';
import { Button } from '@/components/ui/button';
import { SectionError } from '@/components/ui/section-error';
import { TextLink } from '@/components/ui/text-link';
import {
  BILLING_PARTY_SOURCE_LABELS,
  type BillingWorkKind,
  type WorkBillingParties,
  type WorkBillingPartyVersion,
} from '@/lib/billing-parties/types';
import { formatSiteAddress } from '@/lib/clients/types';
import { formatBerlinDateTime } from '@/lib/utils';
import { WorkBillingPartiesDialog } from './work-billing-parties-dialog';
import { WORK_BILLING_PARTIES_LOAD_FAILED, useWorkBillingParties } from './use-work-billing-parties';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

/** The recipient as it was copied onto the work, and why and when. */
export function RecipientFact({ current }: { current: WorkBillingPartyVersion }) {
  return (
    <>
      <TextLink href={`/kunden/${current.recipientClientId}`}>{current.recipientName}</TextLink>
      {current.recipientAddress && (
        <span className="block whitespace-pre-line text-muted-foreground">{current.recipientAddress}</span>
      )}
      <span className="block text-xs text-muted-foreground">
        {BILLING_PARTY_SOURCE_LABELS[current.source]} · {formatBerlinDateTime(current.setAt)}
        {current.setByName ? ` · ${current.setByName}` : ''}
      </span>
    </>
  );
}

/** The earlier choices, newest first. */
function BillingPartiesHistory({ versions }: { versions: WorkBillingPartyVersion[] }) {
  if (versions.length === 0) return null;
  return (
    <div className="mt-3 border-t pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Früher</p>
      <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
        {versions.map((version) => (
          <li key={version.id}>
            Rechnung an {version.recipientName}, Auftraggeber {version.clientName} ·{' '}
            {formatBerlinDateTime(version.setAt)}
            {version.setByName ? ` · ${version.setByName}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BillingPartiesFacts({ parties, showPlace }: { parties: WorkBillingParties; showPlace: boolean }) {
  const [current] = parties.versions;
  const siteAddress = parties.site ? formatSiteAddress(parties.site) : '';
  return (
    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
      <Fact label="Auftraggeber">
        {current ? <TextLink href={`/kunden/${current.clientId}`}>{current.clientName}</TextLink> : '—'}
      </Fact>
      <Fact label="Rechnungsempfänger">{current ? <RecipientFact current={current} /> : '—'}</Fact>
      {showPlace && (
        <>
          <Fact label="Einsatzort">
            {parties.site ? (
              <>
                {parties.site.name}
                {siteAddress && <span className="block text-muted-foreground">{siteAddress}</span>}
              </>
            ) : (
              '—'
            )}
          </Fact>
          <Fact label="Zugangskontakt">
            {parties.accessContacts.length > 0 ? (
              <ul className="space-y-0.5">
                {parties.accessContacts.map((contact) => (
                  <li key={contact.id}>
                    {contact.name}
                    {contact.phone && <span className="text-muted-foreground"> · {contact.phone}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              '—'
            )}
          </Fact>
        </>
      )}
    </dl>
  );
}

/**
 * Who commissioned a job, project or Servicefall and who receives its
 * invoice, with the Einsatzort and its access contacts. Office-only: the
 * server refuses the read to a field worker.
 */
export function WorkBillingPartiesSection({
  kind,
  id,
  initialParties,
  className = '',
}: {
  kind: Exclude<BillingWorkKind, 'request'>;
  id: string;
  /** Undefined: the page's read failed, and the section reads after mount. */
  initialParties?: WorkBillingParties | undefined;
  className?: string;
}) {
  const view = useWorkBillingParties(kind, id, initialParties);
  const [editing, setEditing] = useState(false);
  const parties = view.data;
  if (parties === undefined) {
    return view.isLoading ? null : (
      <SectionError
        className={className}
        onRetry={() => void view.refresh()}
        retryPending={view.isRefreshing}
      >
        {view.error ?? WORK_BILLING_PARTIES_LOAD_FAILED}
      </SectionError>
    );
  }
  const [current = null, ...earlier] = parties.versions;
  return (
    <StaleRegion stale={view.isStale} onRetry={view.refresh} className={className}>
      <section
        aria-labelledby={`work-billing-parties-${id}`}
        className="rounded-lg border bg-card p-4 sm:p-5"
        data-testid="work-billing-parties"
      >
        <div className="flex items-start justify-between gap-3">
          <SectionTitle as="h2" id={`work-billing-parties-${id}`} icon={<ReceiptText className="size-4" />}>
            Auftraggeber und Rechnung
          </SectionTitle>
          {parties.hasClient && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Auftraggeber und Rechnungsempfänger ändern"
              onClick={() => setEditing(true)}
              disabled={view.isStale}
            >
              <Pencil className="size-4" />
              Ändern
            </Button>
          )}
        </div>
        {parties.hasClient ? (
          <BillingPartiesFacts parties={parties} showPlace />
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Ordne zuerst einen Kunden zu.</p>
        )}
        <BillingPartiesHistory versions={earlier} />
      </section>
      <WorkBillingPartiesDialog
        open={editing}
        kind={kind}
        workId={id}
        current={current}
        onClose={() => setEditing(false)}
        onSaved={view.refresh}
      />
    </StaleRegion>
  );
}
