'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import { Badge } from '@/components/ui/badge';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { useRouterRefresh } from '@/components/ui/refresh-button';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import {
  cancelWerkflowSubscription,
  resumeWerkflowSubscription,
} from '@/lib/werkflow-billing/billing-actions';
import { WERKFLOW_BILLING_MESSAGES } from '@/lib/werkflow-billing/billing-messages';
import type { SubscriptionState, SubscriptionView } from '@/lib/werkflow-billing/billing-view';
import { formatGermanDate } from '@/lib/utils';

const FAILED = 'Das hat nicht geklappt. Versuche es erneut.';

const dateOf = (value: string | null) => formatGermanDate(value, { empty: 'Ende des bezahlten Monats' });

function stateBadge(state: SubscriptionState): ReactNode {
  switch (state.kind) {
    case 'active':
      return <Badge variant="success">Aktiv</Badge>;
    case 'ending':
      return <Badge>Gekündigt zum {dateOf(state.endsAt)}</Badge>;
    case 'payment_open':
      return <Badge variant="warning">Zahlung offen</Badge>;
    case 'ended':
      return <Badge variant="outline">Beendet</Badge>;
    case 'unknown':
      return <Badge variant="outline">Wird aktualisiert</Badge>;
  }
}

function stateText(state: SubscriptionState): string {
  switch (state.kind) {
    case 'active':
      return 'Dein Abo verlängert sich jeden Monat. Du kannst jederzeit kündigen, die Kündigung gilt zum Ende des bezahlten Monats.';
    case 'ending':
      return `Du hast gekündigt. Dein Zugang läuft bis zum ${dateOf(state.endsAt)}, bis dahin kannst du die Kündigung zurücknehmen.`;
    case 'payment_open':
      return 'Die letzte Zahlung ist nicht eingegangen. Du hast dazu eine E-Mail mit dem nächsten Schritt bekommen.';
    case 'ended':
      return state.endedAt
        ? `Dein Abo ist am ${formatGermanDate(state.endedAt)} ausgelaufen.`
        : 'Dein Abo ist ausgelaufen.';
    case 'unknown':
      return 'Wir gleichen den Stand deines Abos gerade mit dem Zahlungsdienst ab. Schau später noch einmal vorbei.';
  }
}

/** When the paid period ends, for the cancel confirmation. */
function periodEndOf(state: SubscriptionState): string | null {
  return state.kind === 'active' ? state.renewsAt : null;
}

/** Applies a cancellation change, then shows the new state on this page. */
function useCancellationChange(organizationId: string) {
  const { showBanner } = useBanner();
  const { refresh } = useRouterRefresh();
  const cancel = useServerAction(() => cancelWerkflowSubscription(organizationId));
  const resume = useServerAction(() => resumeWerkflowSubscription(organizationId));
  const [resumeError, setResumeError] = useState<string | null>(null);

  const confirmCancel = async (): Promise<string | null> => {
    const result = await cancel.run();
    if (!result.success) return describeFailure(result.error, WERKFLOW_BILLING_MESSAGES, FAILED);
    showBanner({
      message: 'Dein Abo ist gekündigt. Es läuft bis zum Ende des bezahlten Monats.',
      variant: 'success',
    });
    refresh();
    return null;
  };

  const takeBack = async () => {
    setResumeError(null);
    const result = await resume.run().catch(() => ({ success: false, error: 'unexpected_error' }) as const);
    if (!result.success) {
      setResumeError(describeFailure(result.error, WERKFLOW_BILLING_MESSAGES, FAILED));
      return;
    }
    showBanner({ message: 'Deine Kündigung ist zurückgenommen. Dein Abo läuft weiter.', variant: 'success' });
    refresh();
  };

  return { confirmCancel, takeBack, resumePending: resume.isPending, resumeError };
}

/** The organization's subscription: its state in plain German, and cancelling or taking a cancellation back. */
export function BillingSubscriptionCard({
  organizationId,
  subscription,
}: {
  organizationId: string;
  subscription: SubscriptionView;
}) {
  const { state, canCancel, canResume } = subscription;
  const change = useCancellationChange(organizationId);
  const periodEnd = dateOf(periodEndOf(state));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dein WerkFlow-Abo</CardTitle>
        <CardDescription>{stateText(state)}</CardDescription>
        <CardAction>{stateBadge(state)}</CardAction>
      </CardHeader>
      {(canCancel || canResume || state.kind === 'ended') && (
        <CardContent className="space-y-2">
          {canCancel && (
            <ConfirmActionDialog
              trigger={
                <Button type="button" variant="outline">
                  Abo kündigen
                </Button>
              }
              title="Abo kündigen?"
              description={
                <>
                  <p>
                    Die Kündigung gilt zum Ende des bezahlten Monats. Dein Zugang läuft bis zum {periodEnd},
                    danach bucht WerkFlow nichts mehr ab.
                  </p>
                  <p className="mt-2">
                    Bis dahin kannst du die Kündigung hier zurücknehmen. Bezahlte Zeit wird nicht anteilig
                    erstattet.
                  </p>
                </>
              }
              confirmLabel="Abo kündigen"
              onConfirm={change.confirmCancel}
            />
          )}
          {canResume && (
            <>
              <Button type="button" pending={change.resumePending} onClick={() => void change.takeBack()}>
                Kündigung zurücknehmen
              </Button>
              <ErrorText>{change.resumeError}</ErrorText>
            </>
          )}
          {state.kind === 'ended' && (
            <Button asChild>
              <Link href="/upgrade">Abo abschließen</Link>
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}
