/** Markdown lines outside fenced code, with their original 1-based line numbers. */
export function markdownLinesOutsideFences(markdown: string): { line: number; text: string }[] {
  const lines: { line: number; text: string }[] = [];
  let fence: { character: string; length: number } | null = null;
  for (const [index, text] of markdown.split(/\r?\n/).entries()) {
    const marker = text.match(/^\s*(`{3,}|~{3,})(.*)$/);
    // A backtick fence's info string holds no backtick, so a line like ```lib/a.ts``` is inline code.
    const opensBacktickFenceWrongly = !fence && marker?.[1]?.startsWith('`') && marker[2]?.includes('`');
    if (marker?.[1] && !opensBacktickFenceWrongly) {
      if (!fence) fence = { character: marker[1][0] ?? '', length: marker[1].length };
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2]?.trim())
        fence = null;
      continue;
    }
    if (fence) continue;
    lines.push({ line: index + 1, text });
  }
  return lines;
}
