import { useState } from 'react';
import { ClockStateProvider, useClockState } from '@/components/clock-state-provider';
import { ClockFAB } from '@/components/clock-fab';
import { TimeActivityDialog } from '@/components/time-activity-dialog';
import { BannerProvider } from '@/components/ui/banner';
import { OpenDialogProvider } from '@/components/ui/open-dialog-context';
import { CLOCK_ORGANIZATION_ID } from './clock-state-fixture';

function ClockCallerProbe() {
  const { clockIn, isReady, state, refresh } = useClockState();
  const [open, setOpen] = useState(false);
  return (
    <>
      <output aria-label="Zeitstatus">{isReady ? `Bereit: ${state?.sessionVersion}` : 'Nicht bereit'}</output>
      <button type="button" onClick={async () => { window.clockContract.directResult = await clockIn(null); }}>Direkter Startversuch</button>
      <button type="button" onClick={() => void refresh()}>Zeitstatus aktualisieren</button>
      <button type="button" onClick={() => setOpen(true)}>Aktivitätsdialog prüfen</button>
      <TimeActivityDialog open={open} onOpenChange={setOpen} organizationId={CLOCK_ORGANIZATION_ID} />
      <ClockFAB />
    </>
  );
}

export function ClockContractFixture() {
  return (
    <BannerProvider>
      <OpenDialogProvider>
        <ClockStateProvider><ClockCallerProbe /></ClockStateProvider>
      </OpenDialogProvider>
    </BannerProvider>
  );
}
