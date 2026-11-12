import { UnsentTimeLandingNotice } from '@/components/auth/unsent-time-landing-notice';
import { OfflineClock } from '@/components/clock-offline';

/** The clock of the page without signal, over the browser's own device storage. */
export function OfflineClockContractFixture(): React.JSX.Element {
  return (
    <main>
      <OfflineClock />
    </main>
  );
}

/** The page a sign-out lands on, with its notice about unsent time on the phone. */
export function UnsentTimeLandingContractFixture(): React.JSX.Element {
  return (
    <main>
      <UnsentTimeLandingNotice />
      <p>Anmelden</p>
    </main>
  );
}
