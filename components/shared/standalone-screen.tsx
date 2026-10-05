import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';

/**
 * The one frame for a screen outside the app shell: sign-in and sign-up,
 * onboarding, the upgrade page, the invitation error, the root not-found page
 * and the failure of the root layout. It owns the page background, the
 * WerkFlow logo in both themes, the centered column and the vertical padding
 * that keeps a tall screen clear of the phone's edges. The content sets its
 * own width (`max-w-md` for a form card).
 */
export function StandaloneScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12">
      <Link href="/" className="mb-8">
        <Image
          src="/logo-text-light.svg"
          alt="WerkFlow"
          width={180}
          height={40}
          className="h-10 w-auto dark:hidden"
          priority
        />
        <Image
          src="/logo-text-dark.svg"
          alt="WerkFlow"
          width={180}
          height={40}
          className="hidden h-10 w-auto dark:block"
          priority
        />
      </Link>
      {children}
    </main>
  );
}
