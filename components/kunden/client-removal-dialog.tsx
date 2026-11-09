'use client';

import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { usePendingTask } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { archiveClient, deleteClient } from '@/lib/clients/actions';
import type { ClientLinkKind, ClientLinks } from '@/lib/clients/types';

/** How a customer leaves the list: archived with its history, or deleted as a mistaken entry. */
export type ClientRemoval = 'archive' | 'delete';

const CLIENT_REMOVAL_ERROR_MESSAGES = {
  not_authorized: 'Du darfst Kunden nicht archivieren oder löschen.',
  client_not_found: 'Der Kunde wurde nicht gefunden.',
  client_already_archived: 'Der Kunde ist bereits archiviert.',
} satisfies Record<string, string>;

/** A restore's refusals; it is neither an archive nor a delete. */
export const CLIENT_RESTORE_ERROR_MESSAGES = {
  ...CLIENT_REMOVAL_ERROR_MESSAGES,
  not_authorized: 'Du darfst Kunden nicht wiederherstellen.',
  client_not_archived: 'Der Kunde ist nicht archiviert.',
} satisfies Record<string, string>;

const REMOVAL_FAILED_MESSAGE: Record<ClientRemoval, string> = {
  archive: 'Der Kunde konnte nicht archiviert werden. Bitte versuche es erneut.',
  delete: 'Der Kunde konnte nicht gelöscht werden. Bitte versuche es erneut.',
};

/** What can link to a customer, in the order the refusal names it. */
const LINK_LABELS: readonly (readonly [kind: ClientLinkKind, one: string, many: string])[] = [
  ['jobs', 'Auftrag', 'Aufträge'],
  ['projects', 'Projekt', 'Projekte'],
  ['requests', 'Anfrage', 'Anfragen'],
  ['service_cases', 'Servicefall', 'Servicefälle'],
  ['equipment', 'Anlage', 'Anlagen'],
  ['maintenance', 'Wartungseintrag', 'Wartungseinträge'],
  ['documents', 'Dokument', 'Dokumente'],
  ['follow_ups', 'Nachfassaktion', 'Nachfassaktionen'],
];

/** „2 Aufträge, 1 Anfrage“: what links to the customer. */
function describeLinks(links: ClientLinks): string {
  return LINK_LABELS.flatMap(([kind, one, many]) => {
    const count = links[kind];
    return count ? [`${count} ${count === 1 ? one : many}`] : [];
  }).join(', ');
}

const ARCHIVE_EFFECT =
  'Er verschwindet aus der Kundenliste und aus der Kundenauswahl für neue Arbeit. Aufträge, Projekte, Anfragen und der Verlauf bleiben erhalten. Unter „Archivierte“ findest du ihn wieder und kannst ihn wiederherstellen.';

/** What the removal does, or why the customer stays and what archiving does instead. */
function RemovalDescription({
  clientName,
  removal,
  refusedLinks,
  isArchived,
}: {
  clientName: string;
  removal: ClientRemoval;
  refusedLinks: ClientLinks | null;
  isArchived: boolean;
}) {
  const name = <span className="font-medium">{clientName}</span>;
  return (
    <AlertDialogDescription>
      {refusedLinks && isArchived ? (
        <>
          {name} bleibt erhalten, denn damit verknüpft sind: {describeLinks(refusedLinks)}. Der Kunde ist
          bereits archiviert.
        </>
      ) : refusedLinks ? (
        <>
          {name} bleibt erhalten, denn damit verknüpft sind: {describeLinks(refusedLinks)}. Archiviere den
          Kunden stattdessen. {ARCHIVE_EFFECT}
        </>
      ) : removal === 'delete' ? (
        <>
          {name} wird endgültig gelöscht. Das geht nur bei einem versehentlich angelegten Kunden ohne
          Aufträge, Projekte, Anfragen, Servicefälle, Anlagen, Dokumente und Nachfassaktionen. Einen Kunden
          mit Verlauf archivierst du.
        </>
      ) : (
        <>
          {name} wird archiviert. {ARCHIVE_EFFECT}
        </>
      )}
    </AlertDialogDescription>
  );
}

