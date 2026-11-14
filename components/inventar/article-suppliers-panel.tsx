'use client';

import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import type { ActionResult } from '@/lib/action-result';
import type { SaveArticleSupplierInput } from '@/lib/inventory/action-schemas';
import type { ArticleSupplierReference } from '@/lib/inventory/article-price-terms';
import { ARTICLE_TERMS_FAILURE_MESSAGES, ArticleSupplierDialog } from './article-supplier-dialog';
import { describePack } from '@/lib/inventory/article-terms-format';

type EditedReference = { reference: ArticleSupplierReference | null };

/**
 * The supplier references of one article in the article dialog: each with its
 * article number and pack, the preferred one marked. Admin and Büro add,
 * change and remove them; each change saves at once.
 */
export function ArticleSuppliersPanel({
  itemId,
  baseUnit,
  references,
  orphanArticleNumber,
  suppliers,
  onSave,
  onRemove,
}: {
  itemId: string;
  baseUnit: string;
  /** The article's references, or `null` when their read failed. */
  references: ArticleSupplierReference[] | null;
  orphanArticleNumber: string | null;
  suppliers: Array<{ id: string; name: string }>;
  onSave: (input: SaveArticleSupplierInput) => Promise<ActionResult<{ referenceId: string }> | null>;
  onRemove: (referenceId: string) => Promise<ActionResult | null>;
}) {
  const [edited, setEdited] = useState<EditedReference | null>(null);
  const [removing, setRemoving] = useState<ArticleSupplierReference | null>(null);
  const supplierName = (id: string) =>
    suppliers.find((supplier) => supplier.id === id)?.name ?? 'Unbekannter Lieferant';

  if (references === null) {
    return (
      <RegionLoadError title="Lieferanten nicht geladen">
        Die Lieferanten des Artikels konnten nicht geladen werden. Versuche es noch einmal.
      </RegionLoadError>
    );
  }

  return (
    <section className="space-y-3" aria-label="Lieferanten">
      {references.length === 0 ? (
        <EmptyState
          size="compact"
          title="Noch kein Lieferant hinterlegt."
          description="Füge den Lieferanten mit seiner Artikelnummer und Packungsgröße hinzu."
        />
      ) : (
        <SupplierReferenceList
          references={references}
          baseUnit={baseUnit}
          supplierName={supplierName}
          onEdit={(reference) => setEdited({ reference })}
          onRemove={setRemoving}
        />
      )}
      <Button type="button" variant="outline" onClick={() => setEdited({ reference: null })}>
        Lieferant hinzufügen
      </Button>

      {edited ? (
        <ArticleSupplierDialog
          itemId={itemId}
          baseUnit={baseUnit}
          reference={edited.reference}
          isFirst={references.length === 0}
          orphanArticleNumber={orphanArticleNumber}
          suppliers={suppliers}
          onClose={() => setEdited(null)}
          onSave={onSave}
        />
      ) : null}
      {removing ? (
        <RemoveSupplierDialog
          name={supplierName(removing.supplierId)}
          reference={removing}
          onClose={() => setRemoving(null)}
          onRemove={onRemove}
        />
      ) : null}
    </section>
  );
}

/** The references, the preferred one marked, each with its number and pack. */
function SupplierReferenceList({
  references,
  baseUnit,
  supplierName,
  onEdit,
  onRemove,
}: {
  references: ArticleSupplierReference[];
  baseUnit: string;
  supplierName: (supplierId: string) => string;
  onEdit: (reference: ArticleSupplierReference) => void;
  onRemove: (reference: ArticleSupplierReference) => void;
}) {
  return (
    <ul className="divide-y rounded-lg border">
      {references.map((reference) => (
        <li
          key={reference.id}
          className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0 space-y-0.5">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <span className="break-words">{supplierName(reference.supplierId)}</span>
              {reference.isPreferred ? <Badge variant="success">Bevorzugt</Badge> : null}
            </p>
            <p className="text-sm text-muted-foreground break-words">
              {reference.supplierArticleNumber
                ? `Art.-Nr. ${reference.supplierArticleNumber}`
                : 'Ohne Artikelnummer'}{' '}
              · {describePack(reference, baseUnit)}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onEdit(reference)}>
              Bearbeiten
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onRemove(reference)}>
              Entfernen
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function RemoveSupplierDialog({
  name,
  reference,
  onClose,
  onRemove,
}: {
  name: string;
  reference: ArticleSupplierReference;
  onClose: () => void;
  onRemove: (referenceId: string) => Promise<ActionResult | null>;
}) {
  const { run, isPending } = usePendingTask();
  const [error, setError] = useState<string | null>(null);
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()} pending={isPending}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Lieferant „{name}“ entfernen?</AlertDialogTitle>
          <AlertDialogDescription>
            {reference.isPreferred
              ? 'Der Artikel verliert Artikelnummer und Packungsgröße dieses Lieferanten. Der älteste weitere Lieferant wird bevorzugt.'
              : 'Der Artikel verliert Artikelnummer und Packungsgröße dieses Lieferanten. Preise bleiben, wie sie sind.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter error={error}>
          <AlertDialogCancel disabled={isPending}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            pending={isPending}
            disabled={isPending}
            onClick={(event) => {
              // The dialog stays open until the answer: a failure shows here.
              event.preventDefault();
              void run(async () => {
                setError(null);
                const result = await onRemove(reference.id).catch(() => null);
                if (!result?.success) {
                  setError(
                    describeFailure(
                      result?.error ?? 'save_failed',
                      ARTICLE_TERMS_FAILURE_MESSAGES,
                      'Der Lieferant konnte nicht entfernt werden.',
                    ),
                  );
                  return;
                }
                onClose();
              });
            }}
          >
            Entfernen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
