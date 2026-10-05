import type { ReactNode } from 'react';

import { StandaloneScreen } from '@/components/shared/standalone-screen';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <StandaloneScreen>
      <div className="w-full max-w-md">{children}</div>
    </StandaloneScreen>
  );
}
