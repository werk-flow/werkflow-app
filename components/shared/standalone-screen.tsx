import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';

/**
 * The one frame for a screen outside the app shell: sign-in and sign-up,
 * onboarding, the upgrade page, the invitation error, the root not-found page
 * and the failure of the root layout. It owns the page background, the
 * WerkFlow logo in both themes, the centered column, the vertical padding
 * that keeps a tall screen clear of the phone's edges, and the screen's one
 * main landmark (`data-page-body`, so the layout audit measures it like a
 * page body). The content sets its own width (`max-w-md` for a form card)
 * and takes its title from `StandaloneTitle`.
 */
export function StandaloneScreen({ children }: { children: ReactNode }) {
  return (
    <main
      data-page-body
      className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12"
    >
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

/**
 * The title of a screen outside the app shell, in its one style: the screen's
 * `h1`, whether it heads a form card or the screen itself. Five title styles
 * had drifted apart across these screens, and the sign-in cards had no
 * heading at all (UI audit of 2026-10-15). Alignment and spacing come from
 * the surrounding layout.
 */
export function StandaloneTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-2xl leading-tight font-semibold tracking-tight">{children}</h1>;
}
