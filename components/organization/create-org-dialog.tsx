'use client';
import { ErrorText } from '@/components/ui/error-text';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { createOrganization } from '@/lib/org/actions';

const ERROR_MESSAGES: Record<string, string> = {
  name_required: 'Bitte gib einen Namen ein.',
  name_too_short: 'Der Name muss mindestens 2 Zeichen lang sein.',
  name_too_long: 'Der Name darf maximal 100 Zeichen lang sein.',
  name_taken: 'Du hast bereits eine Organisation mit diesem Namen.',
  not_authenticated: 'Du musst angemeldet sein.',
  subscription_required:
    'Du benötigst ein aktives Abonnement, um eine Organisation zu erstellen.',
  organization_creation_failed: 'Organisation konnte nicht erstellt werden.',
  member_creation_failed: 'Mitgliedschaft konnte nicht erstellt werden.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.'
};

interface CreateOrgDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateOrgDialog({ open, onOpenChange }: CreateOrgDialogProps) {
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const result = await createOrganization(name);

      if (result.success && result.organizationId) {
        // Use hard navigation to ensure cookies are properly read on the new page
        // This is critical for production environments where cookie timing can be an issue
        window.location.href = `/dashboard?created=${result.organizationId}`;
      } else {
        // Check if it's a subscription error - show upgrade prompt
        if (result.error === 'subscription_required') {
          setError(ERROR_MESSAGES.subscription_required);
        } else {
          setError(
            ERROR_MESSAGES[result.error ?? 'unexpected_error'] ??
              ERROR_MESSAGES.unexpected_error
          );
        }
      }
    } catch (submitError) {
      console.error('Unexpected error creating an organization:', submitError);
      setError(ERROR_MESSAGES.unexpected_error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (isLoading && !newOpen) return;
    if (!newOpen) {
      // Reset form when closing
      setName('');
      setError(null);
      setIsLoading(false);
    }
    onOpenChange(newOpen);
  };

  const isValid = name.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neue Organisation erstellen</DialogTitle>
          <DialogDescription>
            Erstelle eine neue Organisation und werde automatisch Admin.
          </DialogDescription>
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

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isLoading}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={!isValid || isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Wird erstellt...
                </>
              ) : (
                'Erstellen'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}


