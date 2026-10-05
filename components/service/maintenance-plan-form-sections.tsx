'use client';

import type { ReactElement } from 'react';

import { ClientSelectWithCreate } from '@/components/auftraege/shared/client-select-with-create';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  MAINTENANCE_NEXT_DUE_BASES,
  MAINTENANCE_NEXT_DUE_BASIS_LABELS,
  type MaintenanceClientOption,
  type MaintenanceCoverageOption,
  type MaintenanceNextDueBasis,
  type MaintenanceTemplateOption,
} from '@/lib/maintenance/types';
import { formatBerlinLocalDate } from '@/lib/planning/date-time';
import type { MaintenancePlanFormState } from './maintenance-plan-form-state';
import type { MaintenancePlanFormController } from './use-maintenance-plan-form';
import { parseIsoLocalDate } from '@/lib/utils';

type MaintenancePlanFieldsProps = Pick<MaintenancePlanFormController, 'form' | 'setForm' | 'fieldErrors'>;

type MaintenancePlanScopeFieldsProps = {
  controller: MaintenancePlanFormController;
  clients: MaintenanceClientOption[];
  templates: MaintenanceTemplateOption[];
  coverages: MaintenanceCoverageOption[];
  isRevision: boolean;
};

/** Customer, site, coverage and template: what the plan applies to. */
export function MaintenancePlanScopeFields({
  controller,
  clients,
  templates,
  coverages,
  isRevision,
}: MaintenancePlanScopeFieldsProps): ReactElement {
  const { form, setForm, fieldErrors, client, site } = controller;
  const availableCoverages = coverages.filter(
    (coverage) => coverage.clientId === form.clientId && coverage.siteId === form.siteId,
  );
  return (
    <>
      <Field label="Kunde" htmlFor="maintenance-client" required error={fieldErrors.clientId}>
        <ClientSelectWithCreate
          clients={clients}
          value={form.clientId}
          onValueChange={(clientId) =>
            setForm((value) => ({
              ...value,
              clientId,
              siteId: '',
              maintenanceCoverageId: '',
              equipmentIds: [],
            }))
          }
          disabled={isRevision}
        />
      </Field>
      <Field label="Einsatzort" htmlFor="maintenance-site" required error={fieldErrors.siteId}>
        <SearchableSelect
          value={form.siteId}
          onChange={(siteId) =>
            setForm((value) => ({
              ...value,
              siteId,
              maintenanceCoverageId: '',
              equipmentIds: [],
            }))
          }
          options={(client?.sites ?? []).map((item) => ({
            value: item.id,
            label: item.name,
            description: item.address,
          }))}
          disabled={!client || isRevision}
          placeholder="Einsatzort wählen"
          searchPlaceholder="Einsatzort suchen…"
          emptyMessage="Kein Einsatzort gefunden"
        />
      </Field>
      <Field label="Operative Abdeckung (optional)" htmlFor="maintenance-coverage" className="sm:col-span-2">
        <SearchableSelect
          value={form.maintenanceCoverageId}
          onChange={(maintenanceCoverageId) => setForm((value) => ({ ...value, maintenanceCoverageId }))}
          options={availableCoverages.map((coverage) => ({
            value: coverage.id,
            label: `${coverage.coverageNumber}${coverage.reference ? ` · ${coverage.reference}` : ''}`,
          }))}
          disabled={!site || isRevision}
          placeholder="Keine Abdeckung verknüpfen"
          searchPlaceholder="Abdeckung suchen…"
          emptyMessage="Keine Abdeckung gefunden"
          allowNone
          noneLabel="Keine Abdeckung verknüpfen"
        />
      </Field>
      <Field
        label="Veröffentlichte Arbeitsvorlage"
        htmlFor="maintenance-template"
        required
        error={fieldErrors.templateVersionId}
        className="sm:col-span-2"
      >
        <SearchableSelect
          value={form.templateVersionId}
          onChange={(templateVersionId) => setForm((value) => ({ ...value, templateVersionId }))}
          options={templates.map((template) => ({
            value: template.versionId,
            label: `${template.name} · Version ${template.versionNumber}`,
          }))}
          placeholder="Arbeitsvorlage wählen"
          searchPlaceholder="Arbeitsvorlage suchen…"
          emptyMessage="Keine veröffentlichte Arbeitsvorlage gefunden"
        />
      </Field>
    </>
  );
}

