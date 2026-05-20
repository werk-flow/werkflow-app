'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createOrganization } from '@/lib/org/actions';

const ERROR_MESSAGES: Record<string, string> = {
  name_required: 'Bitte gib einen Namen ein.',
  name_too_short: 'Der Name muss mindestens 2 Zeichen lang sein.',
  name_too_long: 'Der Name darf maximal 100 Zeichen lang sein.',
  name_taken: 'Du hast bereits eine Organisation mit diesem Namen.',
  not_authenticated: 'Du musst angemeldet sein.',
  subscription_required: 'Du benötigst ein aktives Abonnement.',
  organization_creation_failed: 'Organisation konnte nicht erstellt werden.',
  member_creation_failed: 'Mitgliedschaft konnte nicht erstellt werden.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.'
};

export function CreateOrganizationForm() {
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const result = await createOrganization(name);

    if (result.success && result.organizationId) {
      // Use hard navigation to ensure cookies are properly read on the new page
      // This is critical for production environments where cookie timing can be an issue
      window.location.href = `/dashboard?created=${result.organizationId}`;
    } else {
      setError(
        ERROR_MESSAGES[result.error ?? 'unexpected_error'] ??
          ERROR_MESSAGES.unexpected_error
      );
      setIsLoading(false);
    }
  };

  const isValid = name.trim().length >= 2;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="org-name">Name der Organisation</Label>
        <Input
          id="org-name"
          type="text"
          placeholder="z.B. Meine Firma GmbH"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isLoading}
          autoFocus
          autoComplete="organization"
        />
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={!isValid || isLoading}
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Wird erstellt...
          </>
        ) : (
          'Organisation erstellen'
        )}
      </Button>
    </form>
  );
}



