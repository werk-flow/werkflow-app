'use client';

import { Plus } from 'lucide-react';

import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { PlainButton } from '@/components/ui/plain-button';
import { SectionError } from '@/components/ui/section-error';
import { formatArticlePrice } from '@/lib/inventory/article-terms-format';
import type { SupplierCatalogOption } from '@/lib/inventory/wholesaler-import-schemas';
import type { SupplierCatalogPicker } from './use-supplier-catalog-search';

const PRICE_KIND_LABELS = { list: 'Listenpreis', net: 'Nettopreis' } as const;

function CatalogOption({
  option,
  adopting,
  disabled,
  onAdopt,
}: {
  option: SupplierCatalogOption;
  adopting: boolean;
  disabled: boolean;
  onAdopt: () => void;
}) {
  const name = [option.name, option.nameAddition].filter(Boolean).join(' ');
  return (
    <PlainButton
      type="button"
      className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
      onClick={onAdopt}
      disabled={disabled}
      aria-busy={adopting || undefined}
    >
      <span className="min-w-0 wrap-anywhere">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          <span>{option.supplierName}</span>
          <span>Nr. {option.articleNumber}</span>
          {option.priceCents !== null && option.priceKind !== null && (
            <span>
              {PRICE_KIND_LABELS[option.priceKind]}{' '}
              {formatArticlePrice(option.priceCents, option.priceQuantity, option.unit)}
            </span>
          )}
        </span>
        {adopting && (
          <span className="mt-1 block text-xs text-muted-foreground" role="status">
            Wird als eigener Artikel angelegt …
          </span>
        )}
      </span>
      <Plus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    </PlainButton>
  );
}

/**
 * The catalog rows below the own articles. Choosing one makes it an own
 * article once and adds it to the positions; a second choice takes that article.
 */
export function SupplierCatalogOptions({ catalog }: { catalog: SupplierCatalogPicker }) {
  if (!catalog.searched) {
    return (
      <p className="text-xs text-muted-foreground">
        Ab drei Zeichen sucht die Suche auch in den Großhandelskatalogen.
      </p>
    );
  }
  return (
    <section aria-label="Aus dem Großhandelskatalog" className="space-y-2">
      <p className="text-sm font-medium">Aus dem Großhandelskatalog</p>
      {catalog.searchFailed && (
        <SectionError onRetry={catalog.retrySearch} retryPending={catalog.isSearching}>
          Die Suche in den Großhandelskatalogen ist fehlgeschlagen.
        </SectionError>
      )}
      {catalog.options.length > 0 ? (
        <div className="divide-y rounded-md border">
          {catalog.options.map((option) => (
            <CatalogOption
              key={option.id}
              option={option}
              adopting={catalog.adoptingId === option.id}
              disabled={catalog.adoptingId !== null}
              onAdopt={() => catalog.adopt(option)}
            />
          ))}
        </div>
      ) : catalog.isSearching ? (
        <p className="text-sm text-muted-foreground" role="status">
          Großhandelskataloge werden durchsucht …
        </p>
      ) : (
        !catalog.searchFailed && (
          <EmptyState
            size="compact"
            className="px-3 py-4 text-center"
            title="Kein Katalogartikel gefunden."
          />
        )
      )}
      <ErrorText>{catalog.adoptError}</ErrorText>
    </section>
  );
}
