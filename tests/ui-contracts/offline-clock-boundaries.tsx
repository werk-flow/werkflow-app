import { OfflineClock } from '@/components/clock-offline';

/** The clock of the page without signal, over the browser's own device storage. */
export function OfflineClockContractFixture(): React.JSX.Element {
  return (
    <main>
      <OfflineClock />
    </main>
  );
}
