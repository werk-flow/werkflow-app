'use client';

import { Loader2 } from 'lucide-react';

import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Textarea } from '@/components/ui/textarea';
import { TimeInput } from '@/components/ui/time-input';
import { formatOccurrenceSchedule } from './dispatch-panel-schedule';
import type { DispatchPanelBatch, DispatchPanelBatchPreview } from './use-dispatch-panel-batch';

/** The shift inputs below the list while visits are selected for a batch move. */
export function DispatchPanelBatchForm({ batch }: { batch: DispatchPanelBatch }) {
  const {
    selectedIds,
    dayShiftText,
    setDayShiftText,
    newTime,
    setNewTime,
    batchReason,
    setBatchReason,
    batchPreview,
    isBatchWorking,
    batchError,
    batchAttempted,
    setBatchAttempted,
    batchFieldErrors,
    runBatchPreview,
  } = batch;

  return (
    <div className="shrink-0 space-y-3 border-t p-4">
      <p className="text-sm font-medium">
        {selectedIds.size} Besuch{selectedIds.size === 1 ? '' : 'e'} ausgewählt
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Verschieben um (Tage)"
          htmlFor="batch-day-shift"
          required
          error={batchAttempted ? batchFieldErrors['batch-day-shift'] : undefined}
        >
          <QuantityStepper id="batch-day-shift" min={-366} value={dayShiftText} onChange={setDayShiftText} />
        </Field>
        <Field label="Neue Uhrzeit (optional)" htmlFor="batch-new-time">
          <TimeInput value={newTime} onChange={setNewTime} />
        </Field>
      </div>
      <Field
        label="Begründung"
        htmlFor="batch-reason"
        required
        description="Mindestens 8 Zeichen."
        error={batchAttempted ? batchFieldErrors['batch-reason'] : undefined}
      >
        <Textarea
          value={batchReason}
          onChange={(event) => setBatchReason(event.target.value)}
          placeholder="z. B. Krankheitsbedingte Umplanung der Woche"
          maxLength={1000}
        />
      </Field>
      {/* While the preview dialog is open the error belongs inside it. */}
      <ErrorText>{batchPreview ? null : batchError}</ErrorText>
      <Button
        className="w-full"
        // eslint-disable-next-line ui/action-disabled-only-while-pending -- batch bar: with no visit selected there is nothing to check, not a field to fill
        disabled={selectedIds.size === 0 || isBatchWorking}
        onClick={() => {
          setBatchAttempted(true);
          if (focusFirstInvalidField(batchFieldErrors)) return;
          void runBatchPreview();
        }}
      >
        {isBatchWorking && <Loader2 className="size-4 animate-spin" />}
        Auswirkungen prüfen
      </Button>
    </div>
  );
}

/** Old and new instants per visit and what the reviewed move invalidates. */
export function DispatchPanelBatchPreviewDetails({
  batchPreview,
}: {
  batchPreview: DispatchPanelBatchPreview;
}) {
  return (
    <>
      <ul
        className="max-h-44 space-y-1 overflow-y-auto text-xs"
        role="group"
        aria-label="Alte und neue Zeitpunkte je Besuch"
        tabIndex={0}
      >
        {batchPreview.items.map((item) => (
          <li
            key={item.occurrenceId}
            className="tabular-nums text-muted-foreground"
            data-batch-preview-item={item.occurrenceId}
          >
            <span className="font-medium text-foreground">{item.title}</span>
            {': '}
            {formatOccurrenceSchedule({
              startAt: item.oldStartAt,
              startDate: item.oldStartDate,
            })}
            {' → '}
            {formatOccurrenceSchedule({
              startAt: item.newStartAt,
              startDate: item.newStartDate,
            })}
          </li>
        ))}
      </ul>
      <ul className="space-y-1.5 text-sm">
        {batchPreview.conflictCount > 0 && (
          <li className="text-warning-text">
            {batchPreview.conflictCount} Planungshinweis
            {batchPreview.conflictCount === 1 ? '' : 'e'} – Begründung wird beim Speichern abgefragt.
          </li>
        )}
        {batchPreview.invalidatedAcknowledgementCount > 0 && (
          <li>
            {batchPreview.invalidatedAcknowledgementCount === 1
              ? '1 Bestätigung wird ungültig'
              : `${batchPreview.invalidatedAcknowledgementCount} Bestätigungen werden ungültig`}{' '}
            – die Personen bestätigen neu.
          </li>
        )}
        {batchPreview.commitmentMismatchTitles.length > 0 && (
          <li className="text-warning-text">
            Kundenzusagen weichen danach ab: {batchPreview.commitmentMismatchTitles.join(', ')} – bitte neu
            zusagen oder zurückziehen. Es wird keine Nachricht versendet.
          </li>
        )}
        {batchPreview.conflictCount === 0 &&
          batchPreview.invalidatedAcknowledgementCount === 0 &&
          batchPreview.commitmentMismatchTitles.length === 0 && (
            <li className="text-muted-foreground">Keine Konflikte, Bestätigungen oder Zusagen betroffen.</li>
          )}
      </ul>
    </>
  );
}
