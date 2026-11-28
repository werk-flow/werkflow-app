// Whether a stored upload's first bytes belong to the type it was uploaded as
// (werk-flow/werkflow-planning#534). Storage keeps the type the browser named,
// so the finalize checks the bytes before it registers the file.

const ascii = (text: string): number[] => Array.from(text, (character) => character.charCodeAt(0));

/** The leading bytes of each allowed type; null stands for a byte of any value. */
const SIGNATURES = new Map<string, readonly (number | null)[]>([
  ['application/pdf', ascii('%PDF-')],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  // A RIFF container of four length bytes whose form is WEBP.
  ['image/webp', [...ascii('RIFF'), null, null, null, null, ...ascii('WEBP')]],
]);

/** True when `bytes` start with the signature of `mimeType`; false for any other type. */
export function hasSignatureOf(bytes: Uint8Array, mimeType: string): boolean {
  const signature = SIGNATURES.get(mimeType);
  return (
    signature !== undefined &&
    bytes.length >= signature.length &&
    signature.every((byte, index) => byte === null || bytes[index] === byte)
  );
}
