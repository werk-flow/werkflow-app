'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
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
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import type { ActionResult } from '@/lib/action-result';
import {
  conditionFieldId,
  conditionFormOf,
  parseConditionForm,
  type ConditionForm,
  type ConditionInput,
  type ConditionPriceRow,
} from '@/lib/price-catalog/customer-condition-form';
import {
  CONDITION_LINE_KINDS,
  CONDITION_LINE_KIND_LABELS,
  type CustomerCondition,
} from '@/lib/price-catalog/customer-conditions';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { parseIsoLocalDate, toLocalDateString } from '@/lib/utils';

const SAVE_FAILED = 'Die Konditionen konnten nicht gespeichert werden. Versuche es erneut.';
const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  condition_changed:
    'Jemand hat die Konditionen gerade geändert. Schließe den Dialog und öffne ihn erneut, um von der neuen Fassung auszugehen.',
  client_archived: 'Der Kunde ist archiviert. Stelle ihn wieder her, um Konditionen festzulegen.',
  client_not_found: 'Diesen Kunden gibt es nicht mehr.',
  leistung_not_found: 'Eine gewählte Leistung gibt es nicht mehr. Entferne sie und speichere erneut.',
  invalid_input: 'Eine Angabe passt nicht. Prüfe Rabatte und Preise und speichere erneut.',
};

/** One own price: the Leistung, its net price per unit, and removing the row. */
function PriceRow({
  row,
  onChange,
  onRemove,
  errors,
}: {
  row: ConditionPriceRow;
  onChange: (row: ConditionPriceRow) => void;
  onRemove: () => void;
  errors: Record<string, string | undefined>;
}) {
  const search = useJobEntityOptions({ kind: 'leistungen' }, row.leistungId ? [row.leistungId] : []);
  const leistungId = conditionFieldId.leistung(row.key);
  const priceId = conditionFieldId.price(row.key);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_auto]">
      <Field
        label="Leistung"
        htmlFor={leistungId}
        required
        error={errors[leistungId]}
        className="col-span-2 sm:col-span-1"
      >
        <SearchableSelect
          id={leistungId}
          value={row.leistungId}
          onChange={(value) => onChange({ ...row, leistungId: value })}
          options={search.options}
          onSearchChange={search.onSearchChange}
          loading={search.loading}
          loadFailure={search.loadFailure}
          onLoadMore={search.onLoadMore}
          placeholder="Leistung wählen…"
          searchPlaceholder="Nummer oder Name…"
          emptyMessage="Keine Leistung gefunden"
        />
      </Field>
      <Field label="Preis netto je Einheit" htmlFor={priceId} required error={errors[priceId]}>
        <Input
          inputMode="decimal"
          autoComplete="off"
          value={row.price}
          onChange={(event) => onChange({ ...row, price: event.target.value })}
          placeholder="0,00"
        />
      </Field>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={onRemove}
        aria-label="Eigenen Preis entfernen"
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}

type FormPartProps = {
  form: ConditionForm;
  onChange: (form: ConditionForm) => void;
  errors: Record<string, string | undefined>;
};

/** A discount in percent on the list price per kind of line. */
function DiscountFields({ form, onChange, errors }: FormPartProps) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Rabatt auf den Listenpreis in Prozent</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {CONDITION_LINE_KINDS.map((kind) => {
          const id = conditionFieldId.discount(kind);
          return (
            <Field key={kind} label={CONDITION_LINE_KIND_LABELS[kind]} htmlFor={id} error={errors[id]}>
              <Input
                inputMode="decimal"
                autoComplete="off"
                value={form.discounts[kind]}
                onChange={(event) =>
                  onChange({ ...form, discounts: { ...form.discounts, [kind]: event.target.value } })
                }
                placeholder="kein Rabatt"
              />
            </Field>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        Material sind Artikel. Arbeit und Anfahrt sind Leistungen dieser Art; andere Leistungen bekommen
        keinen Rabatt.
      </p>
    </fieldset>
  );
}

/** The own Leistung prices, each in its row, and adding one. */
function OwnPriceFields({ form, onChange, errors }: FormPartProps) {
  const setRow = (key: string, next: ConditionPriceRow | null) =>
    onChange({
      ...form,
      prices: next
        ? form.prices.map((row) => (row.key === key ? next : row))
        : form.prices.filter((row) => row.key !== key),
    });
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Eigene Preise für Leistungen</legend>
      <p className="text-sm text-muted-foreground">Ein eigener Preis ersetzt Listenpreis und Rabatt.</p>
      {form.prices.length > 0 && (
        <ul className="space-y-3">
          {form.prices.map((row) => (
            <PriceRow
              key={row.key}
              row={row}
              onChange={(next) => setRow(row.key, next)}
              onRemove={() => setRow(row.key, null)}
              errors={errors}
            />
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange({
            ...form,
            prices: [...form.prices, { key: crypto.randomUUID(), leistungId: '', price: '' }],
          })
        }
      >
        <Plus className="size-4" />
        Eigenen Preis hinzufügen
      </Button>
    </fieldset>
  );
}

/**
 * Records a new version of a customer's conditions, filled from the newest
 * one: its first day, a discount per kind of line and own Leistung prices.
 * The version it was filled from goes with the save, so another session's
 * version meanwhile refuses this one; one key per opening makes a retried
 * press answer with the first version.
 */
export function ClientConditionDialog({
  newest,
  today,
  onRecord,
  onClose,
}: {
  newest: CustomerCondition | null;
  today: string;
  onRecord: (input: ConditionInput, expectedVersion: number, attemptKey: string) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ConditionForm>(() => conditionFormOf(newest, today));
  const [expectedVersion] = useState(() => newest?.version ?? 0);
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending: pending } = usePendingTask();
  const parsed = parseConditionForm(form);
  const errors = attempted && !parsed.ok ? parsed.errors : {};

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!parsed.ok) {
      focusFirstInvalidField(parsed.errors);
      return;
    }
    void run(async () => {
      setError(null);
      const result = await onRecord(parsed.input, expectedVersion, attemptKey).catch(() => null);
      if (!result?.success) {
        setError(result ? describeFailure(result.error, FAILURE_MESSAGES, SAVE_FAILED) : SAVE_FAILED);
        return;
      }
      onClose();
    });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={pending}>
      <DialogContent size="2xl">
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>{newest ? 'Konditionen ändern' : 'Konditionen festlegen'}</DialogTitle>
            <DialogDescription>
              Die Konditionen gelten ab ihrem Tag für neue Positionen in Angeboten. Positionen, die es schon
              gibt, behalten ihren Preis.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-6">
            <Field
              label="Gültig ab"
              htmlFor={conditionFieldId.validFrom}
              required
              error={errors[conditionFieldId.validFrom]}
            >
              <DatePicker
                id={conditionFieldId.validFrom}
                ariaLabel="Gültig ab"
                value={parseIsoLocalDate(form.validFrom)}
                // The picker answers the local midnight of the chosen day: keep that calendar day.
                onChange={(date) => setForm({ ...form, validFrom: date ? toLocalDateString(date) : '' })}
              />
            </Field>
            <DiscountFields form={form} onChange={setForm} errors={errors} />
            <OwnPriceFields form={form} onChange={setForm} errors={errors} />
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Abbrechen
            </Button>
            <Button type="submit" pending={pending} disabled={pending}>
              Konditionen speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
