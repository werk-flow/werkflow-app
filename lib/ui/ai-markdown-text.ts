// The text rules of the model-text renderer (components/shared/ai-markdown.tsx,
// B11 of werk-flow/werkflow-planning#530): where a link may point, and where
// a streaming answer splits into blocks.

export const FENCE = /^\s*```/;

const PROBE_ORIGIN = 'https://werkflow.invalid';
const PRINTABLE_PATH = /^\/(?![/\\])[\x21-\x5b\x5d-\x7e]*$/;

/**
 * The link target of a path on this origin, as the browser resolves it, or
 * null. The written path is one leading slash and printable ASCII without a
 * backslash, so no space, control character or lookalike of a slash can turn
 * it into another host. The resolved path holds the same, because dot
 * segments (`/.//host`, `/%2e//host`) can collapse into a second slash that a
 * hard navigation would read as another host.
 */
export function sameOriginTarget(href: string): string | null {
  if (!PRINTABLE_PATH.test(href)) return null;
  const url = new URL(href, PROBE_ORIGIN);
  const target = `${url.pathname}${url.search}${url.hash}`;
  return url.origin === PROBE_ORIGIN && PRINTABLE_PATH.test(url.pathname) ? target : null;
}

/**
 * The answer's blocks: split at blank lines outside a code fence. Text only
 * grows at its end, so every block but the last is finished and never changes.
 */
export function splitAnswerBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fenced = false;
  const close = (): void => {
    if (current.length > 0) blocks.push(current.join('\n'));
    current = [];
  };
  for (const row of text.split('\n')) {
    // A code block stands alone: its fence ends the block before it, and its closing fence ends it.
    if (FENCE.test(row) && !fenced) close();
    if (FENCE.test(row)) fenced = !fenced;
    if (!fenced && row.trim() === '') close();
    else current.push(row);
    if (FENCE.test(row) && !fenced) close();
  }
  close();
  return blocks;
}
