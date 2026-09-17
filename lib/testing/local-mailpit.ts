import { z } from 'zod';
import { isIP } from 'node:net';

const addressSchema = z.object({ Address: z.string().email() });
const messageSummarySchema = z.object({
  ID: z.string().min(1), To: z.array(addressSchema),
  Cc: z.array(addressSchema).nullish(), Bcc: z.array(addressSchema).nullish(),
});
const searchSchema = z.object({ messages: z.array(messageSummarySchema) });
const messageSchema = messageSummarySchema.extend({ Text: z.string(), HTML: z.string() });
export type OwnedMailpitMessage = z.infer<typeof messageSummarySchema>;

/** The local stack uses a private host on Windows; hosted projects never use Mailpit. */
function isLocalHost(address: URL): boolean {
  return address.hostname === 'localhost' || (isIP(address.hostname) === 4 && (
    address.hostname === '127.0.0.1' || /^10\./.test(address.hostname) || /^192\.168\./.test(address.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address.hostname)
  ));
}

export function localMailpitUrl(supabaseUrl: string): URL | null {
  const address = new URL(supabaseUrl);
  if (!isLocalHost(address) || address.protocol !== 'http:' || address.port !== '54321' ||
    address.username || address.password || address.search || address.hash || address.pathname !== '/') return null;
  address.port = '54324';
  return new URL('/', address);
}

function isOwnedMessage(message: OwnedMailpitMessage, recipients: ReadonlySet<string>): boolean {
  const addresses = [...message.To, ...(message.Cc ?? []), ...(message.Bcc ?? [])];
  return addresses.length > 0 && addresses.every((recipient) => recipients.has(recipient.Address.toLowerCase()));
}

async function requestMailpit(baseUrl: URL, path: string, init?: RequestInit): Promise<Response> {
  if (!isLocalHost(baseUrl) || baseUrl.protocol !== 'http:' || baseUrl.port !== '54324' ||
    baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || baseUrl.pathname !== '/') {
    throw new Error('Mailpit requests require the exact local test mailbox origin');
  }
  const response = await fetch(new URL(path, baseUrl), {
    ...init, redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Local Mailpit request failed with HTTP ${response.status}`);
  return response;
}

export async function findOwnedMailpitMessages(baseUrl: URL, emails: readonly string[]): Promise<OwnedMailpitMessage[]> {
  const recipients = new Set(emails.map((email) => z.string().email().parse(email).toLowerCase()));
  const found = new Map<string, OwnedMailpitMessage>();
  for (const email of recipients) {
    const query = new URLSearchParams({ query: `to:"${email}"`, limit: '100' });
    const response = await requestMailpit(baseUrl, `/api/v1/search?${query}`);
    const parsed = searchSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Local Mailpit returned an invalid message inventory');
    for (const message of parsed.data.messages) {
      if (isOwnedMessage(message, recipients)) found.set(message.ID, message);
    }
  }
  return [...found.values()];
}

export async function readOwnedMailpitOtp(baseUrl: URL, messageId: string, recipient: string): Promise<string | null> {
  const response = await requestMailpit(baseUrl, `/api/v1/message/${encodeURIComponent(messageId)}`);
  const parsed = messageSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.ID !== messageId ||
    !isOwnedMessage(parsed.data, new Set([recipient.toLowerCase()]))) {
    throw new Error('Local Mailpit message did not match its exact owned recipient');
  }
  // Match the dedicated code block, never a six-digit CSS color or mail header.
  return parsed.data.HTML.match(/>\s*(\d{6})\s*</)?.[1] ??
    parsed.data.Text.match(/(?:^|\n)\s*(\d{6})\s*(?:\n|$)/)?.[1] ?? null;
}

export async function deleteOwnedMailpitMessages(baseUrl: URL, emails: readonly string[], ids?: readonly string[]): Promise<void> {
  const selectedIds = ids ? new Set(ids) : null;
  // Delete observed, exact-recipient IDs in batches. An empty IDs body would
  // clear the whole mailbox, so it is never sent. Re-read also covers >100 mail.
  for (let batch = 0; batch < 10; batch++) {
    const owned = await findOwnedMailpitMessages(baseUrl, emails);
    const messageIds = owned.map((message) => message.ID).filter((id) => !selectedIds || selectedIds.has(id));
    if (messageIds.length === 0) return;
    await requestMailpit(baseUrl, '/api/v1/messages', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: messageIds }),
    });
  }
  throw new Error('Local Mailpit cleanup exceeded its bounded message batches');
}
