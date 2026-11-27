import { FileCheck2 } from 'lucide-react';
import Link from 'next/link';

import { OfferRevisionDelivery } from '@/components/angebote/offer-revision-delivery';
import { SectionTitle } from '@/components/shared/section-title';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatEuroCents } from '@/lib/document-rendering/format';
import { OFFER_CHANNEL_LABELS, type OfferRevision } from '@/lib/offers/types';
import { formatGermanDate } from '@/lib/utils';

/**
 * The sent revisions of an offer, newest first, each with the day, the
 * channel the office named and its filed PDF in the library. An older
 * revision stays readable, marked as replaced by the next. While the offer is
 * the draft of its next revision, the list says so above the newest sent one.
 * „Versenden“ emails the newest through E2c's delivery; a replaced one lists its sends.
 */
export function OfferRevisions({
  offerId,
  revisions,
  editing,
}: {
  offerId: string;
  revisions: readonly OfferRevision[];
  /** The offer is a draft again: the draft of the revision after the newest sent one. */
  editing: boolean;
}) {
  const [newest] = revisions;
  if (!newest) return null;
  return (
    <section aria-labelledby="offer-revisions-title" className="space-y-3">
      <SectionTitle id="offer-revisions-title">Gesendete Revisionen</SectionTitle>
      {editing && (
        <p className="text-sm text-muted-foreground">
          {`Du bearbeitest Revision ${newest.revision + 1}. Bis du sie als gesendet festhältst, bleibt Revision ${newest.revision} die zuletzt gesendete.`}
        </p>
      )}
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
                <div className="min-w-0 space-y-1 wrap-anywhere">
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
              <div className="flex flex-wrap gap-2 self-start sm:self-auto">
                <OfferRevisionDelivery
                  offerId={offerId}
                  revision={revision.revision}
                  recipientName={revision.recipientName}
                  replacedBy={replacedBy}
                />
                <Button asChild variant="outline" size="sm">
                  <Link href={`/dokumente?document=${revision.documentId}`}>PDF öffnen</Link>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
