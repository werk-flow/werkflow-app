// The fake value that replaces a text in a redrawn screenshot. It keeps the
// shape, so the layout holds: a letter becomes a letter of the same case, a
// digit becomes another digit, and punctuation and spacing stay.
// docs/technical/problem-report-scrubbing.md owns the rule.

/** A source of numbers in [0, 1). Tests pin it; the redraw draws fresh ones on every run. */
export type RandomSource = () => number;

const CONSONANTS = 'bdfgklmnprstvz';
const VOWELS = 'aeiou';

function pick(alphabet: string, random: RandomSource): string {
  return alphabet.charAt(Math.floor(random() * alphabet.length));
}

function otherDigit(digit: string, random: RandomSource): string {
  const others = '0123456789'.replace(digit, '');
  return pick(others, random);
}

/**
 * Replaces every letter and digit of `text` with a fake one of the same kind.
 * Letters alternate consonant and vowel within a word, so the result reads as
 * a made-up word of the same length. A digit never keeps its value.
 */
export function fakeText(text: string, random: RandomSource): string {
  let result = '';
  let letterInWord = 0;
  for (const character of text) {
    if (/\p{L}/u.test(character)) {
      const letter = pick(letterInWord % 2 === 0 ? CONSONANTS : VOWELS, random);
      letterInWord += 1;
      result += character === character.toLowerCase() ? letter : letter.toUpperCase();
      continue;
    }
    letterInWord = 0;
    // \p{Nd} covers every decimal digit; another script's digit becomes a Latin one.
    result += /\p{Nd}/u.test(character) ? otherDigit(character, random) : character;
  }
  return result;
}

/** Fresh randomness for a real redraw: a fixed mapping could be reversed by counting letters. */
export function cryptoRandom(): number {
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1));
  return value / 2 ** 32;
}
