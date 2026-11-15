'use client';
import { ErrorText } from '@/components/ui/error-text';

import { useState } from 'react';
import { unstable_rethrow } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { untilPageLeaves, useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { startOrganizationCheckout, startSubscriptionCheckout } from '@/lib/subscription/actions';

const CHECKOUT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  too_many_attempts: 'Zu viele Versuche. Bitte warte etwas und versuche es dann erneut.',
  checkout_unavailable: 'Die Zahlung ist gerade nicht verfügbar. Bitte versuche es später erneut.',
  checkout_in_progress: 'Die Zahlung wird gerade schon geöffnet. Versuche es gleich noch einmal.',
  already_subscribed: 'Diese Organisation hat bereits ein Abo.',
  organization_exists: 'Du gehörst schon zu einer Organisation.',
};

/** Opens Stripe Checkout: for an existing organization when its id is given, else for a new one. */
export function SubscribeButton({ organizationId }: { organizationId?: string }) {
  const { run, isPending } = useServerAction(async () => {
    const result = organizationId
      ? await startSubscriptionCheckout(organizationId)
      : await startOrganizationCheckout();
    if (!result.success) return result;
    // Checkout is Stripe's page; the button stays pending until the browser leaves.
    window.location.assign(result.checkoutUrl);
    return untilPageLeaves();
  });
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setError(null);
    try {
      const result = await run();
      setError(
        describeFailure(
          result.error,
          CHECKOUT_ERROR_MESSAGES,
          'Die Zahlung konnte nicht gestartet werden. Bitte versuche es erneut.',
        ),
      );
    } catch (error) {
      unstable_rethrow(error);
      setError('Die Zahlung konnte nicht gestartet werden. Bitte versuche es erneut.');
    }
  };

  return (
    <div className="space-y-2">
      <Button onClick={handleClick} pending={isPending} className="w-full" size="lg">
        {isPending ? 'Wird geöffnet…' : 'Weiter zur Zahlung'}
      </Button>
      <ErrorText className="text-center">{error}</ErrorText>
    </div>
  );
}
