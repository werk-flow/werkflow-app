import { Suspense, type ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';

import { SupportRealtimeProvider } from '@/components/realtime/realtime-provider';
import { SupportFrame, SupportFrameSkeleton } from '@/components/support/support-frame';
import { BannerProvider } from '@/components/ui/banner';
import { OpenDialogProvider } from '@/components/ui/open-dialog-context';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { supportCallerOf } from '@/lib/support/allowlist';

// WerkFlow support's own area (docs/features/problem-reports.md, "Support").
// It mounts no app shell and resolves no organization: a support person need
// not be a member of any. Everyone the allowlist does not name gets the
// not-found page, also while the allowlist cannot be resolved; an identity
// check that cannot complete throws into the error page. Each page's reader
// repeats the check, because a layout does not guard its pages' data.
async function SupportGate({ children }: { children: ReactNode }) {
  const user = await getAuthenticatedUser();
  if (!user) redirect('/login');
  if (!supportCallerOf(user.id).success) notFound();
  return (
    <BannerProvider>
      <SupportRealtimeProvider userId={user.id}>
        <OpenDialogProvider>
          <SupportFrame>{children}</SupportFrame>
        </OpenDialogProvider>
      </SupportRealtimeProvider>
    </BannerProvider>
  );
}

export default function SupportLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<SupportFrameSkeleton />}>
      <SupportGate>{children}</SupportGate>
    </Suspense>
  );
}
