'use client';

import { useState } from 'react';

import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import type { ActionFailure } from '@/lib/action-result';
import type { InventoryUnitCode } from '@/lib/inventory/units';
import {
  abandonWholesalerImport,
  confirmWholesalerImport,
  openWholesalerImport,
  previewWholesalerImport,
  readWholesalerImportReport,
  stageWholesalerImportLines,
} from '@/lib/inventory/wholesaler-import-actions';
import {
  wholesalerImportReportCsv,
  type WholesalerReportLine,
} from '@/lib/inventory/wholesaler-import-lines';
import {
  WHOLESALER_IMPORT_MAX_FILE_BYTES,
  WHOLESALER_IMPORT_MAX_FILES,
  WHOLESALER_STAGE_MAX_LINES,
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

/** What a running step does, for the line under the form; sending counts the lines the server has. */
export type WholesalerImportPhase =
  | { kind: 'reading' }
  | { kind: 'sending'; sent: number; total: number }
  | { kind: 'confirming' };

/** The sentences of the codes this import owns; a shared code keeps its shared sentence. */
const FAILURE_MESSAGES: Readonly<Partial<Record<string, string>>> = {
  reader_unavailable: 'Dieser Import ist in dieser Umgebung nicht verfügbar.',
  file_unreadable: 'Eine Datei konnte nicht gelesen werden. Wähle die Dateien der Lieferung noch einmal.',
  delivery_unreadable:
    'Die Lieferung konnte nicht gelesen werden. Prüfe, ob alle Dateien zu einer Lieferung gehören.',
  delivery_empty: 'Die Dateien enthalten keine Artikel, Preise oder Löschungen.',
  delivery_too_large: 'Die Lieferung hat mehr als 2 Millionen Zeilen. So viele übernimmt ein Import nicht.',
  invalid_input:
    'Die Lieferung enthält Angaben, die der Import nicht übernehmen kann. Es wurde nichts übernommen.',
  supplier_not_found: 'Diesen Lieferanten gibt es nicht mehr. Wähle einen anderen.',
  import_not_found: 'Diese Vorschau gilt nicht mehr. Lade die Lieferung noch einmal.',
};
const PREVIEW_FAILED =
  'Die Vorschau konnte nicht erstellt werden. Es wurde nichts übernommen. Versuch es noch einmal.';

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

/** The sentence for an action's failure, or for a call that did not answer. */
function previewFailure(result: ActionFailure | null): { error: string } {
  return { error: result ? describeFailure(result.error, FAILURE_MESSAGES, PREVIEW_FAILED) : PREVIEW_FAILED };
}

/**
 * Reads one delivery in the browser, sends its parsed lines in parts and
 * answers the preview, or the sentence that says why not. The reader loads
 * with the first delivery the dialog reads; no other page carries it.
 */
async function readAndPreview(
  supplierId: string,
  files: readonly File[],
  onPhase: (phase: WholesalerImportPhase) => void,
): Promise<{ preview: WholesalerImportPreview } | { error: string }> {
  const staging = await import('@/lib/inventory/wholesaler-import-staging');
  const read = await staging.readDeliveryFiles(files).catch(() => null);
  if (!read) return previewFailure({ success: false, error: 'file_unreadable' });
  if (!read.success) return previewFailure(read);
  const { delivery, lines } = read;
  const fileNames = files.map((file) => file.name);

  const opened = await openWholesalerImport({
    supplierId,
    fileNames,
    contentHash: read.contentHash,
    header: delivery.header,
    rebateGroups: delivery.rebateGroups,
    skipped: delivery.skipped,
  }).catch(() => null);
  if (!opened?.success) return previewFailure(opened);
  const { importId } = opened;

  let sent = 0;
  onPhase({ kind: 'sending', sent, total: lines.length });
  for (const part of staging.stagingParts(lines, WHOLESALER_STAGE_MAX_LINES)) {
    const staged = await stageWholesalerImportLines({ importId, lines: part }).catch(() => null);
    if (!staged?.success) {
      void abandonPreview(importId);
      return previewFailure(staged);
    }
    sent += part.length;
    onPhase({ kind: 'sending', sent, total: lines.length });
  }

  const previewed = await previewWholesalerImport({ importId }).catch(() => null);
  if (!previewed?.success) {
    void abandonPreview(importId);
    return previewFailure(previewed);
  }
  const { effects, repeat } = previewed;
  return {
    preview: {
      importId,
      delivery: {
        formatVersion: delivery.header?.formatVersion ?? null,
        supplierText: delivery.header?.supplierText ?? null,
        date: delivery.header?.date ?? null,
        fileNames,
      },
      ...effects,
      suggestedUnits: staging.guessUnitMapping(effects.units.map((unit) => unit.unitText)),
      rejections: staging.rejectedLines(lines),
      rebateGroups: delivery.rebateGroups.length,
      repeat,
    },
  };
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
  const [phase, setPhase] = useState<WholesalerImportPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending } = usePendingTask();

  function leavePreview() {
    if (step.kind === 'preview') void abandonPreview(step.preview.importId);
    setError(null);
  }

  function runStep(firstPhase: WholesalerImportPhase | null, task: () => Promise<void>) {
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
      runStep({ kind: 'reading' }, async () => {
        const { supplierId } = choice;
        const answer = await readAndPreview(supplierId, choice.files, setPhase);
        if ('error' in answer) return setError(answer.error);
        decisions.start(answer.preview);
        setStep({ kind: 'preview', preview: answer.preview, supplierId });
      }),
    confirm: (current: WholesalerImportPreview) => {
      if (!decisions.readyToConfirm()) return;
      runStep({ kind: 'confirming' }, async () => {
        const unitMapping = Object.fromEntries(
          current.units.map((unit) => [unit.unitText, decisions.unitMapping[unit.unitText] ?? null]),
        );
        const result = await confirmWholesalerImport({ importId: current.importId, unitMapping }).catch(
          () => null,
        );
        // A confirm sent twice writes once, so trying again is safe.
        if (!result?.success) {
          return setError(
            result
              ? describeFailure(
                  result.error,
                  FAILURE_MESSAGES,
                  'Die Lieferung konnte nicht übernommen werden. Versuch es noch einmal.',
                )
              : 'Die Lieferung konnte nicht übernommen werden. Versuch es noch einmal.',
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
