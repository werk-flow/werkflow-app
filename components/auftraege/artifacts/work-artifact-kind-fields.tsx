'use client';

import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DateTimeField } from '@/components/ui/date-time-field';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  WORK_ARTIFACT_UNIT_LABELS,
  type MeasurementLineInput,
  type WorkArtifactContentInput,
} from '@/lib/work-artifacts/types';
import {
  AUTHORIZATION_STATE_LABELS,
  DEFECT_SEVERITY_LABELS,
  DEFECT_STATE_LABELS,
} from './work-artifact-content';
import { DateField, TextField, type WorkArtifactContentFieldsProps } from './work-artifact-form-fields';

export function WorkArtifactSiteDiaryFields({ content, patchContent }: WorkArtifactContentFieldsProps) {
  return (
    <div className="grid gap-4">
      <DateField
        id="artifact-work-date"
        label="Arbeitstag"
        value={content.workDate}
        onChange={(value) => patchContent({ workDate: value })}
      />
      <TextField
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

export function WorkArtifactWorkReportFields({ content, patchContent }: WorkArtifactContentFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Beginn" htmlFor="artifact-visit-start-date">
          <DateTimeField
            value={content.visitStartedAt ?? ''}
            onChange={(value) => patchContent({ visitStartedAt: value })}
            idPrefix="artifact-visit-start"
          />
        </Field>
        <Field label="Ende" htmlFor="artifact-visit-end-date">
          <DateTimeField
            value={content.visitEndedAt ?? ''}
            onChange={(value) => patchContent({ visitEndedAt: value })}
            idPrefix="artifact-visit-end"
          />
        </Field>
      </div>
      <TextField
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
};

export function WorkArtifactMeasurementFields({
  content,
  patchContent,
  measurementLines,
  setMeasurementLines,
}: WorkArtifactMeasurementFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <DateField
          id="artifact-measurement-date"
          label="Aufmaßdatum"
          value={content.measurementDate}
          onChange={(value) => patchContent({ measurementDate: value })}
        />
        <TextField
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
        <div className="flex items-center justify-between">
          <Label>Positionen</Label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              setMeasurementLines([...measurementLines, { description: '', quantity: '1', unit: 'piece' }])
            }
          >
            Position ergänzen
          </Button>
        </div>
        {measurementLines.map((line, index) => (
          <div
            key={line.id ?? index}
            className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_180px_auto]"
          >
            <TextField
              id={`artifact-measurement-description-${index}`}
              label="Bezeichnung"
              value={line.description}
              onChange={(value) =>
                setMeasurementLines(
                  measurementLines.map((entry, current) =>
                    current === index ? { ...entry, description: value } : entry,
                  ),
                )
              }
            />
            <Field label="Menge" htmlFor={`artifact-measurement-quantity-${index}`}>
              <QuantityStepper
                id={`artifact-measurement-quantity-${index}`}
                value={line.quantity}
                onChange={(value) =>
                  setMeasurementLines(
                    measurementLines.map((entry, current) =>
                      current === index ? { ...entry, quantity: value } : entry,
                    ),
                  )
                }
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
              onValueChange={(value) =>
                setMeasurementLines(
                  measurementLines.map((entry, current) =>
                    current === index ? { ...entry, unit: value as MeasurementLineInput['unit'] } : entry,
                  ),
                )
              }
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
              onChange={(value) =>
                setMeasurementLines(
                  measurementLines.map((entry, current) =>
                    current === index ? { ...entry, location: value } : entry,
                  ),
                )
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkArtifactDefectFields({ content, patchContent }: WorkArtifactContentFieldsProps) {
  return (
    <div className="space-y-4">
      <TextField
        label="Mangelbeschreibung"
        value={content.defectDescription}
        onChange={(value) => patchContent({ defectDescription: value })}
        textarea
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="artifact-defect-location"
          label="Ort"
          value={content.defectLocation}
          onChange={(value) => patchContent({ defectLocation: value })}
        />
        <Field label="Schweregrad" htmlFor="artifact-defect-severity">
          <Select
            value={content.defectSeverity ?? 'medium'}
            onValueChange={(value) =>
              patchContent({ defectSeverity: value as WorkArtifactContentInput['defectSeverity'] })
            }
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
        <DateField
          id="artifact-due-date"
          label="Fällig am"
          value={content.dueDate}
          onChange={(value) => patchContent({ dueDate: value })}
        />
        <Field label="Status" htmlFor="artifact-defect-state">
          <Select
            value={content.defectState ?? 'open'}
            onValueChange={(value) =>
              patchContent({ defectState: value as WorkArtifactContentInput['defectState'] })
            }
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

export function WorkArtifactChangeWorkFields({ content, patchContent }: WorkArtifactContentFieldsProps) {
  return (
    <div className="space-y-4">
      <TextField
        label="Änderungs-/Regiearbeit"
        value={content.changeDescription}
        onChange={(value) => patchContent({ changeDescription: value })}
        textarea
      />
      <TextField
        label="Grund"
        value={content.changeReason}
        onChange={(value) => patchContent({ changeReason: value })}
        textarea
      />
      <TextField
        label="Angefordert durch"
        value={content.requestedByContext}
        onChange={(value) => patchContent({ requestedByContext: value })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Erwartete Arbeitsminuten"
          value={content.expectedLaborMinutes}
          onChange={(value) => patchContent({ expectedLaborMinutes: value })}
        />
        <TextField
          label="Tatsächliche Arbeitsminuten"
          value={content.actualLaborMinutes}
          onChange={(value) => patchContent({ actualLaborMinutes: value })}
        />
      </div>
      <TextField
        label="Erwartetes Material"
        value={content.expectedMaterialSummary}
        onChange={(value) => patchContent({ expectedMaterialSummary: value })}
        textarea
      />
      <TextField
        label="Tatsächliches Material"
        value={content.actualMaterialSummary}
        onChange={(value) => patchContent({ actualMaterialSummary: value })}
        textarea
      />
      <Field label="Autorisierungsstand" htmlFor="artifact-authorization-state">
        <Select
          value={content.authorizationState ?? 'not_requested'}
          onValueChange={(value) =>
            patchContent({ authorizationState: value as WorkArtifactContentInput['authorizationState'] })
          }
        >
          <SelectTrigger aria-label="Autorisierungsstand">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(AUTHORIZATION_STATE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <TextField
        label="Terminauswirkung"
        value={content.scheduleImpact}
        onChange={(value) => patchContent({ scheduleImpact: value })}
        textarea
      />
    </div>
  );
}

export function WorkArtifactCustomerFacingFields({ content, patchContent }: WorkArtifactContentFieldsProps) {
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
