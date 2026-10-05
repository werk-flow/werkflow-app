'use client';

import { ArrowRightLeft, Pencil, RotateCcw, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import type { ClientRequest } from '@/lib/requests/types';
import { ConvertRequestToServiceDialog } from './convert-request-to-service-dialog';

interface RequestHeaderActionsProps {
  request: ClientRequest;
  /** The status the header shows while a toggle is still unconfirmed. */
  shownStatus: ClientRequest['status'];
  isEditable: boolean;
  isPending: boolean;
  isSettling: boolean;
  onConvert: () => void;
  onEdit: () => void;
  onStatusToggle: () => void;
  onClose: () => void;
  onReopen: () => void;
}

export function RequestHeaderActions({
  request,
  shownStatus,
  isEditable,
  isPending,
  isSettling,
  onConvert,
  onEdit,
  onStatusToggle,
  onClose,
  onReopen,
}: RequestHeaderActionsProps) {
  return (
    <>
      <InlinePending active={isPending || isSettling} label="Anfrage wird gespeichert" />
      {isEditable && (
        <>
          <Button size="sm" onClick={onConvert} disabled={isPending}>
            <ArrowRightLeft className="size-4" />
            Umwandeln
          </Button>
          <ConvertRequestToServiceDialog
            requestId={request.id}
            enabled={Boolean(request.clientId && request.siteId)}
          />
          <Button size="sm" variant="outline" onClick={onEdit} disabled={isPending}>
            <Pencil className="size-4" />
            Bearbeiten
          </Button>
          <Button size="sm" variant="outline" onClick={onStatusToggle} disabled={isPending}>
            {shownStatus === 'offen' ? 'In Klärung setzen' : 'Zurück auf Offen'}
          </Button>
          <Button size="sm" variant="outline" onClick={onClose} disabled={isPending}>
            <XCircle className="size-4" />
            Schließen
          </Button>
        </>
      )}
      {request.status === 'geschlossen' && (
        <Button size="sm" variant="outline" onClick={onReopen} disabled={isPending}>
          <RotateCcw className="size-4" />
          Wieder öffnen
        </Button>
      )}
    </>
  );
}
