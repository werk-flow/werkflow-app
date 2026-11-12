// The route of a page without its values: `/auftraege/AUF-2026-001` becomes
// `/auftraege/[jobNumber]`. A problem report carries only templates, so no
// id, number or name of a record travels in its context.

const ROUTE_WORD = /^[a-z]+(?:-[a-z]+)*$/;
const PARAMETER_NAME = /^[a-zA-Z]+$/;

/** The route params of a page, as `useParams` returns them. */
export type RouteParams = Readonly<Record<string, string | string[] | undefined>>;

/**
 * Replaces each path segment that holds a route param with `[name]`. Any
 * other segment that is not a plain route word becomes `[wert]`, so a value
 * the params did not name never passes either.
 */
export function routeTemplate(pathname: string, params: RouteParams): string {
  const parameterBySegment = new Map<string, string>();
  for (const [name, value] of Object.entries(params)) {
    if (!PARAMETER_NAME.test(name)) continue;
    for (const segment of Array.isArray(value) ? value : [value]) {
      if (segment) parameterBySegment.set(segment, name);
    }
  }
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return '/';
  return `/${segments
    .map((segment) => {
      const parameter = parameterBySegment.get(safeDecode(segment)) ?? parameterBySegment.get(segment);
      if (parameter) return `[${parameter}]`;
      return ROUTE_WORD.test(segment) ? segment : '[wert]';
    })
    .join('/')}`;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
