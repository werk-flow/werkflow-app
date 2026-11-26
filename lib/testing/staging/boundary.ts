// The staging journey kit's browser boundary (.claude/skills/staging-journey/SKILL.md). A journey's
// browser loads pages from staging only, and the Vercel bypass reaches staging's host only: the
// kit's route handler asks these functions about every request (Tier 1).

/** Staging: the branch alias of `main` (docs/technical/environments.md, "Vercel"). */
export const STAGING_ORIGIN = 'https://werkflow-app-git-main-werkflows-projects.vercel.app';

/** A sandbox Checkout session's page; a live session's id starts with `cs_live_`. */
const SANDBOX_CHECKOUT = /^https:\/\/checkout\.stripe\.com\/(?:[a-z]+\/)*cs_test_[A-Za-z0-9]+/;

export type BrowserRequest = {
  url: string;
  /** A request that loads a document into a frame. */
  navigation: boolean;
  /** Whether that frame is the page itself, not an embedded one. */
  mainFrame: boolean;
};

/**
 * `staging`: a request to staging, which carries the bypass. `elsewhere`: a request the staging page or
 * the sandbox Checkout makes to another origin (Supabase DEV, Stripe's scripts), without the bypass.
 * `refused`: a page outside staging, except a sandbox Checkout the app sent the journey to.
 */
export type RequestVerdict = 'staging' | 'elsewhere' | 'refused';

export function requestVerdict(request: BrowserRequest): RequestVerdict {
  const url = URL.parse(request.url);
  if (!url || url.username || url.password) return 'refused';
  if (url.origin === STAGING_ORIGIN) return 'staging';
  if (url.protocol !== 'https:') return 'refused';
  if (request.navigation && request.mainFrame)
    return SANDBOX_CHECKOUT.test(url.href) ? 'elsewhere' : 'refused';
  return 'elsewhere';
}

/**
 * The headers a request gets on top of its own: the bypass for a request to staging, nothing for any
 * other origin. A document request also asks Vercel for the bypass cookie, which a redirect back to
 * staging then carries.
 */
export function bypassHeaders(request: BrowserRequest, secret: string): Record<string, string> {
  if (requestVerdict(request) !== 'staging') return {};
  return request.navigation
    ? { 'x-vercel-protection-bypass': secret, 'x-vercel-set-bypass-cookie': 'true' }
    : { 'x-vercel-protection-bypass': secret };
}

/** A refused request's origin for the journey's failure line; never its path, which may carry a token. */
export function refusedOrigin(url: string): string {
  return URL.parse(url)?.origin ?? 'an unreadable URL';
}
