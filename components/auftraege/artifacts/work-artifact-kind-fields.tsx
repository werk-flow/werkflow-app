'use client';

import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DateTimeField } from '@/components/ui/date-time-field';
import { Field, useFieldContext } from '@/components/ui/field';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Constants } from '@/lib/supabase/database.types';
import { WORK_ARTIFACT_UNIT_LABELS, type MeasurementLineInput } from '@/lib/work-artifacts/types';
import { DEFECT_SEVERITY_LABELS, DEFECT_STATE_LABELS } from './work-artifact-content';
import { measurementLineDescriptionId } from './work-artifact-field-errors';
import { DateField, TextField, type WorkArtifactContentFieldsProps } from './work-artifact-form-fields';

export function WorkArtifactSiteDiaryFields({
  content,
  patchContent,
  fieldState,
}: WorkArtifactContentFieldsProps) {
  return (
    <div className="grid gap-4">
      <DateField
        {...fieldState('workDate')}
        label="Arbeitstag"
        value={content.workDate}
        onChange={(value) => patchContent({ workDate: value })}
      />
      <TextField
        {...fieldState('progress')}
        label="Fortschritt"
        value={content.progress}
        onChange={(value) => patchContent({ progress: value })}
        textarea
      />
      <TextField
        label="Anwesende Personen"
        value={content.peoplePresent}
        onChange={(value) => patchContent({ peoplePresent: value })}
      />
      <TextField
        label="Wetter"
        value={content.weatherConditions}
        onChange={(value) => patchContent({ weatherConditions: value })}
      />
      <TextField
        label="Bedingungen vor Ort"
        value={content.siteConditions}
        onChange={(value) => patchContent({ siteConditions: value })}
        textarea
      />
      <TextField
        label="Lieferungen"
        value={content.deliveries}
        onChange={(value) => patchContent({ deliveries: value })}
        textarea
      />
      <TextField
        label="Behinderungen"
        value={content.impediments}
        onChange={(value) => patchContent({ impediments: value })}
        textarea
      />
      <TextField
        label="Entscheidungen"
        value={content.decisions}
        onChange={(value) => patchContent({ decisions: value })}
        textarea
      />
      <TextField
        label="Besondere Ereignisse"
        value={content.notableEvents}
        onChange={(value) => patchContent({ notableEvents: value })}
        textarea
      />
    </div>
  );
}

export function WorkArtifactWorkReportFields({
  content,
  patchContent,
  fieldState,
}: WorkArtifactContentFieldsProps) {
  const start = fieldState('visitStartedAt');
  const end = fieldState('visitEndedAt');
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Beginn" htmlFor={start.id} required={start.required} error={start.error}>
          <DateTimeField
            value={content.visitStartedAt ?? ''}
            onChange={(value) => patchContent({ visitStartedAt: value })}
            idPrefix="artifact-visit-start"
            dateAriaLabel="Datum des Beginns"
            invalid={Boolean(start.error)}
          />
        </Field>
        <Field label="Ende" htmlFor={end.id} required={end.required} error={end.error}>
          <DateTimeField
            value={content.visitEndedAt ?? ''}
            onChange={(value) => patchContent({ visitEndedAt: value })}
            idPrefix="artifact-visit-end"
            dateAriaLabel="Datum des Endes"
            invalid={Boolean(end.error)}
          />
        </Field>
      </div>
      <TextField
        {...fieldState('performedWork')}
        label="Ausgeführte Arbeiten"
        value={content.performedWork}
        onChange={(value) => patchContent({ performedWork: value })}
        textarea
      />
      <TextField
        label="Offene Arbeiten"
        value={content.outstandingWork}
        onChange={(value) => patchContent({ outstandingWork: value })}
        textarea
      />
      <TextField
        label="Materialhinweise"
        value={content.materialsSummary}
        onChange={(value) => patchContent({ materialsSummary: value })}
        textarea
      />
      <Field label="Nächster Besuch" htmlFor="artifact-next-visit-date">
        <DateTimeField
          value={content.nextVisitAt ?? ''}
          onChange={(value) => patchContent({ nextVisitAt: value })}
          idPrefix="artifact-next-visit"
        />
      </Field>
    </div>
  );
}

