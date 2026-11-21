import { expect, test } from 'bun:test';
import type { DeliveryEntry } from './delivery-types';
import { deliveryFailureAdvice, priorEmailAdvice } from './failure-advice';

// A failed send names the step that helps. Tier 2.

test('a mail the provider refused points to a new email, since the retry repeats the stored address', () => {
  for (const code of ['email_validation_error', 'email_provider_422']) {
    const advice = deliveryFailureAdvice(code, 'Unter „Versand“ kannst du sie erneut senden.');
    expect(advice).toContain('„Per E-Mail senden“');
    expect(advice).not.toContain('erneut senden');
  }
  expect(deliveryFailureAdvice('email_provider_503', 'Unter „Versand“ kannst du sie erneut senden.')).toBe(
    'Die E-Mail ist nicht rausgegangen. Unter „Versand“ kannst du sie erneut senden.',
  );
  expect(deliveryFailureAdvice('attachment_unavailable')).toBe('Das Original war gerade nicht lesbar.');
});

const email = (state: DeliveryEntry['state'], failureCode: string | null): DeliveryEntry => ({
  id: '00000000-0000-4000-8000-000000000001',
  channel: 'email',
  state,
  recipient: 'erika.musterfrau@example.com',
  subject: 'Rechnung RE-2037-0001',
  note: '',
  attempts: 1,
  failureCode,
  createdAt: '2037-11-21T09:00:00.000Z',
  sentAt: state === 'sent' ? '2037-11-21T09:00:05.000Z' : null,
  createdBy: 'Erika Musterfrau',
  retryFrom: null,
  retryUntil: null,
});

test('a new email is warned off an earlier one whose outcome is unknown, never off one known not to have left', () => {
  // The provider may have taken the mail without answering, or answered without an id.
  for (const code of ['email_provider_unreachable', 'email_provider_invalid_response']) {
    const advice = priorEmailAdvice([email('failed', code)]);
    expect(advice).toContain('an erika.musterfrau@example.com rausging, ist unklar.');
    expect(advice).toContain('Frag am besten beim Kunden nach');
  }
  expect(priorEmailAdvice([email('sending', null)])).toContain('ist unklar.');
  // Refused or never handed over: a new email cannot duplicate it.
  for (const code of ['email_provider_503', 'email_validation_error', 'attachment_changed', null]) {
    expect(priorEmailAdvice([email('failed', code)])).toBeNull();
  }
  // The newest email that may have left decides, past a known failure.
  expect(priorEmailAdvice([email('failed', 'email_provider_503'), email('sent', null)])).toContain(
    'Zuletzt ging sie am',
  );
});
