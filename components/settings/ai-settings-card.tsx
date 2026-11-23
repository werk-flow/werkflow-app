'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { RegionLoadError } from '@/components/shared/region-load-error';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { AI_PRODUCT_NAME } from '@/lib/ai/name';
import type { AiOrganizationSwitch } from '@/lib/ai/settings';
import { setAiEnabled } from '@/lib/ai/settings-actions';

const ERROR_MESSAGES = {
  not_authorized: `Nur Admins können ${AI_PRODUCT_NAME} ein- oder ausschalten.`,
  not_released: `${AI_PRODUCT_NAME} ist für deine Organisation noch nicht freigeschaltet.`,
  update_failed: `${AI_PRODUCT_NAME} konnte nicht umgeschaltet werden. Versuche es erneut.`,
} satisfies Record<string, string>;

/** The admin's switch for WerkFlow KI in the organization settings. */
export function AiSettingsCard({ state }: { state: AiOrganizationSwitch | 'load_failed' }) {
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
          <AiSwitch key={String(state.enabled)} initialEnabled={state.enabled} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {AI_PRODUCT_NAME} ist für deine Organisation noch nicht freigeschaltet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AiSwitch({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const { run, isPending } = useServerAction(setAiEnabled);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);

  // A micro-toggle: it flips at once, stays quiet on success and turns back with the error.
  async function toggle(next: boolean) {
    setEnabled(next);
    setError(null);
    try {
      const result = await run({ enabled: next });
      if (!result.success) {
        setEnabled(!next);
        setError(describeFailure(result.error, ERROR_MESSAGES, ERROR_MESSAGES.update_failed));
        return;
      }
      router.refresh();
    } catch {
      setEnabled(!next);
      setError(ERROR_MESSAGES.update_failed);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Checkbox
            checked={enabled}
            disabled={isPending}
            onCheckedChange={(checked) => void toggle(checked === true)}
          />
          {AI_PRODUCT_NAME} in dieser Organisation nutzen
        </label>
        <InlinePending active={isPending} label={`${AI_PRODUCT_NAME} wird umgeschaltet`} />
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
