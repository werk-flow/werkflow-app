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
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

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
  const [nameError, setNameError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const missingName = name.trim().length >= 2 ? undefined : ERROR_MESSAGES.name_too_short;
    setNameError(missingName ?? null);
    if (focusFirstInvalidField({ 'dialog-org-name': missingName })) return;

    try {
      const result = await runCreate(name);

      if (result.success) {
        // A full load: the new organization is the active one, and the shell starts from its cookie.
        loadDocument(`/dashboard?created=${result.organizationId}`);
      } else {
        setError(describeFailure(result.error, ERROR_MESSAGES, UNEXPECTED_MESSAGE));
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
      setNameError(null);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neue Organisation erstellen</DialogTitle>
          <DialogDescription>Erstelle eine neue Organisation und werde automatisch Admin.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Before the name, so nobody fills in a form the server refuses. „Abonnement & Abrechnung“
              is still a placeholder, so the sentence links nowhere. */}
          <p className="text-sm text-muted-foreground">
            Für eine neue Organisation brauchst du ein aktives Abonnement.
          </p>
          <Field label="Name der Organisation" htmlFor="dialog-org-name" required error={nameError}>
            <Input
              id="dialog-org-name"
              type="text"
              placeholder="z.B. Meine Firma GmbH"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
              disabled={isLoading}
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
            <Button type="submit" pending={isLoading}>
              {isLoading ? 'Wird erstellt…' : 'Erstellen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
