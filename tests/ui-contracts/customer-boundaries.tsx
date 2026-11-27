import { useState } from 'react';
import { KundenContent } from '@/components/kunden/kunden-content';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { BannerProvider } from '@/components/ui/banner';
import { ClientActionsMenu, type ClientRowActions } from '@/components/kunden/client-actions-menu';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { clientCreations, CreateClientDialog } from '@/components/kunden/create-client-dialog';
import type { Client } from '@/lib/jobs/types';

const organizationId = '10000000-0000-4000-8000-000000000001';
export function customerContractRow(name: string): Client {
  return {
    id: '10000000-0000-4000-8000-000000000003',
    organizationId,
    name,
    clientType: 'privat',
    customerNumber: null,
    email: null,
    phone: null,
    address: null,
    notes: null,
    createdAt: '',
    updatedAt: '',
  };
}
export function CustomerContractFixture(): React.JSX.Element {
  const [clients, setClients] = useState([customerContractRow('Ausgangsstand')]);
  return (
    <BannerProvider>
      <RealtimeProvider>
        <button
          onClick={() =>
            clientCreations.publish({
              kind: 'insert',
              tempId: 'pending-one',
              draft: { ...customerContractRow('Außerhalb der Seite'), id: 'pending-one' },
            })
          }
        >
          Entwurf einfügen
        </button>
        <button
          onClick={() =>
            clientCreations.publish({
              kind: 'commit',
              tempId: 'pending-one',
              confirmed: {
                ...customerContractRow('Außerhalb der Seite'),
                id: '10000000-0000-4000-8000-000000000004',
              },
            })
          }
        >
          Speichern bestätigen
        </button>
        <button
          onClick={() =>
            clientCreations.publish({
              kind: 'insert',
              tempId: 'pending-two',
              draft: { ...customerContractRow('Noch nicht gespeichert'), id: 'pending-two' },
            })
          }
        >
          Weiteren Entwurf einfügen
        </button>
        <button onClick={() => clientCreations.publish({ kind: 'rollback', tempId: 'pending-two' })}>
          Fehlgeschlagenen Entwurf entfernen
        </button>
        <button
          onClick={() =>
            clientCreations.publish({
              kind: 'commit',
              tempId: 'old-scope',
              confirmed: {
                ...customerContractRow('Fremder Kunde'),
                organizationId: '10000000-0000-4000-8000-000000000002',
              },
            })
          }
        >
          Alte Organisationsantwort liefern
        </button>
        <button onClick={() => setClients([customerContractRow('Alter Serverstand')])}>
          Serverantwort liefern
        </button>
        <KundenContent
          scopeKey="contract"
          organizationId={organizationId}
          clients={clients}
          page={2}
          total={61}
          searchQuery="Kontakt"
          view="aktiv"
        />
      </RealtimeProvider>
    </BannerProvider>
  );
}

/** The create dialog on its own, its save held at the write gate. */
export function CreateClientContractFixture(): React.JSX.Element {
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <CreateClientDialog />
      </main>
    </BannerProvider>
  );
}

declare global {
  interface Window {
    /** Each move of focus out of a dialog, named by the control it went to. */
    uiContractDialogFocusLeaks: string[] | undefined;
    /** Settles once the open menu ran its focus return on closing; a spec sets it on the menu it opened. */
    uiContractMenuFocusReturn: Promise<void> | undefined;
  }
}

/**
 * Records each move of focus out of a dialog. A modal dialog's trap takes
 * focus back while it leaves, so the control outside never holds it: only the
 * focusout from the dialog shows the move.
 */
function recordDialogFocusLeaks(): void {
  if (window.uiContractDialogFocusLeaks) return;
  const leaks: string[] = [];
  window.uiContractDialogFocusLeaks = leaks;
  document.addEventListener('focusout', (event) => {
    const from = event.target instanceof Element ? event.target.closest('[role="dialog"]') : null;
    const to = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (from && to && !from.contains(to)) leaks.push(to.textContent ?? '');
  });
}

const ROW_ACTIONS: ClientRowActions = {
  isArchivedView: false,
  onSaved: () => undefined,
  onRequestRemoval: () => undefined,
  onRestore: async () => undefined,
};

/** A row menu inside an open dialog: closing the menu returns focus to its trigger in that dialog. */
function MenuInDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>Auswahl öffnen</Button>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Kunde auswählen</DialogTitle>
          <DialogDescription>Ein Kunde mit seinem Aktionsmenü.</DialogDescription>
        </DialogHeader>
        <ClientActionsMenu client={customerContractRow('Sanitär Kaya')} actions={ROW_ACTIONS} />
      </DialogContent>
    </Dialog>
  );
}

/** A customer row's actions menu and the edit dialog its „Bearbeiten“ opens. */
export function CustomerMenuEditContractFixture(): React.JSX.Element {
  recordDialogFocusLeaks();
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <section aria-label="Kundenzeile">
          <ClientActionsMenu client={customerContractRow('Heizungsbau Weber')} actions={ROW_ACTIONS} />
        </section>
        <MenuInDialog />
      </main>
    </BannerProvider>
  );
}
