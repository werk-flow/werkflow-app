'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { simulatePayment } from '@/lib/subscription/actions';

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
          result.error === 'not_authenticated'
            ? 'Du musst angemeldet sein.'
            : 'Ein Fehler ist aufgetreten. Bitte versuche es erneut.'
        );
      }
    } catch {
      // Redirect will throw, so this is expected behavior
      // Only set error if it's actually an error
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        onClick={handleClick}
        disabled={isLoading}
        className="w-full"
        size="lg"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Wird verarbeitet...
          </>
        ) : (
          'Zahlung simulieren / Fortfahren'
        )}
      </Button>
      {error && (
        <p className="text-sm text-destructive text-center">{error}</p>
      )}
    </div>
  );
}



