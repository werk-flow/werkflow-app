import { knownPhoneKeysOf, type Found, type PlaceholderKind } from './patterns';
import { foldedWordsOf, wordsOf, type Word } from './words';

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
  /** Names of sites. */
  siteNames: readonly string[];
  /** Addresses of customers, sites, callers and employees, each as one line. */
  addresses: readonly string[];
  phones: readonly string[];
  /** Codes that identify the organization, such as its join code. */
  identifiers: readonly string[];
};

type Term = { kind: PlaceholderKind; key: string };
type TermNode = { next: Map<string, TermNode>; term: Term | null };

export type ScrubDictionary = {
  terms: TermNode;
  phones: ReadonlySet<string>;
  /** The identifying codes in lower case, which a token may not hold anywhere. */
  identifiers: ReadonlySet<string>;
};

/**
 * Words of a name that never count as the name alone: salutations and titles,
 * legal forms, articles, prepositions and conjunctions. Without them a
 * customer called „Die Bad GmbH“ would replace every „die“ of a report.
 */
export const NOT_A_NAME_ALONE: ReadonlySet<string> = new Set(
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
/** A single word with one of these endings is a street: „Lindenstraße“ folds to `lindenstr`. */
const STREET_SUFFIX = /(?:str|weg|platz|allee|gasse|ring|damm|ufer|chaussee)$/u;
const NO_WORDS: ReadonlySet<string> = new Set();

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

/**
 * A name is replaced as a whole and word by word, so a surname alone is
 * caught. A word in `notAlone` is replaced only inside the whole name. A
 * short part before a word that stands alone goes with it, so „O’Neill“
 * leaves no „O“ readable.
 */
function addName(root: TermNode, kind: PlaceholderKind, name: string, notAlone: ReadonlySet<string>): void {
  const words = foldedWordsOf(name);
  if (words.length === 0) return;
  const term: Term = { kind, key: words.join(' ') };
  addTerm(root, words, term);
  for (const [index, word] of words.entries()) {
    const alone =
      word.length >= NAME_WORD_MIN_LENGTH &&
      /\p{L}/u.test(word) &&
      !NOT_A_NAME_ALONE.has(word) &&
      !notAlone.has(word);
    if (!alone) continue;
    addTerm(root, [word], term);
    const before = words[index - 1];
    if (before !== undefined && before.length < NAME_WORD_MIN_LENGTH) addTerm(root, [before, word], term);
  }
}

/**
 * An address is replaced in its parts: the street with its number, the
 * street alone, and the postcode with its city. The street alone is every
 * stretch before a number, because a street's name may hold one („Straße
 * des 17. Juni 5“). A street of one word counts alone only with a street
 * ending, so a part such as „Hinterhaus“ is none.
 */
function addAddress(root: TermNode, address: string): void {
  const term: Term = { kind: 'Adresse', key: foldedWordsOf(address).join(' ') };
  for (const line of address.split(/[,;\n]/u)) {
    const words = foldedWordsOf(line);
    const postcode = words.findIndex((word, index) => index > 0 && POSTCODE.test(word));
    const parts = postcode === -1 ? [words] : [words.slice(0, postcode), words.slice(postcode)];
    for (const part of parts) {
      const streets = part.flatMap((word, index) => (/^\d/u.test(word) ? [part.slice(0, index)] : []));
      for (const phrase of [part, ...streets]) {
        if (phrase.length >= 2 || STREET_SUFFIX.test(phrase[0] ?? '')) addTerm(root, phrase, term);
      }
    }
  }
}

/**
 * The app's own UI words: each catalog entry that is one word, such as
 * „Service“. A word inside a longer entry is none. The catalog holds every
 * string of the source, and one of them is a list of common family names.
 */
function uiWordsOf(uiStrings: ReadonlySet<string>): Set<string> {
  const words = new Set<string>();
  for (const entry of uiStrings) {
    const [word, ...more] = foldedWordsOf(entry);
    if (word !== undefined && more.length === 0) words.add(word);
  }
  return words;
}

/**
 * The dictionary of one organization's sources. `uiStrings` is the catalog
 * of the app's own UI strings. Reports are about the app, so a UI word that
 * is also a word of a customer's name, such as „Service“, is replaced only
 * inside the whole name. A person's name stays strict.
 */
export function buildScrubDictionary(
  sources: ScrubDictionarySources,
  uiStrings: ReadonlySet<string>,
): ScrubDictionary {
  const uiWords = uiWordsOf(uiStrings);
  const terms: TermNode = { next: new Map(), term: null };
  for (const name of sources.customerNames) addName(terms, 'Kunde', name, uiWords);
  for (const name of sources.personNames) addName(terms, 'Person', name, NO_WORDS);
  // A site's name is one phrase, never its words alone: „Neubau Kita …“ must not replace every „Neubau“.
  for (const name of sources.siteNames) {
    const words = foldedWordsOf(name);
    const first = words[0];
    if (first !== undefined && (words.length > 1 || !uiWords.has(first))) {
      addTerm(terms, words, { kind: 'Adresse', key: words.join(' ') });
    }
  }
  for (const address of sources.addresses) addAddress(terms, address);
  // An identifying code is a whole word in any case, and becomes an `ID`.
  for (const code of sources.identifiers) {
    const words = foldedWordsOf(code);
    if (words.length > 0) addTerm(terms, words, { kind: 'ID', key: words.join(' ') });
  }
  return {
    terms,
    phones: new Set(sources.phones.flatMap(knownPhoneKeysOf)),
    identifiers: new Set(sources.identifiers.map((code) => code.trim().toLowerCase()).filter(Boolean)),
  };
}

/** The node a word leads to: by its own spelling, or without a genitive `s` („Müllers“). */
function step(node: TermNode, word: string): TermNode | undefined {
  return node.next.get(word) ?? (word.endsWith('s') ? node.next.get(word.slice(0, -1)) : undefined);
}

/**
 * Every known name and address in the words of a text. From each word the
 * tree is walked as far as the following words lead, and the longest term
 * from that word is a find. Whatever stands between two words (spaces, a
 * line break, any punctuation) never ends a term, so „Werkhalle (Neubau)“
 * and a name split over two lines are found. Finds may overlap, as „Wei Li“
 * and „Li Na“ do in „Wei Li Na“; the caller merges them.
 */
export function findTerms(words: readonly Word[], root: TermNode): Found[] {
  const found: Found[] = [];
  words.forEach((head, first) => {
    let node = step(root, head.folded);
    let match: { end: number; term: Term } | null = null;
    for (let last = first, word: Word | undefined = head; node !== undefined && word !== undefined; ) {
      if (node.term !== null) match = { end: word.end, term: node.term };
      last += 1;
      word = words[last];
      node = word === undefined ? undefined : step(node, word.folded);
    }
    if (match !== null) {
      found.push({ start: head.start, end: match.end, kind: match.term.kind, key: match.term.key });
    }
  });
  return found;
}

/** True when the dictionary knows a name, an address or a phone number in the text. No pattern rule applies. */
export function dictionaryKnows(dictionary: ScrubDictionary, original: string): boolean {
  const text = original.normalize('NFC');
  return (
    findTerms(wordsOf(text), dictionary.terms).length > 0 ||
    knownPhoneKeysOf(text).some((key) => dictionary.phones.has(key))
  );
}
