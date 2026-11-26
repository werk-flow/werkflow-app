import { FileCheck2 } from 'lucide-react';
import Link from 'next/link';

import { SectionTitle } from '@/components/shared/section-title';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatEuroCents } from '@/lib/document-rendering/format';
import { OFFER_CHANNEL_LABELS, type OfferRevision } from '@/lib/offers/types';
import { formatGermanDate } from '@/lib/utils';

/**
 * The sent revisions of an offer, newest first, each with the day, the
 * channel the office named and its filed PDF in the library. An older
 * revision stays readable, marked as replaced by the next.
 */
export function OfferRevisions({ revisions }: { revisions: readonly OfferRevision[] }) {
  if (revisions.length === 0) return null;
  return (
    <section aria-labelledby="offer-revisions-title" className="space-y-3">
      <SectionTitle id="offer-revisions-title">Gesendete Revisionen</SectionTitle>
      <ul className="divide-y rounded-lg border bg-card shadow-xs">
        {revisions.map((revision, index) => {
          const replacedBy = index > 0 ? revisions[index - 1]?.revision : undefined;
          return (
            <li
              key={revision.revision}
              className="flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 gap-3">
                <FileCheck2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    Revision {revision.revision}
                    {replacedBy !== undefined && (
                      <Badge variant="outline">Ersetzt durch Revision {replacedBy}</Badge>
                    )}
                  </p>
                  <p className="text-muted-foreground">
                    Als gesendet festgehalten am {formatGermanDate(revision.sentOn)}
                    {` · ${OFFER_CHANNEL_LABELS[revision.channel]}`}
                    {revision.sentBy ? ` · von ${revision.sentBy}` : ''}
                  </p>
                  <p className="text-muted-foreground">
                    An {revision.recipientName} · gültig bis {formatGermanDate(revision.validUntil)} ·{' '}
                    <span className="tabular-nums">{formatEuroCents(revision.grossCents)}</span> brutto
                  </p>
                </div>
              </div>
              <Button asChild variant="outline" size="sm" className="self-start sm:self-auto">
                <Link href={`/dokumente?document=${revision.documentId}`}>PDF öffnen</Link>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
