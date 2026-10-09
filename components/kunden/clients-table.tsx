'use client';

import { EmptyState } from '@/components/ui/empty-state';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2 } from 'lucide-react';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InlinePending } from '@/components/ui/inline-pending';
import { ListRow } from '@/components/ui/list-row';
import { PendingRow } from '@/components/ui/pending-row';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonRows, type SkeletonColumn } from '@/components/ui/skeleton-table';
import type { OptimisticListItem } from '@/hooks/use-optimistic-list';
import { ClientActionsMenu } from './client-actions-menu';
import { CLIENT_TYPE_LABELS, type Client } from '@/lib/jobs/types';

interface ClientsTableProps {
  /** A search is active, so an empty list means "no match", not "nothing yet". */
  isFiltered: boolean;
  rows: OptimisticListItem<Client>[];
  isBusy: (clientId: string) => boolean;
  onSaved: (clientId: string) => void;
  onDelete: (client: Client) => Promise<void>;
}

const PENDING_LABEL = 'Kunde wird gespeichert';

// One column definition for the loaded table and its skeleton (design canon):
// header count, widths and hover cannot drift apart.
const CLIENT_COLUMNS: readonly SkeletonColumn[] = [
  {
    id: 'name',
    header: 'Name',
    className: 'w-[25%]',
    skeleton: <Skeleton className="h-5 w-28" />,
  },
  {
    id: 'type',
    header: 'Typ',
    className: 'w-[120px] px-4',
    skeleton: <Skeleton className="h-[22px] w-20 rounded-full" />,
  },
  { id: 'email', header: 'E-Mail', skeleton: <Skeleton className="h-5 w-40" /> },
  {
    id: 'phone',
    header: 'Telefon',
    className: 'w-[150px]',
    skeleton: <Skeleton className="h-5 w-28" />,
  },
  {
    id: 'actions',
    header: '',
    className: 'w-[50px]',
    skeleton: <Skeleton className="size-8 rounded" />,
  },
];

