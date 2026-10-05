'use client';

import { DateTimeField } from '@/components/ui/date-time-field';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  WORK_ARTIFACT_KIND_LABELS,
  WORK_ARTIFACT_KINDS,
  type MeasurementLineInput,
  type WorkArtifactKind,
  type WorkArtifactVisibility,
} from '@/lib/work-artifacts/types';
import type { WorkArtifactContentDraft } from './work-artifact-content';
import { TextField } from './work-artifact-form-fields';
import {
  WorkArtifactChangeWorkFields,
  WorkArtifactCustomerFacingFields,
  WorkArtifactDefectFields,
  WorkArtifactMeasurementFields,
  WorkArtifactSiteDiaryFields,
  WorkArtifactWorkReportFields,
} from './work-artifact-kind-fields';

type ArtifactFormProps = {
  kind: WorkArtifactKind;
  setKind: (value: WorkArtifactKind) => void;
  lockedKind: boolean;
  visibility: WorkArtifactVisibility;
  setVisibility: (value: WorkArtifactVisibility) => void;
  title: string;
  setTitle: (value: string) => void;
  capturedAt: string;
  setCapturedAt: (value: string) => void;
  content: WorkArtifactContentDraft;
  patchContent: (patch: Partial<WorkArtifactContentDraft>) => void;
  measurementLines: MeasurementLineInput[];
  setMeasurementLines: (lines: MeasurementLineInput[]) => void;
  requiresCorrectionReason: boolean;
  correctionReason: string;
  correctionReasonError: string | null;
  setCorrectionReason: (value: string) => void;
  instructionOptions: Array<{ id: string; label: string }>;
};

export function ArtifactForm({
  kind,
  setKind,
  lockedKind,
  visibility,
  setVisibility,
  title,
  setTitle,
  capturedAt,
  setCapturedAt,
  content,
  patchContent,
  measurementLines,
  setMeasurementLines,
  requiresCorrectionReason,
  correctionReason,
  correctionReasonError,
  setCorrectionReason,
  instructionOptions,
}: ArtifactFormProps) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Art" htmlFor="artifact-kind">
          <Select
            value={kind}
            disabled={lockedKind}
            onValueChange={(value) => setKind(value as WorkArtifactKind)}
          >
            <SelectTrigger aria-label="Art des Arbeitsnachweises">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORK_ARTIFACT_KINDS.map((value) => (
                <SelectItem key={value} value={value}>
                  {WORK_ARTIFACT_KIND_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Sichtbarkeit" htmlFor="artifact-visibility">
          <Select
            value={visibility}
            onValueChange={(value) => setVisibility(value as WorkArtifactVisibility)}
          >
            <SelectTrigger aria-label="Sichtbarkeit des Arbeitsnachweises">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="internal_only">Nur intern</SelectItem>
              <SelectItem value="customer_facing">Für Kundendokumentation</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <TextField label="Titel" value={title} onChange={setTitle} />
      <Field label="Erfasst am" htmlFor="artifact-captured-date">
        <DateTimeField
          value={capturedAt}
          onChange={setCapturedAt}
          idPrefix="artifact-captured"
          dateAriaLabel="Erfassungsdatum"
        />
      </Field>
      <TextField
        label="Zusammenfassung"
        value={content.summary}
        onChange={(value) => patchContent({ summary: value })}
        textarea
      />
      {instructionOptions.length > 0 && (
        <Field label="Zugehörige Aufgabe/Checkliste" htmlFor="artifact-instruction-item">
          <SearchableSelect
            ariaLabel="Zugehörige Aufgabe oder Checkliste"
            options={instructionOptions.map((option) => ({ value: option.id, label: option.label }))}
            value={content.instructionItemId ?? ''}
            onChange={(value) => patchContent({ instructionItemId: value || undefined })}
            allowNone
            noneLabel="Keine direkte Zuordnung"
            placeholder="Keine direkte Zuordnung"
            searchPlaceholder="Eintrag suchen…"
            emptyMessage="Kein Eintrag gefunden"
          />
        </Field>
      )}
      {kind === 'site_diary' && <WorkArtifactSiteDiaryFields content={content} patchContent={patchContent} />}
      {kind === 'work_report' && (
        <WorkArtifactWorkReportFields content={content} patchContent={patchContent} />
      )}
      {kind === 'measurement' && (
        <WorkArtifactMeasurementFields
          content={content}
          patchContent={patchContent}
          measurementLines={measurementLines}
          setMeasurementLines={setMeasurementLines}
        />
      )}
      {kind === 'defect' && <WorkArtifactDefectFields content={content} patchContent={patchContent} />}
      {kind === 'change_work' && (
        <WorkArtifactChangeWorkFields content={content} patchContent={patchContent} />
      )}
      {visibility === 'customer_facing' && (
        <WorkArtifactCustomerFacingFields content={content} patchContent={patchContent} />
      )}
      {requiresCorrectionReason && (
        <TextField
          id="artifact-correction-reason"
          label="Grund der neuen Version"
          value={correctionReason}
          onChange={setCorrectionReason}
          error={correctionReasonError}
          textarea
        />
      )}
    </div>
  );
}
