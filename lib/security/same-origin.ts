// Same-origin guard for route handlers that mutate cookies from a JSON body.
// Next.js checks the Origin header for Server Actions, not for route handlers,
// so a cross-site form could otherwise post into /auth/callback and log the
// victim's browser into the attacker's session (login CSRF, SI-013).

export type SameOriginVerdict =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'origin_mismatch' | 'cross_site' | 'unsupported_content_type';
    };

function normalizeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * A request may change auth cookies only when the browser attests it came from
 * this origin. `Sec-Fetch-Site` is checked first because browsers always send
 * it; `Origin` covers older clients. Requiring a JSON content type rejects the
 * `text/plain` form trick that can smuggle a JSON body across sites.
 */
export function verifySameOriginJsonRequest(request: {
  headers: Headers;
  url: string;
}): SameOriginVerdict {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return { allowed: false, reason: 'unsupported_content_type' };
  }

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return { allowed: false, reason: 'cross_site' };
  }

  const origin = normalizeOrigin(request.headers.get('origin'));
  const expected = normalizeOrigin(request.url);
  if (origin && expected && origin !== expected) {
    return { allowed: false, reason: 'origin_mismatch' };
  }

  return { allowed: true };
}
