'use client';

import { useState } from 'react';

import { usePendingTask } from '@/hooks/use-server-action';
import type { InventoryUnitCode } from '@/lib/inventory/units';
import {
  abandonWholesalerImport,
  confirmWholesalerImport,
  createWholesalerImportUploadTicket,
  previewWholesalerImport,
  readWholesalerImportReport,
} from '@/lib/inventory/wholesaler-import-actions';
import {
  wholesalerImportReportCsv,
  type WholesalerReportLine,
} from '@/lib/inventory/wholesaler-import-lines';
import { uploadDeliveryFiles } from '@/lib/inventory/wholesaler-import-upload';
import {
  WHOLESALER_IMPORT_MAX_FILE_BYTES,
  WHOLESALER_IMPORT_MAX_FILES,
  type WholesalerImportPreview,
  type WholesalerImportResult,
} from '@/lib/inventory/wholesaler-import-schemas';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { downloadImportReport } from './inventory-import-outcomes';

/** Where the dialog stands: choosing supplier and files, deciding the units in the preview, or reading the result. */
type WholesalerImportStep =
  | { kind: 'choose' }
  /** The supplier the preview was made for: the dialog names it, whatever the select shows since. */
  | { kind: 'preview'; preview: WholesalerImportPreview; supplierId: string }
  | { kind: 'result'; importId: string; result: WholesalerImportResult; alreadyConfirmed: boolean };

/** What a running step does, for the line under the form. */
type WholesalerImportPhase = 'uploading' | 'reading' | 'confirming' | null;

const FAILURE_MESSAGES: Record<string, string> = {
  reader_unavailable: 'Dieser Import ist in dieser Umgebung nicht verfügbar.',
  file_too_large: 'Eine Datei ist größer als 250 MB. Teile die Lieferung auf.',
  file_empty: 'Eine Datei ist leer. Wähle die Dateien der Lieferung noch einmal.',
  file_missing: 'Die Dateien sind nicht angekommen. Versuch es noch einmal.',
  upload_failed: 'Die Dateien konnten nicht hochgeladen werden. Versuch es noch einmal.',
  delivery_unreadable:
    'Die Lieferung konnte nicht gelesen werden. Prüfe, ob alle Dateien zu einer Lieferung gehören.',
  delivery_empty: 'Die Dateien enthalten keine Artikel, Preise oder Löschungen.',
  supplier_not_found: 'Diesen Lieferanten gibt es nicht mehr. Wähle einen anderen.',
  import_not_found: 'Diese Vorschau gilt nicht mehr. Lade die Lieferung noch einmal.',
};
const UPLOAD_FAILED = 'Die Dateien konnten nicht hochgeladen werden. Versuch es noch einmal.';

function failureMessage(error: string | undefined, fallback: string): string {
  return (error && FAILURE_MESSAGES[error]) ?? fallback;
}

/** The choose step's checks in visual order, keyed by control id; shown after the first submit attempt. */
function chooseErrors(
  supplierId: string,
  files: readonly File[],
): Record<'wholesaler-import-supplier' | 'wholesaler-import-files', string | undefined> {
  const tooLarge = files.find((file) => file.size > WHOLESALER_IMPORT_MAX_FILE_BYTES);
  return {
    'wholesaler-import-supplier': supplierId
      ? undefined
      : 'Wähle den Großhändler, von dem die Lieferung stammt.',
    'wholesaler-import-files':
      files.length === 0
        ? 'Wähle mindestens eine Datei der Lieferung.'
        : files.length > WHOLESALER_IMPORT_MAX_FILES
          ? `Eine Lieferung hat höchstens ${WHOLESALER_IMPORT_MAX_FILES} Dateien.`
          : tooLarge
            ? `„${tooLarge.name}“ ist größer als 250 MB.`
            : undefined,
  };
}

/**
 * Signs, uploads and previews one delivery; answers the preview or the
 * sentence that says why not. `onReading` marks the end of the upload.
 */
async function uploadAndPreview(
  supplierId: string,
  files: readonly File[],
  onReading: () => void,
): Promise<{ preview: WholesalerImportPreview } | { error: string }> {
  const ticket = await createWholesalerImportUploadTicket({
    supplierId,
    files: files.map((file) => ({ name: file.name, sizeBytes: file.size })),
  }).catch(() => null);
  if (!ticket?.success) {
    return {
      error: failureMessage(
        ticket?.error,
        'Der Upload konnte nicht vorbereitet werden. Versuch es noch einmal.',
      ),
    };
  }
  if (!(await uploadDeliveryFiles(files, ticket.uploadUrls, ticket.contentType)))
    return { error: UPLOAD_FAILED };
  onReading();
  const result = await previewWholesalerImport({
    uploadId: ticket.uploadId,
    supplierId,
    fileNames: files.map((file) => file.name),
  }).catch(() => null);
  if (!result?.success) {
    return {
      error: failureMessage(
        result?.error,
        'Die Vorschau konnte nicht erstellt werden. Es wurde nichts übernommen. Versuch es noch einmal.',
      ),
    };
  }
  return { preview: result.preview };
}

/** Every line of a confirmed import's report, read part by part; null when a part failed. */
async function readWholeReport(importId: string): Promise<WholesalerReportLine[] | null> {
  const lines: WholesalerReportLine[] = [];
  let from: number | null = 0;
  while (from !== null) {
    const part: Awaited<ReturnType<typeof readWholesalerImportReport>> | null =
      await readWholesalerImportReport({
        importId,
        from,
      }).catch(() => null);
    if (!part?.success) return null;
    lines.push(...part.lines);
    from = part.next;
  }
  return lines;
}

