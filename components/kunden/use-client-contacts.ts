'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useBanner } from '@/components/ui/banner';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { createClientContact, updateClientContact } from '@/lib/clients/actions';
import { buildContactEcho, withPendingPrimary } from '@/lib/clients/relation-echo';
import type { ClientContact } from '@/lib/clients/types';

import {
  EMPTY_CONTACT,
  errorMessage,
  getRelationId,
  type ContactDialogState,
} from './client-relation-drafts';
import type { RelationRowTasks } from './use-relation-row-tasks';

interface ClientContactsState {
  activeContacts: ClientContact[];
  inactiveContacts: ClientContact[];
  isOptimistic: (id: string) => boolean;
  contactDialog: ContactDialogState | null;
  setContactDialog: (next: ContactDialogState | null) => void;
  openNewContact: () => void;
  openContactEditor: (contact: ClientContact) => void;
  saveContact: () => void;
  toggleContactActive: (contact: ClientContact) => void;
}

/** The optimistic contact list of one customer with its dialog and row actions. */
export function useClientContacts({
  clientId,
  contacts,
  rowTasks,
  setSectionError,
}: {
  clientId: string;
  contacts: ClientContact[];
  rowTasks: RelationRowTasks;
  setSectionError: (error: string | null) => void;
}): ClientContactsState {
  const router = useRouter();
  const { runRowTask, settleRow } = rowTasks;
  const contactList = useOptimisticList({ items: contacts, getId: getRelationId });
  const waitForContacts = useSettleOnChange(contacts);
  const { showBanner } = useBanner();
  const [contactDialog, setContactDialog] = useState<ContactDialogState | null>(null);

  const shownContacts = withPendingPrimary(contactList.items);
  const activeContacts = shownContacts.filter((contact) => contact.isActive);
  const inactiveContacts = shownContacts.filter((contact) => !contact.isActive);

  function openNewContact(): void {
    setContactDialog({
      contactId: null,
      draft: {
        ...EMPTY_CONTACT,
        isPrimary: activeContacts.length === 0,
      },
      error: null,
    });
  }

  function openContactEditor(contact: ClientContact): void {
    setContactDialog({
      contactId: contact.id,
      draft: {
        name: contact.name,
        role: contact.role ?? '',
        email: contact.email ?? '',
        phone: contact.phone ?? '',
        notes: contact.notes ?? '',
        isPrimary: contact.isPrimary,
      },
      error: null,
    });
  }

  function saveContact(): void {
    if (!contactDialog) return;
    if (!contactDialog.draft.name.trim()) {
      setContactDialog({ ...contactDialog, nameError: 'Bitte gib einen Namen ein.' });
      document.getElementById('contact-name')?.focus();
      return;
    }
    const { contactId, draft } = contactDialog;
    const stored = contacts.find((contact) => contact.id === contactId);
    const echoId = stored?.id ?? `pending-${crypto.randomUUID()}`;
    const echo = buildContactEcho(stored ?? { id: echoId, clientId }, draft);
    if (stored) contactList.update(echoId, echo);
    else contactList.insert(echoId, echo);
    setContactDialog(null);
    void (async () => {
      const result = await (
        stored ? updateClientContact(stored.id, draft) : createClientContact(clientId, draft)
      ).catch(() => ({ success: false as const, error: 'unexpected_error' }));

      if (!result.success) {
        // The dialog returns with the entered values and the reason.
        contactList.rollback(echoId);
        setContactDialog({ contactId, draft, error: errorMessage(result.error) });
        return;
      }
      showBanner({
        variant: 'success',
        message: 'Ansprechpartner gespeichert.',
      });
      if (stored) return settleRow(contactList, echoId, waitForContacts);
      contactList.commit(echoId, result.contact);
      router.refresh();
    })();
  }

  function toggleContactActive(contact: ClientContact): void {
    setSectionError(null);
    contactList.update(contact.id, { ...contact, isActive: !contact.isActive });
    void runRowTask(contact.id, async () => {
      const result = await updateClientContact(contact.id, {
        isActive: !contact.isActive,
      }).catch(() => ({ success: false as const, error: 'unexpected_error' }));
      if (!result.success) {
        contactList.rollback(contact.id);
        setSectionError(errorMessage(result.error));
        return;
      }
      await settleRow(contactList, contact.id, waitForContacts);
    });
  }

  return {
    activeContacts,
    inactiveContacts,
    isOptimistic: contactList.isOptimistic,
    contactDialog,
    setContactDialog,
    openNewContact,
    openContactEditor,
    saveContact,
    toggleContactActive,
  };
}
