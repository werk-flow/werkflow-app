'use client';

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

interface JoinOrgDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function JoinOrgDialog({ open, onOpenChange }: JoinOrgDialogProps) {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const result = await joinOrganization(code);

    if (result.success && result.organizationId) {
      // Use hard navigation to ensure cookies are properly read on the new page
      // This is critical for production environments where cookie timing can be an issue
      window.location.href = `/dashboard?joined=${result.organizationId}`;
    } else {
      setError(
        ERROR_MESSAGES[result.error ?? 'unexpected_error'] ??
          ERROR_MESSAGES.unexpected_error
      );
      setIsLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset form when closing
      setCode('');
      setError(null);
      setIsLoading(false);
    }
    onOpenChange(newOpen);
  };

  const isValid = code.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Organisation beitreten</DialogTitle>
          <DialogDescription>
            Gib den Organisationscode ein, den du von deinem Admin erhalten hast.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dialog-org-code">Organisationscode</Label>
            <Input
              id="dialog-org-code"
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
                  Wird beigetreten...
                </>
              ) : (
                'Beitreten'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

