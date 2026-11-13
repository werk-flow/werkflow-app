'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { usePendingTask } from '@/hooks/use-server-action';
import { useReportPending } from '@/hooks/use-report-pending';
import { describeFailure } from '@/lib/action-messages';
import type { ActionResult } from '@/lib/action-result';
import type { AddArticlePriceInput } from '@/lib/inventory/action-schemas';
import {
  ARTICLE_PRICE_ORIGIN_LABELS,
  PRICE_QUANTITIES,
  type ArticlePriceEntry,
  type ArticlePriceKind,
} from '@/lib/inventory/article-price-terms';
import type { PriceQuantity } from '@/lib/inventory/line-amount';
import { parseEuroCents } from '@/lib/price-catalog/money';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { formatGermanDate, parseIsoLocalDate, toLocalDateString } from '@/lib/utils';
import { ARTICLE_TERMS_FAILURE_MESSAGES } from './article-supplier-dialog';
import {
  ARTICLE_PRICE_STATE_BADGES,
  articlePriceState,
  formatArticlePrice,
  unitShortLabel,
} from '@/lib/inventory/article-terms-format';

const KIND_LABELS: Record<ArticlePriceKind, string> = {
  purchase: 'Einkaufspreis',
  sale: 'Verkaufspreis',
};

type PriceForm = { kind: ArticlePriceKind; amount: string; priceQuantity: PriceQuantity; validFrom: string };

const emptyPriceForm = (priceDate: string): PriceForm => ({
  kind: 'purchase',
  amount: '',
  priceQuantity: 1,
  validFrom: priceDate,
});

function priceFormErrors(form: PriceForm) {
  return {
    'article-price-amount':
      parseEuroCents(form.amount) === undefined || form.amount.trim() === ''
        ? 'Bitte gib einen gültigen Preis ein, zum Beispiel 12,50.'
        : undefined,
    'article-price-valid-from': form.validFrom ? undefined : 'Bitte wähle den Tag, ab dem der Preis gilt.',
  };
}

/**
 * The prices of one article in the article dialog: today's purchase and sale
 * price with first day and source, every recorded price, and the form for a
 * new one. A recorded price never changes; a new price starts on its own day.
 */
