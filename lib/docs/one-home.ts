// A fact has one home (docs/README.md, "Add, change and remove docs"). A rule copied word for word
// into a second living doc or skill drifts from its home with the next edit. The meaning of a
// paraphrase is a review judgment; an identical long sentence is mechanical.

/** The shortest sentence, in words, that counts as a copy when it appears in two documents. */
const SHARED_SENTENCE_MIN_WORDS = 12;

export type GuidanceText = { path: string; markdown: string };

/** One sentence that two or more documents carry, with its normalized text. */
export type SharedSentence = { sentence: string; paths: string[] };

function withoutFencedCode(markdown: string): string {
  // A fence closes only with its own character, at least as long as the opener (CommonMark).
  let fence: string | null = null;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
      if (marker !== undefined) {
        if (fence === null) fence = marker;
        else if (marker.charAt(0) === fence.charAt(0) && marker.length >= fence.length) fence = null;
        return '';
      }
      return fence === null ? line : '';
    })
    .join('\n');
}

/**
 * The sentences of a Markdown text, normalized for comparison: link targets, emphasis, list
 * markers, headings and table pipes are dropped, whitespace collapses and case folds. A line
 * break ends a sentence, because these docs write one paragraph or list item per line.
 */
export function readSentences(markdown: string): string[] {
  return withoutFencedCode(markdown)
    .split('\n')
    .flatMap((line) =>
      line
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`>|]/g, ' ')
        .replace(/^\s*(?:#{1,6}|-|\d+\.)\s+/, '')
        .split(/(?<=[.!?:;])\s+/),
    )
    .map((sentence) =>
      sentence
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[.!?:;,]+$/, '')
        .toLowerCase(),
    )
    .filter((sentence) => sentence.length > 0);
}

function wordCount(sentence: string): number {
  return sentence.split(' ').filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/**
 * Every sentence of at least `SHARED_SENTENCE_MIN_WORDS` words that two or more of the given
 * documents carry, with the documents in the given order. A sentence repeated inside one
 * document is that document's own business.
 */
export function findSharedSentences(texts: readonly GuidanceText[]): SharedSentence[] {
  const homes = new Map<string, string[]>();
  for (const { path, markdown } of texts) {
    for (const sentence of new Set(readSentences(markdown))) {
      if (wordCount(sentence) < SHARED_SENTENCE_MIN_WORDS) continue;
      homes.set(sentence, [...(homes.get(sentence) ?? []), path]);
    }
  }
  return [...homes].filter(([, paths]) => paths.length > 1).map(([sentence, paths]) => ({ sentence, paths }));
}

/**
 * Problems against the reviewed allowlist of shared sentences (decision 0004 holds each reason):
 * a shared sentence the list does not name, and a listed sentence that no longer appears twice,
 * so the list only shrinks.
 */
export function findSharedSentenceProblems(
  shared: readonly SharedSentence[],
  allowlist: readonly string[],
): string[] {
  const problems: string[] = [];
  const found = new Set(shared.map((entry) => entry.sentence));
  for (const entry of shared) {
    if (allowlist.includes(entry.sentence)) continue;
    problems.push(
      `"${entry.sentence}" stands in ${entry.paths.join(' and ')}; keep it in its one home and link to it from the others`,
    );
  }
  for (const sentence of allowlist) {
    if (!found.has(sentence))
      problems.push(
        `the allowlisted shared sentence "${sentence}" no longer appears twice; remove its entry`,
      );
  }
  return problems;
}
