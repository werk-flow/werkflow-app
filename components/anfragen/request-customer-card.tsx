'use client';

import Link from 'next/link';
import { Building2, Loader2, Phone, UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import type { ClientRequest } from '@/lib/requests/types';
import type { RequestDetailData } from './request-detail-content';
import { SectionTitle } from '@/components/shared/section-title';

interface RequestCustomerCardProps {
  request: ClientRequest;
  data: Pick<RequestDetailData, 'clientName' | 'siteLabel' | 'contactLabel' | 'contactPhone'>;
  isEditable: boolean;
  isPending: boolean;
  promoteError: string | null;
  onMatch: () => void;
  onPromote: () => void;
}

/** The matched customer, or the captured caller with the match and promote actions. */
export function RequestCustomerCard({
  request,
  data,
  isEditable,
  isPending,
  promoteError,
  onMatch,
  onPromote,
}: RequestCustomerCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <SectionTitle as="h2">
        <Building2 className="size-4" />
        Kunde
      </SectionTitle>
      {request.clientId && data.clientName ? (
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
      ) : (
        <div className="mt-3 space-y-3">
          <div className="space-y-1 text-sm">
            <p className="font-medium">{request.callerName || 'Unbekannte/r Anrufer/in'}</p>
            {request.callerPhone && <p className="text-muted-foreground">{request.callerPhone}</p>}
            {request.callerEmail && <p className="text-muted-foreground">{request.callerEmail}</p>}
            {request.callerAddress && <p className="text-muted-foreground">{request.callerAddress}</p>}
            <p className="text-xs text-muted-foreground">Noch keinem Kunden zugeordnet.</p>
          </div>
          {isEditable && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={onMatch} disabled={isPending}>
                Vorhandenem Kunden zuordnen
              </Button>
              <Button size="sm" variant="outline" onClick={onPromote} disabled={isPending}>
                {isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                Als neuen Kunden anlegen
              </Button>
            </div>
          )}
          <ErrorText>{promoteError}</ErrorText>
        </div>
      )}
    </div>
  );
}