export function ArticlePricesPanel({
  itemId,
  baseUnit,
  prices,
  priceDate,
  onAdd,
  onClose,
  onPendingChange,
}: {
  itemId: string;
  baseUnit: string;
  /** Every price of the article, or `null` when the read failed. */
  prices: ArticlePriceEntry[] | null;
  /** The Berlin day the prices were read for. */
  priceDate: string;
  onAdd: (input: AddArticlePriceInput) => Promise<ActionResult<{ priceId: string }> | null>;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [form, setForm] = useState(() => emptyPriceForm(priceDate));
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = usePendingTask();
  useReportPending(isPending, onPendingChange);
  const errors = priceFormErrors(form);
  const shown: Partial<typeof errors> = attempted ? errors : {};

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    const amountCents = parseEuroCents(form.amount);
    if (focusFirstInvalidField(errors) || amountCents === null || amountCents === undefined) return;
    void run(async () => {
      setError(null);
      const result = await onAdd({
        itemId,
        kind: form.kind,
        amountCents,
        priceQuantity: form.priceQuantity,
        validFrom: form.validFrom,
      }).catch(() => null);
      if (!result?.success) {
        setError(
          describeFailure(
            result?.error ?? 'save_failed',
            ARTICLE_TERMS_FAILURE_MESSAGES,
            'Der Preis konnte nicht gespeichert werden.',
          ),
        );
        return;
      }
      setAttempted(false);
      setForm(emptyPriceForm(priceDate));
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="space-y-6 py-1">
        {prices === null ? (
          <RegionLoadError title="Preise nicht geladen">
            Die Preise des Artikels konnten nicht geladen werden. Versuche es noch einmal.
          </RegionLoadError>
        ) : (
          <>
            <CurrentPrices prices={prices} />
            <PriceHistory prices={prices} priceDate={priceDate} />
          </>
        )}
        <NewPriceSection form={form} setForm={setForm} errors={shown} error={error} baseUnit={baseUnit} />
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
          Schließen
        </Button>
        <Button type="submit" pending={isPending} disabled={isPending}>
          Preis speichern
        </Button>
      </DialogFooter>
    </form>
  );
}

function PriceKindField({ form, setForm }: { form: PriceForm; setForm: (form: PriceForm) => void }) {
  return (
    <Field label="Art" htmlFor="article-price-kind">
      <Select
        value={form.kind}
        onValueChange={(value) => {
          if (value === 'purchase' || value === 'sale') setForm({ ...form, kind: value });
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="purchase">{KIND_LABELS.purchase}</SelectItem>
          <SelectItem value="sale">{KIND_LABELS.sale}</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

/** The base units one price is stated for: 1, 10, 100 or 1000. */
function PriceQuantityField({
  form,
  setForm,
  baseUnit,
}: {
  form: PriceForm;
  setForm: (form: PriceForm) => void;
  baseUnit: string;
}) {
  return (
    <Field
      label="Je"
      htmlFor="article-price-quantity"
      description="Großhändler nennen Kleinteile oft je 100 Stück."
    >
      <Select
        value={String(form.priceQuantity)}
        onValueChange={(value) => {
          const quantity = PRICE_QUANTITIES.find((candidate) => String(candidate) === value);
          if (quantity) setForm({ ...form, priceQuantity: quantity });
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRICE_QUANTITIES.map((quantity) => (
            <SelectItem key={quantity} value={String(quantity)}>
              {quantity} {unitShortLabel(baseUnit)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** The form section of the next price: kind, first day, amount and price quantity. */
function NewPriceSection({
  form,
  setForm,
  errors,
  error,
  baseUnit,
}: {
  form: PriceForm;
  setForm: (form: PriceForm) => void;
  errors: Partial<ReturnType<typeof priceFormErrors>>;
  error: string | null;
  baseUnit: string;
}) {
  return (
    <section className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-semibold">Neuer Preis</h3>
      <p className="text-sm text-muted-foreground">
        Ein neuer Preis gilt ab seinem Tag. Frühere Preise bleiben, wie sie waren, und erfasster Verbrauch
        behält seinen Einkaufspreis.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <PriceKindField form={form} setForm={setForm} />
        <Field
          label="Gültig ab"
          htmlFor="article-price-valid-from"
          required
          error={errors['article-price-valid-from']}
        >
          <DatePicker
            id="article-price-valid-from"
            ariaLabel="Gültig ab"
            value={parseIsoLocalDate(form.validFrom)}
            onChange={(date) => setForm({ ...form, validFrom: date ? toLocalDateString(date) : '' })}
          />
        </Field>
        <Field
          label="Betrag netto"
          htmlFor="article-price-amount"
          required
          error={errors['article-price-amount']}
        >
          <Input
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
          />
        </Field>
        <PriceQuantityField form={form} setForm={setForm} baseUnit={baseUnit} />
      </div>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

/** Today's purchase and sale price, each with its first day and source. */
function CurrentPrices({ prices }: { prices: ArticlePriceEntry[] }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2" aria-label="Aktuelle Preise">
      {(['purchase', 'sale'] as const).map((kind) => {
        const current = prices.find((price) => price.kind === kind && price.isCurrent);
        return (
          <div key={kind} className="space-y-1 rounded-lg border px-3 py-2.5">
            <h3 className="text-sm text-muted-foreground">{KIND_LABELS[kind]}</h3>
            {current ? (
              <>
                <p className="text-base font-semibold tabular-nums">
                  {formatArticlePrice(current.amountCents, current.priceQuantity, current.unit)}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  Gilt seit {formatGermanDate(current.validFrom)} ·{' '}
                  {ARTICLE_PRICE_ORIGIN_LABELS[current.origin]}
                </p>
              </>
            ) : (
              <EmptyState size="compact" title="Kein Preis für heute." />
            )}
          </div>
        );
      })}
    </section>
  );
}

/** Every recorded price, latest first day first; rows on phones, a table on wide screens. */
function PriceHistory({ prices, priceDate }: { prices: ArticlePriceEntry[]; priceDate: string }) {
  const rows = prices.map((price) => ({ price, state: articlePriceState(price, priceDate) }));
  return (
    <section className="space-y-2" aria-label="Preisverlauf">
      <h3 className="text-sm font-semibold">Preisverlauf</h3>
      {rows.length === 0 ? (
        <EmptyState
          size="compact"
          title="Noch kein Preis erfasst."
          description="Erfasse unten den ersten Einkaufs- oder Verkaufspreis."
        />
      ) : (
        <>
          <ul className="divide-y rounded-lg border md:hidden">
            {rows.map(({ price, state }) => (
              <li key={price.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{KIND_LABELS[price.kind]}</p>
                  <p className="text-sm tabular-nums">
                    {formatArticlePrice(price.amountCents, price.priceQuantity, price.unit)}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    ab {formatGermanDate(price.validFrom)} · {ARTICLE_PRICE_ORIGIN_LABELS[price.origin]} ·
                    erfasst am {formatGermanDate(price.recordedAt)}
                  </p>
                </div>
                <Badge variant={ARTICLE_PRICE_STATE_BADGES[state].variant}>
                  {ARTICLE_PRICE_STATE_BADGES[state].label}
                </Badge>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Art</TableHead>
                  <TableHead className="text-right">Preis</TableHead>
                  <TableHead>Gültig ab</TableHead>
                  <TableHead>Quelle</TableHead>
                  <TableHead>Erfasst am</TableHead>
                  <TableHead>Stand</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ price, state }) => (
                  <TableRow key={price.id}>
                    <TableCell>{KIND_LABELS[price.kind]}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatArticlePrice(price.amountCents, price.priceQuantity, price.unit)}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatGermanDate(price.validFrom)}</TableCell>
                    <TableCell>{ARTICLE_PRICE_ORIGIN_LABELS[price.origin]}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatGermanDate(price.recordedAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ARTICLE_PRICE_STATE_BADGES[state].variant}>
                        {ARTICLE_PRICE_STATE_BADGES[state].label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}
