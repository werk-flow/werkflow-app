'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import type { ArticleTermsPage } from '@/lib/inventory/article-price-terms';
import type { InventoryCategory, InventoryLocation } from '@/lib/inventory/types';
import { isInventoryUnitCode } from '@/lib/inventory/units';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { getItemNumberFieldErrors, type ItemFormState } from './inventory-form-state';
import {
  ItemMasterDataFields,
  ItemNotesFields,
  ItemStockFields,
  ItemSupplierFields,
} from './inventory-item-form-fields';
import { parseDecimalInput } from '@/lib/ui/decimal';
import { ArticlePricesPanel } from './article-prices-panel';
import { ArticleSuppliersPanel } from './article-suppliers-panel';
import type { ArticleTermWrites } from './use-article-terms';

/** What the saved article carries, beside the form's possibly unsaved values. */
type SavedArticle = {
  unit: string;
  supplierId: string | null;
  supplierArticleNumber: string | null;
};

type ItemDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ItemFormState;
  setForm: (form: ItemFormState) => void;
  categories: InventoryCategory[];
  suppliers: Array<{ id: string; name: string }>;
  locations: InventoryLocation[];
  /** The saved article of an edit, `null` for a new one. */
  savedArticle: SavedArticle | null;
  articleTerms: ArticleTermsPage;
  articleWrites: ArticleTermWrites;
  isSaving: boolean;
  error: string | null;
  onSave: () => void;
};

type ArticleTab = 'stammdaten' | 'lieferanten' | 'preise';

/** An article saved before the unit list may carry a unit outside it; a save needs one from the list. */
function unitFieldError(unit: string): string | undefined {
  if (isInventoryUnitCode(unit)) return undefined;
  return unit.trim()
    ? `„${unit}“ ist keine Einheit aus der Liste. Bitte wähle eine Einheit aus.`
    : 'Bitte wähle eine Einheit aus.';
}

/** The item form's errors, keyed by control id in visual order. */
function itemFieldErrors(form: ItemFormState, initialQuantity: number) {
  return {
    'inventory-item-name': form.name.trim() ? undefined : 'Bitte gib einen Namen ein.',
    'inventory-item-unit': unitFieldError(form.unit),
    'inventory-item-initial-location':
      !form.id && initialQuantity > 0 && !form.initialLocationId
        ? 'Wähle ein Lager für den Startbestand.'
        : undefined,
    ...getItemNumberFieldErrors(form),
  };
}

