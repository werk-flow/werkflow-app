'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { InventoryCategory, InventoryLocation } from '@/lib/inventory/types';
import {
  IMPORT_COLUMNS,
  importTotals,
  type ImportColumnMapping,
  type ImportRowOutcome,
} from '@/lib/inventory/csv-import';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { formatBerlinDateTime } from '@/lib/utils';
import { ImportOutcomeList, ImportTotalsSummary } from './inventory-import-outcomes';
import { useInventoryCsvImport, type RepeatCheck } from './use-inventory-csv-import';

type ImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingItemCount: number;
  locations: InventoryLocation[];
  categories: InventoryCategory[];
};

type CsvImport = ReturnType<typeof useInventoryCsvImport>;

/** One picker per import column: which CSV header fills it, or none. */
function ImportColumnMappingFields({
  headers,
  mapping,
  setMapping,
  nameMappingError,
}: {
  headers: string[];
  mapping: ImportColumnMapping;
  setMapping: (mapping: ImportColumnMapping) => void;
  nameMappingError: string | undefined;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {IMPORT_COLUMNS.map((column) => (
        <Field
          key={column.key}
          label={column.label}
          htmlFor={`inventory-import-${column.key}`}
          required={column.key === 'name'}
          error={column.key === 'name' ? nameMappingError : undefined}
        >
          <SearchableSelect
            options={headers.map((header) => ({ value: header, label: header }))}
            value={mapping[column.key] ?? ''}
            onChange={(value) =>
              setMapping({
                ...mapping,
                [column.key]: value || undefined,
              })
            }
            placeholder="Nicht importieren"
            searchPlaceholder="Spalte suchen …"
            emptyMessage="Keine Spalte gefunden"
            allowNone
            noneLabel="Nicht importieren"
          />
        </Field>
      ))}
    </div>
  );
}

