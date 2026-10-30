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