/** The article's master data, stock and barcode, saved with „Speichern“. */
function MasterDataForm({
  form,
  setForm,
  categories,
  suppliers,
  locations,
  isSaving,
  error,
  onSave,
  onCancel,
  attempted,
  onAttempt,
}: Pick<
  ItemDialogProps,
  'form' | 'setForm' | 'categories' | 'suppliers' | 'locations' | 'isSaving' | 'error' | 'onSave'
> & { onCancel: () => void; attempted: boolean; onAttempt: () => void }) {
  const initialQuantity = parseDecimalInput(form.initialQuantity);
  const fieldErrors = itemFieldErrors(form, initialQuantity);
  const shownErrors: Partial<typeof fieldErrors> = attempted ? fieldErrors : {};
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onAttempt();
        if (focusFirstInvalidField(fieldErrors)) return;
        onSave();
      }}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogBody className="grid gap-4 py-1 sm:grid-cols-2">
        <ItemMasterDataFields
          form={form}
          setForm={setForm}
          categories={categories}
          nameError={shownErrors['inventory-item-name']}
          unitError={shownErrors['inventory-item-unit']}
        />
        <ItemStockFields
          form={form}
          setForm={setForm}
          locations={locations}
          initialQuantity={initialQuantity}
          initialLocationError={shownErrors['inventory-item-initial-location']}
          numberErrors={shownErrors}
        />
        <ItemSupplierFields form={form} setForm={setForm} suppliers={suppliers} numberErrors={shownErrors} />
        <ItemNotesFields form={form} setForm={setForm} />
        <div className="sm:col-span-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
          Abbrechen
        </Button>
        <Button pending={isSaving} type="submit" disabled={isSaving}>
          Speichern
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ItemDialog(props: ItemDialogProps) {
  const { open, onOpenChange, form, savedArticle, articleTerms, articleWrites, isSaving } = props;
  const [attempted, setAttempted] = useState(false);
  const [tab, setTab] = useState<ArticleTab>('stammdaten');
  const [pricePending, setPricePending] = useState(false);
  // A reopened dialog starts on its first tab without the previous attempt's errors (adjust state on prop change).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setAttempted(false);
      setTab('stammdaten');
    }
  }
  const masterDataForm = (
    <MasterDataForm
      {...props}
      onCancel={() => onOpenChange(false)}
      attempted={attempted}
      onAttempt={() => setAttempted(true)}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isSaving || pricePending}>
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle>{form.id ? 'Artikel bearbeiten' : 'Artikel anlegen'}</DialogTitle>
          <DialogDescription>
            {form.id
              ? 'Stammdaten, Lieferanten mit Packungsgrößen und Preise mit ihrem Gültigkeitstag.'
              : 'Stammdaten, Lagerkennzahlen und Barcode für den Inventarartikel.'}
          </DialogDescription>
        </DialogHeader>
        {form.id && savedArticle ? (
          <Tabs
            value={tab}
            // A tab change unmounts the saving form and would release the dialog mid-request.
            onValueChange={(next) => {
              if (isSaving || pricePending) return;
              if (next === 'stammdaten' || next === 'lieferanten' || next === 'preise') setTab(next);
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList>
              <TabsTrigger value="stammdaten">Stammdaten</TabsTrigger>
              <TabsTrigger value="lieferanten">Lieferanten</TabsTrigger>
              <TabsTrigger value="preise">Preise</TabsTrigger>
            </TabsList>
            <TabsContent value="stammdaten" className="flex min-h-0 flex-1 flex-col">
              {masterDataForm}
            </TabsContent>
            <ArticleTermsTabs
              itemId={form.id}
              savedArticle={savedArticle}
              articleTerms={articleTerms}
              writes={articleWrites}
              suppliers={props.suppliers}
              onClose={() => onOpenChange(false)}
              onPricePendingChange={setPricePending}
            />
          </Tabs>
        ) : (
          masterDataForm
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The „Lieferanten“ and „Preise“ tabs of a saved article; each change saves at once. */
function ArticleTermsTabs({
  itemId,
  savedArticle,
  articleTerms,
  writes,
  suppliers,
  onClose,
  onPricePendingChange,
}: {
  itemId: string;
  savedArticle: SavedArticle;
  articleTerms: ArticleTermsPage;
  writes: ArticleTermWrites;
  suppliers: Array<{ id: string; name: string }>;
  onClose: () => void;
  onPricePendingChange: (pending: boolean) => void;
}) {
  const terms =
    articleTerms.status === 'loaded' ? (articleTerms.byItem[itemId] ?? { suppliers: [], prices: [] }) : null;
  const priceDate = articleTerms.status === 'loaded' ? articleTerms.priceDate : getBusinessTodayIso();
  // An article number the article carries without a supplier waits for its first reference.
  const orphanArticleNumber = savedArticle.supplierId === null ? savedArticle.supplierArticleNumber : null;
  return (
    <>
      <TabsContent value="lieferanten" className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="py-1">
          <ArticleSuppliersPanel
            itemId={itemId}
            baseUnit={savedArticle.unit}
            references={terms?.suppliers ?? null}
            orphanArticleNumber={orphanArticleNumber}
            suppliers={suppliers}
            onSave={writes.saveSupplier}
            onRemove={writes.removeSupplier}
          />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Schließen
          </Button>
        </DialogFooter>
      </TabsContent>
      <TabsContent value="preise" className="flex min-h-0 flex-1 flex-col">
        <ArticlePricesPanel
          itemId={itemId}
          baseUnit={savedArticle.unit}
          prices={terms?.prices ?? null}
          priceDate={priceDate}
          onAdd={writes.addPrice}
          onClose={onClose}
          onPendingChange={onPricePendingChange}
        />
      </TabsContent>
    </>
  );
}
