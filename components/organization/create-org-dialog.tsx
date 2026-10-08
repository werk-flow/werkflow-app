'use client';
import { ErrorText } from '@/components/ui/error-text';

import { useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure, SHARED_FAILURE_MESSAGES } from '@/lib/action-messages';
import { logError } from '@/lib/logging';
import { loadDocument } from '@/lib/navigation/document-load';
import { createOrganization } from '@/lib/org/actions';
import { Spinner } from '@/components/ui/spinner';

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  name_required: 'Bitte gib einen Namen ein.',
  name_too_short: 'Der Name muss mindestens 2 Zeichen lang sein.',
  name_too_long: 'Der Name darf maximal 100 Zeichen lang sein.',
  name_taken: 'Du hast bereits eine Organisation mit diesem Namen.',
  subscription_required: 'Du benötigst ein aktives Abonnement, um eine Organisation zu erstellen.',
  organization_creation_failed: 'Organisation konnte nicht erstellt werden.',
  member_creation_failed: 'Mitgliedschaft konnte nicht erstellt werden.',
};
const UNEXPECTED_MESSAGE = SHARED_FAILURE_MESSAGES.unexpected_error;

interface CreateOrgDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateOrgDialog({ open, onOpenChange }: CreateOrgDialogProps) {
  const [name, setName] = useState('');
  const { run: runCreate, isPending: isLoading } = useServerAction(createOrganization);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const result = await runCreate(name);

      if (result.success && result.organizationId) {
        // A full load: the new organization is the active one, and the shell starts from its cookie.
        loadDocument(`/dashboard?created=${result.organizationId}`);
      } else {
        setError(describeFailure(result.error ?? 'unexpected_error', ERROR_MESSAGES, UNEXPECTED_MESSAGE));
      }
    } catch (submitError) {
      logError('CreateOrgDialog: organization creation failed', submitError);
      setError(UNEXPECTED_MESSAGE);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (isLoading && !newOpen) return;
    if (!newOpen) {
      // Reset form when closing
      setName('');
      setError(null);
    }
    onOpenChange(newOpen);
  };

  const isValid = name.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neue Organisation erstellen</DialogTitle>
          <DialogDescription>Erstelle eine neue Organisation und werde automatisch Admin.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Name der Organisation" htmlFor="dialog-org-name" required>
            <Input
              id="dialog-org-name"
              type="text"
              placeholder="z.B. Meine Firma GmbH"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isLoading}
              autoFocus
              autoComplete="organization"
            />
          </Field>

          <ErrorText>{error}</ErrorText>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isLoading}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              // eslint-disable-next-line ui/submit-disabled-only-while-pending -- canon exception: a form with one required field enables on completeness
              disabled={!isValid || isLoading}
            >
              {isLoading ? (
                <>
                  <Spinner className="mr-2" />
                  Wird erstellt…
                </>
              ) : (
                'Erstellen'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
