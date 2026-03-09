'use client';

import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ClientActionsMenu } from './client-actions-menu';
import { CLIENT_TYPE_LABELS, type Client } from '@/lib/jobs/types';

interface ClientsTableProps {
  clients: Client[];
  isLoading?: boolean;
  skeletonCount?: number;
}

function ClientCardSkeleton() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5">
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
      <Skeleton className="h-8 w-8 shrink-0 rounded" />
    </div>
  );
}

function ClientRowSkeleton() {
  return (
    <TableRow>
      <TableCell className="font-medium">
        <Skeleton className="h-5 w-28" />
      </TableCell>
      <TableCell className="px-4">
        <Skeleton className="h-[22px] w-20 rounded-full" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-40" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-28" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-8 w-8 rounded" />
      </TableCell>
    </TableRow>
  );
}

function ClientCard({ client }: { client: Client }) {
  const router = useRouter();

  return (
    <div
      className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/50"
      onClick={() => router.push(`/kunden/${client.id}`)}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{client.name}</p>
          <span className="inline-flex shrink-0 items-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
            {CLIENT_TYPE_LABELS[client.clientType]}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {client.email && <span className="truncate">{client.email}</span>}
          {client.email && client.phone && (
            <span className="text-muted-foreground/60">&middot;</span>
          )}
          {client.phone && <span>{client.phone}</span>}
          {!client.email && !client.phone && <span>&mdash;</span>}
        </div>
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <ClientActionsMenu client={client} />
      </div>
    </div>
  );
}

export function ClientsTable({
  clients,
  isLoading = false,
  skeletonCount = 0,
}: ClientsTableProps) {
  const router = useRouter();
  if (isLoading && skeletonCount > 0) {
    return (
      <>
        {/* Mobile view - Card skeletons */}
        <div className="space-y-2 md:hidden">
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <ClientCardSkeleton key={i} />
          ))}
        </div>

        {/* Desktop view - Table skeletons */}
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[25%]">Name</TableHead>
                <TableHead className="w-[120px] px-4">Typ</TableHead>
                <TableHead>E-Mail</TableHead>
                <TableHead className="w-[150px]">Telefon</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: skeletonCount }).map((_, i) => (
                <ClientRowSkeleton key={i} />
              ))}
            </TableBody>
          </Table>
        </div>
      </>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <Building2 className="size-6 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold">Noch keine Kunden</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Du hast noch keine Kunden hinzugefügt. Klicke auf &quot;Kunde
          hinzufügen&quot; um einen neuen Kunden anzulegen.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile view - Card layout */}
      <div className="space-y-2 md:hidden">
        {clients.map((client) => (
          <ClientCard key={client.id} client={client} />
        ))}
      </div>

      {/* Desktop view - Table layout */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[25%]">Name</TableHead>
              <TableHead className="w-[120px] px-4">Typ</TableHead>
              <TableHead>E-Mail</TableHead>
              <TableHead className="w-[150px]">Telefon</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <TableRow
                key={client.id}
                className="cursor-pointer transition-colors hover:bg-accent/50"
                onClick={() => router.push(`/kunden/${client.id}`)}
              >
                <TableCell className="font-medium">{client.name}</TableCell>
                <TableCell className="px-4">
                  <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
                    {CLIENT_TYPE_LABELS[client.clientType]}
                  </span>
                </TableCell>
                <TableCell>{client.email || '—'}</TableCell>
                <TableCell>{client.phone || '—'}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <ClientActionsMenu client={client} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
