// The pattern rules of the text scrubber: what is replaced by its shape
// alone, whoever it belongs to (docs/technical/problem-report-scrubbing.md,
// "Text scrubbing"). Each finder reads the text once from left to right.

export type PlaceholderKind = 'Kunde' | 'Person' | 'Adresse' | 'Telefon' | 'E-Mail' | 'IBAN';

/** A stretch of the text to replace. Stretches with the same kind and key take the same placeholder. */
export type Found = { start: number; end: number; kind: PlaceholderKind; key: string };

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

// --- IBAN ---

const IBAN_HEAD = /(?<![\p{L}\p{N}])[A-Za-z]{2}\d{2}/gu;
const IBAN_CHARACTER = /[A-Za-z0-9]/u;
const IBAN_MIN_LENGTH = 15;
const IBAN_MAX_LENGTH = 34;

/** The ISO 13616 check: the number with its first four characters moved to the end leaves 1 modulo 97. */
function hasValidIbanCheck(compact: string): boolean {
  let remainder = 0;
  for (const character of compact.slice(4) + compact.slice(0, 4)) {
    const value = Number.parseInt(character, 36);
    remainder = (remainder * (value > 9 ? 100 : 10) + value) % 97;
  }
  return remainder === 1;
}

/**
 * Every IBAN, written in one piece or in groups. A candidate starts with two
 * letters and two digits and ends at a word end; the longest one with a valid
 * check wins, so a word after the number stays. A number whose check fails,
 * such as a mistyped one, is still replaced when digits alone follow its
 * first four characters.
 */
export function findIbans(text: string): Found[] {
  const found: Found[] = [];
  let scannedTo = 0;
  for (const head of text.matchAll(IBAN_HEAD)) {
    if (head.index < scannedTo) continue;
    const ends: Array<{ end: number; compact: string; digitsOnly: boolean }> = [];
    let compact = head[0];
    let digitsOnly = true;
    let index = head.index + compact.length;
    const noteEnd = (): void => {
      if (compact.length >= IBAN_MIN_LENGTH) ends.push({ end: index, compact, digitsOnly });
    };
    while (compact.length < IBAN_MAX_LENGTH) {
      const character = text[index] ?? '';
      if (IBAN_CHARACTER.test(character)) {
        compact += character;
        digitsOnly &&= character >= '0' && character <= '9';
        index += 1;
      } else if (/[ \u00a0]/u.test(character) && IBAN_CHARACTER.test(text[index + 1] ?? '')) {
        noteEnd();
        index += 1;
      } else break;
    }
    if (!WORD_CHARACTER.test(text[index] ?? '')) noteEnd();
    const best =
      ends.findLast((end) => hasValidIbanCheck(end.compact)) ?? ends.findLast((end) => end.digitsOnly);
    if (best === undefined) continue;
    found.push({ start: head.index, end: best.end, kind: 'IBAN', key: best.compact.toUpperCase() });
    scannedTo = best.end;
  }
  return found;
}

// --- Email ---

// Every character an unquoted local part may hold (RFC 5322), so „o'neill@…“ is one address.
const EMAIL_LOCAL_CHARACTER = /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]/u;
/** The longest local part, with its two quotes. */
const EMAIL_QUOTED_LOCAL_MAX_LENGTH = 66;
const EMAIL_DOMAIN_CHARACTER = /[\p{L}\p{N}.-]/u;
const EMAIL_DOMAIN = /^[^.].*\.\p{L}{2,}$/u;

/**
 * Every email address: the characters around an `@` that form a local part
 * and a domain with an ending. A quoted local part, which may hold spaces,
 * reaches back to its opening quote.
 */
