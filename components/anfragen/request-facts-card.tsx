import Link from 'next/link';

import { formatBerlinDateTime as formatDateTime } from '@/lib/utils';
import { REQUEST_CATEGORY_LABELS, REQUEST_SOURCE_LABELS, type ClientRequest } from '@/lib/requests/types';
import { SectionTitle } from '@/components/shared/section-title';
import { CallbackOverdueBadge } from './request-badges';

interface RequestFactsCardProps {
  request: ClientRequest;
  assigneeName: string | null;
  /** The promised callback had passed when the page was read. */
  callbackOverdue: boolean;
  /** The request's Anlage with the number of its detail page. */
  equipment: { label: string; equipmentNumber: string } | null;
}

export function RequestFactsCard({
  request,
  assigneeName,
  callbackOverdue,
  equipment,
}: RequestFactsCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <SectionTitle as="h2">Details</SectionTitle>
      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">Zuständig</dt>
          <dd>{assigneeName || '—'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">Rückruf bis</dt>
          <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {request.callbackDueAt ? formatDateTime(request.callbackDueAt) : '—'}
            {callbackOverdue && <CallbackOverdueBadge />}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">Anlage</dt>
          <dd className="min-w-0">
            {equipment ? (
              <Link
                href={`/service/anlagen/${encodeURIComponent(equipment.equipmentNumber)}`}
                className="text-primary-text underline-offset-4 hover:underline"
              >
                {equipment.label}
              </Link>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">Kategorie</dt>
          <dd>{REQUEST_CATEGORY_LABELS[request.category]}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">Eingang über</dt>
          <dd>{REQUEST_SOURCE_LABELS[request.source]}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">Eingegangen</dt>
          <dd>{formatDateTime(request.receivedAt)}</dd>
        </div>
      </dl>
      {request.details && (
        <div className="mt-3 border-t pt-3">
          <p className="whitespace-pre-wrap text-sm">{request.details}</p>
        </div>
      )}
    </div>
  );
}
