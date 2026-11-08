'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { usePendingTask } from '@/hooks/use-server-action';
import type { ImportInventoryRowsInput } from '@/lib/inventory/action-inputs';
import { importInventoryRows } from '@/lib/inventory/actions';
import {
  buildImportRows,
  guessMapping,
  importResultBanner,
  parseCsv,
  type ImportColumnMapping,
} from '@/lib/inventory/csv-import';

type InventoryCsvImport = {
  headers: string[];
  rows: Record<string, string>[];
  mapping: ImportColumnMapping;
  setMapping: (mapping: ImportColumnMapping) => void;
  error: string | null;
  isPending: boolean;
  validationErrors: Readonly<Record<string, string | undefined>>;
  fileError: string | undefined;
  nameMappingError: string | undefined;
  setAttempted: (attempted: boolean) => void;
  handleOpenChange: (nextOpen: boolean) => void;
  handleFile: (file: File | null) => void;
  handleImport: () => void;
};

/** The import form's checks in visual order, keyed by control id; shown after the first submit attempt. */
function importValidationErrors(
  rowCount: number,
  mapping: ImportColumnMapping,
  fileRefusal: string | undefined,
): Record<'inventory-import-file' | 'inventory-import-name', string | undefined> {
  return {
    'inventory-import-file':
      fileRefusal ?? (rowCount === 0 ? 'Wähle eine CSV-Datei mit mindestens einer Datenzeile.' : undefined),
    'inventory-import-name':
      rowCount > 0 && !mapping.name ? 'Ordne die Spalte mit dem Artikelnamen zu.' : undefined,
  };
}

type CsvSource = { fileName: string; headers: string[]; rows: Record<string, string>[] };
const NO_SOURCE: CsvSource = { fileName: '', headers: [], rows: [] };

/** The CSV import dialog's state: the parsed file, the column mapping, the import run. */
export function useInventoryCsvImport({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}): InventoryCsvImport {
  const { showBanner } = useBanner();
  const [source, setSource] = useState(NO_SOURCE);
  const { fileName, headers, rows } = source;
  const [mapping, setMapping] = useState<ImportColumnMapping>({});
  const [error, setError] = useState<string | null>(null);
  // Why the chosen file was refused; shown on the file field at once, not only after a submit.
  const [fileRefusal, setFileRefusal] = useState<string | undefined>();
  const { run: runImportTask, isPending } = usePendingTask();
  const [attempted, setAttempted] = useState(false);
  const validationErrors = importValidationErrors(rows.length, mapping, fileRefusal);
  const fileError = fileRefusal ?? (attempted ? validationErrors['inventory-import-file'] : undefined);
  const nameMappingError = attempted ? validationErrors['inventory-import-name'] : undefined;

  function resetImportState() {
    setSource(NO_SOURCE);
    setMapping({});
    setError(null);
    setFileRefusal(undefined);
    setAttempted(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetImportState();
    onOpenChange(nextOpen);
  }

  function handleFile(file: File | null) {
    setError(null);
    if (!file) return;

    file
      .text()
      .then((content) => {
        const parsed = parseCsv(content);
        setFileRefusal(parsed.ok ? undefined : parsed.message);
        setSource(
          parsed.ok ? { fileName: file.name, headers: parsed.headers, rows: parsed.rows } : NO_SOURCE,
        );
        setMapping(parsed.ok ? guessMapping(parsed.headers) : {});
      })
      .catch(() => setError('Die Datei konnte nicht gelesen werden.'));
  }

  function handleImport() {
    setError(null);
    void runImportTask(async () => {
      const normalizedRows = buildImportRows(rows, mapping);

      const payload: ImportInventoryRowsInput = {
        fileName: fileName || 'inventar-import.csv',
        columnMapping: Object.fromEntries(
          Object.entries(mapping).filter((entry): entry is [string, string] => Boolean(entry[1])),
        ),
        rows: normalizedRows,
      };

      // One server call imports every row; the result carries the counts.
      const result = await importInventoryRows(payload).catch(() => null);
      if (!result?.success) {
        setError('Der Import konnte nicht abgeschlossen werden.');
        return;
      }

      handleOpenChange(false);
      // The action's response renders the route with the imported items.
      showBanner(importResultBanner(result));
    });
  }

  return {
    headers,
    rows,
    mapping,
    setMapping,
    error,
    isPending,
    validationErrors,
    fileError,
    nameMappingError,
    setAttempted,
    handleOpenChange,
    handleFile,
    handleImport,
  };
}
