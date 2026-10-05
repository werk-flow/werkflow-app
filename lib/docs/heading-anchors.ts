/** The ATX headings and explicit anchors used by repository Markdown. */
export function markdownHeadingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  let fence: { character: string; length: number } | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker?.[1]) {
      if (!fence) fence = { character: marker[1][0] ?? '', length: marker[1].length };
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2]?.trim())
        fence = null;
      continue;
    }
    if (fence) continue;
    for (const explicit of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(explicit[1] ?? '');
    const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/)?.[1];
    if (!heading) continue;
    // Code spans preserve underscores; emphasis outside them loses only its delimiters.
    const text = heading
      .split(/(`+[^`]*`+)/g)
      .map((part) =>
        part.startsWith('`')
          ? part.replace(/`/g, '')
          : part
              .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
              .replace(/(^|\s)(_+)(\S(?:.*?\S)?)\2(?=\s|$|[.,:;!?])/g, '$1$3')
              .replace(/[*~]/g, ''),
      )
      .join('');
    const slug = text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${count}`);
  }
  return anchors;
}
