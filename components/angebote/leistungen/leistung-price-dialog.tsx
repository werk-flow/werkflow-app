'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import type { ActionResult } from '@/lib/action-result';
import { INVENTORY_UNITS } from '@/lib/inventory/units';
import { formatEuroCents } from '@/lib/document-rendering/format';
import type { LeistungListEntry, LeistungPriceVersion } from '@/lib/price-catalog/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { formatGermanDate } from '@/lib/utils';
import {
  emptyLeistungPrice,
  LEISTUNG_FAILURE_MESSAGES,
  leistungPriceErrors,
  type LeistungPriceForm,
} from './leistung-form-state';
import { LeistungPriceFields } from './leistung-price-fields';

const SAVE_FAILED = LEISTUNG_FAILURE_MESSAGES.save_failed ?? '';

type VersionState = 'aktuell' | 'kommend' | 'frueher' | 'ersetzt';

function versionState(
  entry: LeistungListEntry,
  version: LeistungPriceVersion,
  priceDate: string,
): VersionState {
  if (version.superseded) return 'ersetzt';
  if (version.id === entry.currentVersionId) return 'aktuell';
  return version.validFrom > priceDate ? 'kommend' : 'frueher';
}

const VERSION_BADGES: Record<VersionState, { label: string; variant: 'success' | 'secondary' | 'outline' }> =
  {
    aktuell: { label: 'Gilt heute', variant: 'success' },
    kommend: { label: 'Kommt', variant: 'secondary' },
    frueher: { label: 'Früher', variant: 'outline' },
    ersetzt: { label: 'Ersetzt', variant: 'outline' },
  };

/**
 * The price history of one Leistung and the form for its next price. A
 * recorded price never changes; a second price for the same first day
 * replaces the first one for new offers and keeps it here as „Ersetzt“.
 */
export function LeistungPriceDialog({
  entry,
  priceDate,
  onClose,
  onAddPrice,
}: {
  entry: LeistungListEntry;
  /** The Berlin day the list's prices were read for. */
  priceDate: string;
  onClose: () => void;
  onAddPrice: (leistungId: string, price: LeistungPriceForm) => Promise<ActionResult>;
}) {
  const latest = entry.versions.find((version) => !version.superseded);
  const [price, setPrice] = useState(() => emptyLeistungPrice(latest));
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending: pending } = usePendingTask();
  const errors = leistungPriceErrors(price, 'leistung-price');
  const unitLabel = INVENTORY_UNITS.find((unit) => unit.code === entry.unit)?.shortLabel ?? null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (focusFirstInvalidField(errors)) return;
    void run(async () => {
      setError(null);
      const result = await onAddPrice(entry.id, price).catch(() => null);
      if (!result?.success) {
        setError(
          result ? describeFailure(result.error, LEISTUNG_FAILURE_MESSAGES, SAVE_FAILED) : SAVE_FAILED,
        );
        return;
      }
      setAttempted(false);
      setPrice(emptyLeistungPrice());
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} pending={pending}>
      <DialogContent size="3xl">
        <form onSubmit={submit} className="contents" noValidate>
          <DialogHeader>
            <DialogTitle>Preise von „{entry.name}“</DialogTitle>
            <DialogDescription>
              Ein neuer Preis gilt ab seinem Tag. Frühere Preise bleiben, wie sie waren, und gesendete
              Angebote behalten ihren Preis.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-6">
            <LeistungPriceHistory entry={entry} priceDate={priceDate} unitLabel={unitLabel} />
            {entry.archived ? (
              <p className="text-sm text-muted-foreground">
                Die Leistung ist archiviert. Stelle sie wieder her, um einen neuen Preis zu erfassen.
              </p>
            ) : (
              <NewPriceSection
                unitLabel={unitLabel}
                price={price}
                onChange={setPrice}
                errors={attempted ? errors : {}}
                error={error}
              />
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Schließen
            </Button>
            {!entry.archived && (
              <Button type="submit" pending={pending} disabled={pending}>
                Preis speichern
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The form section of the next price. */
function NewPriceSection({
  unitLabel,
  price,
  onChange,
  errors,
  error,
}: {
  unitLabel: string | null;
  price: LeistungPriceForm;
  onChange: (price: LeistungPriceForm) => void;
  errors: Record<string, string | undefined>;
  error: string | null;
}) {
  return (
    <section className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-semibold">Neuer Preis</h3>
      <LeistungPriceFields
        prefix="leistung-price"
        unitLabel={unitLabel}
        form={price}
        onChange={onChange}
        errors={errors}
      />
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

/** Every version, latest first day first; a table on wide screens, rows on phones. */
function LeistungPriceHistory({
  entry,
  priceDate,
  unitLabel,
}: {
  entry: LeistungListEntry;
  priceDate: string;
  unitLabel: string | null;
}) {
  const perUnit = (cents: number) => `${formatEuroCents(cents)}${unitLabel ? ` / ${unitLabel}` : ''}`;
  const rows = entry.versions.map((version) => ({ version, state: versionState(entry, version, priceDate) }));
  return (
    <section className="space-y-2" aria-label="Preisverlauf">
      <h3 className="text-sm font-semibold">Preisverlauf</h3>
      <ul className="divide-y rounded-lg border md:hidden">
        {rows.map(({ version, state }) => (
          <li key={version.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium tabular-nums">ab {formatGermanDate(version.validFrom)}</p>
              <p className="text-sm tabular-nums">{perUnit(version.salePriceCents)}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                Kostensatz {version.costRateCents === null ? '—' : perUnit(version.costRateCents)} · erfasst
                am {formatGermanDate(version.recordedAt)}
              </p>
            </div>
            <Badge variant={VERSION_BADGES[state].variant}>{VERSION_BADGES[state].label}</Badge>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Gültig ab</TableHead>
              <TableHead className="text-right">Verkaufspreis</TableHead>
              <TableHead className="text-right">Kostensatz</TableHead>
              <TableHead>Erfasst am</TableHead>
              <TableHead>Stand</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ version, state }) => (
              <TableRow key={version.id}>
                <TableCell className="tabular-nums">{formatGermanDate(version.validFrom)}</TableCell>
                <TableCell className="text-right tabular-nums">{perUnit(version.salePriceCents)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {version.costRateCents === null ? '—' : perUnit(version.costRateCents)}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {formatGermanDate(version.recordedAt)}
                </TableCell>
                <TableCell>
                  <Badge variant={VERSION_BADGES[state].variant}>{VERSION_BADGES[state].label}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
