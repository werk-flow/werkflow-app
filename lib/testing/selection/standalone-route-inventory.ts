import { VERIFY_ADDRESS_COOKIE } from '@/lib/auth/address-cookies';

/**
 * The screens outside the app shell (`StandaloneScreen`): sign-in and sign-up,
 * onboarding, the upgrade offer, the invitation error, the unavailable sign-in
 * and the root not-found page. Each entry names the session the screen needs
 * and the address the audit opens, because these screens refuse or redirect
 * every other visitor.
 * `standalone-route-inventory.test.ts` fails when a page under `app/` outside
 * the app shell is missing here. The standalone audit
 * (`tests/audit/layout/standalone-screens.spec.ts`) opens each screen at 375
 * and 1280 px in both themes with axe; the acceptance captures and the visual
 * references open them through the same sessions.
 *
 * - `anonymous`: no session.
 * - `newcomer`: a confirmed account without an organization or a subscription.
 * - `subscriber`: a newcomer whose payment the upgrade page simulated.
 * - `prestart`: a member whose access starts later, with an open blocking onboarding task.
 */
export type StandaloneSession = 'anonymous' | 'newcomer' | 'subscriber' | 'prestart';

export type StandaloneScreen = {
  /** The page folder under `app/`, or `not-found` for the root not-found page. */
  route: string;
  session: StandaloneSession;
  /** The address the audit opens, query included. */
  path: string;
  /** A cookie the browser carries before it opens the screen, as the step before the screen leaves it. */
  cookie?: { name: string; value: string };
};

export const STANDALONE_SCREENS = [
  { route: '/login', session: 'anonymous', path: '/login' },
  { route: '/signup', session: 'anonymous', path: '/signup' },
  { route: '/forgot-password', session: 'anonymous', path: '/forgot-password' },
  { route: '/reset-password', session: 'anonymous', path: '/reset-password' },
  {
    route: '/verify',
    session: 'anonymous',
    path: '/verify',
    cookie: { name: VERIFY_ADDRESS_COOKIE, value: 'pruefung@werkflow-golden.test' },
  },
  { route: '/invite-error', session: 'anonymous', path: '/invite-error?error=invite_expired' },
  { route: '/auth/unavailable', session: 'anonymous', path: '/auth/unavailable' },
  { route: 'not-found', session: 'anonymous', path: '/diese-seite-gibt-es-nicht' },
  { route: '/onboarding/start', session: 'newcomer', path: '/onboarding/start' },
  { route: '/onboarding/join-organization', session: 'newcomer', path: '/onboarding/join-organization' },
  { route: '/upgrade', session: 'newcomer', path: '/upgrade' },
  {
    route: '/onboarding/create-organization',
    session: 'subscriber',
    path: '/onboarding/create-organization',
  },
  { route: '/onboarding/meine-aufgaben', session: 'prestart', path: '/onboarding/meine-aufgaben' },
] as const satisfies readonly StandaloneScreen[];

export type StandaloneRoute = (typeof STANDALONE_SCREENS)[number]['route'];

/** Pages outside the app shell that only redirect and never render a screen. */
export const STANDALONE_REDIRECTS = [{ route: '/', destination: '/login' }] as const;

/** The inventory entry of a standalone route. */
export function standaloneScreen(route: StandaloneRoute): StandaloneScreen {
  const screen = STANDALONE_SCREENS.find((entry) => entry.route === route);
  if (!screen) throw new Error(`No standalone screen ${route}.`);
  return screen;
}
