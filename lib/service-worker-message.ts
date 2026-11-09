/**
 * The message public/sw.js answers by filling its offline shell again when it
 * is missing. The app shell sends it on mount, the organization switch after
 * it cleared the caches (lib/security/service-worker.test.ts pins both sides).
 * It lives outside lib/offline/ because the app shell imports it statically.
 */
export const SHELL_REFILL_MESSAGE = 'werkflow:refill-shell';
