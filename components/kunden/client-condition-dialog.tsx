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
import { usePayloadAttemptKey } from '@/hooks/use-payload-attempt-key';
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
  MAX_CONDITION_LEISTUNG_PRICES,
  type ConditionChanged,
  type CustomerCondition,
} from '@/lib/price-catalog/customer-conditions';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { parseIsoLocalDate, toLocalDateString } from '@/lib/utils';

const SAVE_FAILED = 'Die Konditionen konnten nicht gespeichert werden. Versuche es erneut.';
const CONDITION_CHANGED =
  'Inzwischen wurde ein neuerer Stand gespeichert, zum Beispiel in einem anderen Fenster. Deine Eingaben sind noch da: Speicherst du erneut, werden sie als nächster Stand gespeichert.';
const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  client_archived: 'Der Kunde ist archiviert. Stelle ihn wieder her, um Konditionen festzulegen.',
  client_not_found: 'Diesen Kunden gibt es nicht mehr.',
  leistung_not_found: 'Eine gewählte Leistung gibt es nicht mehr. Entferne sie und speichere erneut.',
  invalid_input: 'Eine Angabe passt nicht. Prüfe Rabatte und Preise und speichere erneut.',
};

/** One own price: the Leistung, its net price per unit, and removing the row. */
function PriceRow({
  row,
  knownLabel,
  onChange,
  onRemove,
  errors,
}: {
  row: ConditionPriceRow;
  /** The picked Leistung's label from the version the form was filled from: no read needed for it. */
  knownLabel: string | undefined;
  onChange: (row: ConditionPriceRow) => void;
  onRemove: () => void;
  errors: Record<string, string | undefined>;
}) {
  // Only a Leistung picked in this dialog reads its label; the picker searches once it opens.
  const search = useJobEntityOptions(
    { kind: 'leistungen' },
    row.leistungId && !knownLabel ? [row.leistungId] : [],
  );
  const known = knownLabel ? { value: row.leistungId, label: knownLabel } : null;
  const options =
    known && !search.options.some((option) => option.value === known.value)
      ? [known, ...search.options]
      : search.options;
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
          options={options}
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

/** The first day the new version applies. */
function ValidFromField({ form, onChange, errors, disabled }: FormPartProps & { disabled: boolean }) {
  return (
    <Field
      label="Gültig ab"
      htmlFor={conditionFieldId.validFrom}
      required
      error={errors[conditionFieldId.validFrom]}
    >
      <DatePicker
        id={conditionFieldId.validFrom}
        ariaLabel="Gültig ab"
        // Its date segments are no native inputs: the fieldset does not disable them.
        disabled={disabled}
        value={parseIsoLocalDate(form.validFrom)}
        // The picker answers the local midnight of the chosen day: keep that calendar day.
        onChange={(date) => onChange({ ...form, validFrom: date ? toLocalDateString(date) : '' })}
      />
    </Field>
  );
}

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
function OwnPriceFields({
  form,
  onChange,
  errors,
  newest,
}: FormPartProps & { newest: CustomerCondition | null }) {
  const labels = new Map(
    (newest?.leistungPrices ?? []).map((price) => [price.leistungId, `${price.number} · ${price.name}`]),
  );
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
              knownLabel={labels.get(row.leistungId)}
              onChange={(next) => setRow(row.key, next)}
              onRemove={() => setRow(row.key, null)}
              errors={errors}
            />
          ))}
        </ul>
      )}
      {form.prices.length < MAX_CONDITION_LEISTUNG_PRICES ? (
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
      ) : (
        <p className="text-sm text-muted-foreground">
          Ein Stand hat höchstens {MAX_CONDITION_LEISTUNG_PRICES} eigene Preise.
        </p>
      )}
    </fieldset>
  );
}

/**
 * Records a new version of a customer's conditions, filled from the newest
 * one: its first day, a discount per kind of line and own Leistung prices.
 * The version it was filled from goes with the save, so another session's
 * version meanwhile refuses this one. The dialog then keeps every value and
 * expects the version the refusal names: a save never overwrites, so a
 * second press records the office's values as the next version. One key per
 * payload makes a retried press of the same values answer with the first
 * version.
 */
export function ClientConditionDialog({
  newest,
  today,
  onRecord,
  onClose,
}: {
  newest: CustomerCondition | null;
  today: string;
  onRecord: (
    input: ConditionInput,
    expectedVersion: number,
    attemptKey: string,
  ) => Promise<ActionResult | ConditionChanged>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ConditionForm>(() => conditionFormOf(newest, today));
  // The page's newer version waits while the dialog is open: a refusal names it instead.
  const [expectedVersion, setExpectedVersion] = useState(() => newest?.version ?? 0);
  const attempt = usePayloadAttemptKey();
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
      // One key per payload: a retry of the same values answers the first save, whose answer may
      // have been lost; changed values are a new version. A refusal commits nothing, so its key stays.
      const key = attempt.keyFor(JSON.stringify(parsed.input));
      const result = await onRecord(parsed.input, expectedVersion, key).catch(() => null);
      if (result?.success) {
        onClose();
        return;
      }
      if (result && 'currentVersion' in result) {
        setExpectedVersion(result.currentVersion);
        setError(CONDITION_CHANGED);
        return;
      }
      setError(result ? describeFailure(result.error, FAILURE_MESSAGES, SAVE_FAILED) : SAVE_FAILED);
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
          <DialogBody>
            {/* While the save runs, no field takes an edit the save would not carry. */}
            <fieldset disabled={pending} className="space-y-6">
              <ValidFromField form={form} onChange={setForm} errors={errors} disabled={pending} />
              <DiscountFields form={form} onChange={setForm} errors={errors} />
              <OwnPriceFields form={form} onChange={setForm} errors={errors} newest={newest} />
              <ErrorText>{error}</ErrorText>
            </fieldset>
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
