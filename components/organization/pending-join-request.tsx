'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { z } from '@/lib/zod';

import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { withdrawOrganizationJoinRequest } from '@/lib/org/join-request-actions';
import { joinRequestStatusSchema } from '@/lib/org/schemas';
import type { JoinRequestStatus, OwnJoinRequest } from '@/lib/org/types';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { RequestedOrganizationScope } from './organization-context';

export type SettledJoinRequestStatus = Exclude<JoinRequestStatus, 'pending'>;

const WITHDRAW_MESSAGES: Readonly<Record<string, string>> = {
  request_not_pending: 'Die Anfrage ist nicht mehr offen. Sie wurde gerade entschieden.',
};
const WITHDRAW_FALLBACK = 'Die Anfrage konnte nicht zurückgezogen werden. Bitte versuche es erneut.';

const ownRequestRowSchema = z.object({ status: joinRequestStatusSchema }).nullable();

/**
 * Reads the requester's own request whenever it changes. The browser client
 * reads through row-level security, which shows a person only their own
 * requests; a read that starts on mount stays out of the Server Action queue.
 */
function JoinRequestWatcher({
  requestId,
  onSettled,
}: {
  requestId: string;
  onSettled: (status: SettledJoinRequestStatus) => void;
}) {
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  });

  const view = useLiveView<JoinRequestStatus | null>({
    tables: ['organization_join_requests'],
    read: async (): Promise<LiveViewResult<JoinRequestStatus | null>> => {
      const { data, error } = await createSupabaseBrowserClient()
        .from('organization_join_requests')
        .select('status')
        .eq('id', requestId)
        .maybeSingle();
      const row = ownRequestRowSchema.safeParse(data);
      if (error || !row.success) return { ok: false };
      return { ok: true, data: row.data?.status ?? null };
    },
  });

  const status = view.data;
  useEffect(() => {
    if (status && status !== 'pending') onSettledRef.current(status);
  }, [status]);

  return null;
}

/**
 * Moves a waiting requester on once Admin or Büro decided. Only for a person
 * outside the app shell: the provider below joins the requested
 * organization's channel, and a second provider inside the shell would
 * overwrite the shell's channel markers.
 */
export function JoinRequestLiveWatch({
  request,
  onSettled,
}: {
  request: OwnJoinRequest;
  onSettled: (status: SettledJoinRequestStatus) => void;
}) {
  return (
    <RequestedOrganizationScope organizationId={request.organizationId}>
      <RealtimeProvider>
        <JoinRequestWatcher requestId={request.id} onSettled={onSettled} />
      </RealtimeProvider>
    </RequestedOrganizationScope>
  );
}

/**
 * The calm waiting state after a valid code: whom the requester waits for,
 * what happens next (`hint`), and the way to take the request back.
 */
export function PendingJoinRequest({
  request,
  hint,
  onWithdrawn,
}: {
  request: OwnJoinRequest;
  hint: string;
  onWithdrawn: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const withdraw = useServerAction(withdrawOrganizationJoinRequest);

  const handleWithdraw = async () => {
    setError(null);
    const result = await withdraw.run(request.id).catch(() => ({
      success: false as const,
      error: 'unexpected_error',
    }));
    if (!result.success) {
      setError(describeFailure(result.error, WITHDRAW_MESSAGES, WITHDRAW_FALLBACK));
      return;
    }
    onWithdrawn();
  };

  return (
    <div className="space-y-4" data-join-request-state="pending">
      <div className="space-y-2">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-xs font-medium text-warning-soft-foreground">
          <Clock className="size-3.5" />
          Wartet auf Freigabe
        </span>
        <p className="text-sm font-medium">
          Deine Anfrage wartet auf Freigabe durch {request.organizationName}.
        </p>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <ErrorText>{error}</ErrorText>
      <Button
        type="button"
        variant="outline"
        onClick={() => void handleWithdraw()}
        disabled={withdraw.isPending}
      >
        {withdraw.isPending && <Loader2 className="size-4 animate-spin" />}
        Anfrage zurückziehen
      </Button>
    </div>
  );
}
