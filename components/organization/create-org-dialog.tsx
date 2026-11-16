'use client';
import { ErrorText } from '@/components/ui/error-text';

import { useState } from 'react';
import { unstable_rethrow } from 'next/navigation';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { untilPageLeaves, useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { startFurtherOrganizationCheckout } from '@/lib/subscription/actions';

// A further organization has its own subscription (werk-flow/werkflow-planning#495):
// the Admin pays in the same Stripe Checkout as on /upgrade, and names the
// organization after paying, on /onboarding/create-organization.

const FAILED = 'Die Zahlung konnte nicht gestartet werden. Bitte versuche es erneut.';
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  not_authorized: 'Nur Admins können eine weitere Organisation erstellen.',
  not_a_member: 'Du bist kein Admin dieser Organisation mehr. Lade die Seite neu.',
  too_many_attempts: 'Zu viele Versuche. Bitte warte etwas und versuche es dann erneut.',
  checkout_unavailable: 'Die Zahlung ist gerade nicht verfügbar. Bitte versuche es später erneut.',
  checkout_in_progress: 'Die Zahlung wird gerade schon geöffnet. Versuche es gleich noch einmal.',
};

interface CreateOrgDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** An organization the caller administers; the server checks the role again. */
  adminOrganizationId: string;
}

export function CreateOrgDialog({ open, onOpenChange, adminOrganizationId }: CreateOrgDialogProps) {
  const { run, isPending } = useServerAction(async () => {
    const result = await startFurtherOrganizationCheckout(adminOrganizationId);
    if (!result.success) return result;
    // Checkout is Stripe's page; the button stays pending until the browser leaves.
    window.location.assign(result.checkoutUrl);
    return untilPageLeaves();
  });
  const [error, setError] = useState<string | null>(null);

  const handleStart = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const result = await run();
      setError(describeFailure(result.error, ERROR_MESSAGES, FAILED));
    } catch (startError) {
      // A paid reservation redirects to naming the organization.
      unstable_rethrow(startError);
      setError(FAILED);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) setError(null);
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} pending={isPending}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neue Organisation erstellen</DialogTitle>
          <DialogDescription>Jede Organisation hat ihr eigenes monatliches Abo.</DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void handleStart(event)} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Du schließt das Abo über Stripe ab, per SEPA-Lastschrift oder Karte. Den Preis siehst du vor dem
            Abschluss. Danach gibst du der Organisation einen Namen und wirst ihr Admin.
          </p>

          <ErrorText>{error}</ErrorText>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Abbrechen
            </Button>
            <Button type="submit" pending={isPending}>
              {isPending ? 'Wird geöffnet…' : 'Weiter zur Zahlung'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
