'use client';

import { Archive, ArchiveRestore, Pencil, Phone, Plus, Star, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import type { ClientContact } from '@/lib/clients/types';
import { SectionTitle } from '@/components/shared/section-title';

// tel: links work most reliably with digits and a leading + only.
function normalizePhoneHref(phone: string): string {
  return phone.replace(/(?!^\+)[^\d]/g, '');
}

export type ContactRequestHandler = (input: {
  contactId: string;
  contactName: string;
  channel: 'phone' | 'email';
  href: string;
}) => void;

interface ClientContactRowProps {
  contact: ClientContact;
  isAdminOrManager: boolean;
  isPendingRow: (id: string) => boolean;
  onRequestContact: ContactRequestHandler | undefined;
  isCheckingContact: ((contactId: string) => boolean) | undefined;
  onEditContact: (contact: ClientContact) => void;
  onToggleContactActive: (contact: ClientContact) => void;
}

function ClientContactRow({
  contact,
  isAdminOrManager,
  isPendingRow,
  onRequestContact,
  isCheckingContact,
  onEditContact,
  onToggleContactActive,
}: ClientContactRowProps) {
  return (
    <li className="rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-medium">{contact.name}</p>
            <InlinePending active={isPendingRow(contact.id)} />
            <InlinePending
              active={isCheckingContact?.(contact.id) ?? false}
              label="Kontaktvorgaben werden geprüft"
            />
            {contact.isPrimary && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Star className="size-3" />
                Hauptkontakt
              </Badge>
            )}
            {contact.role && (
              <Badge variant="outline" className="text-xs">
                {contact.role}
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
            {contact.phone && (
              <a
                href={`tel:${normalizePhoneHref(contact.phone)}`}
                className="inline-flex items-center gap-1 hover:text-foreground"
                onClick={(event) => {
                  if (!onRequestContact) return;
                  event.preventDefault();
                  onRequestContact({
                    contactId: contact.id,
                    contactName: contact.name,
                    channel: 'phone',
                    href: `tel:${normalizePhoneHref(contact.phone ?? '')}`,
                  });
                }}
              >
                <Phone className="size-3.5" />
                {contact.phone}
              </a>
            )}
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                className="hover:text-foreground"
                onClick={(event) => {
                  if (!onRequestContact) return;
                  event.preventDefault();
                  onRequestContact({
                    contactId: contact.id,
                    contactName: contact.name,
                    channel: 'email',
                    href: `mailto:${contact.email ?? ''}`,
                  });
                }}
              >
                {contact.email}
              </a>
            )}
          </div>
          {contact.notes && <p className="mt-1 text-xs text-muted-foreground">{contact.notes}</p>}
        </div>
        {isAdminOrManager && (
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              title="Ansprechpartner bearbeiten"
              disabled={isPendingRow(contact.id)}
              onClick={() => onEditContact(contact)}
            >
              <Pencil className="size-3.5" />
              <span className="sr-only">Ansprechpartner bearbeiten</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              title="Ansprechpartner archivieren"
              disabled={isPendingRow(contact.id)}
              onClick={() => onToggleContactActive(contact)}
            >
              <Archive className="size-3.5" />
              <span className="sr-only">Ansprechpartner archivieren</span>
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

interface ClientContactsCardProps extends Omit<ClientContactRowProps, 'contact'> {
  activeContacts: ClientContact[];
  inactiveContacts: ClientContact[];
  onAddContact: () => void;
}

export function ClientContactsCard({
  activeContacts,
  inactiveContacts,
  isAdminOrManager,
  isPendingRow,
  onRequestContact,
  isCheckingContact,
  onAddContact,
  onEditContact,
  onToggleContactActive,
}: ClientContactsCardProps) {
  return (
    <div id="ansprechpartner" className="scroll-mt-4 rounded-lg border bg-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle icon={<Users className="size-4" />}>Ansprechpartner</SectionTitle>
        {isAdminOrManager && (
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={onAddContact}>
            <Plus className="size-3.5" />
            Ansprechpartner hinzufügen
          </Button>
        )}
      </div>

      {activeContacts.length === 0 ? (
        <p className="rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-sm text-muted-foreground">
          Noch keine Ansprechpartner hinterlegt.
        </p>
      ) : (
        <ul className="space-y-2">
          {activeContacts.map((contact) => (
            <ClientContactRow
              key={contact.id}
              contact={contact}
              isAdminOrManager={isAdminOrManager}
              isPendingRow={isPendingRow}
              onRequestContact={onRequestContact}
              isCheckingContact={isCheckingContact}
              onEditContact={onEditContact}
              onToggleContactActive={onToggleContactActive}
            />
          ))}
        </ul>
      )}

      {inactiveContacts.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            Archiviert
          </p>
          <ul className="space-y-1.5">
            {inactiveContacts.map((contact) => (
              <li
                key={contact.id}
                className="flex items-center justify-between gap-3 rounded-md px-3 py-1.5 text-sm text-muted-foreground"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">
                    {contact.name}
                    {contact.role ? ` · ${contact.role}` : ''}
                  </span>
                  <InlinePending active={isPendingRow(contact.id)} />
                </span>
                {isAdminOrManager && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground"
                    title="Ansprechpartner wiederherstellen"
                    disabled={isPendingRow(contact.id)}
                    onClick={() => onToggleContactActive(contact)}
                  >
                    <ArchiveRestore className="size-3.5" />
                    <span className="sr-only">Ansprechpartner wiederherstellen</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
