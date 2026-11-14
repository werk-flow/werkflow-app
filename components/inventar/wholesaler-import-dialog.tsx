'use client';

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
import { Field } from '@/components/ui/field';
import { FileInput } from '@/components/ui/file-input';
import { ListRow } from '@/components/ui/list-row';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { InventorySupplier } from '@/lib/inventory/types';
import { isInventoryUnitCode, OFFERED_INVENTORY_UNITS } from '@/lib/inventory/units';
import { wholesalerPreviewTotals } from '@/lib/inventory/wholesaler-import-lines';
import type {
  WholesalerImportPreview,
  WholesalerImportResult,
} from '@/lib/inventory/wholesaler-import-schemas';
import { formatFileSize } from '@/lib/documents/format';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { formatBerlinDateTime } from '@/lib/utils';
import { ImportCountGrid, RevealedImportRows } from './inventory-import-outcomes';
import { useWholesalerImport } from './use-wholesaler-import';

type WholesalerImport = ReturnType<typeof useWholesalerImport>;

const UNIT_OPTIONS = OFFERED_INVENTORY_UNITS.map((unit) => ({ value: unit.code, label: unit.label }));

const PHASE_TEXT = {
  uploading: 'Die Dateien werden hochgeladen …',
  reading: 'Die Lieferung wird gelesen …',
  confirming: 'Die Lieferung wird in den Katalog übernommen …',
} as const;

