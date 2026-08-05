'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Inbox, RefreshCw, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import {
  REQUEST_CATEGORY_LABELS,
  type ClientRequest,
  type RequestStatus,
} from '@/lib/requests/types';
import { RequestStatusBadge, RequestUrgencyBadge } from './request-badges';

export type RequestListEntry = {
  request: ClientRequest;
  clientName: string | null;
  assigneeName: string | null;
  convertedLabel: string | null;
};

interface AnfragenContentProps {
  entries: RequestListEntry[];
}

type StatusFilter = 'aktiv' | RequestStatus | 'alle';

const FILTER_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'aktiv', label: 'Aktiv' },
  { value: 'umgewandelt', label: 'Umgewandelt' },
  { value: 'geschlossen', label: 'Geschlossen' },
  { value: 'alle', label: 'Alle' },
];

function formatReceivedAt(receivedAt: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(receivedAt));
}

function requestCallerLabel(entry: RequestListEntry): string {
  if (entry.clientName) return entry.clientName;
  if (entry.request.callerName) return `${entry.request.callerName} (neu)`;
  return 'Unbekannte/r Anrufer/in';
}

export function AnfragenContent({ entries }: AnfragenContentProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('aktiv');

  useRealtimeRouterRefresh({
    tables: ['client_requests', 'clients'],
  });

  const handleRefresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      const { request } = entry;
      if (statusFilter === 'aktiv') {
        if (request.status !== 'offen' && request.status !== 'in_klaerung') {
          return false;
        }
      } else if (statusFilter !== 'alle' && request.status !== statusFilter) {
        return false;
      }

      if (!query) return true;
      const haystack = [
        request.summary,
        request.details,
        request.requestNumber,
        entry.clientName,
        request.callerName,
        request.callerPhone,
        request.callerEmail,
        entry.assigneeName,
        REQUEST_CATEGORY_LABELS[request.category],
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [entries, search, statusFilter]);

  return (
    <>
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <Tabs
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as StatusFilter)}
          >
            <TabsList className="h-9">
              {FILTER_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-9"
                placeholder="Anliegen, Kunde, Nummer..."
                aria-label="Anfragen durchsuchen"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={isPending}
              className="h-8 w-8"
              title="Liste aktualisieren"
            >
              <RefreshCw className={`size-4 ${isPending ? 'animate-spin' : ''}`} />
              <span className="sr-only">Aktualisieren</span>
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {filteredEntries.length}{' '}
          {filteredEntries.length === 1 ? 'Anfrage' : 'Anfragen'}
        </p>
      </div>

      {filteredEntries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
            <Inbox className="size-6 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">Keine Anfragen</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {entries.length === 0
              ? 'Erfasse eine Anfrage direkt während des nächsten Anrufs über „Anfrage erfassen“.'
              : 'Für die aktuelle Filterung gibt es keine Anfragen.'}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile view - card layout */}
          <div className="space-y-2 md:hidden">
            {filteredEntries.map((entry) => (
              <div
                key={entry.request.id}
                className="cursor-pointer rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/50"
                onClick={() => router.push(`/anfragen/${entry.request.id}`)}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium">
                    {entry.request.summary}
                  </p>
                  <RequestStatusBadge status={entry.request.status} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="truncate">{requestCallerLabel(entry)}</span>
                  <span className="text-muted-foreground/60">&middot;</span>
                  <span>{REQUEST_CATEGORY_LABELS[entry.request.category]}</span>
                  <span className="text-muted-foreground/60">&middot;</span>
                  <span>{formatReceivedAt(entry.request.receivedAt)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <RequestUrgencyBadge urgency={entry.request.urgency} />
                  {entry.convertedLabel && (
                    <span className="text-xs text-muted-foreground">
                      → {entry.convertedLabel}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop view - table layout */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Nr.</TableHead>
                  <TableHead>Anliegen</TableHead>
                  <TableHead className="w-[18%]">Kunde / Anrufer</TableHead>
                  <TableHead className="w-[140px]">Kategorie</TableHead>
                  <TableHead className="w-[110px]">Dringlichkeit</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[140px]">Eingegangen</TableHead>
                  <TableHead className="w-[15%]">Zuständig</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.map((entry) => (
                  <TableRow
                    key={entry.request.id}
                    className="cursor-pointer transition-colors hover:bg-accent/50"
                    onClick={() => router.push(`/anfragen/${entry.request.id}`)}
                  >
                    <TableCell className="text-muted-foreground">
                      {entry.request.requestNumber || '—'}
                    </TableCell>
                    <TableCell className="max-w-0">
                      <p className="truncate font-medium">{entry.request.summary}</p>
                      {entry.convertedLabel && (
                        <p className="truncate text-xs text-muted-foreground">
                          → {entry.convertedLabel}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="max-w-0">
                      <p className="truncate">{requestCallerLabel(entry)}</p>
                    </TableCell>
                    <TableCell>
                      {REQUEST_CATEGORY_LABELS[entry.request.category]}
                    </TableCell>
                    <TableCell>
                      <RequestUrgencyBadge urgency={entry.request.urgency} />
                    </TableCell>
                    <TableCell>
                      <RequestStatusBadge status={entry.request.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatReceivedAt(entry.request.receivedAt)}
                    </TableCell>
                    <TableCell className="max-w-0">
                      <p className="truncate">{entry.assigneeName || '—'}</p>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </>
  );
}
