import { useState } from 'react';
import { ClockStateProvider, useClockState } from '@/components/clock-state-provider';
import { ClockFAB } from '@/components/clock-fab';
import { TimeActivityDialog } from '@/components/time-activity-dialog';
import { mayEndSession } from '@/components/shared/unsent-work-gate';
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
          const mayEnd = await mayEndSession((message) =>
            setSessionEnd(`Prüfung fehlgeschlagen: ${message}`),
          );
          setSessionEnd((failure) => failure || (mayEnd ? 'Sitzung darf enden' : 'Sitzung bleibt'));
        }}
      >
        Abmelden prüfen
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
