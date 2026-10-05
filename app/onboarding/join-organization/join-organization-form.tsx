'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';

import { JoinOrgCodeForm } from '@/components/organization/join-org-code-form';
import {
  JoinRequestLiveWatch,
  PendingJoinRequest,
  type SettledJoinRequestStatus,
} from '@/components/organization/pending-join-request';
import { Button } from '@/components/ui/button';
import { loadDocument } from '@/lib/navigation/document-load';
import type { OwnJoinRequest } from '@/lib/org/types';

type FlowState =
  | { kind: 'form'; declinedBy: string | null }
  | { kind: 'pending'; request: OwnJoinRequest }
  | { kind: 'approved'; request: OwnJoinRequest };

/**
 * The way into an organization by its code for a person without one: enter
 * the code, wait for the approval, and enter the app by themselves once Admin
 * or Büro approved. A declined request says so and offers the code field again.
 */
export function JoinOrganizationForm({
  pendingRequest,
  declinedBy,
}: {
  pendingRequest: OwnJoinRequest | null;
  declinedBy: string | null;
}) {
  const [state, setState] = useState<FlowState>(
    pendingRequest ? { kind: 'pending', request: pendingRequest } : { kind: 'form', declinedBy },
  );

  if (state.kind === 'approved') {
    return (
      <p className="flex items-center gap-2 text-sm font-medium" role="status">
        <Loader2 className="size-4 animate-spin" />
        {state.request.organizationName} hat deine Anfrage freigegeben. Du wirst weitergeleitet …
      </p>
    );
  }

  if (state.kind === 'pending') {
    const { request } = state;
    const handleSettled = (status: SettledJoinRequestStatus) => {
      if (status === 'approved') {
        setState({ kind: 'approved', request });
        // A full load: the person is a member now, and the app shell starts from that membership.
        loadDocument(`/dashboard?joined=${request.organizationId}`);
        return;
      }
      setState({ kind: 'form', declinedBy: status === 'declined' ? request.organizationName : null });
    };
    return (
      <>
        <PendingJoinRequest
          request={request}
          hint="Sobald ein Admin oder das Büro sie freigibt, geht es hier von selbst weiter. Du musst die Seite nicht neu laden."
          onWithdrawn={() => setState({ kind: 'form', declinedBy: null })}
        />
        <JoinRequestLiveWatch request={request} onSettled={handleSettled} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      {state.declinedBy && (
        <p className="rounded-md border px-3 py-2 text-sm" data-join-request-state="declined">
          {state.declinedBy} hat deine Anfrage abgelehnt. Wenn das ein Versehen war, sprich mit deinem Admin.
          Du kannst auch einen anderen Code eingeben.
        </p>
      )}
      <JoinOrgCodeForm
        inputId="org-code"
        onRequest={(request) => setState({ kind: 'pending', request })}
        renderActions={(isPending) => (
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Beitritt anfragen
          </Button>
        )}
      />
      <div className="text-center">
        <Link
          href="/onboarding/start"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Zurück
        </Link>
      </div>
    </div>
  );
}
