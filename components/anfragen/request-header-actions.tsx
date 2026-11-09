'use client';

import { ArrowRightLeft, CircleHelp, Link2, MoreVertical, Pencil, RotateCcw, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  onAttach: () => void;
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
  onAttach,
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
          {/* Only a request with a customer has that customer's work to join. */}
          {request.clientId && (
            <Button size="sm" variant="outline" onClick={onAttach} disabled={isPending}>
              <Link2 className="size-4" />
              Zu Arbeit hinzufügen
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onEdit} disabled={isPending}>
            <Pencil className="size-4" />
            {/* Phones show the pencil alone so it shares a row with the menu; the name stays for screen readers. */}
            <span className="sr-only sm:not-sr-only">Bearbeiten</span>
          </Button>
          <RequestStatusMenu
            shownStatus={shownStatus}
            isPending={isPending}
            onStatusToggle={onStatusToggle}
            onClose={onClose}
          />
        </>
      )}
      {/* A closed request has this one action, so it stays a button. */}
      {request.status === 'geschlossen' && (
        <Button size="sm" variant="outline" onClick={onReopen} disabled={isPending}>
          <RotateCcw className="size-4" />
          Wieder öffnen
        </Button>
      )}
    </>
  );
}

/** The rarer status steps of an open request, so the header keeps room for its title. */
function RequestStatusMenu({
  shownStatus,
  isPending,
  onStatusToggle,
  onClose,
}: Pick<RequestHeaderActionsProps, 'shownStatus' | 'isPending' | 'onStatusToggle' | 'onClose'>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="size-8" aria-label="Weitere Aktionen">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onStatusToggle} disabled={isPending}>
          {shownStatus === 'offen' ? <CircleHelp className="size-4" /> : <RotateCcw className="size-4" />}
          {shownStatus === 'offen' ? 'In Klärung setzen' : 'Zurück auf Offen'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onClose} disabled={isPending}>
          <XCircle className="size-4" />
          Schließen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