/** Drops an open preview on the server; a failure leaves it for this person's next import to drop. */
async function abandonPreview(importId: string): Promise<boolean> {
  const result = await abandonWholesalerImport({ importId }).catch(() => null);
  return result?.success ?? false;
}

/** The supplier and the files of one delivery, with their checks. */
function useDeliveryChoice() {
  const [supplierId, setSupplierId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [attempted, setAttempted] = useState(false);
  const errors = chooseErrors(supplierId, files);
  return {
    supplierId,
    setSupplierId,
    files,
    // A file chosen again under the same name replaces the earlier one.
    addFile: (file: File | null) => {
      if (file) setFiles((current) => [...current.filter((entry) => entry.name !== file.name), file]);
    },
    removeFile: (name: string) => setFiles((current) => current.filter((file) => file.name !== name)),
    errors,
    supplierError: attempted ? errors['wholesaler-import-supplier'] : undefined,
    filesError: attempted ? errors['wholesaler-import-files'] : undefined,
    setAttempted,
    reset: () => {
      setSupplierId('');
      setFiles([]);
      setAttempted(false);
    },
  };
}

/** The office's decisions in the preview: a unit per unit text, and whether a repeated delivery goes in. */
function usePreviewDecisions(step: WholesalerImportStep) {
  const [unitMapping, setUnitMapping] = useState<Record<string, InventoryUnitCode | null>>({});
  const [repeatConfirmed, setRepeatConfirmed] = useState(false);
  const [repeatAttempted, setRepeatAttempted] = useState(false);
  const repeatUndecided = step.kind === 'preview' && step.preview.repeat !== null && !repeatConfirmed;
  return {
    unitMapping,
    setUnit: (unitText: string, unit: InventoryUnitCode | null) =>
      setUnitMapping((current) => ({ ...current, [unitText]: unit })),
    repeatConfirmed,
    confirmRepeat: () => setRepeatConfirmed(true),
    repeatError:
      repeatAttempted && repeatUndecided
        ? 'Entscheide, ob du diese Lieferung noch einmal übernimmst.'
        : undefined,
    /** Marks the confirm attempt; false while a repeat waits for the office's decision. */
    readyToConfirm: () => {
      setRepeatAttempted(true);
      return !focusFirstInvalidField({
        'wholesaler-import-repeat': repeatUndecided ? 'undecided' : undefined,
      });
    },
    start: (preview: WholesalerImportPreview) => {
      setUnitMapping(preview.suggestedUnits);
      setRepeatConfirmed(false);
      setRepeatAttempted(false);
    },
  };
}

/** The wholesaler import dialog's state: supplier and files, upload and preview, the unit mapping, the confirm and the report. */
export function useWholesalerImport({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [step, setStep] = useState<WholesalerImportStep>({ kind: 'choose' });
  const choice = useDeliveryChoice();
  const decisions = usePreviewDecisions(step);
  const [phase, setPhase] = useState<WholesalerImportPhase>(null);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = usePendingTask();

  function leavePreview() {
    if (step.kind === 'preview') void abandonPreview(step.preview.importId);
    setError(null);
  }

  function runStep(firstPhase: WholesalerImportPhase, task: () => Promise<void>) {
    setError(null);
    setPhase(firstPhase);
    void run(() =>
      task()
        .catch(() => setError('Das hat nicht geklappt. Es wurde nichts übernommen. Versuch es noch einmal.'))
        .finally(() => setPhase(null)),
    );
  }

  return {
    step,
    ...choice,
    ...decisions,
    phase,
    error,
    isPending,
    handleOpenChange: (nextOpen: boolean) => {
      if (!nextOpen) {
        leavePreview();
        setStep({ kind: 'choose' });
        choice.reset();
      }
      onOpenChange(nextOpen);
    },
    preview: () =>
      runStep('uploading', async () => {
        const { supplierId } = choice;
        const answer = await uploadAndPreview(supplierId, choice.files, () => setPhase('reading'));
        if ('error' in answer) return setError(answer.error);
        decisions.start(answer.preview);
        setStep({ kind: 'preview', preview: answer.preview, supplierId });
      }),
    confirm: (current: WholesalerImportPreview) => {
      if (!decisions.readyToConfirm()) return;
      runStep('confirming', async () => {
        const unitMapping = Object.fromEntries(
          current.units.map((unit) => [unit.unitText, decisions.unitMapping[unit.unitText] ?? null]),
        );
        const result = await confirmWholesalerImport({ importId: current.importId, unitMapping }).catch(
          () => null,
        );
        // A confirm sent twice writes once, so trying again is safe.
        if (!result?.success) {
          return setError(
            failureMessage(
              result?.error,
              'Die Lieferung konnte nicht übernommen werden. Versuch es noch einmal.',
            ),
          );
        }
        const { alreadyConfirmed } = result;
        setStep({ kind: 'result', importId: current.importId, result: result.result, alreadyConfirmed });
      });
    },
    backToChoose: () => {
      leavePreview();
      setStep({ kind: 'choose' });
    },
    downloadReport: (importId: string) =>
      runStep(null, async () => {
        const lines = await readWholeReport(importId);
        if (lines) return downloadImportReport('grosshandel-import', wholesalerImportReportCsv(lines));
        setError('Der Bericht konnte nicht geladen werden. Versuch es noch einmal.');
      }),
  };
}
