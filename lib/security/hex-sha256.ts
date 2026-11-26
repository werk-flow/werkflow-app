import { createHash } from 'node:crypto';

/** The SHA-256 of `bytes` in lowercase hex, as pinned checksums are written. */
export const hexSha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
