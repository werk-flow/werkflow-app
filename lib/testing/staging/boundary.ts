// The staging journey kit's browser boundary (.claude/skills/staging-journey/SKILL.md). A journey's
// browser reaches staging, DEV, Stripe's sandbox Checkout and staging's signed billing downloads only, and the Vercel bypass reaches
// staging's host only: the kit's route asks these functions about every request and every redirect
// hop before it is sent (Tier 1).

/** Staging: the branch alias of `main` (docs/technical/environments.md, "Vercel"). */
export const STAGING_ORIGIN = 'https://werkflow-app-git-main-werkflows-projects.vercel.app';

/** A sandbox Checkout session's page; a live session's id starts with `cs_live_`. */
const SANDBOX_CHECKOUT = /^https:\/\/checkout\.stripe\.com\/(?:[a-z]+\/)*cs_test_[A-Za-z0-9]+/;

/**
 * A signed R2 download of a WerkFlow invoice original, which the billing page opens as its PDF button's
 * page (lib/storage/r2.ts, `createWerkflowBillingDownloadUrl`): DEV's EU bucket `werkflow-documents-dev`
 * (docs/technical/environments.md), never PROD's, the original's key
 * `werkflow-billing/invoices/<Stripe invoice>/<sha256>.pdf` (lib/werkflow-billing/issue-invoice.ts) and
 * a SigV4 signature only staging's server can make. The R2 account id is server configuration the kit
 * cannot know; bucket names are unique within it.
 */
const SIGNED_BILLING_DOWNLOAD =
  /^https:\/\/[0-9a-f]{32}\.eu\.r2\.cloudflarestorage\.com\/werkflow-documents-dev\/werkflow-billing\/invoices\/in_[A-Za-z0-9]+\/[0-9a-f]{64}\.pdf\?(?:[^#&]+&)*X-Amz-Signature=[0-9a-f]{64}(?:&[^#]*)?$/;

export type BrowserRequest = {
  url: string;
  /** A request that loads a document into a frame. */
  navigation: boolean;
  /** Whether that frame is the page itself, not an embedded one. */
  mainFrame: boolean;
};

/** Hosts the sandbox Checkout loads its scripts, frames and captcha from; Stripe's live pages are refused above. */
const STRIPE_SANDBOX_ASSET_HOSTS =
  /^(?:[a-z0-9-]+\.)*(?:stripe\.com|stripe\.network|stripecdn\.com|hcaptcha\.com)$/;

/**
 * `staging`: a request to staging, which carries the bypass. `elsewhere`: a request to DEV's Supabase
 * project or, from a frame or a script, to Stripe's sandbox Checkout hosts, without the bypass.
 * `refused`: everything else, PROD included, and a page outside staging except a sandbox Checkout or a
 * signed billing download the app sent the journey to. A journey that needs another origin adds it here, with a test.
 */
export type RequestVerdict = 'staging' | 'elsewhere' | 'refused';

export function requestVerdict(request: BrowserRequest, devRef: string): RequestVerdict {
  const url = URL.parse(request.url);
  if (!url || url.username || url.password) return 'refused';
  if (url.origin === STAGING_ORIGIN) return 'staging';
  if (url.protocol !== 'https:' && url.protocol !== 'wss:') return 'refused';
  if (request.navigation && request.mainFrame)
    return SANDBOX_CHECKOUT.test(url.href) || SIGNED_BILLING_DOWNLOAD.test(url.href)
      ? 'elsewhere'
      : 'refused';
  if (url.hostname === `${devRef}.supabase.co`) return 'elsewhere';
  return url.protocol === 'https:' && STRIPE_SANDBOX_ASSET_HOSTS.test(url.hostname) ? 'elsewhere' : 'refused';
}

/**
 * The headers a request gets on top of its own: the bypass for a request to staging, nothing for any
 * other origin. No bypass cookie: the route adds the header to every hop to staging, and a cookie would
 * leave the bypass in the browser, where Vercel answers its request with one more redirect.
 */
export function bypassHeaders(request: BrowserRequest, secret: string): Record<string, string> {
  return URL.parse(request.url)?.origin === STAGING_ORIGIN ? { 'x-vercel-protection-bypass': secret } : {};
}

/** A refused request's origin for the journey's failure line; never its path, which may carry a token. */
export function refusedOrigin(url: string): string {
  return URL.parse(url)?.origin ?? 'an unreadable URL';
}
