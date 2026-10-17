/**
 * The waits of the browser tests that may outlast the configured expect
 * timeout (10 s, `expect.timeout` in playwright*.config.ts). Every other wait
 * uses the configured default or a shorter literal:
 * `playwright-spec/bounded-timeout` refuses a longer literal and a constant
 * from any other module. Each entry names its slow operation and the evidence
 * for its length. The list only shrinks: lib/testing/spec-support/timeout-registry.test.ts
 * pins every entry, so a new or longer wait changes that pin in review.
 */

/**
 * A document upload: the browser sends the bytes to object storage, then the
 * server records the file and the dialog reports it complete. The archived
 * local runs took up to 15 s; the cloud bucket is slower.
 */
export const DOCUMENT_UPLOAD_TIMEOUT_MS = 60_000;

/**
 * The Aufgaben overview after a navigation: it reads every task, approval and
 * notification source of the person before it marks itself loaded. The
 * archived local runs took up to 7 s, and 4 s at the 95th percentile.
 */
export const TASK_OVERVIEW_READ_TIMEOUT_MS = 20_000;
