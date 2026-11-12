// Text encoding of an export file. German Windows exports are often
// Windows-1252 without a byte order mark, so bytes that are not valid UTF-8
// are read as Windows-1252, a superset of ISO-8859-1.

type TextEncodingName = 'utf-8' | 'utf-8 with BOM' | 'utf-16le' | 'utf-16be' | 'windows-1252' | 'ascii';

export type DecodedText = { encoding: TextEncodingName; text: string };

/** Decodes the bytes and names the encoding it used. */
export function decodeText(bytes: Uint8Array): DecodedText {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { encoding: 'utf-8 with BOM', text: new TextDecoder('utf-8').decode(bytes.subarray(3)) };
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return { encoding: 'utf-16le', text: new TextDecoder('utf-16le').decode(bytes.subarray(2)) };
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return { encoding: 'utf-16be', text: new TextDecoder('utf-16be').decode(bytes.subarray(2)) };
  if (bytes.every((byte) => byte < 0x80))
    return { encoding: 'ascii', text: new TextDecoder('utf-8').decode(bytes) };
  try {
    return { encoding: 'utf-8', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    // Not valid UTF-8: the German Windows default is the remaining candidate.
    return { encoding: 'windows-1252', text: new TextDecoder('windows-1252').decode(bytes) };
  }
}

/** True when the first bytes look like text rather than a binary format. */
export function looksLikeText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 4096);
  if (head.length === 0) return true;
  if ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff)) return true;
  let control = 0;
  for (const byte of head) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control += 1;
  }
  return control / head.length < 0.01;
}

// Code page 850 (the DOS Latin-1 code page) for bytes 0x80 to 0xFF; bytes
// below 0x80 are ASCII. The WHATWG decoders behind TextDecoder do not know
// it, and DATANORM files are written in it.
const CP850_HIGH_HALF = [
  '\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00f8\u00a3\u00d8\u00d7\u0192',
  '\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u00ae\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb\u2591\u2592\u2593\u2502\u2524\u00c1\u00c2\u00c0\u00a9\u2563\u2551\u2557\u255d\u00a2\u00a5\u2510',
  '\u2514\u2534\u252c\u251c\u2500\u253c\u00e3\u00c3\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u00a4\u00f0\u00d0\u00ca\u00cb\u00c8\u0131\u00cd\u00ce\u00cf\u2518\u250c\u2588\u2584\u00a6\u00cc\u2580',
  '\u00d3\u00df\u00d4\u00d2\u00f5\u00d5\u00b5\u00fe\u00de\u00da\u00db\u00d9\u00fd\u00dd\u00af\u00b4\u00ad\u00b1\u2017\u00be\u00b6\u00a7\u00f7\u00b8\u00b0\u00a8\u00b7\u00b9\u00b3\u00b2\u25a0\u00a0',
].join('');

/** Decodes bytes written in code page 850. Every byte maps to one character. */
export function decodeCp850(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes)
    text += byte < 0x80 ? String.fromCharCode(byte) : CP850_HIGH_HALF.charAt(byte - 0x80);
  return text;
}
