// What a value that identifies a person looks like. The profiler masks every
// export-derived label that matches (label), and its self-check refuses an
// output that still contains a match (findPersonalDataLike). A masked shape
// (letters X or x, digits 9) never counts as a match.

export type PersonalDataKind =
  | 'email'
  | 'phone'
  | 'iban'
  | 'street_address'
  | 'postal_code_and_place'
  | 'salutation_and_name'
  | 'person_name';

const PATTERNS: readonly (readonly [PersonalDataKind, RegExp])[] = [
  ['email', /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu],
  ['phone', /(?:\+\d{2}|\b00\d{2}|\(0\d{2,5}\)|\b0\d{2,5})[\s/-]*\d[\d\s/-]{4,}\d/gu],
  ['iban', /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/gu],
  [
    'street_address',
    /[\p{L}.-]*(?:straße|strasse|str\.|weg|allee|platz|gasse|ring|damm|ufer|chaussee|steig|pfad)\s*\d{1,4}\s?[a-z]?(?![\p{L}\p{N}])/giu,
  ],
  ['postal_code_and_place', /\b\d{5}\s+\p{Lu}\p{Ll}{2,}/gu],
  ['salutation_and_name', /(?:\bHerrn?|\bFrau|\bHr\.|\bFr\.)\s+\p{Lu}\p{Ll}+/gu],
];

// Common German first and family names. Names that are also ordinary words
// (Klein, Lang, Koch, Bauer, Wolf, Winter, Stein) stay out, so a label such
// as "Winter" is not masked by mistake.
const COMMON_NAMES = new Set(
  (
    'Alexander Andreas Angelika Anna Anja Bernd Birgit Brigitte Carsten Christa Christian Christina ' +
    'Christine Claudia Daniel Dennis Dieter Dirk Elke Elisabeth Emma Erika Felix Florian Frank ' +
    'Gabriele Gerhard Günter Hannah Hans Harald Heike Heinz Helga Helmut Holger Horst Ingrid Jan ' +
    'Jens Joachim Johannes Jonas Jörg Jürgen Julia Karin Karl Katharina Kerstin Klaus Kurt Lea ' +
    'Leon Lukas Manfred Manuela Marco Maria Marie Markus Martin Martina Matthias Max Melanie Michael ' +
    'Monika Nicole Niklas Olaf Paul Peter Petra Rainer Ralf Renate Robert Sabine Sandra Sebastian ' +
    'Silke Simone Sophie Stefan Stefanie Steffen Susanne Sven Thomas Thorsten Tim Tobias Torsten ' +
    'Ursula Ute Uwe Werner Wolfgang Yvonne ' +
    'Müller Mueller Schmidt Schneider Fischer Weber Meyer Meier Wagner Becker Schulz Hoffmann ' +
    'Schäfer Schaefer Richter Wolff Schröder Schroeder Neumann Zimmermann Krüger Krueger ' +
    'Hofmann Hartmann Schmitt Schmitz Krause Lehmann Schmid Schulze Maier ' +
    'Köhler Koehler Herrmann Walter König Koenig Mayer Huber Kaiser Fuchs Peters Möller Moeller ' +
    'Scholz Hahn Vogel Friedrich Keller Günther Berger Winkler Roth Beck Lorenz Baumann Franke ' +
    'Albrecht Ludwig Kraus Böhm Boehm Schuster Jäger Jaeger Heinrich Brandt Haas Schreiber ' +
    'Dietrich Ziegler Kuhn Kühn Pohl Bergmann Voigt Sauer Arnold Pfeiffer Schubert Obermaier'
  ).split(' '),
);

export type PersonalDataFinding = { kind: PersonalDataKind; index: number };

/** True when every letter is X or x and every digit is 9: a masked shape carries no value. */
function isMaskedShape(text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(text.replace(/[Xx9]/g, ''));
}

/** Every place in `text` that looks like a name, an email, a phone number, an IBAN or an address. */
export function findPersonalDataLike(text: string): PersonalDataFinding[] {
  const findings: PersonalDataFinding[] = [];
  for (const [kind, pattern] of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (!isMaskedShape(match[0])) findings.push({ kind, index: match.index });
    }
  }
  for (const word of text.matchAll(/\p{L}+/gu)) {
    if (COMMON_NAMES.has(word[0])) findings.push({ kind: 'person_name', index: word.index });
  }
  return findings.sort((first, second) => first.index - second.index);
}

/**
 * The shape of a value: an uppercase letter becomes X, any other letter x,
 * a digit 9; punctuation stays, whitespace becomes one space, control
 * characters become ?. "Müller 12" becomes "Xxxxxx 99".
 */
export function maskShape(value: string, maxLength = 40): string {
  let shape = '';
  let length = 0;
  for (const character of value) {
    if (length === maxLength) return `${shape}…`;
    shape += maskCharacter(character);
    length += 1;
  }
  return shape;
}

function maskCharacter(character: string): string {
  if (/\p{Lu}/u.test(character)) return 'X';
  if (/\p{L}/u.test(character)) return 'x';
  if (/\p{N}/u.test(character)) return '9';
  if (/\s/u.test(character)) return ' ';
  if (/[\p{C}]/u.test(character)) return '?';
  return character;
}

/**
 * A file, folder, sheet, column or element name from the export, as the
 * profile may show it: in clear when it looks like a schema label, masked
 * when it looks like personal data or when the owner asked for masked labels.
 */
export function exportLabel(name: string, maskAll: boolean): string {
  const clean = name.replace(/[\p{C}]/gu, '?').trim();
  if (maskAll || findPersonalDataLike(clean).length > 0) return maskShape(clean, 60);
  return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean;
}
