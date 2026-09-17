import { useState } from 'react';
import { KundenContent } from '@/components/kunden/kunden-content';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { BannerProvider } from '@/components/ui/banner';
import { clientCreations } from '@/components/kunden/create-client-dialog';
import type { Client } from '@/lib/jobs/types';

const organizationId = '10000000-0000-4000-8000-000000000001';
export function customerContractRow(name: string): Client {
  return { id: '10000000-0000-4000-8000-000000000003', organizationId, name, clientType: 'privat', customerNumber: null, email: null, phone: null, address: null, notes: null, createdAt: '', updatedAt: '' };
}
export function CustomerContractFixture(): React.JSX.Element {
  const [clients, setClients] = useState([customerContractRow('Ausgangsstand')]);
  return <BannerProvider><RealtimeProvider>
    <button onClick={() => clientCreations.publish({ kind: 'insert', tempId: 'pending-one', draft: { ...customerContractRow('Außerhalb der Seite'), id: 'pending-one' } })}>Entwurf einfügen</button>
    <button onClick={() => clientCreations.publish({ kind: 'commit', tempId: 'pending-one', confirmed: { ...customerContractRow('Außerhalb der Seite'), id: '10000000-0000-4000-8000-000000000004' } })}>Speichern bestätigen</button>
    <button onClick={() => clientCreations.publish({ kind: 'insert', tempId: 'pending-two', draft: { ...customerContractRow('Noch nicht gespeichert'), id: 'pending-two' } })}>Weiteren Entwurf einfügen</button>
    <button onClick={() => clientCreations.publish({ kind: 'rollback', tempId: 'pending-two' })}>Fehlgeschlagenen Entwurf entfernen</button>
    <button onClick={() => clientCreations.publish({ kind: 'commit', tempId: 'old-scope', confirmed: { ...customerContractRow('Fremder Kunde'), organizationId: '10000000-0000-4000-8000-000000000002' } })}>Alte Organisationsantwort liefern</button>
    <button onClick={() => setClients([customerContractRow('Alter Serverstand')])}>Serverantwort liefern</button>
    <KundenContent scopeKey="contract" organizationId={organizationId} clients={clients} page={2} total={61} searchQuery="Kontakt" />
  </RealtimeProvider></BannerProvider>;
}
