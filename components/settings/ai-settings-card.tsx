'use client';

import { useEffect, useRef, useState } from 'react';

import { RegionLoadError } from '@/components/shared/region-load-error';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { useServerAction } from '@/hooks/use-server-action';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { describeFailure } from '@/lib/action-messages';
import { AI_PRODUCT_NAME } from '@/lib/ai/name';
import type { AiOrganizationSwitch } from '@/lib/ai/settings';
import { setAiEnabled } from '@/lib/ai/settings-actions';
import { unconfirmedMarker } from '@/lib/ui/unconfirmed';

const ERROR_MESSAGES = {
  not_authorized: `Nur Admins können ${AI_PRODUCT_NAME} ein- oder ausschalten.`,
  not_a_member: 'Du bist kein Mitglied dieser Organisation mehr. Lade die Seite neu.',
  not_released: `${AI_PRODUCT_NAME} ist für deine Organisation noch nicht freigeschaltet.`,
  update_failed: `${AI_PRODUCT_NAME} konnte nicht umgeschaltet werden. Versuche es erneut.`,
} satisfies Record<string, string>;

/** The admin's switch for WerkFlow KI in the organization settings. */
export function AiSettingsCard({
  organizationId,
  state,
}: {
  organizationId: string;
  state: AiOrganizationSwitch | 'load_failed';
}) {
  // Another admin's change reaches this card as a route refresh.
  useRealtimeRouterRefresh({ tables: ['ai_organization_settings'] });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{AI_PRODUCT_NAME}</CardTitle>
        <CardDescription>
          Der KI-Assistent arbeitet nur mit den Rechten der Person, die ihn nutzt. Chats sind privat: Niemand
          sonst kann sie lesen, auch kein Admin. Nach 12 Monaten werden sie gelöscht.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state === 'load_failed' ? (
          <RegionLoadError title={`${AI_PRODUCT_NAME} konnte nicht geladen werden`}>
            Die Einstellung ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
          </RegionLoadError>
        ) : state.released ? (
          <AiSwitch
            organizationId={organizationId}
            serverEnabled={state.enabled}
            serverRevision={state.revision}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {AI_PRODUCT_NAME} ist für deine Organisation noch nicht freigeschaltet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AiSwitch({
  organizationId,
  serverEnabled,
  serverRevision,
}: {
  organizationId: string;
  serverEnabled: boolean;
  serverRevision: number;
}) {
  // The rendered revision, current before useSettleOnChange's effect reports
  // the render: this effect is declared first, so it runs first.
  const renderedRevision = useRef(serverRevision);
  useEffect(() => {
    renderedRevision.current = serverRevision;
  }, [serverRevision]);
  const settleOnChange = useSettleOnChange(serverRevision);
  const sinceRef = useRef<number | undefined>(undefined);
  // The value the admin asked for, shown until the refreshed props carry it.
  const [requested, setRequested] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { run, isPending, isSettling } = useServerAction(setAiEnabled, {
    // The action revalidates, so its response renders the new props. A save
    // settles once the props carry its own revision or a later one, so the
    // render of another admin's earlier save does not settle it; the mark
    // taken before the call catches a render that lands first.
    settle: async (result) => {
      if (!result.success) return;
      let since = sinceRef.current;
      while (renderedRevision.current < result.revision) {
        const seen = settleOnChange.markChange();
        if (!(await settleOnChange.confirmChange(since))) break;
        since = seen;
      }
      setRequested(null);
    },
  });
  const busy = isPending || isSettling;
  const enabled = requested ?? serverEnabled;

  // A micro-toggle: it flips at once, stays quiet on success and turns back with the error.
  async function toggle(next: boolean) {
    setRequested(next);
    setError(null);
    sinceRef.current = settleOnChange.markChange();
    try {
      const result = await run({ organizationId, enabled: next });
      if (!result.success) {
        setRequested(null);
        setError(describeFailure(result.error, ERROR_MESSAGES, ERROR_MESSAGES.update_failed));
      }
    } catch {
      setRequested(null);
      setError(ERROR_MESSAGES.update_failed);
    }
  }

  // The checkbox and its sentence show the asked-for value until the refreshed props confirm it.
  return (
    <div role="group" aria-label={AI_PRODUCT_NAME} className="space-y-2" {...unconfirmedMarker(busy)}>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Checkbox
            checked={enabled}
            disabled={busy}
            onCheckedChange={(checked) => void toggle(checked === true)}
          />
          {AI_PRODUCT_NAME} in dieser Organisation nutzen
        </label>
        <InlinePending active={busy} label={`${AI_PRODUCT_NAME} wird umgeschaltet`} />
      </div>
      <p className="text-sm text-muted-foreground">
        {enabled
          ? `Alle Mitglieder können ${AI_PRODUCT_NAME} nutzen, sobald sie verfügbar ist.`
          : `${AI_PRODUCT_NAME} ist ausgeschaltet. Niemand in deiner Organisation kann sie nutzen.`}
      </p>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
