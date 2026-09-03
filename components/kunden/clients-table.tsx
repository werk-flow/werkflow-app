"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2 } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ListRow } from "@/components/ui/list-row";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SkeletonList,
  SkeletonRows,
  type SkeletonColumn,
} from "@/components/ui/skeleton-table";
import { ClientActionsMenu } from "./client-actions-menu";
import { CLIENT_TYPE_LABELS, type Client } from "@/lib/jobs/types";

interface ClientsTableProps {
  clients: Client[];
  isLoading?: boolean;
  skeletonCount?: number;
}

// One column definition for the loaded table and its skeleton (design canon):
// header count, widths and hover cannot drift apart.
export const CLIENT_COLUMNS: readonly SkeletonColumn[] = [
  {
    id: "name",
    header: "Name",
    className: "w-[25%]",
    skeleton: <Skeleton className="h-5 w-28" />,
  },
  {
    id: "type",
    header: "Typ",
    className: "w-[120px] px-4",
    skeleton: <Skeleton className="h-[22px] w-20 rounded-full" />,
  },
  { id: "email", header: "E-Mail", skeleton: <Skeleton className="h-5 w-40" /> },
  {
    id: "phone",
    header: "Telefon",
    className: "w-[150px]",
    skeleton: <Skeleton className="h-5 w-28" />,
  },
  {
    id: "actions",
    header: "",
    className: "w-[50px]",
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

function ClientCard({ client }: { client: Client }) {
  const router = useRouter();

  return (
    <ListRow interactive onClick={() => router.push(`/kunden/${client.id}`)}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 truncate text-sm font-medium">{client.name}</p>
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
    </ListRow>
  );
}

export function ClientsTable({
  clients,
  isLoading = false,
  skeletonCount = 0,
}: ClientsTableProps) {
  const router = useRouter();
  if (isLoading && skeletonCount > 0) {
    return <ClientsTableSkeleton count={skeletonCount} />;
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
          <ClientsTableHeader />
          <TableBody>
            {clients.map((client) => (
              <TableRow
                key={client.id}
                interactive
                onClick={() => router.push(`/kunden/${client.id}`)}
              >
                <TableCell className="font-medium">
                  <Link
                    href={`/kunden/${client.id}`}
                    className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {client.name}
                  </Link>
                </TableCell>
                <TableCell className="px-4">
                  <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
                    {CLIENT_TYPE_LABELS[client.clientType]}
                  </span>
                </TableCell>
                <TableCell>{client.email || "—"}</TableCell>
                <TableCell>{client.phone || "—"}</TableCell>
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
