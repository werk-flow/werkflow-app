'use client';

import { useRef, useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { usePendingTask } from '@/hooks/use-server-action';
import type { InventoryImportRow, PreviewInventoryImportInput } from '@/lib/inventory/action-inputs';
import {
  buildImportRows,
  guessMapping,
  importReportCsv,
  importResultMessage,
  importRowProblem,
  importTotals,
  parseCsv,
  type ImportColumnMapping,
  type ImportRowOutcome,
  type InventoryImportMode,
} from '@/lib/inventory/csv-import';
import {
  bookInventoryImport,
  findInventoryImportRepeat,
  previewInventoryImport,
} from '@/lib/inventory/import-actions';

/**
 * The file and the mode a preview was made from. The preview and the result
 * render and report from it, so a control changed while the preview loads
 * never mixes into the batch it shows.
 */
type ImportBasis = {
  mode: InventoryImportMode;
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
  lineNumbers: number[];
  importRows: InventoryImportRow[];
};

/** Where the dialog stands: choosing file and columns, looking at the preview, or reading the result. */
type ImportStep =
  | { kind: 'choose' }
  | { kind: 'preview'; batchId: string; outcomes: ImportRowOutcome[]; basis: ImportBasis }
  | { kind: 'result'; outcomes: ImportRowOutcome[]; alreadyBooked: boolean; basis: ImportBasis };

/** Whether the chosen file's content was booked before; a repeat or a failed check waits for the user's decision. */
export type RepeatCheck =
  | { state: 'none' }
  | { state: 'checking' }
  | { state: 'clear' }
  | { state: 'repeat'; bookedAt: string; bookedBy: string; confirmed: boolean }
  | { state: 'failed'; confirmed: boolean };

type CsvSource = {
  fileName: string;
  contentHash: string;
  headers: string[];
  rows: Record<string, string>[];
  lineNumbers: number[];
};
const NO_SOURCE: CsvSource = { fileName: '', contentHash: '', headers: [], rows: [], lineNumbers: [] };

/** The file's text and the SHA-256 of its bytes, both read in the browser; the bytes never leave it. */
async function readCsvFile(file: File): Promise<{ text: string; contentHash: string }> {
  const bytes = await file.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const contentHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { text: new TextDecoder().decode(bytes), contentHash };
}

/** The import form's checks in visual order, keyed by control id; shown after the first submit attempt. */
function importValidationErrors(
  rowCount: number,
  mapping: ImportColumnMapping,
  fileRefusal: string | undefined,
  repeat: RepeatCheck,
): Record<'inventory-import-file' | 'inventory-import-repeat' | 'inventory-import-name', string | undefined> {
  const undecided = (repeat.state === 'repeat' || repeat.state === 'failed') && !repeat.confirmed;
  return {
    'inventory-import-file':
      fileRefusal ??
      (rowCount === 0
        ? 'Wähle eine CSV-Datei mit mindestens einer Datenzeile.'
        : repeat.state === 'checking'
          ? 'Die Datei wird noch geprüft. Versuch es gleich noch einmal.'
          : undefined),
    'inventory-import-repeat': undecided
      ? 'Entscheide, ob du diese Datei noch einmal importierst.'
      : undefined,
    'inventory-import-name':
      rowCount > 0 && !mapping.name ? 'Ordne die Spalte mit dem Artikelnamen zu.' : undefined,
  };
}

/** The chosen CSV file, parsed, with its guessed column mapping and its repeat check. A later selection or a clear outdates every earlier read. */
function useCsvFile() {
  const latestRead = useRef(0);
  const [source, setSource] = useState(NO_SOURCE);
  const [mapping, setMapping] = useState<ImportColumnMapping>({});
  // Why the chosen file was refused; shown on the file field at once, not only after a submit.
  const [fileRefusal, setFileRefusal] = useState<string | undefined>();
  const [repeat, setRepeat] = useState<RepeatCheck>({ state: 'none' });

  function clear() {
    latestRead.current += 1;
    setSource(NO_SOURCE);
    setMapping({});
    setFileRefusal(undefined);
    setRepeat({ state: 'none' });
  }

  async function checkRepeat(contentHash: string, thisRead: number) {
    setRepeat({ state: 'checking' });
    const result = await findInventoryImportRepeat({ contentHash }).catch(() => null);
    if (thisRead !== latestRead.current) return;
    if (!result?.success) setRepeat({ state: 'failed', confirmed: false });
    else if (result.repeat) setRepeat({ state: 'repeat', ...result.repeat, confirmed: false });
    else setRepeat({ state: 'clear' });
  }

  function read(file: File) {
    clear();
    const thisRead = latestRead.current;
    readCsvFile(file)
      .then(({ text, contentHash }) => {
        if (thisRead !== latestRead.current) return;
        const parsed = parseCsv(text);
        if (!parsed.ok) {
          setFileRefusal(parsed.message);
          return;
        }
        setSource({ fileName: file.name, contentHash, ...parsed });
        setMapping(guessMapping(parsed.headers));
        if (parsed.rows.length > 0) void checkRepeat(contentHash, thisRead);
      })
      .catch(() => {
        if (thisRead === latestRead.current) {
          setFileRefusal('Die Datei konnte nicht gelesen werden. Wähle sie noch einmal.');
        }
      });
  }

  function confirmRepeat() {
    setRepeat((current) =>
      current.state === 'repeat' || current.state === 'failed' ? { ...current, confirmed: true } : current,
    );
  }

  return {
    source,
    mapping,
    setMapping,
    fileRefusal,
    repeat,
    clear,
    read,
    confirmRepeat,
    retryRepeat: () => void checkRepeat(source.contentHash, latestRead.current),
  };
}

/** Saves the result report, built in the browser from the file's own rows. */
function downloadReport(fileName: string, csv: Uint8Array) {
  const url = URL.createObjectURL(new Blob([csv.slice()], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${fileName.replace(/\.csv$/i, '') || 'inventar-import'}-hinweise.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** The preview and the booking with the step they lead to. A booking with nothing to report closes the dialog. */
function useImportRun() {
  const [step, setStep] = useState<ImportStep>({ kind: 'choose' });
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = usePendingTask();

  function preview(input: PreviewInventoryImportInput, basis: ImportBasis) {
    setError(null);
    void run(async () => {
      const result = await previewInventoryImport(input).catch(() => null);
      if (!result?.success) {
        setError(
          'Die Vorschau konnte nicht erstellt werden. Es wurde nichts gebucht. Versuch es noch einmal.',
        );
        return;
      }
      setStep({ kind: 'preview', batchId: result.batchId, outcomes: result.rows, basis });
    });
  }

  function book(
    { batchId, basis }: { batchId: string; basis: ImportBasis },
    onBookedClean: (outcomes: ImportRowOutcome[]) => void,
  ) {
    setError(null);
    void run(async () => {
      const result = await bookInventoryImport({ batchId }).catch(() => null);
      if (!result?.success) {
        // A repeated confirm books once, so trying again is safe.
        setError('Der Import konnte nicht gebucht werden. Versuch es noch einmal.');
        return;
      }
      const hasProblems = result.rows.some((row) => importRowProblem(row, null) !== null);
      if (hasProblems || result.alreadyBooked) {
        setStep({ kind: 'result', outcomes: result.rows, alreadyBooked: result.alreadyBooked, basis });
        return;
      }
      onBookedClean(result.rows);
    });
  }

  function reset() {
    setError(null);
    setStep({ kind: 'choose' });
  }

  return { step, error, setError, isPending, preview, book, reset };
}

/** The CSV import dialog's state: the parsed file, the column mapping, the preview and the booking. */
export function useInventoryCsvImport({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { showBanner } = useBanner();
  const csvFile = useCsvFile();
  const { mapping, fileRefusal, repeat } = csvFile;
  const { fileName, contentHash, headers, rows, lineNumbers } = csvFile.source;
  const [mode, setMode] = useState<InventoryImportMode>('stock');
  const importRun = useImportRun();
  const [attempted, setAttempted] = useState(false);
  const validationErrors = importValidationErrors(rows.length, mapping, fileRefusal, repeat);
  const fileError = fileRefusal ?? (attempted ? validationErrors['inventory-import-file'] : undefined);
  const importRows: InventoryImportRow[] = buildImportRows(rows, mapping);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      csvFile.clear();
      importRun.reset();
      setMode('stock');
      setAttempted(false);
    }
    onOpenChange(nextOpen);
  }

  function handleFile(file: File | null) {
    importRun.setError(null);
    if (file) csvFile.read(file);
    else csvFile.clear();
  }

  function preview() {
    importRun.preview(
      {
        fileName: fileName || 'inventar-import.csv',
        contentHash,
        mode,
        columnMapping: Object.fromEntries(
          Object.entries(mapping).filter((entry): entry is [string, string] => Boolean(entry[1])),
        ),
        rows: importRows,
      },
      { mode, fileName, headers, rows, lineNumbers, importRows },
    );
  }

  return {
    step: importRun.step,
    headers,
    rows,
    importRows,
    lineNumbers,
    fileName,
    mapping,
    setMapping: csvFile.setMapping,
    mode,
    setMode,
    repeat,
    confirmRepeat: csvFile.confirmRepeat,
    retryRepeat: csvFile.retryRepeat,
    clearFile: () => handleFile(null),
    error: importRun.error,
    isPending: importRun.isPending,
    validationErrors,
    fileError,
    repeatError: attempted ? validationErrors['inventory-import-repeat'] : undefined,
    nameMappingError: attempted ? validationErrors['inventory-import-name'] : undefined,
    setAttempted,
    handleOpenChange,
    handleFile,
    preview,
    book: (preview: { batchId: string; basis: ImportBasis }) =>
      importRun.book(preview, (outcomes) => {
        handleOpenChange(false);
        showBanner({ variant: 'success', message: importResultMessage(importTotals(outcomes)) });
      }),
    // A failed booking answer may hide a booking that went through, so the
    // file is checked for a repeat again before the next preview.
    backToChoose: () => {
      importRun.reset();
      csvFile.retryRepeat();
    },
    report: (outcomes: readonly ImportRowOutcome[], basis: ImportBasis) =>
      importReportCsv({ ...basis, outcomes, fileUnits: basis.importRows.map((row) => row.unit ?? null) }),
    downloadReport: (csv: Uint8Array, basis: ImportBasis) => downloadReport(basis.fileName, csv),
  };
}
