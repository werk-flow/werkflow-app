'use client';

import { useMemo } from 'react';

import { redeemOtpInvite } from '@/components/otp-form-invite';
import { Button } from '@/components/ui/button';
import { untilPageLeaves, usePendingTask } from '@/hooks/use-server-action';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * A signed-in person accepts an invite with a click. The invite link itself
 * redeems nothing, because any site can open it in a signed-in browser; this
 * click redeems through the same-origin POST /api/redeem-invite, the path the
 * login and the code entry use after signing in.
 */
export function AcceptInviteButton({ inviteCode }: { inviteCode: string }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { run, isPending } = usePendingTask();

  const accept = async () => {
    await run(async () => {
      // Every exit of the redemption loads the next page.
      await redeemOtpInvite(supabase, inviteCode);
      return untilPageLeaves();
    });
  };

  return (
    <Button className="w-full" onClick={accept} disabled={isPending}>
      {isPending ? 'Wird angenommen…' : 'Einladung annehmen'}
    </Button>
  );
}
