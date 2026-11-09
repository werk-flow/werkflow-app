'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { CLIENT_MATCH_REASON_LABELS, type ClientMatchList } from '@/lib/clients/types';

/**
 * The existing customers a new customer may duplicate, each with what matched
 * and „Öffnen“ in a new tab, so the draft in the dialog stays.
 */
export function ClientDuplicateMatches({ matches: { matches, moreMatches } }: { matches: ClientMatchList }) {
  return (
    <div
      role="status"
      className="rounded-md border border-info/30 bg-info-soft p-3 text-sm text-info-soft-foreground"
    >
      <p className="font-medium">Vielleicht schon Kunde</p>
      <ul className="mt-2 space-y-2">
        {matches.map((match) => (
          <li key={match.clientId} className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium break-words">{match.clientName}</p>
              <p className="text-xs">
                Gleich: {match.matchedOn.map((reason) => CLIENT_MATCH_REASON_LABELS[reason]).join(', ')}
              </p>
            </div>
            <Button size="sm" variant="outline" asChild>
              <Link
                href={`/kunden/${match.clientId}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${match.clientName} in neuem Tab öffnen`}
              >
                Öffnen
              </Link>
            </Button>
          </li>
        ))}
      </ul>
      {moreMatches && <p className="mt-2 text-xs">Es passen noch weitere Kunden.</p>}
      <p className="mt-2 text-xs">Ist es ein anderer Kunde, leg ihn mit „Trotzdem neu anlegen“ an.</p>
    </div>
  );
}
