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

type EquipmentTextKey =
  | 'manufacturer'
  | 'model'
  | 'serialNumber'
  | 'productNumber'
  | 'operatorNumber'
  | 'sourceNumber'
  | 'warrantyProvider'
  | 'warrantyBasis';

/** One free-text field of the dialog. */
function EquipmentTextField({
  form,
  updateField,
  name,
  id,
  label,
  placeholder,
  maxLength,
}: EquipmentFormFieldsProps & {
  name: EquipmentTextKey;
  id: string;
  label: string;
  placeholder?: string;
  maxLength?: number;
}): ReactElement {
  return (
    <Field label={label} htmlFor={id}>
      <Input
        value={form[name] ?? ''}
        onChange={(event) => updateField(name, event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
      />
    </Field>
  );
}

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
          loadFailure={clientSearch.loadFailure}
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
          loadFailure={clientOption.loadFailure}
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
  const fields = { form, updateField };
  return (
    <FormDisclosure label="Technische Angaben und Kennungen" defaultOpen={mode === 'edit'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <EquipmentTextField {...fields} name="manufacturer" id="equipment-manufacturer" label="Hersteller" />
        <EquipmentTextField {...fields} name="model" id="equipment-model" label="Modell" />
        <EquipmentTextField {...fields} name="serialNumber" id="equipment-serial" label="Seriennummer" />
        <EquipmentTextField
          {...fields}
          name="productNumber"
          id="equipment-product"
          label="Hersteller- oder Artikelnummer"
        />
        <EquipmentTextField
          {...fields}
          name="operatorNumber"
          id="equipment-operator"
          label="Betreiberkennung"
        />
        {/* A replacement is a new device: it does not take the predecessor's old number. */}
        {mode !== 'replace' && (
          <EquipmentTextField
            {...fields}
            name="sourceNumber"
            id="equipment-source-number"
            label="Nummer im Altsystem"
            placeholder="Nummer aus dem bisherigen Programm"
            maxLength={100}
          />
        )}
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
  const fields = { form, updateField };
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
        <EquipmentTextField
          {...fields}
          name="warrantyProvider"
          id="equipment-warranty-provider"
          label="Gewährleistungsgeber"
        />
        <EquipmentTextField
          {...fields}
          name="warrantyBasis"
          id="equipment-warranty-basis"
          label="Grundlage"
          placeholder="z. B. Vertrag oder Herstellerzusage"
        />
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
