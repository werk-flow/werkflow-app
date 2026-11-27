'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { readOfferArticleLine, readOfferLeistungLine } from '@/lib/invoices/line-source-actions';
import type { InvoiceLineSourceKind, OfferCatalogLine } from '@/lib/invoices/line-sources';

type CatalogKind = {
  options: 'inventory-items' | 'leistungen';
  placeholder: string;
  empty: string;
  failed: string;
  messages: Readonly<Record<string, string>>;
};

// The prefill of either kind reads the same catalog line rule on the server; only the words differ.
const CATALOG: Record<InvoiceLineSourceKind, CatalogKind> = {
  article: {
    options: 'inventory-items',
    placeholder: 'Artikel hinzufügen…',
    empty: 'Kein Artikel gefunden',
    failed: 'Der Artikel konnte nicht übernommen werden. Bitte versuche es erneut.',
    messages: {
      source_not_found: 'Diesen Artikel gibt es nicht mehr. Wähle einen anderen.',
      offer_not_found: 'Das Angebot gibt es nicht mehr.',
      source_archived: 'Dieser Artikel ist archiviert und lässt sich nicht mehr übernehmen.',
      source_unpriced:
        'Für diesen Artikel gilt heute kein Verkaufspreis. Trag ihn im Inventar nach oder schreib die Position frei.',
      source_tax_rate_unsupported:
        'Der Steuersatz dieses Artikels ist im Angebot nicht wählbar. Erlaubt sind 19, 7 und 0 %.',
    },
  },
  leistung: {
    options: 'leistungen',
    placeholder: 'Leistung hinzufügen…',
    empty: 'Keine Leistung gefunden',
    failed: 'Die Leistung konnte nicht übernommen werden. Bitte versuche es erneut.',
    messages: {
      source_not_found: 'Diese Leistung gibt es nicht mehr. Wähle eine andere.',
      offer_not_found: 'Das Angebot gibt es nicht mehr.',
      source_archived: 'Diese Leistung ist archiviert und lässt sich nicht mehr übernehmen.',
      source_unpriced:
        'Für diese Leistung gilt heute kein Verkaufspreis. Trag ihn in den Preisen nach oder schreib die Position frei.',
      source_tax_rate_unsupported:
        'Der Steuersatz dieser Leistung ist im Angebot nicht wählbar. Erlaubt sind 19, 7 und 0 %.',
    },
  },
};

/**
 * „Artikel hinzufügen“ or „Leistung hinzufügen“ under a Titel: the picked
 * entry becomes a new Position with today's net price by the offer's
 * customer's conditions, unit, VAT rate and cost, read on the server by the
 * rule of an invoice line. The office can change every value before it saves. A read that failed for no reason
 * of the entry offers „Erneut versuchen“ with the same entry.
 */
export function OfferCatalogPicker({
  offerId,
  kind,
  id,
  label,
  onPick,
  onAdd,
  disabled,
}: {
  /** The offer whose customer's conditions price the entry. */
  offerId: string;
  kind: InvoiceLineSourceKind;
  id: string;
  /** The accessible name, naming the Titel, because every Titel has one. */
  label: string;
  /** The pick is an own change at once, so another session's content cannot move its Titel meanwhile. */
  onPick: () => void;
  onAdd: (line: OfferCatalogLine) => void;
  disabled: boolean;
}) {
  const catalog = CATALOG[kind];
  const [picked, setPicked] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [retryId, setRetryId] = useState<string | null>(null);
  const { run, isPending } = usePendingTask();
  const search = useJobEntityOptions({ kind: catalog.options }, picked ? [picked] : []);

  const add = (entryId: string) => {
    if (!entryId) return;
    setPicked(entryId);
    onPick();
    void run(async () => {
      setError(null);
      setRetryId(null);
      const result = await (
        kind === 'leistung'
          ? readOfferLeistungLine({ offerId, leistungId: entryId })
          : readOfferArticleLine({ offerId, articleId: entryId })
      ).catch(() => null);
      setPicked('');
      if (!result?.success) {
        setError(result ? describeFailure(result.error, catalog.messages, catalog.failed) : catalog.failed);
        // A reason of the entry stays; any other failure may pass on a second try.
        if (!result || !Object.hasOwn(catalog.messages, result.error)) setRetryId(entryId);
        return;
      }
      onAdd(result.line);
    });
  };

  return (
    <div className="min-w-0 space-y-1 sm:w-80">
      <div className="flex items-center gap-2">
        <SearchableSelect
          id={id}
          ariaLabel={label}
          value={picked}
          onChange={add}
          options={search.options}
          onSearchChange={search.onSearchChange}
          loading={search.loading}
          loadFailure={search.loadFailure}
          onLoadMore={search.onLoadMore}
          disabled={disabled || isPending}
          placeholder={catalog.placeholder}
          searchPlaceholder="Nummer oder Name…"
          emptyMessage={catalog.empty}
        />
        <InlinePending active={isPending} label="Preis wird übernommen" />
      </div>
      <ErrorText>{error}</ErrorText>
      {retryId && (
        <Button type="button" variant="outline" size="sm" onClick={() => add(retryId)} disabled={disabled}>
          Erneut versuchen
        </Button>
      )}
    </div>
  );
}
