'use client';

import type { ReactElement } from 'react';

import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { FormDisclosure } from '@/components/ui/form-disclosure';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import { parseIsoLocalDate, toLocalDateString } from '@/lib/utils';
import type { EquipmentFormMode } from './equipment-form-state';
import type { EquipmentFormController } from './use-equipment-form';

function toDateValue(value: Date | undefined): string {
  return value ? toLocalDateString(value) : '';
}

type EquipmentFormFieldsProps = Pick<EquipmentFormController, 'form' | 'updateField'>;

/** Customer, site and name: the first cells of the dialog's main grid. */
export function EquipmentAssignmentFields({
  controller,
  mode,
}: {
  controller: EquipmentFormController;
  mode: EquipmentFormMode;
}): ReactElement {
  const { form, setForm, updateField, fieldErrors, clientSearch, clientOption } = controller;
  return (
    <>
      <Field label="Kunde" htmlFor="equipment-client" required error={fieldErrors.clientId}>
        <SearchableSelect
          value={form.clientId}
          disabled={mode !== 'create'}
          onChange={(value) =>
            setForm((current) => ({
              ...current,
              clientId: value,
              siteId: '',
              parentEquipmentId: null,
            }))
          }
          options={clientSearch.options}
          onSearchChange={clientSearch.onSearchChange}
          loading={clientSearch.loading}
          loadError={clientSearch.loadError}
          onLoadMore={clientSearch.onLoadMore}
          placeholder="Kunde auswählen"
          searchPlaceholder="Kunde suchen…"
        />
      </Field>
      <Field label="Einsatzort" htmlFor="equipment-site" required error={fieldErrors.siteId}>
        <SearchableSelect
          value={form.siteId}
          disabled={!form.clientId || mode !== 'create'}
          onChange={(value) =>
            setForm((current) => ({
              ...current,
              siteId: value,
              parentEquipmentId: null,
            }))
          }
          options={controller.siteOptions}
          loading={clientOption.loading}
          loadError={clientOption.error}
          onSearchChange={clientOption.error ? clientOption.retry : undefined}
          placeholder="Einsatzort auswählen"
          searchPlaceholder="Einsatzort suchen…"
        />
      </Field>
      <Field
        label="Bezeichnung"
        htmlFor="equipment-name"
        required
        error={fieldErrors.name}
        className="sm:col-span-2"
      >
        <Input
          value={form.name}
          onChange={(event) => updateField('name', event.target.value)}
          placeholder="z. B. Wärmepumpe Wohnhaus"
        />
      </Field>
    </>
  );
}

export function EquipmentTechnicalFields({
  form,
  updateField,
  mode,
}: EquipmentFormFieldsProps & { mode: EquipmentFormMode }): ReactElement {
  return (
    <FormDisclosure label="Technische Angaben und Kennungen" defaultOpen={mode === 'edit'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Hersteller" htmlFor="equipment-manufacturer">
          <Input
            value={form.manufacturer ?? ''}
            onChange={(event) => updateField('manufacturer', event.target.value)}
          />
        </Field>
        <Field label="Modell" htmlFor="equipment-model">
          <Input value={form.model ?? ''} onChange={(event) => updateField('model', event.target.value)} />
        </Field>
        <Field label="Seriennummer" htmlFor="equipment-serial">
          <Input
            value={form.serialNumber}
            onChange={(event) => updateField('serialNumber', event.target.value)}
          />
        </Field>
        <Field label="Hersteller- oder Artikelnummer" htmlFor="equipment-product">
          <Input
            value={form.productNumber}
            onChange={(event) => updateField('productNumber', event.target.value)}
          />
        </Field>
        <Field label="Betreiberkennung" htmlFor="equipment-operator">
          <Input
            value={form.operatorNumber}
            onChange={(event) => updateField('operatorNumber', event.target.value)}
          />
        </Field>
        <Field label="Technische Hinweise" htmlFor="equipment-notes" className="sm:col-span-2">
          <Textarea
            value={form.technicalNotes ?? ''}
            onChange={(event) => updateField('technicalNotes', event.target.value)}
            placeholder="Nur dauerhafte technische Hinweise, keine Servicechronik"
          />
        </Field>
      </div>
    </FormDisclosure>
  );
}

export function EquipmentWarrantyFields({ form, updateField }: EquipmentFormFieldsProps): ReactElement {
  return (
    <FormDisclosure label="Installation, Inbetriebnahme und Gewährleistung">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Installationsdatum" htmlFor="equipment-installation-date">
          <DatePicker
            value={parseIsoLocalDate(form.installationDate ?? '')}
            onChange={(value) => updateField('installationDate', toDateValue(value))}
          />
        </Field>
        <Field label="Inbetriebnahme" htmlFor="equipment-commissioning-date">
          <DatePicker
            value={parseIsoLocalDate(form.commissioningDate ?? '')}
            onChange={(value) => updateField('commissioningDate', toDateValue(value))}
          />
        </Field>
        <Field label="Gewährleistungsgeber" htmlFor="equipment-warranty-provider">
          <Input
            value={form.warrantyProvider ?? ''}
            onChange={(event) => updateField('warrantyProvider', event.target.value)}
          />
        </Field>
        <Field label="Grundlage" htmlFor="equipment-warranty-basis">
          <Input
            value={form.warrantyBasis ?? ''}
            onChange={(event) => updateField('warrantyBasis', event.target.value)}
            placeholder="z. B. Vertrag oder Herstellerzusage"
          />
        </Field>
        <Field label="Beginn" htmlFor="equipment-warranty-start">
          <DatePicker
            value={parseIsoLocalDate(form.warrantyStartDate ?? '')}
            onChange={(value) => updateField('warrantyStartDate', toDateValue(value))}
          />
        </Field>
        <Field label="Ende" htmlFor="equipment-warranty-end">
          <DatePicker
            value={parseIsoLocalDate(form.warrantyEndDate ?? '')}
            onChange={(value) => updateField('warrantyEndDate', toDateValue(value))}
          />
        </Field>
      </div>
    </FormDisclosure>
  );
}
