'use client';

import { useLayoutEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useBanner } from '@/components/ui/banner';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { createClientSite } from '@/lib/clients/actions';
import type { ClientSite } from '@/lib/clients/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const CREATE_SITE_ERROR_MESSAGES = {
  name_required: 'Bitte gib eine Bezeichnung ein.',
  client_not_found: 'Der Kunde wurde nicht gefunden.',
} satisfies Record<string, string>;

type SiteDraft = { name: string; street: string; postalCode: string; city: string };

// The first site of a customer is its main location.
const FIRST_SITE: SiteDraft = { name: 'Hauptstandort', street: '', postalCode: '', city: '' };

/** The draft, its validation and the create call; `onCreated` receives the saved site. */
function useCreateSiteForm(
  clientId: string,
  onOpenChange: (open: boolean) => void,
  onCreated: (site: ClientSite) => void,
) {
  const { showBanner } = useBanner();
  const [draft, setDraft] = useState<SiteDraft>(FIRST_SITE);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  // The save completes after later renders; the latest handler of the parent form receives the site.
  const onCreatedRef = useRef(onCreated);
  useLayoutEffect(() => {
    onCreatedRef.current = onCreated;
  });
  const { run: runCreateSite, isPending } = useServerAction(createClientSite);

  function handleSave(): void {
    const nameMessage = draft.name.trim() ? undefined : CREATE_SITE_ERROR_MESSAGES.name_required;
    setNameError(nameMessage ?? null);
    if (focusFirstInvalidField({ 'create-site-name': nameMessage })) return;
    setError(null);
    void (async () => {
      const result = await runCreateSite(clientId, { ...draft, isPrimary: true }).catch(() => null);
      if (!result?.success) {
        setError(
          describeFailure(
            result?.error ?? 'create_failed',
            CREATE_SITE_ERROR_MESSAGES,
            'Der Einsatzort konnte nicht angelegt werden. Bitte versuche es erneut.',
          ),
        );
        return;
      }
      onCreatedRef.current(result.site);
      setDraft(FIRST_SITE);
      onOpenChange(false);
      showBanner({ variant: 'success', message: 'Einsatzort angelegt.' });
    })();
  }

  return { draft, setDraft, error, nameError, setNameError, isPending, handleSave };
}

/** Street, postal code and city of the new site. */
function SiteAddressFields({ draft, setDraft }: { draft: SiteDraft; setDraft: (draft: SiteDraft) => void }) {
  return (
    <>
      <Field label="Straße und Hausnummer" htmlFor="create-site-street">
        <Input
          value={draft.street}
          onChange={(event) => setDraft({ ...draft, street: event.target.value })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
        <Field label="PLZ" htmlFor="create-site-postal-code">
          <Input
            inputMode="numeric"
            value={draft.postalCode}
            onChange={(event) => setDraft({ ...draft, postalCode: event.target.value })}
          />
        </Field>
        <Field label="Ort" htmlFor="create-site-city">
          <Input value={draft.city} onChange={(event) => setDraft({ ...draft, city: event.target.value })} />
        </Field>
      </div>
    </>
  );
}

/**
 * Creates the first work site of a customer from inside a work form and hands
 * it back to be selected. Its form stops the submit, so the work form behind
 * it is not submitted too.
 */
export function CreateSiteDialog({
  clientId,
  open,
  onOpenChange,
  onCreated,
}: {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (site: ClientSite) => void;
}) {
  const { draft, setDraft, error, nameError, setNameError, isPending, handleSave } = useCreateSiteForm(
    clientId,
    onOpenChange,
    onCreated,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Einsatzort anlegen</DialogTitle>
          <DialogDescription>
            Der Einsatzort wird beim Kunden gespeichert und gleich hier ausgewählt.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!isPending) handleSave();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody className="grid gap-4 py-1">
            <Field label="Bezeichnung" htmlFor="create-site-name" required error={nameError}>
              <Input
                value={draft.name}
                onChange={(event) => {
                  setDraft({ ...draft, name: event.target.value });
                  setNameError(null);
                }}
                placeholder="z. B. Hauptgebäude, Wohnung 3. OG"
              />
            </Field>
            <SiteAddressFields draft={draft} setDraft={setDraft} />
            <ErrorText>{error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Abbrechen
            </Button>
            <Button pending={isPending} type="submit" disabled={isPending}>
              Einsatzort anlegen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
