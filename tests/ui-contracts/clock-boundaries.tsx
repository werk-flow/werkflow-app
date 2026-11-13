import { useState } from 'react';
import { ClockStateProvider, useClockState } from '@/components/clock-state-provider';
import { ClockFAB } from '@/components/clock-fab';
import { TimeActivityDialog } from '@/components/time-activity-dialog';
import { endSessionAfterCheck } from '@/components/shared/unsent-work-gate';
import { BannerProvider } from '@/components/ui/banner';
import { OpenDialogProvider } from '@/components/ui/open-dialog-context';
import { CLOCK_ORGANIZATION_ID } from './clock-state-fixture';

function ClockCallerProbe() {
  const { clockIn, isReady, state, refresh } = useClockState();
  const [open, setOpen] = useState(false);
  const [sessionEnd, setSessionEnd] = useState('');
  return (
    <>
      <output aria-label="Abmeldung">{sessionEnd}</output>
      <button
        type="button"
        onClick={async () => {
          setSessionEnd('');
          const ended = await endSessionAfterCheck(
            (message) => setSessionEnd(`Prüfung fehlgeschlagen: ${message}`),
            async () => undefined,
          );
          setSessionEnd((failure) => failure || (ended ? 'Sitzung darf enden' : 'Sitzung bleibt'));
        }}
      >
        Abmelden prüfen
      </button>
      <button
        type="button"
        onClick={async () => {
          setSessionEnd('');
          // A flow that fails after the check, as a clock-out the server refuses.
          await endSessionAfterCheck(
            (message) => setSessionEnd(`Prüfung fehlgeschlagen: ${message}`),
            async () => {
              throw new Error('the clock-out failed');
            },
          ).catch(() => setSessionEnd('Abmeldung fehlgeschlagen'));
        }}
      >
        Abmelden mit Fehler
      </button>
      <output aria-label="Zeitstatus">{isReady ? `Bereit: ${state?.sessionVersion}` : 'Nicht bereit'}</output>
      <button
        type="button"
        onClick={async () => {
          window.clockContract.directResult = await clockIn(null);
        }}
      >
        Direkter Startversuch
      </button>
      <button type="button" onClick={() => void refresh()}>
        Zeitstatus aktualisieren
      </button>
      <button type="button" onClick={() => setOpen(true)}>
        Aktivitätsdialog prüfen
      </button>
      <TimeActivityDialog open={open} onOpenChange={setOpen} organizationId={CLOCK_ORGANIZATION_ID} />
      <ClockFAB />
    </>
  );
}

export function ClockContractFixture() {
  return (
    <BannerProvider>
      <OpenDialogProvider>
        <ClockStateProvider>
          <ClockCallerProbe />
        </ClockStateProvider>
      </OpenDialogProvider>
    </BannerProvider>
  );
}
