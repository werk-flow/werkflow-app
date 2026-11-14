'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { ListRow } from '@/components/ui/list-row';
import { ColumnsTableHeader } from '@/components/ui/skeleton-table';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { OFFER_STATUS_LABELS, type OfferListEntry, type OfferStatus } from '@/lib/offers/types';
import { rowIntentPrefetch } from '@/lib/ui/row-intent';
import { cn, formatGermanDate } from '@/lib/utils';
import { OFFER_COLUMNS } from './offers-columns';

const offerPath = (entry: OfferListEntry) => `/angebote/${entry.id}`;

export function OfferStatusBadge({ status }: { status: OfferStatus }) {
  return (
    <Badge variant={status === 'angenommen' ? 'success' : status === 'entwurf' ? 'outline' : 'secondary'}>
      {OFFER_STATUS_LABELS[status]}
    </Badge>
  );
}

/** The customer, and the Rechnungsempfänger when another customer gets the invoice. */
function ClientLine({ entry }: { entry: OfferListEntry }) {
  return (
    <>
      <p className="truncate">{entry.clientName}</p>
      {entry.recipientName && (
        <p className="truncate text-xs text-muted-foreground">Rechnung an {entry.recipientName}</p>
      )}
    </>
  );
}

/** Desktop table; a row opens the offer and prefetches it on intent. */
export function OffersTable({ entries }: { entries: readonly OfferListEntry[] }) {
  const router = useRouter();
  return (
    <div className="hidden md:block">
      <Table>
        <ColumnsTableHeader columns={OFFER_COLUMNS} />
        <TableBody>
          {entries.map((entry) => (
            <TableRow
              key={entry.id}
              rowId={entry.id}
              interactive
              onClick={() => router.push(`/angebote/${entry.id}`)}
              {...rowIntentPrefetch(() => router.prefetch(`/angebote/${entry.id}`))}
            >
              <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                {entry.offerNumber}
              </TableCell>
              <TableCell className="max-w-0">
                {/* A real link inside the clickable row for keyboard users and middle-click. */}
                <Link
                  href={offerPath(entry)}
                  onClick={(event) => event.stopPropagation()}
                  className="block truncate rounded-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {entry.title}
                </Link>
              </TableCell>
              <TableCell className="max-w-0">
                <ClientLine entry={entry} />
              </TableCell>
              <TableCell>
                <OfferStatusBadge status={entry.status} />
              </TableCell>
              <TableCell className="tabular-nums">{formatGermanDate(entry.validUntil)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Cards, each a real link: the phone list, and the customer detail at every width. */
export function OffersCards({
  entries,
  className,
}: {
  entries: readonly OfferListEntry[];
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {entries.map((entry) => (
        <ListRow key={entry.id} rowId={entry.id} asChild interactive>
          <Link href={offerPath(entry)} aria-label={`Angebot öffnen: ${entry.offerNumber} ${entry.title}`}>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium">{entry.title}</p>
                <OfferStatusBadge status={entry.status} />
              </div>
              <div className="text-xs text-muted-foreground">
                <ClientLine entry={entry} />
              </div>
              <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground tabular-nums">
                <span>{entry.offerNumber}</span>
                <span>gültig bis {formatGermanDate(entry.validUntil)}</span>
              </p>
            </div>
          </Link>
        </ListRow>
      ))}
    </div>
  );
}
