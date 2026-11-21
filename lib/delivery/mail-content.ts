import { escapeHtml } from '@/lib/format/html';

// The parts of a document mail the delivery builds from stored values: the
// HTML of the office's text and the From header. Both run on every attempt,
// so they are pure: a retry sends the same message under the same key.

/** The mail's HTML: the office's text, escaped, its blank lines as paragraphs. */
export function deliveryHtml(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replaceAll('\n', '<br>')}</p>`)
    .join('\n');
}

const ADDRESS_IN_SENDER = /<([^<>\s]+@[^<>\s]+)>\s*$/;
const BARE_ADDRESS = /^[^<>\s]+@[^<>\s]+$/;

/**
 * The company name over WerkFlow's sending address (`FROM_EMAIL`), quoted
 * for the header; none without a sending address, so the transport answers
 * what it lacks.
 */
export function senderHeader(
  companyName: string,
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const configured = environment.FROM_EMAIL?.trim() ?? '';
  const address =
    ADDRESS_IN_SENDER.exec(configured)?.[1] ?? (BARE_ADDRESS.test(configured) ? configured : '');
  if (!address) return undefined;
  const name = companyName.replaceAll(/[\p{Cc}"\\\s]+/gu, ' ').trim();
  return name ? `"${name}" <${address}>` : address;
}
