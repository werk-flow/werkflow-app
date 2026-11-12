import type { ReactNode } from 'react';

import { DraftLandingSweep } from '@/components/auth/draft-landing-sweep';
import { TodayLandingWipe } from '@/components/auth/today-landing-wipe';
import { UnsentTimeLandingNotice } from '@/components/auth/unsent-time-landing-notice';
import { StandaloneScreen } from '@/components/shared/standalone-screen';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <StandaloneScreen>
      {/* Every sign-out lands here once its session ended: nothing of today stays on the phone. */}
      <TodayLandingWipe />
      {/* A lost-access report draft past its seven days goes, whoever wrote it. */}
      <DraftLandingSweep />
      <UnsentTimeLandingNotice />
      <div className="w-full max-w-md">{children}</div>
    </StandaloneScreen>
  );
}
