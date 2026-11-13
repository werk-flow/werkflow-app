'use client';

import { useCallback, useMemo, useState } from 'react';
import { Pencil, ReceiptText } from 'lucide-react';

import { SectionTitle } from '@/components/shared/section-title';
import { StaleRegion } from '@/components/shared/stale-region';
import { Button } from '@/components/ui/button';
import { SectionError } from '@/components/ui/section-error';
import { TextLink } from '@/components/ui/text-link';
import type {
  BillingPartySource,
  BillingRecipient,
  BillingWorkKind,
  WorkBillingParties,
} from '@/lib/billing-parties/types';
import {
  partyLinks,
  resolveBillingVersions,
  shownBillingSite,
  standInsByRead,
  type ResolvedBillingVersion,
} from '@/lib/billing-parties/resolve';
import { formatSiteAddress } from '@/lib/clients/types';
import { formatBerlinDateTime } from '@/lib/utils';
import { lazyWorkBillingPartiesDialog } from './work-billing-parties-lazy-dialog';
import { WORK_BILLING_PARTIES_LOAD_FAILED, useWorkBillingParties } from './use-work-billing-parties';

/** Why this recipient: shown under it on the work. */
const SOURCE_LABELS: Readonly<Record<BillingPartySource, string>> = {
  objekt: 'Rechnungsempfänger des Einsatzorts',
  auftraggeber: 'Wie Auftraggeber',
  projekt: 'Aus dem Projekt übernommen',
  anfrage: 'Aus der Anfrage übernommen',
  buero: 'Vom Büro gewählt',
};

/** A party's name, linked to its customer only where the page does not link it already. */
export function partyName(party: { id: string; name: string }, linked: boolean): React.ReactNode {
  return linked ? <TextLink href={`/kunden/${party.id}`}>{party.name}</TextLink> : party.name;
}

/** One labelled fact: a plain element, so the section adds no component per fact (lab.office.job-open). */
function partyFact(label: string, value: React.ReactNode): React.ReactNode {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{value}</dd>
    </div>
  );
}

/** The recipient as it was copied onto the work, and why and when. */
export function RecipientFact({ current, linked }: { current: ResolvedBillingVersion; linked: boolean }) {
  return (
    <>
      {partyName(current.recipient, linked)}
      {current.recipient.address && (
        <span className="block whitespace-pre-line text-muted-foreground">{current.recipient.address}</span>
      )}
      <span className="block text-xs text-muted-foreground">
        {SOURCE_LABELS[current.source]} · {formatBerlinDateTime(current.setAt)}
      </span>
    </>
  );
}

/** The earlier choices, newest first; nothing while there are none. */
function earlierPartiesList(versions: ResolvedBillingVersion[]): React.ReactNode {
  if (versions.length === 0) return null;
  return (
    <div className="mt-3 border-t pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Früher</p>
      <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
        {versions.map((version) => (
          <li key={version.version}>
            Rechnung an {version.recipient.name}, Auftraggeber {version.auftraggeber.name} ·{' '}
            {formatBerlinDateTime(version.setAt)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Auftraggeber, recipient, Einsatzort and access contacts. */
function partyFacts(
  parties: WorkBillingParties,
  current: ResolvedBillingVersion | undefined,
  site: WorkBillingParties['site'],
  workClientId: string | null,
): React.ReactNode {
  const siteAddress = site ? formatSiteAddress(site) : '';
  const links = current ? partyLinks(current, workClientId) : null;
  return (
    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
      {partyFact(
        'Auftraggeber',
        current && links ? partyName(current.auftraggeber, links.auftraggeber) : '—',
      )}
      {partyFact(
        'Rechnungsempfänger',
        current && links ? <RecipientFact current={current} linked={links.recipient} /> : '—',
      )}
      {partyFact(
        'Einsatzort',
        site ? (
          <>
            {site.name}
            {siteAddress && <span className="block text-muted-foreground">{siteAddress}</span>}
          </>
        ) : (
          '—'
        ),
      )}
      {partyFact(
        'Zugangskontakt',
        parties.accessContacts.length > 0 ? (
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
        ),
      )}
    </dl>
  );
}

/** The card itself, built once per shown state so a live-view tick re-renders none of it. */
function billingCard(input: {
  id: string;
  parties: WorkBillingParties;
  versions: ResolvedBillingVersion[];
  site: WorkBillingParties['site'];
  workClientId: string | null;
  stale: boolean;
  onEdit: () => void;
}): React.ReactNode {
  const { id, parties, stale, onEdit } = input;
  return (
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
            onClick={onEdit}
            onPointerEnter={lazyWorkBillingPartiesDialog.preload}
            onFocus={lazyWorkBillingPartiesDialog.preload}
            disabled={stale}
          >
            <Pencil className="size-4" />
            Ändern
          </Button>
        )}
      </div>
      {parties.hasClient ? (
        partyFacts(parties, input.versions[0], input.site, input.workClientId)
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Ordne zuerst einen Kunden zu.</p>
      )}
      {earlierPartiesList(input.versions.slice(1))}
    </section>
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
  site,
  workClient = null,
  workClientId,
  className = '',
}: {
  kind: Exclude<BillingWorkKind, 'request'>;
  id: string;
  /** Undefined: the page's read failed, and the section reads after mount. */
  initialParties?: WorkBillingParties | undefined;
  /** The Einsatzort the page already holds (the job's), until the section's own read names it. */
  site?: WorkBillingParties['site'] | undefined;
  /** The job's customer, which stands in for a party the job's read left out. */
  workClient?: BillingRecipient | null | undefined;
  /** The work's own customer, which the page links already. */
  workClientId: string | null;
  className?: string;
}) {
  const view = useWorkBillingParties(kind, id, initialParties);
  const [editing, setEditing] = useState(false);
  const openEditor = useCallback(() => setEditing(true), []);
  const parties = view.data;
  // A job read's left-out parties are its own customer of that read (S4).
  const [standIns] = useState(standInsByRead);
  if (initialParties) standIns.remember(initialParties, workClient);
  const shownSite = parties ? shownBillingSite(parties, standIns.fromPage(parties), site) : null;
  const versions = useMemo(
    () => (parties ? resolveBillingVersions(parties.versions, standIns.clientFor(parties)) : []),
    [parties, standIns],
  );
  const card = useMemo(
    () =>
      parties === undefined
        ? null
        : billingCard({
            id,
            parties,
            versions,
            site: shownSite,
            workClientId,
            stale: view.isStale,
            onEdit: openEditor,
          }),
    [id, parties, versions, shownSite, workClientId, view.isStale, openEditor],
  );
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
  return (
    <StaleRegion stale={view.isStale} onRetry={view.refresh} className={className}>
      {card}
      {/* Mounted while open, so a page that only shows the parties renders no dialog. */}
      {editing && (
        <lazyWorkBillingPartiesDialog.Dialog
          open
          onOpenChange={setEditing}
          kind={kind}
          workId={id}
          current={versions[0] ?? null}
          onSaved={view.refresh}
        />
      )}
    </StaleRegion>
  );
}
