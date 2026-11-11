import { knownPhoneKeysOf, type Found, type PlaceholderKind } from './patterns';
import { foldedWordsOf, type Word } from './words';

// The dictionary of one organization: what its own data knows as a name, an
// address or a phone number (docs/technical/problem-report-scrubbing.md,
// "Text scrubbing"). The terms sit in a tree keyed by folded word, so a text
// is matched in one pass over its words, however many names the tree holds.

/** What one organization's rows name. Built for one scrub, never kept. */
export type ScrubDictionarySources = {
  /** Names of customers and of the callers of requests. */
  customerNames: readonly string[];
  /** Names of contacts, members, employees and emergency contacts. */
  personNames: readonly string[];
  /** Addresses of customers, sites, callers and employees, each as one line. */
  addresses: readonly string[];
  phones: readonly string[];
};

type Term = { kind: PlaceholderKind; key: string };
type TermNode = { next: Map<string, TermNode>; term: Term | null };

export type ScrubDictionary = { terms: TermNode; phones: ReadonlySet<string> };

/**
 * Words of a name that never count as the name alone: salutations and titles,
 * legal forms, articles, prepositions and conjunctions. Without them a
 * customer called „Die Bad GmbH“ would replace every „die“ of a report.
 */
const NOT_A_NAME_ALONE = new Set(
  (
    'herr herrn frau familie fam firma dr prof dipl ing ' +
    'gmbh mbh ag kg ug ohg gbr co ' +
    'der die das dem den des ein eine einer und oder fuer mit von vom van zu zum zur ' +
    'am an auf aus bei im in'
  ).split(' '),
);
/** A shorter word is replaced only inside its whole name: two letters match too much alone. */
const NAME_WORD_MIN_LENGTH = 3;
const POSTCODE = /^\d{5}$/u;

/**
 * A longer term enters the tree as every stretch of this many words in a
 * row. The finds of those stretches overlap and merge, so the whole term is
 * still replaced, and no walk from a word of the text goes deeper than this.
 */
const TERM_MAX_WORDS = 12;

function addTerm(root: TermNode, words: readonly string[], term: Term): void {
  for (let start = 1; start + TERM_MAX_WORDS <= words.length; start += 1) {
    addTerm(root, words.slice(start, start + TERM_MAX_WORDS), term);
  }
  let node = root;
  for (const word of words.slice(0, TERM_MAX_WORDS)) {
    let next = node.next.get(word);
    if (next === undefined) {
      next = { next: new Map(), term: null };
      node.next.set(word, next);
    }
    node = next;
  }
  // The first name that claims a spelling keeps it, so one spelling has one placeholder.
  node.term ??= term;
}

/** A name is replaced as a whole and word by word, so a surname alone is caught. */
function addName(root: TermNode, kind: PlaceholderKind, name: string): void {
  const words = foldedWordsOf(name);
  if (words.length === 0) return;
  const term: Term = { kind, key: words.join(' ') };
  addTerm(root, words, term);
  for (const word of words) {
    if (word.length >= NAME_WORD_MIN_LENGTH && /\p{L}/u.test(word) && !NOT_A_NAME_ALONE.has(word)) {
      addTerm(root, [word], term);
    }
  }
}

/** An address is replaced in its parts: the street with its number, and the postcode with its city. */
function addAddress(root: TermNode, address: string): void {
  const term: Term = { kind: 'Adresse', key: foldedWordsOf(address).join(' ') };
  for (const line of address.split(/[,;\n]/u)) {
    const words = foldedWordsOf(line);
    const postcode = words.findIndex((word, index) => index > 0 && POSTCODE.test(word));
    const parts = postcode === -1 ? [words] : [words.slice(0, postcode), words.slice(postcode)];
    for (const part of parts) if (part.length >= 2) addTerm(root, part, term);
  }
}

/** The dictionary of one organization's sources. */
export function buildScrubDictionary(sources: ScrubDictionarySources): ScrubDictionary {
  const terms: TermNode = { next: new Map(), term: null };
  for (const name of sources.customerNames) addName(terms, 'Kunde', name);
  for (const name of sources.personNames) addName(terms, 'Person', name);
  for (const address of sources.addresses) addAddress(terms, address);
  return { terms, phones: new Set(sources.phones.flatMap(knownPhoneKeysOf)) };
}

/** What may stand between two words of one term: spaces, a line break, a dot, a comma, a hyphen. */
const TERM_GAP = /^[\s.,\-–]*$/u;

/** The node a word leads to: by its own spelling, or without a genitive `s` („Müllers“). */
function step(node: TermNode, word: string): TermNode | undefined {
  return node.next.get(word) ?? (word.endsWith('s') ? node.next.get(word.slice(0, -1)) : undefined);
}

/**
 * Every known name and address in the words of a text. From each word the
 * tree is walked as far as the following words lead, and the longest term
 * from that word is a find. Finds may overlap, as „Wei Li“ and „Li Na“ do in
 * „Wei Li Na“; the caller merges them.
 */
export function findTerms(text: string, words: readonly Word[], root: TermNode): Found[] {
  const found: Found[] = [];
  words.forEach((head, first) => {
    let node = step(root, head.folded);
    let match: { end: number; term: Term } | null = null;
    for (let last = first, word = head; node !== undefined; ) {
      if (node.term !== null) match = { end: word.end, term: node.term };
      const next = words[last + 1];
      if (next === undefined || !TERM_GAP.test(text.slice(word.end, next.start))) break;
      node = step(node, next.folded);
      last += 1;
      word = next;
    }
    if (match !== null) {
      found.push({ start: head.start, end: match.end, kind: match.term.kind, key: match.term.key });
    }
  });
  return found;
}
