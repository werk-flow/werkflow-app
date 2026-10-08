'use client';

import { ClientSelectWithCreate } from '@/components/auftraege/shared/client-select-with-create';
import { SiteContactFields } from '@/components/auftraege/shared/site-contact-fields';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import type { Client } from '@/lib/jobs/types';

interface RequestMatchFieldsProps {
  clients: Client[];
  matchClientId: string;
  matchSiteId: string;
  matchContactId: string;
  matchError: string | null;
  matchClientError: string | null;
  isPending: boolean;
  onClientChange: (clientId: string) => void;
  onSiteChange: (siteId: string) => void;
  onContactChange: (contactId: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Body and footer of the dialog that matches an existing customer to a request. */
export function RequestMatchFields({
  clients,
  matchClientId,
  matchSiteId,
  matchContactId,
  matchError,
  matchClientError,
  isPending,
  onClientChange,
  onSiteChange,
  onContactChange,
  onCancel,
  onConfirm,
}: RequestMatchFieldsProps) {
  return (
    <>
      <div className="grid gap-4 py-2">
        <Field label="Kunde" htmlFor="match-client" required error={matchClientError}>
          <ClientSelectWithCreate
            clients={clients}
            value={matchClientId}
            onValueChange={onClientChange}
            disabled={isPending}
          />
        </Field>
        {matchClientId && (
          <SiteContactFields
            clientId={matchClientId}
            siteId={matchSiteId}
            contactId={matchContactId}
            onSiteChange={(nextSiteId) => onSiteChange(nextSiteId)}
            onContactChange={onContactChange}
            disabled={isPending}
            idPrefix="match"
          />
        )}
        <ErrorText>{matchError}</ErrorText>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Abbrechen
        </Button>
        <Button pending={isPending} type="button" onClick={onConfirm} disabled={isPending}>
          Zuordnen
        </Button>
      </DialogFooter>
    </>
  );
}
