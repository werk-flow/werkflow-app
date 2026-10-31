'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useBanner } from '@/components/ui/banner';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { createClientContact, updateClientContact } from '@/lib/clients/actions';
import { buildContactEcho, withPendingPrimary } from '@/lib/clients/relation-echo';
import type { ClientContact } from '@/lib/clients/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

import {
  EMPTY_CONTACT,
  clientRelationErrorMessage,
  getRelationId,
  type ContactDialogState,
} from './client-relation-drafts';
import { toggleRelationActive } from './toggle-relation-active';
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

/** A new contact's dialog; the first active contact starts as the primary one. */
function newContactDialogState(isPrimary: boolean): ContactDialogState {
  return {
    contactId: null,
    draft: {
      ...EMPTY_CONTACT,
      isPrimary,
    },
    error: null,
  };
}

/** The dialog of a stored contact, its draft filled from the contact. */
function contactEditorDialogState(contact: ClientContact): ContactDialogState {
  return {
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
  };
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
  const { settleRow } = rowTasks;
  const contactList = useOptimisticList({ items: contacts, getId: getRelationId });
  const waitForContacts = useSettleOnChange(contacts);
  const { showBanner } = useBanner();
  const [contactDialog, setContactDialog] = useState<ContactDialogState | null>(null);

  const shownContacts = withPendingPrimary(contactList.items);
  const activeContacts = shownContacts.filter((contact) => contact.isActive);
  const inactiveContacts = shownContacts.filter((contact) => !contact.isActive);

  function openNewContact(): void {
    setContactDialog(newContactDialogState(activeContacts.length === 0));
  }

  function openContactEditor(contact: ClientContact): void {
    setContactDialog(contactEditorDialogState(contact));
  }

  function saveContact(): void {
    if (!contactDialog) return;
    const nameError = contactDialog.draft.name.trim() ? undefined : 'Bitte gib einen Namen ein.';
    if (focusFirstInvalidField({ 'contact-name': nameError })) {
      setContactDialog({ ...contactDialog, nameError: nameError ?? null });
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
        setContactDialog({ contactId, draft, error: clientRelationErrorMessage(result.error) });
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
    toggleRelationActive(contact, {
      list: contactList,
      rowTasks,
      waitForRows: waitForContacts,
      setSectionError,
      saveIsActive: (contactId, isActive) => updateClientContact(contactId, { isActive }),
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
