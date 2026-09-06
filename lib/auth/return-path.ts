// Only same-origin paths may be used as post-authentication destinations.
// Concatenating the origin with an attacker-chosen `next` such as
// `.evil.example` or `@evil.example` changes the parsed host (SI-003).

const DEFAULT_RETURN_PATH = '/';

export function resolveSafeReturnPath(
  candidate: string | null | undefined,
  origin: string
): string {
  if (
    !candidate ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.startsWith('/\\')
  ) {
    return DEFAULT_RETURN_PATH;
  }

  try {
    const resolved = new URL(candidate, origin);
    if (resolved.origin !== origin) return DEFAULT_RETURN_PATH;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return DEFAULT_RETURN_PATH;
  }
}
