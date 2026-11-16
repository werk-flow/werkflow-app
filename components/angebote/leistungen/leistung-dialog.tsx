'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import type { ActionResult } from '@/lib/action-result';
import { OFFERED_INVENTORY_UNITS } from '@/lib/inventory/units';
import { formatTaxRate } from '@/lib/document-rendering/format';
import {
  LEISTUNG_KIND_LABELS,
  LEISTUNG_KINDS,
  LEISTUNG_TAX_RATES,
  type LeistungListEntry,
} from '@/lib/price-catalog/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import {
  emptyLeistungFields,
  emptyLeistungPrice,
  LEISTUNG_FAILURE_MESSAGES,
  leistungFieldErrors,
  leistungFieldsOf,
  leistungPriceErrors,
  type LeistungFieldsForm,
  type LeistungPriceForm,
} from './leistung-form-state';
import { LeistungPriceFields } from './leistung-price-fields';

const SAVE_FAILED = LEISTUNG_FAILURE_MESSAGES.save_failed ?? '';
// E1's units; more than nine, so the choice searches.
const LEISTUNG_UNIT_OPTIONS = OFFERED_INVENTORY_UNITS.map((unit) => ({
  value: unit.code,
  label: unit.label,
}));

export type LeistungDialogSubmit =
  | { mode: 'create'; fields: LeistungFieldsForm; price: LeistungPriceForm }
  | { mode: 'edit'; leistungId: string; fields: LeistungFieldsForm };

/**
 * „Leistung anlegen“ with its first price, or „Leistung bearbeiten“ for the
 * master data of an existing one; its prices change in the price dialog.
 */
export function LeistungDialog({
  entry,
  onClose,
  onSubmit,
}: {
  /** The Leistung to edit; none creates a new one. */
  entry: LeistungListEntry | null;
  onClose: () => void;
  onSubmit: (submit: LeistungDialogSubmit) => Promise<ActionResult>;
}) {
  const [fields, setFields] = useState(() => (entry ? leistungFieldsOf(entry) : emptyLeistungFields()));
  const [price, setPrice] = useState(() => emptyLeistungPrice());
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending: pending } = usePendingTask();
  const errors = {
    ...leistungFieldErrors(fields),
    ...(entry ? {} : leistungPriceErrors(price, 'leistung-first')),
  };
  const unitLabel = OFFERED_INVENTORY_UNITS.find((unit) => unit.code === fields.unit)?.shortLabel ?? null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField(errors)) return;
    void run(async () => {
      setError(null);
      const result = await onSubmit(
        entry ? { mode: 'edit', leistungId: entry.id, fields } : { mode: 'create', fields, price },
      ).catch(() => null);
      if (!result?.success) {
        setError(
          result ? describeFailure(result.error, LEISTUNG_FAILURE_MESSAGES, SAVE_FAILED) : SAVE_FAILED,
        );
        return;
      }
      onClose();
    });
  };
  const shown = attempted ? errors : {};

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={pending}>
      <DialogContent size="2xl">
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>{entry ? 'Leistung bearbeiten' : 'Leistung anlegen'}</DialogTitle>
            <DialogDescription>
              {entry
                ? 'Die Preise änderst du unter „Preise“. Gesendete Angebote behalten ihre Angaben.'
                : 'Eine Leistung ohne Artikel, zum Beispiel Arbeitszeit, Anfahrt oder eine Pauschale.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <LeistungTextFields fields={fields} onChange={setFields} errors={shown} />
            <LeistungKindFields fields={fields} onChange={setFields} unitError={shown['leistung-unit']} />
            {!entry && (
              <section className="space-y-3 border-t pt-4">
                <h3 className="text-sm font-semibold">Erster Preis</h3>
                <LeistungPriceFields
                  prefix="leistung-first"
                  unitLabel={unitLabel}
                  form={price}
                  onChange={setPrice}
                  errors={shown}
                />
              </section>
            )}
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Abbrechen
            </Button>
            <Button type="submit" pending={pending} disabled={pending}>
              {entry ? 'Speichern' : 'Leistung anlegen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Nummer, Name and Beschreibung. */
function LeistungTextFields({
  fields,
  onChange,
  errors,
}: {
  fields: LeistungFieldsForm;
  onChange: (fields: LeistungFieldsForm) => void;
  errors: Record<string, string | undefined>;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Field label="Nummer" htmlFor="leistung-number" required error={errors['leistung-number']}>
          <Input
            value={fields.leistungNumber}
            onChange={(event) => onChange({ ...fields, leistungNumber: event.target.value })}
            maxLength={40}
            autoComplete="off"
          />
        </Field>
        <Field label="Name" htmlFor="leistung-name" required error={errors['leistung-name']}>
          <Input
            value={fields.name}
            onChange={(event) => onChange({ ...fields, name: event.target.value })}
            maxLength={200}
            autoComplete="off"
          />
        </Field>
      </div>
      <Field
        label="Beschreibung"
        htmlFor="leistung-description"
        description="Steht im Angebot unter dem Namen."
      >
        <Textarea
          value={fields.description}
          onChange={(event) => onChange({ ...fields, description: event.target.value })}
          maxLength={4000}
          rows={3}
        />
      </Field>
    </>
  );
}

/** Art, Einheit and MwSt: three fixed lists side by side. */
function LeistungKindFields({
  fields,
  onChange,
  unitError,
}: {
  fields: LeistungFieldsForm;
  onChange: (fields: LeistungFieldsForm) => void;
  unitError: string | undefined;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Art" htmlFor="leistung-kind" required>
        <Select
          value={fields.kind}
          onValueChange={(value) => {
            const kind = LEISTUNG_KINDS.find((candidate) => candidate === value);
            if (kind) onChange({ ...fields, kind });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEISTUNG_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {LEISTUNG_KIND_LABELS[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Einheit" htmlFor="leistung-unit" required error={unitError}>
        <SearchableSelect
          options={LEISTUNG_UNIT_OPTIONS}
          value={fields.unit}
          placeholder="Einheit wählen"
          onChange={(unit) => onChange({ ...fields, unit })}
          searchPlaceholder="Einheit suchen …"
          emptyMessage="Keine Einheit gefunden"
        />
      </Field>
      <Field label="MwSt." htmlFor="leistung-tax-rate" required>
        <Select
          value={String(fields.taxRate)}
          onValueChange={(value) => {
            const taxRate = LEISTUNG_TAX_RATES.find((rate) => String(rate) === value);
            if (taxRate !== undefined) onChange({ ...fields, taxRate });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEISTUNG_TAX_RATES.map((rate) => (
              <SelectItem key={rate} value={String(rate)}>
                {formatTaxRate(rate)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}
