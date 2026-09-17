'use client';

import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { LIST_PAGE_SIZE, lastListPage } from '@/lib/ui/list-pagination';

export function ListPagination({ page, total, pageSize = LIST_PAGE_SIZE, onPageChange, busy = false, label }: {
  page: number;
  total: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  busy?: boolean;
  label: string;
}) {
  const lastPage = lastListPage(total, pageSize);
  return (
    <nav aria-label={label} className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground" role="status" aria-label="Eintragsanzahl">
          {total === 0 || page > lastPage ? '0' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)}`} von {total}
        </span>
        <InlinePending active={busy} label="Liste wird geladen" />
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={busy || page <= 1} onClick={() => onPageChange(page - 1)}>Zurück</Button>
        <span className="tabular-nums">{page > lastPage ? 'Seite nicht mehr vorhanden' : `Seite ${page} von ${lastPage}`}</span>
        <Button variant="outline" size="sm" disabled={busy || page >= lastPage} onClick={() => onPageChange(page + 1)}>Weiter</Button>
      </div>
    </nav>
  );
}
