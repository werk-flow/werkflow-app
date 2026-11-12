import type { ReactNode } from 'react';

import { TodayLandingWipe } from '@/components/auth/today-landing-wipe';
import { StandaloneScreen } from '@/components/shared/standalone-screen';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <StandaloneScreen>
      {/* Every sign-out lands here once its session ended: nothing of today stays on the phone. */}
      <TodayLandingWipe />
      <div className="w-full max-w-md">{children}</div>
    </StandaloneScreen>
  );
}