type WorkArtifactMeasurementFieldsProps = WorkArtifactContentFieldsProps & {
  measurementLines: MeasurementLineInput[];
  setMeasurementLines: (lines: MeasurementLineInput[]) => void;
  /** The form's errors by control id; a line's description error sits under its id. */
  fieldErrors: Readonly<Record<string, string>>;
};

export function WorkArtifactMeasurementFields({
  content,
  patchContent,
  fieldState,
  fieldErrors,
  measurementLines,
  setMeasurementLines,
}: WorkArtifactMeasurementFieldsProps) {
  const lines = fieldState('measurementLines');
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <DateField
          {...fieldState('measurementDate')}
          label="Aufmaßdatum"
          value={content.measurementDate}
          onChange={(value) => patchContent({ measurementDate: value })}
        />
        <TextField
          {...fieldState('measurementLocation')}
          label="Aufmaßort"
          value={content.measurementLocation}
          onChange={(value) => patchContent({ measurementLocation: value })}
        />
      </div>
      <TextField
        label="Aufmaßhinweise"
        value={content.measurementNotes}
        onChange={(value) => patchContent({ measurementNotes: value })}
        textarea
      />
      <div className="space-y-3">
        <Field label="Positionen" htmlFor={lines.id} required={lines.required} error={lines.error}>
          <AddMeasurementLineButton
            onAdd={() =>
              setMeasurementLines([...measurementLines, { description: '', quantity: '1', unit: 'piece' }])
            }
          />
        </Field>
        {measurementLines.map((line, index) => (
          <MeasurementLineFields
            key={line.id ?? index}
            line={line}
            index={index}
            descriptionError={fieldErrors[measurementLineDescriptionId(index)]}
            measurementLines={measurementLines}
            setMeasurementLines={setMeasurementLines}
          />
        ))}
      </div>
    </div>
  );
}

/** The control of „Positionen“: it keeps its own name and carries the field's required mark and error. */
function AddMeasurementLineButton({ onAdd }: { onAdd: () => void }) {
  const field = useFieldContext();
  return (
    <Button
      id={field?.controlId}
      type="button"
      size="sm"
      variant="ghost"
      className="justify-self-start"
      aria-label="Position ergänzen"
      aria-describedby={
        [field?.describedBy, field?.requiredDescriptionId].filter(Boolean).join(' ') || undefined
      }
      onClick={onAdd}
    >
      Position ergänzen
    </Button>
  );
}

function MeasurementLineFields({
  line,
  index,
  measurementLines,
  setMeasurementLines,
  descriptionError,
}: Pick<WorkArtifactMeasurementFieldsProps, 'measurementLines' | 'setMeasurementLines'> & {
  line: MeasurementLineInput;
  index: number;
  descriptionError: string | undefined;
}) {
  const patchLine = (patch: Partial<MeasurementLineInput>) =>
    setMeasurementLines(
      measurementLines.map((entry, current) => (current === index ? { ...entry, ...patch } : entry)),
    );
  return (
    <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_180px_auto]">
      <TextField
        id={measurementLineDescriptionId(index)}
        required
        error={descriptionError}
        label="Bezeichnung"
        value={line.description}
        onChange={(value) => patchLine({ description: value })}
      />
      <Field label="Menge" htmlFor={`artifact-measurement-quantity-${index}`}>
        <QuantityStepper
          id={`artifact-measurement-quantity-${index}`}
          value={line.quantity}
          onChange={(value) => patchLine({ quantity: value })}
          min={0.001}
          step={1}
          unitLabel={WORK_ARTIFACT_UNIT_LABELS[line.unit]}
        />
      </Field>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="self-end"
        onClick={() => setMeasurementLines(measurementLines.filter((_, current) => current !== index))}
        aria-label="Aufmaßposition entfernen"
      >
        <Trash2 className="size-4" />
      </Button>
      <Select
        value={line.unit}
        onValueChange={(value) => {
          const unit = Constants.public.Enums.work_artifact_measurement_unit.find(
            (candidate) => candidate === value,
          );
          if (unit) patchLine({ unit });
        }}
      >
        <SelectTrigger aria-label="Aufmaßeinheit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(WORK_ARTIFACT_UNIT_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <TextField
        id={`artifact-measurement-location-${index}`}
        label="Ort"
        value={line.location}
        onChange={(value) => patchLine({ location: value })}
      />
    </div>
  );
}

