'use client';
import { ErrorText } from '@/components/ui/error-text';

import { useState } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { describeFailure } from '@/lib/action-messages';
import { simulatePayment } from '@/lib/subscription/actions';

const PAYMENT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  too_many_attempts: 'Zu viele Versuche. Bitte warte etwas und versuche es dann erneut.',
};

export function SimulatePaymentButton() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await simulatePayment();

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
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button onClick={handleClick} disabled={isLoading} className="w-full" size="lg">
        {isLoading ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
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
