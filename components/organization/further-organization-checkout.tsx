'use client';

import { useState } from 'react';
import { unstable_rethrow } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { untilPageLeaves, useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { startFurtherOrganizationCheckout } from '@/lib/subscription/actions';

// A further organization has its own subscription (werk-flow/werkflow-planning#495):
// the Admin pays in Stripe Checkout and names the organization after paying,
// on /onboarding/create-organization. The create dialog starts it, and
// /upgrade/abgebrochen starts it again after a cancelled Checkout
// (werk-flow/werkflow-planning#500).

const FAILED = 'Die Zahlung konnte nicht gestartet werden. Bitte versuche es erneut.';
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  not_authorized: 'Nur Admins können eine weitere Organisation erstellen.',
  not_a_member: 'Du bist kein Admin dieser Organisation mehr. Lade die Seite neu.',
  too_many_attempts: 'Zu viele Versuche. Bitte warte etwas und versuche es dann erneut.',
  checkout_unavailable: 'Die Zahlung ist gerade nicht verfügbar. Bitte versuche es später erneut.',
  checkout_in_progress: 'Die Zahlung wird gerade schon geöffnet. Versuche es gleich noch einmal.',
};

/**
 * Opens the further organization's Checkout, paid from an organization the
 * caller administers; the server checks the role again.
 */
export function useFurtherOrganizationCheckout(adminOrganizationId: string) {
  const { run, isPending } = useServerAction(async () => {
    const result = await startFurtherOrganizationCheckout(adminOrganizationId);
    if (!result.success) return result;
    // Checkout is Stripe's page; the button stays pending until the browser leaves.
    window.location.assign(result.checkoutUrl);
    return untilPageLeaves();
  });
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
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

  return { start, isPending, error, clearError: () => setError(null) };
}

/** „Weiter zur Zahlung“ for a further organization, with its failure below. */
export function FurtherOrganizationCheckoutButton({ adminOrganizationId }: { adminOrganizationId: string }) {
  const { start, isPending, error } = useFurtherOrganizationCheckout(adminOrganizationId);
  return (
    <div className="space-y-2">
      <Button onClick={() => void start()} pending={isPending} className="w-full" size="lg">
        {isPending ? 'Wird geöffnet…' : 'Weiter zur Zahlung'}
      </Button>
      <ErrorText className="text-center">{error}</ErrorText>
    </div>
  );
}