/** The warning before a file whose content was booked before, or whose check failed; the user decides. */
function RepeatNotice({
  repeat,
  error,
  onConfirm,
  onRetry,
  onOtherFile,
}: {
  repeat: RepeatCheck;
  error: string | undefined;
  onConfirm: () => void;
  onRetry: () => void;
  onOtherFile: () => void;
}) {
  if (repeat.state === 'checking') {
    return <p className="text-sm text-muted-foreground">Prüfe, ob du diese Datei schon importiert hast …</p>;
  }
  if (repeat.state === 'none' || repeat.state === 'clear') return null;
  const message =
    repeat.state === 'repeat'
      ? `Diese Datei wurde schon am ${formatBerlinDateTime(repeat.bookedAt)} von ${repeat.bookedBy} importiert. Ein zweiter Import bucht ihre Mengen noch einmal.`
      : 'Ob diese Datei schon importiert wurde, konnte nicht geprüft werden.';
  if (repeat.confirmed) {
    return <p className="text-sm text-muted-foreground">{message} Du importierst sie trotzdem.</p>;
  }
  return (
    <div className="space-y-3 rounded-lg border border-warning bg-warning-soft p-3 text-warning-soft-foreground">
      <p className="text-sm">{message}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" id="inventory-import-repeat" onClick={onConfirm}>
          Trotzdem fortfahren
        </Button>
        {repeat.state === 'failed' && (
          <Button type="button" variant="outline" onClick={onRetry}>
            Erneut prüfen
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onOtherFile}>
          Andere Datei wählen
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** File, repeat decision, mode and column mapping. */
function ChooseStep({ csvImport }: { csvImport: CsvImport }) {
  return (
    <>
      <Field label="CSV-Datei" htmlFor="inventory-import-file" required error={csvImport.fileError}>
        <FileInput
          buttonLabel="CSV-Datei auswählen"
          fileName={csvImport.fileName || null}
          accept=".csv,text/csv"
          onSelect={csvImport.handleFile}
        />
      </Field>
      <RepeatNotice
        repeat={csvImport.repeat}
        error={csvImport.repeatError}
        onConfirm={csvImport.confirmRepeat}
        onRetry={csvImport.retryRepeat}
        onOtherFile={csvImport.clearFile}
      />
      {csvImport.headers.length > 0 && (
        <>
          <div className="flex items-start gap-2 rounded-md border px-3 py-2">
            <Checkbox
              id="inventory-import-master-data"
              className="mt-0.5"
              checked={csvImport.mode === 'master_data'}
              onCheckedChange={(checked) => csvImport.setMode(checked === true ? 'master_data' : 'stock')}
            />
            <Label htmlFor="inventory-import-master-data" className="block font-normal">
              <span className="font-medium">Nur Stammdaten und Preise</span>
              <span className="block text-muted-foreground">
                Legt Artikel an, bucht aber keinen Bestand, auch wenn die Datei Mengen enthält.
              </span>
            </Label>
          </div>
          <ImportColumnMappingFields
            headers={csvImport.headers}
            mapping={csvImport.mapping}
            setMapping={csvImport.setMapping}
            nameMappingError={csvImport.nameMappingError}
          />
        </>
      )}
    </>
  );
}

function dialogDescription(csvImport: CsvImport, props: ImportDialogProps): string {
  const { step, rows } = csvImport;
  if (step.kind === 'preview') return `Vorschau von ${rows.length} Zeilen. Noch ist nichts gebucht.`;
  if (step.kind === 'result') {
    return step.alreadyBooked
      ? 'Dieser Import war schon gebucht. Es wurde nichts doppelt gebucht.'
      : 'Der Import ist gebucht. Diese Zeilen wurden nicht so übernommen, wie die Datei sie enthält.';
  }
  return rows.length > 0
    ? `${rows.length} Zeilen erkannt`
    : `${props.existingItemCount} bestehende Artikel, ${props.locations.length} Lager, ${props.categories.length} Kategorien`;
}

/** The download of the result report, above the rows it holds; nothing when every row went in as the file says. */
function ReportDownload({ csvImport, outcomes }: { csvImport: CsvImport; outcomes: ImportRowOutcome[] }) {
  const report = csvImport.report(outcomes);
  if (report === null) return null;
  return (
    <Button type="button" variant="outline" onClick={() => csvImport.downloadReport(report)}>
      Bericht herunterladen
    </Button>
  );
}

/** The footer of each step: its way back and its one primary action. */
function StepFooter({ csvImport }: { csvImport: CsvImport }) {
  const { step, isPending } = csvImport;
  return (
    <DialogFooter>
      {step.kind === 'choose' && (
        <Button
          type="button"
          variant="outline"
          onClick={() => csvImport.handleOpenChange(false)}
          disabled={isPending}
        >
          Abbrechen
        </Button>
      )}
      {step.kind === 'preview' && (
        <Button type="button" variant="outline" onClick={csvImport.backToChoose} disabled={isPending}>
          Zurück zur Zuordnung
        </Button>
      )}
      <Button pending={isPending} type="submit" disabled={isPending}>
        {step.kind === 'choose' ? 'Vorschau anzeigen' : step.kind === 'preview' ? 'Jetzt buchen' : 'Fertig'}
      </Button>
    </DialogFooter>
  );
}

export function ImportDialog(props: ImportDialogProps) {
  const csvImport = useInventoryCsvImport({ onOpenChange: props.onOpenChange });
  const { step, mode } = csvImport;

  return (
    <Dialog open={props.open} onOpenChange={csvImport.handleOpenChange} pending={csvImport.isPending}>
      <DialogContent size="3xl">
        <DialogHeader>
          <DialogTitle>CSV importieren</DialogTitle>
          <DialogDescription>{dialogDescription(csvImport, props)}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (step.kind === 'preview') return csvImport.book(step.batchId);
            if (step.kind === 'result') return csvImport.handleOpenChange(false);
            csvImport.setAttempted(true);
            if (focusFirstInvalidField(csvImport.validationErrors)) return;
            csvImport.preview();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody className="space-y-4 py-1" data-import-repeat-check={csvImport.repeat.state}>
            {step.kind === 'choose' && <ChooseStep csvImport={csvImport} />}
            {step.kind !== 'choose' && (
              <>
                <ImportTotalsSummary totals={importTotals(step.outcomes)} mode={mode} />
                {step.kind === 'result' && <ReportDownload csvImport={csvImport} outcomes={step.outcomes} />}
                <ImportOutcomeList
                  outcomes={step.outcomes}
                  importRows={csvImport.importRows}
                  lineNumbers={csvImport.lineNumbers}
                  mode={mode}
                  onlyProblems={step.kind === 'result'}
                />
              </>
            )}
            <ErrorText>{csvImport.error}</ErrorText>
          </DialogBody>
          <StepFooter csvImport={csvImport} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
