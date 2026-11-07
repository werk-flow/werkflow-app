'use client';

import Link from 'next/link';
import { Building2, Phone, UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { RegionLoadError } from '@/components/shared/region-load-error';
import {
  CALLER_MATCH_FIELD_LABELS,
  type CallerMatch,
  type CallerMatchList,
  type ClientRequest,
} from '@/lib/requests/types';
import type { RequestDetailData } from './request-detail-content';
import { SectionTitle } from '@/components/shared/section-title';

interface RequestCustomerCardProps {
  request: ClientRequest;
  data: Pick<
    RequestDetailData,
    'clientName' | 'siteLabel' | 'contactLabel' | 'contactPhone' | 'callerMatches'
  >;
  isEditable: boolean;
  isPending: boolean;
  /** The first press found matches; the next press creates the customer anyway. */
  promoteArmed: boolean;
  customerError: string | null;
  onMatch: () => void;
  onAssignMatch: (match: CallerMatch) => void;
  onPromote: () => void;
}

/** The matched customer with site, contact and the caller data captured before the match. */
function MatchedCustomer({ request, data }: Pick<RequestCustomerCardProps, 'request' | 'data'>) {
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <Link
        href={`/kunden/${request.clientId}`}
        className="font-medium text-primary-text underline-offset-4 hover:underline"
      >
        {data.clientName}
      </Link>
      {data.siteLabel && (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Einsatzort:</span> {data.siteLabel}
        </p>
      )}
      {data.contactLabel && (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Ansprechpartner:</span> {data.contactLabel}
          {data.contactPhone && (
            <>
              {' · '}
              <a
                href={`tel:${data.contactPhone.replace(/[^\d+]/g, '')}`}
                className="inline-flex items-center gap-1 text-primary-text underline-offset-4 hover:underline"
              >
                <Phone className="size-3.5" />
                {data.contactPhone}
              </a>
            </>
          )}
        </p>
      )}
      {(request.callerName || request.callerPhone || request.callerEmail || request.callerAddress) && (
        <div className="mt-3 border-t pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Erfasste Anruferdaten
          </p>
          <div className="mt-1 space-y-1">
            {request.callerName && <p>{request.callerName}</p>}
            {request.callerPhone && <p className="text-muted-foreground">{request.callerPhone}</p>}
            {request.callerEmail && <p className="text-muted-foreground">{request.callerEmail}</p>}
            {request.callerAddress && <p className="text-muted-foreground">{request.callerAddress}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** The customers the caller may already be, each with its one-press assignment. */
function CallerMatches({
  matches: { matches, moreMatches },
  isEditable,
  isPending,
  onAssignMatch,
}: {
  matches: CallerMatchList;
  isEditable: boolean;
  isPending: boolean;
  onAssignMatch: (match: CallerMatch) => void;
}) {
  return (
    <div className="rounded-md border border-info/30 bg-info-soft p-3 text-sm text-info-soft-foreground">
      <p className="font-medium">Vielleicht schon Kunde</p>
      <ul className="mt-2 space-y-2">
        {matches.map((match) => (
          <li key={match.clientId} className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium break-words">{match.clientName}</p>
              <p className="text-xs">
                Gleich: {match.matchedOn.map((field) => CALLER_MATCH_FIELD_LABELS[field]).join(', ')}
              </p>
            </div>
            {isEditable && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAssignMatch(match)}
                disabled={isPending}
                aria-label={`${match.clientName} zuordnen`}
              >
                Zuordnen
              </Button>
            )}
          </li>
        ))}
      </ul>
      {moreMatches && (
        <p className="mt-2 text-xs">
          Es passen noch weitere Kunden. Such sie über „Vorhandenem Kunden zuordnen“.
        </p>
      )}
    </div>
  );
}

/** The captured caller with the matching customers and the match and promote actions. */
function UnmatchedCaller({
  request,
  callerMatches,
  isEditable,
  isPending,
  promoteArmed,
  customerError,
  onMatch,
  onAssignMatch,
  onPromote,
}: Omit<RequestCustomerCardProps, 'data'> & { callerMatches: CallerMatchList | null }) {
  return (
    <div className="mt-3 space-y-3">
      <div className="space-y-1 text-sm">
        <p className="font-medium">{request.callerName || 'Unbekannte/r Anrufer/in'}</p>
        {request.callerPhone && <p className="text-muted-foreground">{request.callerPhone}</p>}
        {request.callerEmail && <p className="text-muted-foreground">{request.callerEmail}</p>}
        {request.callerAddress && <p className="text-muted-foreground">{request.callerAddress}</p>}
        <p className="text-xs text-muted-foreground">Noch keinem Kunden zugeordnet.</p>
      </div>
      {callerMatches === null ? (
        <RegionLoadError title="Prüfung auf vorhandene Kunden fehlgeschlagen">
          Ob die Anruferin oder der Anrufer schon Kunde ist, konnte nicht geprüft werden.
        </RegionLoadError>
      ) : (
        callerMatches.matches.length > 0 && (
          <CallerMatches
            matches={callerMatches}
            isEditable={isEditable}
            isPending={isPending}
            onAssignMatch={onAssignMatch}
          />
        )
      )}
      {isEditable && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onMatch} disabled={isPending}>
            Vorhandenem Kunden zuordnen
          </Button>
          <Button pending={isPending} size="sm" variant="outline" onClick={onPromote} disabled={isPending}>
            <UserPlus className="size-4" />
            {promoteArmed ? 'Trotzdem neu anlegen' : 'Als neuen Kunden anlegen'}
          </Button>
        </div>
      )}
      {promoteArmed && !customerError && (
        <p className="text-xs text-muted-foreground">
          Es gibt schon passende Kunden. Drück noch einmal, um trotzdem einen neuen Kunden anzulegen.
        </p>
      )}
      <ErrorText>{customerError}</ErrorText>
    </div>
  );
}

/** The matched customer, or the captured caller with the match and promote actions. */
export function RequestCustomerCard({
  request,
  data,
  isEditable,
  isPending,
  promoteArmed,
  customerError,
  onMatch,
  onAssignMatch,
  onPromote,
}: RequestCustomerCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <SectionTitle as="h2">
        <Building2 className="size-4" />
        Kunde
      </SectionTitle>
      {request.clientId && data.clientName ? (
        <MatchedCustomer request={request} data={data} />
      ) : (
        <UnmatchedCaller
          request={request}
          callerMatches={data.callerMatches}
          isEditable={isEditable}
          isPending={isPending}
          promoteArmed={promoteArmed}
          customerError={customerError}
          onMatch={onMatch}
          onAssignMatch={onAssignMatch}
          onPromote={onPromote}
        />
      )}
    </div>
  );
}
