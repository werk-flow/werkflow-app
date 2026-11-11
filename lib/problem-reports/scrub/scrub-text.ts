import { isUiString, type UiStringCatalog } from '@/lib/problem-reports/screenshot/ui-string-catalog';
import type { ProblemReportContext } from '@/lib/problem-reports/schemas';
import { findTerms, type ScrubDictionary } from './dictionary';
import { findEmails, findIbans, findPhones, type Found, type PlaceholderKind } from './patterns';
import { wordsOf, type Word } from './words';

// The scrubbed copy of a problem report's text and context
// (docs/technical/problem-report-scrubbing.md, "Text scrubbing"). Every rule
// finds its stretches in the original text; overlapping stretches merge, and
// each becomes a typed placeholder that is stable within the text.

const PERSON_SALUTATIONS = new Set(['herr', 'herrn', 'frau', 'familie', 'fam']);
const COMPANY_SALUTATIONS = new Set(['firma', 'fa']);
const TITLES = new Set(['dr', 'prof']);
const SALUTED_NAME_WORDS = 2;

/**
 * The name after a salutation, known or not: up to two capitalized words
 * after „Herr“, „Frau“, „Familie“, „Fam.“, „Firma“ or „Fa.“. A hyphenated
 * double name counts as one word, and a title before the name is skipped.
 */
function findSalutedNames(text: string, words: readonly Word[]): Found[] {
  const found: Found[] = [];
  words.forEach((salutation, index) => {
    const kind: PlaceholderKind | null = PERSON_SALUTATIONS.has(salutation.folded)
      ? 'Person'
      : COMPANY_SALUTATIONS.has(salutation.folded)
        ? 'Kunde'
        : null;
    if (kind === null) return;
    const name: Word[] = [];
    let nameWords = 0;
    let previous = salutation;
    for (let next = index + 1, word = words[next]; word !== undefined; next += 1, word = words[next]) {
      const gap = text.slice(previous.end, word.start);
      const hyphenated = nameWords > 0 && gap === '-';
      // A dot belongs to an abbreviation („Fam.“, „Dr.“); after a name it ends the sentence.
      if (!hyphenated && !(nameWords === 0 ? /^\.?\s+$/u : /^\s+$/u).test(gap)) break;
      previous = word;
      if (nameWords === 0 && TITLES.has(word.folded)) continue;
      if (!word.capitalized || (!hyphenated && nameWords === SALUTED_NAME_WORDS)) break;
      if (!hyphenated) nameWords += 1;
      name.push(word);
    }
    const first = name[0];
    const last = name.at(-1);
    if (first !== undefined && last !== undefined) {
      found.push({
        start: first.start,
        end: last.end,
        kind,
        key: name.map((word) => word.folded).join(' '),
      });
    }
  });
  return found;
}

/**
 * The stretches of all rules in text order. Stretches that overlap become
 * one, so no part of either stays readable; it takes the placeholder of the
 * rule that comes first in `ranked`.
 */
function mergeFound(ranked: readonly Found[][]): Found[] {
  const all = ranked
    .flatMap((found, rank) => found.map((entry) => ({ ...entry, rank })))
    .sort((left, right) => left.start - right.start || left.rank - right.rank);
  const merged: Array<Found & { rank: number }> = [];
  for (const entry of all) {
    const open = merged.at(-1);
    if (open === undefined || entry.start >= open.end) {
      merged.push(entry);
      continue;
    }
    if (entry.rank < open.rank) Object.assign(open, { kind: entry.kind, key: entry.key, rank: entry.rank });
    open.end = Math.max(open.end, entry.end);
  }
  return merged;
}

/**
 * The text with every IBAN, email address, phone number, known name and
 * address and every saluted name replaced by a placeholder such as
 * `[Kunde 1]`. The same name takes the same placeholder throughout the text.
 */
export function scrubReportText(original: string, dictionary: ScrubDictionary): string {
  const text = original.normalize('NFC');
  const words = wordsOf(text);
  const found = mergeFound([
    findIbans(text),
    findEmails(text),
    findPhones(text, dictionary.phones),
    findTerms(text, words, dictionary.terms),
    findSalutedNames(text, words),
  ]);
  const numbers = new Map<string, number>();
  const counts = new Map<PlaceholderKind, number>();
  const parts: string[] = [];
  let position = 0;
  for (const entry of found) {
    const identity = `${entry.kind}\n${entry.key}`;
    let number = numbers.get(identity);
    if (number === undefined) {
      number = (counts.get(entry.kind) ?? 0) + 1;
      counts.set(entry.kind, number);
      numbers.set(identity, number);
    }
    parts.push(text.slice(position, entry.start), `[${entry.kind} ${number}]`);
    position = entry.end;
  }
  parts.push(text.slice(position));
  return parts.join('');
}

/**
 * The context without any text of a record. Its only free text is the label
 * of a pressed control, which stays when the whole label is one of the app's
 * own UI strings; the server checks that again, because the device's filter
 * is not trusted.
 */
export function scrubReportContext(
  context: ProblemReportContext,
  catalog: UiStringCatalog,
): ProblemReportContext {
  return {
    ...context,
    recentActions: context.recentActions.map((action) => ({
      ...action,
      controlLabel:
        action.controlLabel !== null && isUiString(catalog, action.controlLabel) ? action.controlLabel : null,
    })),
  };
}