/** The confirming action, or only „Schließen“ once nothing is left to do. */
function RemovalFooter({
  removal,
  isFinal,
  isPending,
  error,
  onConfirm,
}: {
  removal: ClientRemoval;
  isFinal: boolean;
  isPending: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  if (isFinal)
    return (
      <AlertDialogFooter error={error}>
        <AlertDialogCancel>Schließen</AlertDialogCancel>
      </AlertDialogFooter>
    );
  const label =
    removal === 'delete'
      ? isPending
        ? 'Wird gelöscht…'
        : 'Löschen'
      : isPending
        ? 'Wird archiviert…'
        : 'Archivieren';
  return (
    <AlertDialogFooter error={error}>
      <AlertDialogCancel>Abbrechen</AlertDialogCancel>
      <AlertDialogAction
        onClick={(event) => {
          event.preventDefault();
          onConfirm();
        }}
        pending={isPending}
        variant={removal === 'delete' ? 'destructive' : 'default'}
      >
        {label}
      </AlertDialogAction>
    </AlertDialogFooter>
  );
}

interface ClientRemovalDialogProps {
  client: { id: string; name: string };
  /** An archived customer kept by a refused deletion is offered no second archiving. */
  isArchived: boolean;
  /** The removal the menu asked for; null while the dialog is closed. */
  removal: ClientRemoval | null;
  onClose: () => void;
  /**
   * The customer was archived or deleted. The caller removes it from view and
   * confirms; the dialog stays pending until the returned promise settles.
   */
  onRemoved: (removal: ClientRemoval) => Promise<void>;
}

/**
 * Archive or delete one customer. Deleting is for a mistaken entry: when the
 * server keeps the customer because something links to it, the dialog names
 * those links and offers archiving instead.
 */
export function ClientRemovalDialog({
  client,
  isArchived,
  removal,
  onClose,
  onRemoved,
}: ClientRemovalDialogProps) {
  const { run, isPending } = usePendingTask();
  const [refusedLinks, setRefusedLinks] = useState<ClientLinks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown: ClientRemoval = refusedLinks ? 'archive' : (removal ?? 'archive');
  const isFinal = refusedLinks !== null && isArchived;
  const title = isFinal
    ? 'Kunde bleibt erhalten'
    : refusedLinks
      ? 'Archivieren statt löschen?'
      : shown === 'delete'
        ? 'Kunde löschen?'
        : 'Kunde archivieren?';

  const close = () => {
    setRefusedLinks(null);
    setError(null);
    onClose();
  };

  const confirm = () =>
    run(async () => {
      setError(null);
      try {
        const deletion = shown === 'delete' ? await deleteClient(client.id) : null;
        if (deletion && !deletion.success && deletion.links) {
          setRefusedLinks(deletion.links);
          return;
        }
        const result = deletion ?? (await archiveClient(client.id));
        if (!result.success) {
          setError(
            describeFailure(result.error, CLIENT_REMOVAL_ERROR_MESSAGES, REMOVAL_FAILED_MESSAGE[shown]),
          );
          return;
        }
        await onRemoved(shown);
        setRefusedLinks(null);
      } catch {
        setError(REMOVAL_FAILED_MESSAGE[shown]);
      }
    });

  return (
    <AlertDialog
      open={removal !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      pending={isPending}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <RemovalDescription
            clientName={client.name}
            removal={shown}
            refusedLinks={refusedLinks}
            isArchived={isArchived}
          />
        </AlertDialogHeader>
        <RemovalFooter
          removal={shown}
          isFinal={isFinal}
          isPending={isPending}
          error={error}
          onConfirm={() => void confirm()}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}
