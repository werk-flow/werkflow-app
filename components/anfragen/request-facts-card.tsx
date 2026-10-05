import { formatGermanDateTime as formatDateTime } from '@/lib/utils';
import { REQUEST_CATEGORY_LABELS, REQUEST_SOURCE_LABELS, type ClientRequest } from '@/lib/requests/types';
import { SectionTitle } from '@/components/shared/section-title';

interface RequestFactsCardProps {
  request: ClientRequest;
  assigneeName: string | null;
}

export function RequestFactsCard({ request, assigneeName }: RequestFactsCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <SectionTitle as="h2">Details</SectionTitle>
      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">Zuständig</dt>
          <dd>{assigneeName || '—'}</dd>
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