function formatDeliveryDate(date: string | null): string {
  if (!date) return 'nicht angegeben';
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year}`;
}

/** The counts of a preview or a result. */
function WholesalerCounts({ totals }: { totals: WholesalerImportResult }) {
  return (
    <section aria-label="Summen" className="rounded-lg border p-3">
      <ImportCountGrid
        counts={[
          { label: 'Neue Artikel', value: totals.created },
          { label: 'Geänderte Artikel', value: totals.changed },
          { label: 'Unverändert', value: totals.unchanged },
          { label: 'Neue Preise', value: totals.priceChanged + totals.priceUpdates },
          { label: 'Entfernte Artikel', value: totals.removed },
          {
            label: 'Abgelehnte Zeilen',
            value: totals.rejected + totals.unitRejected + totals.priceUnmatched,
          },
        ]}
      />
    </section>
  );
}

/** Supplier and the files of one delivery. */
function DeliveryChoiceStep({
  wholesalerImport,
  suppliers,
}: {
  wholesalerImport: WholesalerImport;
  suppliers: readonly Pick<InventorySupplier, 'id' | 'name'>[];
}) {
  const { files } = wholesalerImport;
  return (
    <>
      <Field
        label="Großhändler"
        htmlFor="wholesaler-import-supplier"
        required
        error={wholesalerImport.supplierError}
      >
        <SearchableSelect
          options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))}
          value={wholesalerImport.supplierId}
          onChange={wholesalerImport.setSupplierId}
          placeholder="Großhändler wählen"
          searchPlaceholder="Großhändler suchen …"
          emptyMessage="Kein Großhändler gefunden."
        />
      </Field>
      <Field
        label="Dateien der Lieferung"
        htmlFor="wholesaler-import-files"
        required
        error={wholesalerImport.filesError}
        description="Wähle alle Dateien einer Lieferung, zum Beispiel Artikel- und Preisdatei. Bis „Übernehmen“ ändert sich nichts."
      >
        <FileInput
          buttonLabel={files.length > 0 ? 'Weitere Datei hinzufügen' : 'Datei auswählen'}
          fileName={null}
          onSelect={wholesalerImport.addFile}
        />
      </Field>
      {files.length > 0 && (
        <ul aria-label="Gewählte Dateien" className="divide-y rounded-lg border">
          {files.map((file) => (
            <li key={file.name} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate text-sm">
                {file.name} <span className="text-muted-foreground">· {formatFileSize(file.size)}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => wholesalerImport.removeFile(file.name)}
                aria-label={`${file.name} entfernen`}
              >
                Entfernen
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The delivery as read: which wholesaler, which date and version, which files. */
function DeliverySummary({
  preview,
  supplierName,
}: {
  preview: WholesalerImportPreview;
  supplierName: string;
}) {
  const { delivery } = preview;
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
      <dt className="text-muted-foreground">Großhändler</dt>
      <dd>{supplierName}</dd>
      <dt className="text-muted-foreground">Absender laut Lieferung</dt>
      <dd>{delivery.supplierText || 'nicht angegeben'}</dd>
      <dt className="text-muted-foreground">Stand</dt>
      <dd>
        {formatDeliveryDate(delivery.date)}
        {delivery.formatVersion ? ` · Version ${delivery.formatVersion}` : ''}
      </dd>
      <dt className="text-muted-foreground">Dateien</dt>
      <dd className="wrap-anywhere">{delivery.fileNames.join(', ')}</dd>
    </dl>
  );
}

/** One unit text of the delivery and the unit the office maps it to. */
function UnitMappingFields({
  wholesalerImport,
  preview,
}: {
  wholesalerImport: WholesalerImport;
  preview: WholesalerImportPreview;
}) {
  return (
    <section aria-label="Einheiten" className="space-y-3">
      <p className="text-sm font-medium">Einheiten der Lieferung</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {preview.units.map((unit, index) => {
          const mapped = wholesalerImport.unitMapping[unit.unitText] ?? null;
          const articles = `${unit.articles.toLocaleString('de-DE')} Artikel`;
          return (
            <Field
              key={unit.unitText}
              label={`„${unit.unitText || 'ohne Einheit'}“ · ${articles}`}
              htmlFor={`wholesaler-import-unit-${index}`}
              description={mapped ? undefined : 'Nicht zugeordnet: Diese Artikel werden abgelehnt.'}
            >
              <SearchableSelect
                options={UNIT_OPTIONS}
                value={mapped ?? ''}
                onChange={(value) =>
                  wholesalerImport.setUnit(unit.unitText, isInventoryUnitCode(value) ? value : null)
                }
                placeholder="Nicht zuordnen"
                searchPlaceholder="Einheit suchen …"
                emptyMessage="Keine Einheit gefunden"
                allowNone
                noneLabel="Nicht zuordnen"
              />
            </Field>
          );
        })}
      </div>
    </section>
  );
}

/** The warning before a delivery that was taken over before; the office decides. */
function RepeatWarning({
  wholesalerImport,
  preview,
}: {
  wholesalerImport: WholesalerImport;
  preview: WholesalerImportPreview;
}) {
  if (!preview.repeat) return null;
  const message = `Diese Lieferung wurde schon am ${formatBerlinDateTime(preview.repeat.confirmedAt)} von ${preview.repeat.confirmedBy} übernommen.`;
  if (wholesalerImport.repeatConfirmed) {
    return <p className="text-sm text-muted-foreground">{message} Du übernimmst sie trotzdem.</p>;
  }
  return (
    <div className="space-y-3 rounded-lg border border-warning bg-warning-soft p-3 text-warning-soft-foreground">
      <p className="text-sm">{message} Was schon so im Katalog steht, bleibt unverändert.</p>
      <Button
        type="button"
        variant="outline"
        id="wholesaler-import-repeat"
        onClick={wholesalerImport.confirmRepeat}
      >
        Trotzdem übernehmen
      </Button>
      <ErrorText>{wholesalerImport.repeatError}</ErrorText>
    </div>
  );
}

function PreviewStep({
  wholesalerImport,
  preview,
  supplierName,
}: {
  wholesalerImport: WholesalerImport;
  preview: WholesalerImportPreview;
  supplierName: string;
}) {
  return (
    <>
      <DeliverySummary preview={preview} supplierName={supplierName} />
      <RepeatWarning wholesalerImport={wholesalerImport} preview={preview} />
      <WholesalerCounts totals={wholesalerPreviewTotals(preview, wholesalerImport.unitMapping)} />
      <p className="text-sm text-muted-foreground">
        Die Artikel kommen in den Katalog dieses Großhändlers, nicht ins Inventar. Eigene Artikel, ihre Preise
        und der Bestand bleiben unverändert.
        {preview.rebateGroups > 0 &&
          ` ${preview.rebateGroups} ${preview.rebateGroups === 1 ? 'Rabattgruppe wird' : 'Rabattgruppen werden'} gespeichert.`}
      </p>
      {preview.units.length > 0 && (
        <UnitMappingFields wholesalerImport={wholesalerImport} preview={preview} />
      )}
      {preview.rejections.length > 0 && (
        <section aria-label="Abgelehnte Zeilen" className="space-y-3">
          <p className="text-sm font-medium">Zeilen, die nicht gelesen werden konnten</p>
          <RevealedImportRows
            rows={preview.rejections}
            rowKey={(row) => `${row.fileName}:${row.lineNumber}`}
            renderRow={(row) => (
              <ListRow variant="plain" rowId={`wholesaler-rejection-${row.fileName}-${row.lineNumber}`}>
                <p className="text-xs text-muted-foreground">
                  {row.fileName}, Zeile {row.lineNumber}
                  {row.articleNumber ? ` · Nr. ${row.articleNumber}` : ''}
                </p>
                <p className="text-sm text-destructive">{row.reason}</p>
              </ListRow>
            )}
          />
        </section>
      )}
    </>
  );
}

function ResultStep({
  wholesalerImport,
  step,
}: {
  wholesalerImport: WholesalerImport;
  step: Extract<WholesalerImport['step'], { kind: 'result' }>;
}) {
  const { result } = step;
  const hasReport = result.rejected + result.unitRejected + result.priceUnmatched > 0;
  return (
    <>
      <WholesalerCounts totals={result} />
      {hasReport && (
        <Button
          type="button"
          variant="outline"
          onClick={() => wholesalerImport.downloadReport(step.importId)}
          disabled={wholesalerImport.isPending}
        >
          Bericht herunterladen
        </Button>
      )}
    </>
  );
}

function wholesalerDialogDescription(step: WholesalerImport['step']): string {
  if (step.kind === 'preview') return 'Vorschau der Lieferung. Noch ist nichts übernommen.';
  if (step.kind === 'result') {
    return step.alreadyConfirmed
      ? 'Diese Lieferung war schon übernommen. Es wurde nichts doppelt geändert.'
      : 'Die Lieferung ist im Katalog des Großhändlers.';
  }
  return 'Lies die Artikel und Preise eines Großhändlers in seinen Katalog ein.';
}

function WholesalerStepFooter({ wholesalerImport }: { wholesalerImport: WholesalerImport }) {
  const { step, isPending } = wholesalerImport;
  return (
    <DialogFooter>
      {step.kind === 'choose' && (
        <Button
          type="button"
          variant="outline"
          onClick={() => wholesalerImport.handleOpenChange(false)}
          disabled={isPending}
        >
          Abbrechen
        </Button>
      )}
      {step.kind === 'preview' && (
        <Button type="button" variant="outline" onClick={wholesalerImport.backToChoose} disabled={isPending}>
          Andere Dateien wählen
        </Button>
      )}
      <Button pending={isPending} type="submit" disabled={isPending}>
        {step.kind === 'choose' ? 'Vorschau anzeigen' : step.kind === 'preview' ? 'Übernehmen' : 'Fertig'}
      </Button>
    </DialogFooter>
  );
}

/** The wholesaler import: supplier and files, the preview with its unit choice, and the result. */
export function WholesalerImportDialog({
  open,
  onOpenChange,
  suppliers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suppliers: readonly Pick<InventorySupplier, 'id' | 'name'>[];
}) {
  const wholesalerImport = useWholesalerImport({ onOpenChange });
  const { step } = wholesalerImport;
  // The preview names the supplier it was made for, not one chosen while it loaded.
  const previewSupplierId = step.kind === 'preview' ? step.supplierId : wholesalerImport.supplierId;
  const supplierName = suppliers.find((supplier) => supplier.id === previewSupplierId)?.name ?? '';

  return (
    <Dialog open={open} onOpenChange={wholesalerImport.handleOpenChange} pending={wholesalerImport.isPending}>
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle>Großhandel importieren</DialogTitle>
          <DialogDescription>{wholesalerDialogDescription(step)}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (step.kind === 'preview') return wholesalerImport.confirm(step.preview);
            if (step.kind === 'result') return wholesalerImport.handleOpenChange(false);
            wholesalerImport.setAttempted(true);
            if (focusFirstInvalidField(wholesalerImport.errors)) return;
            wholesalerImport.preview();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody className="space-y-4 py-1">
            {step.kind === 'choose' && (
              <DeliveryChoiceStep wholesalerImport={wholesalerImport} suppliers={suppliers} />
            )}
            {step.kind === 'preview' && (
              <PreviewStep
                wholesalerImport={wholesalerImport}
                preview={step.preview}
                supplierName={supplierName}
              />
            )}
            {step.kind === 'result' && <ResultStep wholesalerImport={wholesalerImport} step={step} />}
            {wholesalerImport.phase && (
              <p className="text-sm text-muted-foreground" role="status">
                {PHASE_TEXT[wholesalerImport.phase]}
              </p>
            )}
            <ErrorText>{wholesalerImport.error}</ErrorText>
          </DialogBody>
          <WholesalerStepFooter wholesalerImport={wholesalerImport} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
