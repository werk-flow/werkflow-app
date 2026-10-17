// A relative link in a doc resolves to a file, and a #fragment on a Markdown target names one of
// its headings (GitHub slug rules, lib/docs/heading-anchors.ts). A renamed heading otherwise
// breaks every inbound fragment without a sound.

/** How links resolve: the caller answers from the file system, relative to the linking doc. */
export type LinkResolver = {
  /** The absolute path a link target names from the doc, or null for an external link. */
  resolve: (target: string) => string | null;
  exists: (absolutePath: string) => boolean;
  /** Whether a missing target lies inside a sibling clone that is not checked out (counted elsewhere). */
  inMissingSibling: (absolutePath: string) => boolean;
  anchors: (absolutePath: string) => ReadonlySet<string>;
};

const LINK_TARGET = /\]\(([^)\s]+)\)/g;

/** A fragment with its percent-encoding decoded, or null when the encoding is malformed. */
function decodedFragment(fragment: string): string | null {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return null;
  }
}

/** Every link of a doc whose file does not exist or whose fragment names no heading. */
export function findBrokenLinks(markdown: string, resolver: LinkResolver): string[] {
  const problems: string[] = [];
  for (const [, target = ''] of markdown.matchAll(LINK_TARGET)) {
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [pathPart = '', fragment] = target.split('#');
    const path = resolver.resolve(pathPart);
    if (path === null) continue;
    if (!resolver.exists(path)) {
      if (!resolver.inMissingSibling(path)) problems.push(`${target} does not resolve`);
      continue;
    }
    if (fragment === undefined || !path.endsWith('.md')) continue;
    const anchor = decodedFragment(fragment);
    if (anchor === null) problems.push(`${target} carries a malformed percent-encoded fragment`);
    else if (!resolver.anchors(path).has(anchor))
      problems.push(`${target} names no heading of the target; use the heading's slug or drop the fragment`);
  }
  return problems;
}
