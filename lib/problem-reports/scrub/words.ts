// The words of a text as the text scrubber compares them
// (docs/technical/problem-report-scrubbing.md, "Text scrubbing"). A word is
// a whole run of letters, digits and combining marks, so a name inside a
// longer word is never a word of its own. Each word is folded to one
// spelling: case, umlaut and `ß` variants and the street suffix compare equal.

/** One word of a text, with its place in it. */
export type Word = {
  start: number;
  end: number;
  /** The spelling that compares: `MÜLLER`, `Mueller` and `Müller` fold to `mueller`. */
  folded: string;
  /** True when the word starts with an upper-case letter. */
  capitalized: boolean;
};

// A house number keeps its letter as a word of its own, so `12a` and `12 a` compare equal.
const WORD = /\d+(?=\p{L}(?![\p{L}\p{N}\p{M}]))|[\p{L}\p{N}\p{M}]+/gu;
const UMLAUTS: Readonly<Record<string, string>> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

function fold(word: string): string {
  const folded = word
    .toLowerCase()
    .replace(/[äöüß]/gu, (letter) => UMLAUTS[letter] ?? letter)
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  // `Hauptstraße`, `Hauptstrasse` and `Hauptstr.` are one street.
  return folded.endsWith('strasse') ? folded.slice(0, -4) : folded;
}

/**
 * The words of an NFC-normalized text, in order. The modifier apostrophe
 * `ʼ` counts as a letter in Unicode; here it separates like `'` and `’`, so
 * „OʼNeill“ is „O“ and „Neill“, as the stored „O'Neill“ is. It keeps the
 * text's length, so every position stays.
 */
export function wordsOf(text: string): Word[] {
  return Array.from(text.replace(/\u02bc/gu, '\u2019').matchAll(WORD), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
    folded: fold(match[0]),
    capitalized: /^\p{Lu}/u.test(match[0]),
  }));
}

/** The folded words of a stored value, such as a customer's name. */
export function foldedWordsOf(value: string): string[] {
  return wordsOf(value.normalize('NFC')).map((word) => word.folded);
}
