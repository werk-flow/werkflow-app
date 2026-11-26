'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { InlinePending } from '@/components/ui/inline-pending';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { centsToEuroInput } from '@/lib/price-catalog/money';
import type { DraftLineForm } from '@/lib/invoices/draft-form';
import { readInvoiceLineSource } from '@/lib/invoices/line-source-actions';
import {
  INVOICE_LINE_SOURCE_KINDS,
  INVOICE_LINE_SOURCE_LABELS,
  invoiceLineSourceKindSchema,
  lineSourceLabel,
  type InvoiceCatalogLine,
  type InvoiceLineSource,
  type InvoiceLineSourceKind,
} from '@/lib/invoices/line-sources';

const KIND_FIELD = 'invoice-catalog-kind';
const ENTRY_FIELD = 'invoice-catalog-entry';

const OPTION_KIND: Record<InvoiceLineSourceKind, 'leistungen' | 'inventory-items'> = {
  leistung: 'leistungen',
  article: 'inventory-items',
};

const ADD_FAILED = 'Der Eintrag konnte nicht übernommen werden. Bitte versuche es erneut.';
const CATALOG_FAILURE_MESSAGES: Record<string, string> = {
  source_not_found: 'Diesen Eintrag gibt es nicht mehr. Wähle einen anderen.',
  source_archived: 'Dieser Eintrag ist archiviert und lässt sich nicht mehr übernehmen.',
  source_unpriced:
    'Für diesen Eintrag gilt heute kein Verkaufspreis. Trag ihn im Katalog nach oder schreib die Position frei.',
  source_unit_unknown: 'Die Einheit dieses Eintrags ist unbekannt. Prüf sie im Katalog.',
  source_tax_rate_unsupported:
    'Der Steuersatz dieses Eintrags ist auf einer Rechnung nicht wählbar. Erlaubt sind 19, 7 und 0 %.',
};

/** The editor's new line from the server's answer: the copied values stay editable. */
function draftLineOf(line: InvoiceCatalogLine): DraftLineForm {
  return {
    key: `catalog-${crypto.randomUUID()}`,
    name: line.name,
    description: line.description,
    quantity: '1',
    unit: line.unit,
    price: centsToEuroInput(line.unitPriceCents),
    priceQuantity: line.priceQuantity,
    taxRateBasisPoints: line.taxRateBasisPoints,
    source: line.source,
  };
}

/**
 * „Aus dem Katalog“: a Leistung or an article becomes a new line with today's
 * net price, unit and VAT rate. The server reads the price; the office can
 * change every copied value before it saves.
 */
export function InvoiceCatalogLine({
  onAdd,
  disabled,
}: {
  onAdd: (line: DraftLineForm) => void;
  disabled: boolean;
}) {
  const [kind, setKind] = useState<InvoiceLineSourceKind>('leistung');
  const [picked, setPicked] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = usePendingTask();
  const search = useJobEntityOptions({ kind: OPTION_KIND[kind] }, picked ? [picked] : []);

  const add = (id: string) => {
    if (!id) return;
    setPicked(id);
    void run(async () => {
      setError(null);
      const result = await readInvoiceLineSource({ kind, id }).catch(() => null);
      setPicked('');
      if (!result?.success) {
        setError(result ? describeFailure(result.error, CATALOG_FAILURE_MESSAGES, ADD_FAILED) : ADD_FAILED);
        return;
      }
      onAdd(draftLineOf(result.line));
    });
  };

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:items-end">
        <Field label="Aus dem Katalog" htmlFor={KIND_FIELD}>
          <Select
            value={kind}
            onValueChange={(value) => {
              const next = invoiceLineSourceKindSchema.safeParse(value);
              if (next.success) setKind(next.data);
              setError(null);
            }}
            disabled={disabled || isPending}
          >
            <SelectTrigger id={KIND_FIELD} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INVOICE_LINE_SOURCE_KINDS.map((option) => (
                <SelectItem key={option} value={option}>
                  {INVOICE_LINE_SOURCE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={`${INVOICE_LINE_SOURCE_LABELS[kind]} übernehmen`} htmlFor={ENTRY_FIELD}>
          <div className="flex items-center gap-2">
            <SearchableSelect
              id={ENTRY_FIELD}
              value={picked}
              onChange={add}
              options={search.options}
              onSearchChange={search.onSearchChange}
              loading={search.loading}
              loadFailure={search.loadFailure}
              onLoadMore={search.onLoadMore}
              disabled={disabled || isPending}
              placeholder={kind === 'leistung' ? 'Leistung suchen…' : 'Artikel suchen…'}
              searchPlaceholder="Nummer oder Name…"
              emptyMessage="Nichts gefunden"
            />
            <InlinePending active={isPending} label="Preis wird übernommen" />
          </div>
        </Field>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Under a line from the catalog: where it came from, and whether that entry is archived now. */
export function InvoiceLineSourceNote({ source }: { source: InvoiceLineSource }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span className="min-w-0 break-words">Aus {lineSourceLabel(source)}</span>
      {source.archived && <Badge>Archiviert</Badge>}
    </p>
  );
}
