'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { joinOrganization } from '@/lib/org/actions';

const ERROR_MESSAGES: Record<string, string> = {
  code_required: 'Bitte gib einen Organisationscode ein.',
  invalid_code: 'Ungültiger Organisationscode.',
  admin_mismatch:
    'Du kannst keiner Organisation beitreten, die nicht vom gleichen Admin stammt wie deine bestehenden Organisationen.',
  already_member: 'Du bist bereits Mitglied dieser Organisation.',
  not_authenticated: 'Du musst angemeldet sein.',
  join_failed: 'Beitritt fehlgeschlagen. Bitte versuche es erneut.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.'
};

export function JoinOrganizationForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const result = await joinOrganization(code);

    if (result.success && result.organizationId) {
      // Redirect to dashboard with joined flag for success banner
      router.replace(`/dashboard?joined=${result.organizationId}`);
      router.refresh();
    } else {
      setError(
        ERROR_MESSAGES[result.error ?? 'unexpected_error'] ??
          ERROR_MESSAGES.unexpected_error
      );
      setIsLoading(false);
    }
  };

  const isValid = code.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="org-code">Organisationscode</Label>
        <Input
          id="org-code"
          type="text"
          placeholder="z. B. ABC123"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          disabled={isLoading}
          autoFocus
          autoComplete="off"
          className="uppercase"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        type="submit"
        className="w-full"
        disabled={!isValid || isLoading}
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Wird beigetreten...
          </>
        ) : (
          'Beitreten'
        )}
      </Button>
    </form>
  );
}

