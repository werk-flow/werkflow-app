'use client';

import { Archive, ArchiveRestore, Euro, Pencil } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { InlinePending } from '@/components/ui/inline-pending';
import { ListRow, ListRowActions } from '@/components/ui/list-row';
import { PlainButton } from '@/components/ui/plain-button';
import { RowActionsMenu, type RowActionMenuItem } from '@/components/ui/row-actions-menu';
import { ColumnsTableHeader } from '@/components/ui/skeleton-table';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { INVENTORY_UNITS } from '@/lib/inventory/units';
import { formatEuroCents, formatTaxRate } from '@/lib/document-rendering/format';
import { LEISTUNG_KIND_LABELS, type LeistungListEntry } from '@/lib/price-catalog/types';
import { formatGermanDate } from '@/lib/utils';
import { LEISTUNG_COLUMNS } from './leistungen-columns';

export type LeistungRowActions = {
  onOpenPrices: (entry: LeistungListEntry) => void;
  onEdit: (entry: LeistungListEntry) => void;
  onSetArchived: (entry: LeistungListEntry, archived: boolean) => void;
  isBusy: (id: string) => boolean;
};

function unitShortLabel(entry: LeistungListEntry): string {
  return INVENTORY_UNITS.find((unit) => unit.code === entry.unit)?.shortLabel ?? 'Einheit prüfen';
}

function currentVersion(entry: LeistungListEntry) {
  return entry.versions.find((version) => version.id === entry.currentVersionId) ?? null;
}

/** „65,00 € / Std“, and the first day of the next price. */
function SalePrice({ entry }: { entry: LeistungListEntry }) {
  const current = currentVersion(entry);
  return (
    <div className="tabular-nums">
      <p>{current ? `${formatEuroCents(current.salePriceCents)} / ${unitShortLabel(entry)}` : '—'}</p>
      {entry.nextValidFrom && (
        <p className="text-xs text-muted-foreground">
          {current ? 'Neuer Preis' : 'Preis'} ab {formatGermanDate(entry.nextValidFrom)}
        </p>
      )}
    </div>
  );
}

function costRateLabel(entry: LeistungListEntry): string {
  const cost = currentVersion(entry)?.costRateCents ?? null;
  return cost === null ? '—' : formatEuroCents(cost);
}

function rowMenu(entry: LeistungListEntry, actions: LeistungRowActions): RowActionMenuItem[] {
  const prices = {
    label: 'Preise',
    icon: <Euro className="size-4" />,
    onSelect: () => actions.onOpenPrices(entry),
  };
  if (entry.archived) {
    return [
      prices,
      {
        label: 'Wiederherstellen',
        icon: <ArchiveRestore className="size-4" />,
        onSelect: () => actions.onSetArchived(entry, false),
      },
    ];
  }
  return [
    prices,
    { label: 'Bearbeiten', icon: <Pencil className="size-4" />, onSelect: () => actions.onEdit(entry) },
    {
      label: 'Archivieren',
      icon: <Archive className="size-4" />,
      onSelect: () => actions.onSetArchived(entry, true),
      separatorBefore: true,
    },
  ];
}

/** The row's menu with its pending marker. */
function RowMenu({ entry, actions }: { entry: LeistungListEntry; actions: LeistungRowActions }) {
  const busy = actions.isBusy(entry.id);
  return (
    <div className="flex items-center justify-end gap-1">
      <InlinePending active={busy} />
      <RowActionsMenu actions={rowMenu(entry, actions)} disabled={busy} />
    </div>
  );
}

/** Desktop table; a row opens its prices. */
export function LeistungenTable({
  entries,
  actions,
}: {
  entries: readonly LeistungListEntry[];
  actions: LeistungRowActions;
}) {
  return (
    <div className="hidden md:block">
      <Table>
        <ColumnsTableHeader columns={LEISTUNG_COLUMNS} />
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id} rowId={entry.id} interactive onClick={() => actions.onOpenPrices(entry)}>
              <TableCell className="max-w-0 text-muted-foreground">
                <p className="truncate">{entry.leistungNumber}</p>
              </TableCell>
              <TableCell className="max-w-0">
                <PlainButton
                  className="block max-w-full truncate rounded-sm text-left font-medium"
                  onClick={(event) => {
                    event.stopPropagation();
                    actions.onOpenPrices(entry);
                  }}
                >
                  {entry.name}
                </PlainButton>
                {entry.description && (
                  <p className="truncate text-xs text-muted-foreground">{entry.description}</p>
                )}
              </TableCell>
              <TableCell>{LEISTUNG_KIND_LABELS[entry.kind]}</TableCell>
              <TableCell className="text-right">
                <SalePrice entry={entry} />
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {costRateLabel(entry)}
              </TableCell>
              <TableCell className="tabular-nums">{formatTaxRate(entry.taxRateBasisPoints)}</TableCell>
              <TableCell onClick={(event) => event.stopPropagation()}>
                <RowMenu entry={entry} actions={actions} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Phone cards with every column's information. */
export function LeistungenCards({
  entries,
  actions,
}: {
  entries: readonly LeistungListEntry[];
  actions: LeistungRowActions;
}) {
  return (
    <div className="space-y-2 md:hidden">
      {entries.map((entry) => (
        <ListRow key={entry.id} rowId={entry.id} interactive onClick={() => actions.onOpenPrices(entry)}>
          <div className="min-w-0 flex-1 space-y-1">
            <PlainButton
              className="block max-w-full truncate rounded-sm text-left text-sm font-medium"
              onClick={(event) => {
                event.stopPropagation();
                actions.onOpenPrices(entry);
              }}
            >
              {entry.name}
            </PlainButton>
            {entry.description && (
              <p className="line-clamp-2 text-xs text-muted-foreground">{entry.description}</p>
            )}
            <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              <span>{entry.leistungNumber}</span>
              <span>{LEISTUNG_KIND_LABELS[entry.kind]}</span>
              <span>MwSt. {formatTaxRate(entry.taxRateBasisPoints)}</span>
            </p>
            <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
              <SalePrice entry={entry} />
              <span className="text-xs text-muted-foreground tabular-nums">
                Kostensatz {costRateLabel(entry)}
              </span>
            </div>
            {entry.archived && <Badge variant="outline">Archiviert</Badge>}
          </div>
          <ListRowActions>
            <RowMenu entry={entry} actions={actions} />
          </ListRowActions>
        </ListRow>
      ))}
    </div>
  );
}