/** Validity, first due date, interval, duration, due window and the next-due basis. */
export function MaintenancePlanScheduleFields({
  form,
  setForm,
  fieldErrors,
}: MaintenancePlanFieldsProps): ReactElement {
  return (
    <>
      <Field label="Gültig ab" htmlFor="maintenance-effective" required error={fieldErrors.effectiveFromDate}>
        <DatePicker
          ariaLabel="Gültig ab"
          value={parseIsoLocalDate(form.effectiveFromDate)}
          onChange={(date) =>
            setForm((value) => ({
              ...value,
              effectiveFromDate: date ? formatBerlinLocalDate(date) : '',
            }))
          }
        />
      </Field>
      <Field
        label="Erste Fälligkeit"
        htmlFor="maintenance-first-due"
        required
        error={fieldErrors.firstDueDate}
      >
        <DatePicker
          ariaLabel="Erste Fälligkeit"
          value={parseIsoLocalDate(form.firstDueDate)}
          onChange={(date) =>
            setForm((value) => ({
              ...value,
              firstDueDate: date ? formatBerlinLocalDate(date) : '',
            }))
          }
        />
      </Field>
      <Field label="Intervall in Monaten" htmlFor="maintenance-interval">
        <QuantityStepper
          id="maintenance-interval"
          min={1}
          value={form.intervalMonths}
          onChange={(intervalMonths) => setForm((value) => ({ ...value, intervalMonths }))}
        />
      </Field>
      <Field label="Geplante Dauer in Minuten" htmlFor="maintenance-duration">
        <QuantityStepper
          id="maintenance-duration"
          min={15}
          step={15}
          value={form.plannedDurationMinutes}
          onChange={(plannedDurationMinutes) => setForm((value) => ({ ...value, plannedDurationMinutes }))}
          unitLabel="Min."
        />
      </Field>
      <Field label="Frühestens (Tage vorher)" htmlFor="maintenance-window-before">
        <QuantityStepper
          id="maintenance-window-before"
          min={0}
          value={form.dueWindowBeforeDays}
          onChange={(dueWindowBeforeDays) => setForm((value) => ({ ...value, dueWindowBeforeDays }))}
          unitLabel="Tage"
        />
      </Field>
      <Field label="Spätestens (Tage danach)" htmlFor="maintenance-window-after">
        <QuantityStepper
          id="maintenance-window-after"
          min={0}
          value={form.dueWindowAfterDays}
          onChange={(dueWindowAfterDays) => setForm((value) => ({ ...value, dueWindowAfterDays }))}
          unitLabel="Tage"
        />
      </Field>
      <Field label="Nächste Fälligkeit berechnen" htmlFor="maintenance-basis" className="sm:col-span-2">
        <Select
          value={form.nextDueBasis}
          onValueChange={(nextDueBasis) =>
            setForm((value) => ({
              ...value,
              nextDueBasis: nextDueBasis as MaintenanceNextDueBasis,
            }))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MAINTENANCE_NEXT_DUE_BASES.map((basis) => (
              <SelectItem key={basis} value={basis}>
                {MAINTENANCE_NEXT_DUE_BASIS_LABELS[basis]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}

/** The equipment of the chosen site that the plan covers. */
export function MaintenancePlanEquipmentFieldset({
  site,
  form,
  setForm,
  fieldErrors,
}: MaintenancePlanFieldsProps & {
  site: MaintenanceClientOption['sites'][number] | undefined;
}): ReactElement | null {
  return site?.equipment.length ? (
    <fieldset className="space-y-2 sm:col-span-2">
      <legend className="text-sm font-medium">Anlagen im Wartungsumfang</legend>
      <div
        id="maintenance-equipment"
        tabIndex={-1}
        className="grid gap-2 rounded-md border p-3 sm:grid-cols-2"
      >
        {site.equipment.map((equipment) => (
          <label key={equipment.id} className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={form.equipmentIds.includes(equipment.id)}
              onCheckedChange={(checked) =>
                setForm((value) => ({
                  ...value,
                  equipmentIds: checked
                    ? [...value.equipmentIds, equipment.id]
                    : value.equipmentIds.filter((id) => id !== equipment.id),
                }))
              }
            />
            <span>
              <span className="block font-medium">{equipment.name}</span>
              <span className="text-xs text-muted-foreground">{equipment.equipmentNumber}</span>
            </span>
          </label>
        ))}
      </div>
      <ErrorText>{fieldErrors.equipmentIds}</ErrorText>
    </fieldset>
  ) : site ? (
    <p role="status" className="sm:col-span-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
      An diesem Einsatzort ist noch keine aktive Anlage erfasst.
    </p>
  ) : null;
}

/** Execution notes, overlap reason, and the revision reason or the start status. */
export function MaintenancePlanNotesFields({
  form,
  setForm,
  fieldErrors,
  isRevision,
}: MaintenancePlanFieldsProps & { isRevision: boolean }): ReactElement {
  return (
    <>
      <Field label="Hinweise für die Ausführung" htmlFor="maintenance-instructions" className="sm:col-span-2">
        <Textarea
          value={form.operationalInstructions}
          onChange={(event) =>
            setForm((value) => ({
              ...value,
              operationalInstructions: event.target.value,
            }))
          }
          placeholder="Zugang, Prüfhinweise oder Besonderheiten für den Einsatz"
        />
      </Field>
      <Field
        label="Begründung bei Überschneidung (falls erforderlich)"
        htmlFor="maintenance-overlap"
        className="sm:col-span-2"
      >
        <Textarea
          value={form.overlapReason}
          onChange={(event) =>
            setForm((value) => ({
              ...value,
              overlapReason: event.target.value,
            }))
          }
          placeholder="Warum darf dieselbe Anlage in mehreren laufenden Plänen enthalten sein?"
        />
      </Field>
      {isRevision ? (
        <Field
          label="Grund der neuen Revision"
          htmlFor="maintenance-reason"
          required
          error={fieldErrors.reason}
          className="sm:col-span-2"
        >
          <Input
            value={form.reason}
            onChange={(event) => setForm((value) => ({ ...value, reason: event.target.value }))}
          />
        </Field>
      ) : (
        <Field label="Startstatus" htmlFor="maintenance-status" className="sm:col-span-2">
          <Select
            value={form.status}
            onValueChange={(status) =>
              setForm((value) => ({
                ...value,
                status: status as MaintenancePlanFormState['status'],
              }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Aktiv – Fälligkeiten jetzt erzeugen</SelectItem>
              <SelectItem value="draft">Entwurf – noch keine Fälligkeiten</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}
    </>
  );
}