export function WorkArtifactDefectFields({
  content,
  patchContent,
  fieldState,
}: WorkArtifactContentFieldsProps) {
  return (
    <div className="space-y-4">
      <TextField
        {...fieldState('defectDescription')}
        label="Mangelbeschreibung"
        value={content.defectDescription}
        onChange={(value) => patchContent({ defectDescription: value })}
        textarea
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          {...fieldState('defectLocation')}
          label="Ort"
          value={content.defectLocation}
          onChange={(value) => patchContent({ defectLocation: value })}
        />
        <DefectSeverityField content={content} patchContent={patchContent} fieldState={fieldState} />
        <DateField
          id="artifact-due-date"
          label="Fällig am"
          value={content.dueDate}
          onChange={(value) => patchContent({ dueDate: value })}
        />
        <DefectStateField content={content} patchContent={patchContent} />
      </div>
      <TextField
        label="Zuständigkeit"
        value={content.responsibilityContext}
        onChange={(value) => patchContent({ responsibilityContext: value })}
      />
      <TextField
        label="Vorgeschlagene Lösung"
        value={content.proposedResolution}
        onChange={(value) => patchContent({ proposedResolution: value })}
        textarea
      />
      {content.defectState === 'resolved' && (
        <TextField
          label="Behebung"
          value={content.resolutionSummary}
          onChange={(value) => patchContent({ resolutionSummary: value })}
          textarea
        />
      )}
    </div>
  );
}

function DefectSeverityField({ content, patchContent, fieldState }: WorkArtifactContentFieldsProps) {
  const severity = fieldState('defectSeverity');
  return (
    <Field label="Schweregrad" htmlFor={severity.id} required={severity.required} error={severity.error}>
      <Select
        value={content.defectSeverity ?? 'medium'}
        onValueChange={(value) => {
          const defectSeverity = Constants.public.Enums.work_artifact_defect_severity.find(
            (candidate) => candidate === value,
          );
          if (defectSeverity) patchContent({ defectSeverity });
        }}
      >
        <SelectTrigger aria-label="Schweregrad">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(DEFECT_SEVERITY_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function DefectStateField({
  content,
  patchContent,
}: Pick<WorkArtifactContentFieldsProps, 'content' | 'patchContent'>) {
  return (
    <Field label="Status" htmlFor="artifact-defect-state">
      <Select
        value={content.defectState ?? 'open'}
        onValueChange={(value) => {
          const defectState = Constants.public.Enums.work_artifact_defect_state.find(
            (candidate) => candidate === value,
          );
          if (defectState) patchContent({ defectState });
        }}
      >
        <SelectTrigger aria-label="Mangelstatus">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(DEFECT_STATE_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function WorkArtifactCustomerFacingFields({
  content,
  patchContent,
}: Pick<WorkArtifactContentFieldsProps, 'content' | 'patchContent'>) {
  return (
    <div className="space-y-3 rounded-md border p-4">
      <TextField
        label="Kundenaussage"
        value={content.customerStatement}
        onChange={(value) => patchContent({ customerStatement: value })}
        textarea
      />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={content.requiresCustomerResponse ?? false}
          onCheckedChange={(checked) => patchContent({ requiresCustomerResponse: checked === true })}
        />
        Kundenentscheidung erforderlich
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={content.requiresSignature ?? false}
          onCheckedChange={(checked) => patchContent({ requiresSignature: checked === true })}
        />
        Unterschrift erforderlich
      </label>
    </div>
  );
}
