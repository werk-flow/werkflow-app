'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { untilPageLeaves, usePendingTask } from '@/hooks/use-server-action';
import { RECOVERY_LINK_REDEMPTION } from '@/lib/auth/recovery-link';
import { logError } from '@/lib/logging';

const UNAVAILABLE_MESSAGE =
  'Die Anmeldung antwortet gerade nicht. Dein Link ist wahrscheinlich noch gültig. Versuche es in einem Moment erneut.';

type Redemption = 'redeemed' | 'refused' | 'unavailable';

async function redeemRecoveryLink(): Promise<Redemption> {
  try {
    const response = await fetch('/auth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redeem: RECOVERY_LINK_REDEMPTION }),
    });
    if (response.ok) return 'redeemed';
    return response.status === 400 ? 'refused' : 'unavailable';
  } catch (error) {
    logError('reset-password: recovery link redemption failed', error);
    return 'unavailable';
  }
}

/**
 * The one click that redeems the reset link. The callback kept the link in an
 * httpOnly cookie; this same-origin POST signs in its account, and the reset
 * page then names that account.
 */
export function ConfirmRecoveryLink() {
  const router = useRouter();
  const { run, isPending } = usePendingTask();
  const [failure, setFailure] = useState<string | null>(null);

  const confirm = async () => {
    setFailure(null);
    await run(async () => {
      const redemption = await redeemRecoveryLink();
      if (redemption === 'unavailable') {
        setFailure(UNAVAILABLE_MESSAGE);
        return;
      }
      router.replace(redemption === 'redeemed' ? '/reset-password' : '/reset-password?error=invalid_token');
      // The button stays pending until the reset form replaces this step.
      await untilPageLeaves();
    });
  };

  return (
    <div className="grid gap-4">
      <ErrorText>{failure}</ErrorText>
      <Button className="w-full" onClick={confirm} disabled={isPending}>
        {isPending ? 'Wird geprüft…' : 'Weiter zum neuen Passwort'}
      </Button>
    </div>
  );
}
