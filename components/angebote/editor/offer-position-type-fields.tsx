'use client';

import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatAlternativeMark } from '@/lib/document-rendering/format';
import type { PositionFigures } from '@/lib/offers/calculation';
import { isNormalPricedForm, type PositionForm } from '@/lib/offers/content-form';

const TYPE_LABELS: Record<PositionForm['positionType'], string> = {
  normal: 'Normalposition',
  bedarf: 'Bedarfsposition',
  alternative: 'Alternativposition',
};

/** The normal priced Positions of the Titel an Alternativposition at `index` can stand for, nearest above first. */
function basesFor(positions: readonly PositionForm[], index: number): PositionForm[] {
  const candidates = positions.filter((candidate, at) => at !== index && isNormalPricedForm(candidate));
  const above = candidates.filter((candidate) => positions.indexOf(candidate) < index).reverse();
  return [...above, ...candidates.filter((candidate) => positions.indexOf(candidate) > index)];
}

/**
 * Positionsart, and for an Alternativposition the Position it is offered
 * instead of. Neither a Bedarfs- nor an Alternativposition counts in a sum;
 * the description says so and names an Alternativposition's difference.
 */
export function PositionTypeFields({
  alternativeId,
  index,
  positions,
  numbers,
  figures,
  onChange,
  error,
  disabled,
}: {
  /** The id of „Alternative zu“, which a save's error names. */
  alternativeId: string;
  /** The position's place in `positions`, its Titel. */
  index: number;
  positions: readonly PositionForm[];
  /** The printed number of each position of the Titel, null for a text line. */
  numbers: ReadonlyArray<string | null>;
  /** The figures of each position of the Titel, or null while one cannot be read. */
  figures: ReadonlyArray<PositionFigures | null> | null;
  onChange: (position: PositionForm) => void;
  error: string | undefined;
  disabled: boolean;
}) {
  const position = positions[index];
  if (!position) return null;
  const typeId = `${alternativeId}-type`;
  const bases = basesFor(positions, index);
  const baseIndex = positions.findIndex((candidate) => candidate.key === position.alternativeTo);
  const baseForm = positions[baseIndex];
  // A Position since removed, or no longer a normal one, is no choice: the save names the field.
  const base = baseForm && bases.includes(baseForm) ? baseIndex : null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field
        label="Positionsart"
        htmlFor={typeId}
        description={typeDescription(position, base, numbers, figures, index)}
      >
        <Select
          value={position.positionType}
          onValueChange={(value) => {
            const kind = (['normal', 'bedarf', 'alternative'] as const).find(
              (candidate) => candidate === value,
            );
            if (!kind) return;
            onChange({
              ...position,
              positionType: kind,
              alternativeTo: kind === 'alternative' ? (bases[0]?.key ?? null) : null,
            });
          }}
          disabled={disabled}
        >
          <SelectTrigger id={typeId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {position.positionType === 'alternative' && (
        <AlternativeField
          id={alternativeId}
          value={base === null ? '' : (position.alternativeTo ?? '')}
          options={bases.map((candidate) => ({
            value: candidate.key,
            label: `${numbers[positions.indexOf(candidate)] ?? ''} · ${candidate.name.trim() || 'ohne Bezeichnung'}`,
          }))}
          onChange={(key) => onChange({ ...position, alternativeTo: key })}
          error={error}
          disabled={disabled}
        />
      )}
    </div>
  );
}

/** „Alternative zu“: the Normalpositionen of the Titel, empty while it names none of them. */
function AlternativeField({
  id,
  value,
  options,
  onChange,
  error,
  disabled,
}: {
  id: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (key: string) => void;
  error: string | undefined;
  disabled: boolean;
}) {
  return (
    <Field label="Alternative zu" htmlFor={id} required error={error}>
      <SearchableSelect
        id={id}
        value={value}
        onChange={onChange}
        placeholder="Position wählen…"
        options={[...options]}
        searchPlaceholder="Position suchen…"
        emptyMessage="Keine Normalposition im Titel"
        disabled={disabled}
      />
    </Field>
  );
}

/** What the type means for the sums, with an Alternativposition's Position and difference once both read. */
function typeDescription(
  position: PositionForm,
  base: number | null,
  numbers: ReadonlyArray<string | null>,
  figures: ReadonlyArray<PositionFigures | null> | null,
  index: number,
): string | undefined {
  if (position.positionType === 'normal') return undefined;
  if (position.positionType === 'bedarf') return 'Mit Preis angeboten, nicht in der Summe.';
  const own = figures?.[index];
  const of = base === null ? null : figures?.[base];
  const number = base === null ? null : numbers[base];
  if (!own || !of || !number) return 'Statt einer Normalposition angeboten, nicht in der Summe.';
  return `${formatAlternativeMark({ number, differenceCents: own.saleCents - of.saleCents })}. Nicht in der Summe.`;
}
