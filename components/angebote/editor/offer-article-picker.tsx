'use client';

import { useState } from 'react';

import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { readOfferArticleLine } from '@/lib/invoices/line-source-actions';
import type { OfferArticleLine } from '@/lib/invoices/line-sources';

const ADD_FAILED = 'Der Artikel konnte nicht übernommen werden. Bitte versuche es erneut.';
const ARTICLE_FAILURE_MESSAGES: Record<string, string> = {
  source_not_found: 'Diesen Artikel gibt es nicht mehr. Wähle einen anderen.',
  source_archived: 'Dieser Artikel ist archiviert und lässt sich nicht mehr übernehmen.',
  source_unpriced:
    'Für diesen Artikel gilt heute kein Verkaufspreis. Trag ihn im Inventar nach oder schreib die Position frei.',
  source_tax_rate_unsupported:
    'Der Steuersatz dieses Artikels ist im Angebot nicht wählbar. Erlaubt sind 19, 7 und 0 %.',
};

/**
 * „Artikel hinzufügen“ under a Titel: the picked article becomes a new
 * Position with today's net sale price, unit and VAT rate, read on the
 * server by the rule of an invoice line. The office can change every value
 * before it saves.
 */
export function OfferArticlePicker({
  id,
  label,
  onAdd,
  disabled,
}: {
  id: string;
  /** The accessible name, naming the Titel, because every Titel has one. */
  label: string;
  onAdd: (line: OfferArticleLine) => void;
  disabled: boolean;
}) {
  const [picked, setPicked] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = usePendingTask();
  const search = useJobEntityOptions({ kind: 'inventory-items' }, picked ? [picked] : []);

  const add = (articleId: string) => {
    if (!articleId) return;
    setPicked(articleId);
    void run(async () => {
      setError(null);
      const result = await readOfferArticleLine({ articleId }).catch(() => null);
      setPicked('');
      if (!result?.success) {
        setError(result ? describeFailure(result.error, ARTICLE_FAILURE_MESSAGES, ADD_FAILED) : ADD_FAILED);
        return;
      }
      onAdd(result.line);
    });
  };

  return (
    <div className="min-w-0 space-y-1 sm:w-72">
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
          placeholder="Artikel hinzufügen…"
          searchPlaceholder="Nummer oder Name…"
          emptyMessage="Kein Artikel gefunden"
        />
        <InlinePending active={isPending} label="Preis wird übernommen" />
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
