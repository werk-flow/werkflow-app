'use client';

import { useState } from 'react';

import { ErrorText } from '@/components/ui/error-text';
import type { ClientContact, ClientSite } from '@/lib/clients/types';
import type { ClientSiteRole } from '@/lib/clients/site-roles';
import type { EquipmentListItem } from '@/lib/installed-equipment/types';

import { ClientContactDialog } from './client-contact-dialog';
import { ClientContactsCard, type ContactRequestHandler } from './client-contacts-card';
import { ClientSiteDialog } from './client-site-dialog';
import { ClientSiteRolesDialog } from './client-site-roles-dialog';
import { ClientSitesCard } from './client-sites-card';
import { useClientContacts } from './use-client-contacts';
import { useClientSites } from './use-client-sites';
import { useRelationRowTasks } from './use-relation-row-tasks';

interface ClientRelationsSectionProps {
  clientId: string;
  clientAddress: string | null;
  contacts: ClientContact[];
  sites: ClientSite[];
  /** Every role on the customer's own Einsatzorte; null when they could not be read. */
  siteRoles: ClientSiteRole[] | null;
  isAdminOrManager: boolean;
  equipment: EquipmentListItem[];
  equipmentLoadFailed: boolean;
  onRequestContact?: ContactRequestHandler;
  /** The contact guard is checking this contact's preferences on the server. */
  isCheckingContact?: (contactId: string) => boolean;
}

/** The contact, site and role dialogs of the section; each opens from its card. */
function ClientRelationDialogs({
  clientId,
  contacts,
  sites,
  siteRoles,
  rolesSiteId,
  onCloseRoles,
  contactState,
  siteState,
}: Pick<ClientRelationsSectionProps, 'clientId' | 'contacts' | 'sites' | 'siteRoles'> & {
  rolesSiteId: string | null;
  onCloseRoles: () => void;
  contactState: ReturnType<typeof useClientContacts>;
  siteState: ReturnType<typeof useClientSites>;
}) {
  return (
    <>
      <ClientContactDialog
        sites={siteState.activeSites}
        contactDialog={contactState.contactDialog}
        onContactDialogChange={contactState.setContactDialog}
        onSave={contactState.saveContact}
      />
      <ClientSiteDialog
        siteDialog={siteState.siteDialog}
        contacts={contacts}
        onSiteDialogChange={siteState.setSiteDialog}
        onSave={siteState.saveSite}
      />
      <ClientSiteRolesDialog
        site={sites.find((site) => site.id === rolesSiteId) ?? null}
        clientId={clientId}
        roles={siteRoles ?? []}
        onClose={onCloseRoles}
      />
    </>
  );
}

export function ClientRelationsSection({
  clientId,
  clientAddress,
  contacts,
  sites,
  siteRoles,
  isAdminOrManager,
  equipment,
  equipmentLoadFailed,
  onRequestContact,
  isCheckingContact,
}: ClientRelationsSectionProps) {
  const rowTasks = useRelationRowTasks();
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [rolesSiteId, setRolesSiteId] = useState<string | null>(null);
  const contactState = useClientContacts({
    clientId,
    contacts,
    rowTasks,
    setSectionError,
  });
  const siteState = useClientSites({
    clientId,
    clientAddress,
    sites,
    rowTasks,
    setSectionError,
  });
  const isPendingRow = (id: string) =>
    rowTasks.isBusy(id) || contactState.isOptimistic(id) || siteState.isOptimistic(id);

  return (
    <div className="space-y-4">
      {/* Ansprechpartner */}
      <ClientContactsCard
        activeContacts={contactState.activeContacts}
        inactiveContacts={contactState.inactiveContacts}
        isAdminOrManager={isAdminOrManager}
        isPendingRow={isPendingRow}
        onRequestContact={onRequestContact}
        isCheckingContact={isCheckingContact}
        onAddContact={contactState.openNewContact}
        onEditContact={contactState.openContactEditor}
        onToggleContactActive={contactState.toggleContactActive}
        sites={sites}
      />

      {/* Einsatzorte */}
      <ClientSitesCard
        clientId={clientId}
        clientAddress={clientAddress}
        contacts={[...contactState.activeContacts, ...contactState.inactiveContacts]}
        roles={siteRoles}
        onOpenRoles={(site) => setRolesSiteId(site.id)}
        activeSites={siteState.activeSites}
        inactiveSites={siteState.inactiveSites}
        equipment={equipment}
        equipmentLoadFailed={equipmentLoadFailed}
        isAdminOrManager={isAdminOrManager}
        isPendingRow={isPendingRow}
        onAddSite={siteState.openNewSite}
        onAdoptAddress={siteState.adoptAddressAsSite}
        onEditSite={siteState.openSiteEditor}
        onToggleSiteActive={siteState.toggleSiteActive}
      />

      <ErrorText>{sectionError}</ErrorText>

      <ClientRelationDialogs
        clientId={clientId}
        contacts={contacts}
        sites={sites}
        siteRoles={siteRoles}
        rolesSiteId={rolesSiteId}
        onCloseRoles={() => setRolesSiteId(null)}
        contactState={contactState}
        siteState={siteState}
      />
    </div>
  );
}
