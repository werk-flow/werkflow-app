'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { ListRow } from '@/components/ui/list-row';
import { ColumnsTableHeader } from '@/components/ui/skeleton-table';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { formatEuroCents } from '@/lib/document-rendering/format';
import { INVOICE_STATUS_LABELS, type InvoiceListEntry, type InvoiceStatus } from '@/lib/invoices/types';
import { ClientRecipientLine } from '@/components/shared/client-recipient-line';
import { rowIntentPrefetch } from '@/lib/ui/row-intent';
import { formatGermanDate } from '@/lib/utils';
import { INVOICE_COLUMNS } from './invoices-columns';

const invoicePath = (entry: InvoiceListEntry) => `/rechnungen/${entry.id}`;

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <Badge variant={status === 'ausgestellt' ? 'success' : status === 'entwurf' ? 'outline' : 'secondary'}>
      {INVOICE_STATUS_LABELS[status]}
    </Badge>
  );
}

/** A draft has no number until it is issued. */
function numberLabel(entry: InvoiceListEntry): string {
  return entry.invoiceNumber ?? 'Ohne Nummer';
}

/** Desktop table; a row opens the invoice and prefetches it on intent. */
export function InvoicesTable({ entries }: { entries: readonly InvoiceListEntry[] }) {
  const router = useRouter();
  return (
    <div className="hidden md:block">
      <Table>
        <ColumnsTableHeader columns={INVOICE_COLUMNS} />
        <TableBody>
          {entries.map((entry) => (
            <TableRow
              key={entry.id}
              rowId={entry.id}
              interactive
              onClick={() => router.push(`/rechnungen/${entry.id}`)}
              {...rowIntentPrefetch(() => router.prefetch(`/rechnungen/${entry.id}`))}
            >
              <TableCell className="whitespace-nowrap tabular-nums">
                {/* A real link inside the clickable row for keyboard users and middle-click. */}
                <Link
                  href={invoicePath(entry)}
                  onClick={(event) => event.stopPropagation()}
                  className="rounded-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {numberLabel(entry)}
                </Link>
              </TableCell>
              <TableCell className="max-w-0">
                <ClientRecipientLine clientName={entry.clientName} recipientName={entry.recipientName} />
              </TableCell>
              <TableCell>
                <InvoiceStatusBadge status={entry.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatEuroCents(entry.grossCents)}</TableCell>
              <TableCell className="tabular-nums">{formatGermanDate(entry.updatedAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Phone cards, each a real link. */
export function InvoicesCards({ entries }: { entries: readonly InvoiceListEntry[] }) {
  return (
    <div className="space-y-2 md:hidden">
      {entries.map((entry) => (
        <ListRow key={entry.id} rowId={entry.id} asChild interactive>
          <Link
            href={invoicePath(entry)}
            aria-label={`Rechnung öffnen: ${entry.clientName}, ${numberLabel(entry)}`}
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium">{entry.clientName}</p>
                <InvoiceStatusBadge status={entry.status} />
              </div>
              {entry.recipientName && (
                <p className="truncate text-xs text-muted-foreground">Rechnung an {entry.recipientName}</p>
              )}
              <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground tabular-nums">
                <span>{numberLabel(entry)}</span>
                <span>{formatEuroCents(entry.grossCents)}</span>
                <span>geändert {formatGermanDate(entry.updatedAt)}</span>
              </p>
            </div>
          </Link>
        </ListRow>
      ))}
    </div>
  );
}