function ClientsTableHeader() {
  return (
    <TableHeader>
      <TableRow>
        {CLIENT_COLUMNS.map((column) => (
          <TableHead key={column.id} className={column.className}>
            {column.header}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

/** Same frame as the loaded list; rows hover because loaded rows navigate. */
export function ClientsTableSkeleton({ count }: { count: number }) {
  return (
    <>
      <SkeletonList count={count} interactive className="md:hidden">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <Skeleton className="h-[20px] w-[120px]" />
            <Skeleton className="h-[18px] w-[70px] rounded-full" />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Skeleton className="h-[16px] w-[160px]" />
            <Skeleton className="h-[16px] w-[100px]" />
          </div>
        </div>
        <Skeleton className="size-8 shrink-0 rounded" />
      </SkeletonList>
      <div className="hidden md:block">
        <Table>
          <ClientsTableHeader />
          <TableBody>
            <SkeletonRows columns={CLIENT_COLUMNS} rows={count} interactive />
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function ClientTypeBadge({ clientType, compact }: { clientType: Client['clientType']; compact?: boolean }) {
  return (
    <span
      className={
        compact
          ? 'inline-flex shrink-0 items-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground'
          : 'inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground'
      }
    >
      {CLIENT_TYPE_LABELS[clientType]}
    </span>
  );
}

function ClientContactLine({ client }: { client: Client }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      {client.email && <span className="truncate">{client.email}</span>}
      {client.email && client.phone && <span className="text-muted-foreground/60">&middot;</span>}
      {client.phone && <span>{client.phone}</span>}
      {!client.email && !client.phone && <span>&mdash;</span>}
    </div>
  );
}

/** Mobile counterpart of `PendingRow`: the draft, dimmed, without actions. */
function PendingClientCard({ client }: { client: Client }) {
  return (
    <ListRow
      interactive
      unconfirmed
      role="status"
      aria-label={PENDING_LABEL}
      data-pending-row=""
      className="opacity-70"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <InlinePending active label={PENDING_LABEL} />
          <p className="min-w-0 truncate text-sm font-medium">{client.name}</p>
          <ClientTypeBadge clientType={client.clientType} compact />
        </div>
        <ClientContactLine client={client} />
      </div>
    </ListRow>
  );
}

function ClientCard({
  client,
  isBusy,
  onSaved,
  onDelete,
}: {
  client: Client;
  isBusy: boolean;
  onSaved: (clientId: string) => void;
  onDelete: (client: Client) => Promise<void>;
}) {
  const router = useRouter();

  return (
    <ListRow interactive onClick={() => router.push(`/kunden/${client.id}`)}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/kunden/${client.id}`}
            className="min-w-0 truncate rounded-sm text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => event.stopPropagation()}
          >
            {client.name}
          </Link>
          <ClientTypeBadge clientType={client.clientType} compact />
          <InlinePending active={isBusy} />
        </div>
        <ClientContactLine client={client} />
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <ClientActionsMenu client={client} isBusy={isBusy} onSaved={onSaved} onDelete={onDelete} />
      </div>
    </ListRow>
  );
}

// No loading prop on purpose: the list never turns into a skeleton over data
// it already has (feedback canon); `ClientsTableSkeleton` serves loading.tsx.
// A record the user just created rides along as an optimistic row.
export function ClientsTable({ rows, isBusy, onSaved, onDelete, isFiltered }: ClientsTableProps) {
  const router = useRouter();

  if (rows.length === 0) {
    return isFiltered ? (
      <EmptyState
        icon={Building2}
        title="Keine Kunden gefunden"
        description="Zu deiner Suche gibt es keinen Kunden. Prüfe die Schreibweise oder leere die Suche."
      />
    ) : (
      <EmptyState
        icon={Building2}
        title="Noch keine Kunden"
        description="Lege deinen ersten Kunden über „Kunde hinzufügen“ an."
      />
    );
  }

  return (
    <>
      {/* Mobile view - Card layout */}
      <div className="space-y-2 md:hidden">
        {rows.map(({ item: client, isOptimistic }) =>
          isOptimistic ? (
            <PendingClientCard key={client.id} client={client} />
          ) : (
            <ClientCard
              key={client.id}
              client={client}
              isBusy={isBusy(client.id)}
              onSaved={onSaved}
              onDelete={onDelete}
            />
          ),
        )}
      </div>

      {/* Desktop view - Table layout */}
      <div className="hidden md:block">
        <Table>
          <ClientsTableHeader />
          <TableBody>
            {rows.map(({ item: client, isOptimistic }) =>
              isOptimistic ? (
                <PendingRow
                  key={client.id}
                  columns={CLIENT_COLUMNS}
                  interactive
                  label={PENDING_LABEL}
                  cells={{
                    name: <span className="font-medium">{client.name}</span>,
                    type: <ClientTypeBadge clientType={client.clientType} />,
                    email: client.email || '—',
                    phone: client.phone || '—',
                    actions: <span className="block size-8" />,
                  }}
                />
              ) : (
                <TableRow
                  key={client.id}
                  interactive
                  onClick={() => router.push(`/kunden/${client.id}`)}
                  onMouseEnter={() => router.prefetch(`/kunden/${client.id}`)}
                  onFocus={() => router.prefetch(`/kunden/${client.id}`)}
                >
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <Link
                        href={`/kunden/${client.id}`}
                        className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {client.name}
                      </Link>
                      <InlinePending active={isBusy(client.id)} />
                    </span>
                  </TableCell>
                  <TableCell className="px-4">
                    <ClientTypeBadge clientType={client.clientType} />
                  </TableCell>
                  <TableCell>{client.email || '—'}</TableCell>
                  <TableCell>{client.phone || '—'}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <ClientActionsMenu
                      client={client}
                      isBusy={isBusy(client.id)}
                      onSaved={onSaved}
                      onDelete={onDelete}
                    />
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
