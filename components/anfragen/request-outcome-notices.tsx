import Link from 'next/link';
import { CircleCheck } from 'lucide-react';

import { formatGermanDateTime as formatDateTime } from '@/lib/utils';
import { REQUEST_CLOSE_REASON_LABELS, type ClientRequest } from '@/lib/requests/types';
import type { RequestDetailData } from './request-detail-content';

interface RequestOutcomeNoticesProps {
  request: ClientRequest;
  convertedLink: RequestDetailData['convertedLink'];
}

/** How the request ended: the record it was converted into, or the close reason. */
export function RequestOutcomeNotices({ request, convertedLink }: RequestOutcomeNoticesProps) {
  return (
    <>
      {convertedLink && (
        <div className="flex items-center gap-2 rounded-lg border bg-card p-4">
          <CircleCheck className="size-5 shrink-0 text-success-text" />
          <p className="text-sm">
            Diese Anfrage wurde umgewandelt:{' '}
            {convertedLink.href ? (
              <Link
                href={convertedLink.href}
                className="font-medium text-primary-text underline-offset-4 hover:underline"
              >
                {convertedLink.label}
              </Link>
            ) : (
              <span className="font-medium">{convertedLink.label}</span>
            )}
          </p>
        </div>
      )}

      {request.status === 'geschlossen' && request.closedReason && (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm">
            <span className="font-medium">Ohne Auftrag geschlossen:</span>{' '}
            {REQUEST_CLOSE_REASON_LABELS[request.closedReason]}
            {request.closedAt ? ` (${formatDateTime(request.closedAt)})` : ''}
          </p>
          {request.closedNote && <p className="mt-1 text-sm text-muted-foreground">{request.closedNote}</p>}
        </div>
      )}
    </>
  );
}