export function findEmails(text: string): Found[] {
  const found: Found[] = [];
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    let start = at;
    if (text[at - 1] === '"') {
      const from = Math.max(0, at - EMAIL_QUOTED_LOCAL_MAX_LENGTH);
      const quote = text.slice(from, at - 1).lastIndexOf('"');
      if (quote !== -1) start = from + quote;
    } else {
      while (start > 0 && EMAIL_LOCAL_CHARACTER.test(text[start - 1] ?? '')) start -= 1;
    }
    let end = at + 1;
    while (end < text.length && EMAIL_DOMAIN_CHARACTER.test(text[end] ?? '')) end += 1;
    while (end > at + 1 && /[.-]/u.test(text[end - 1] ?? '')) end -= 1;
    if (start < at && EMAIL_DOMAIN.test(text.slice(at + 1, end))) {
      found.push({ start, end, kind: 'E-Mail', key: text.slice(start, end).toLowerCase() });
    }
  }
  return found;
}

// --- Phone ---

/** What may stand between two digit groups of one number: spaces, a slash, a dash, a bracket. */
const PHONE_GAP = /^[ \u00a0\t]*[-\u2013/()]{0,2}[ \u00a0\t]*$/u;
const PHONE_MIN_DIGITS = 7;
/** The longest phone number (E.164). Digits without a phone's shape are compared with known numbers up to here. */
const PHONE_MAX_DIGITS = 15;
/** A stored number with fewer digits is an extension: digits that short match anywhere. */
const KNOWN_PHONE_MIN_DIGITS = 6;

/**
 * One spelling for a number in any format: the national number without its
 * leading zero. `+49 171 2345678`, `0049 (0) 171 2345678` and `0171/2345678`
 * share one key; a number of another country keeps its country code.
 */
function phoneKey(plus: boolean, digits: string): string {
  const international = plus ? digits : digits.startsWith('00') ? digits.slice(2) : null;
  if (international === null) return digits.replace(/^0/u, '');
  return international.startsWith('49') ? international.slice(2).replace(/^0/u, '') : `+${international}`;
}

/**
 * Every phone number. A number has a phone's shape when it stands alone,
 * starts with `+`, `00` or `0` and has at least 7 digits, in groups or in
 * one piece. It ends where its groups end, so no group of it stays readable;
 * a second number right behind it becomes part of the same find. Digits in
 * any grouping that spell a known number are replaced too, so a stored
 * number matches without its leading zero.
 */
export function findPhones(text: string, knownPhones: ReadonlySet<string>): Found[] {
  const groups = Array.from(text.matchAll(/\d+/gu), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
    digits: match[0],
  }));
  const found: Found[] = [];
  let first = 0;
  for (let head = groups[first]; head !== undefined; head = groups[first]) {
    const plus = text[head.start - 1] === '+';
    const start = plus ? head.start - 1 : head.start;
    const shaped =
      !WORD_CHARACTER.test(text[start - 1] ?? '') &&
      (plus ? !head.digits.startsWith('0') : head.digits.startsWith('0'));
    let digits = '';
    let match: { last: number; end: number; key: string } | null = null;
    let group: typeof head | undefined = head;
    for (let last = first; group !== undefined; last += 1, group = groups[last]) {
      const previous = last > first ? groups[last - 1] : undefined;
      if (previous !== undefined && !PHONE_GAP.test(text.slice(previous.end, group.start))) break;
      // Without a phone's shape only a known number matches, and none is longer than this.
      if (!shaped && digits.length + group.digits.length > PHONE_MAX_DIGITS) break;
      digits += group.digits;
      const key = phoneKey(plus, digits);
      if ((shaped && digits.length >= PHONE_MIN_DIGITS) || knownPhones.has(key)) {
        match = { last, end: group.end, key };
      }
    }
    if (match === null) {
      first += 1;
    } else {
      found.push({ start, end: match.end, kind: 'Telefon', key: match.key });
      first = match.last + 1;
    }
  }
  return found;
}

/** The keys under which a stored phone field is known: each number in it, or all of its digits. */
export function knownPhoneKeysOf(value: string): string[] {
  const shaped = findPhones(value, new Set()).map((phone) => phone.key);
  const digits = value.replace(/\D/gu, '');
  const keys =
    shaped.length > 0 || digits.length > PHONE_MAX_DIGITS
      ? shaped
      : [phoneKey(value.trimStart().startsWith('+'), digits)];
  return keys.filter((key) => key.replace(/\D/gu, '').length >= KNOWN_PHONE_MIN_DIGITS);
}
