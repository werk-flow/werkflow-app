'use client';
import { ErrorText } from '@/components/ui/error-text';

import { useState } from 'react';
import { unstable_rethrow } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { simulatePayment } from '@/lib/subscription/actions';
import { Spinner } from '@/components/ui/spinner';

const PAYMENT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  too_many_attempts: 'Zu viele Versuche. Bitte warte etwas und versuche es dann erneut.',
};

export function SimulatePaymentButton() {
  const { run: runPayment, isPending: isLoading } = useServerAction(simulatePayment);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setError(null);

    try {
      const result = await runPayment();

      // If we get here without redirect, there was an error
      if (!result.success) {
        setError(
          describeFailure(
            result.error ?? 'unexpected_error',
            PAYMENT_ERROR_MESSAGES,
            'Ein Fehler ist aufgetreten. Bitte versuche es erneut.',
          ),
        );
      }
    } catch (error) {
      unstable_rethrow(error);
      setError('Die Zahlung konnte nicht verarbeitet werden. Bitte versuche es erneut.');
    }
  };

  return (
    <div className="space-y-2">
      <Button onClick={handleClick} disabled={isLoading} className="w-full" size="lg">
        {isLoading ? (
          <>
            <Spinner className="mr-2" />
            Wird verarbeitet…
          </>
        ) : (
          'Zahlung simulieren / Fortfahren'
        )}
      </Button>
      <ErrorText className="text-center">{error}</ErrorText>
    </div>
  );
}
