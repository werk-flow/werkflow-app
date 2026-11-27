import { expect, test } from 'bun:test';
import type { DeliveryEntry } from './delivery-types';
import { deliveryFailureAdvice, pastDeliveryOutcome, priorEmailAdvice } from './failure-advice';

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

test('a past delivery names no step, since a cancelled invoice is never sent again', () => {
  for (const failureCode of [
    'email_not_configured',
    'email_provider_422',
    'email_provider_unreachable',
    null,
  ]) {
    const outcome = pastDeliveryOutcome({ failureCode, outcomeUnknown: false });
    expect(outcome).not.toContain('Versuche');
    expect(outcome).not.toContain('senden');
  }
  expect(deliveryFailureAdvice('email_not_configured')).toBe(
    'Der E-Mail-Versand war nicht eingerichtet. Versuche es später erneut.',
  );
});

test('a past delivery keeps its last reason and says when an earlier attempt may have reached the customer', () => {
  expect(pastDeliveryOutcome({ failureCode: 'email_provider_503', outcomeUnknown: true })).toBe(
    'Ob die E-Mail rausging, ist unklar: Ein früherer Versuch blieb ohne klare Antwort. Letzter Versuch: Die E-Mail ist nicht rausgegangen.',
  );
  // The last attempt itself got no usable answer: its reason already says so, once.
  expect(pastDeliveryOutcome({ failureCode: 'email_provider_invalid_response', outcomeUnknown: true })).toBe(
    'Der Mailanbieter hat nicht geantwortet. Ob die E-Mail rausging, ist unklar.',
  );
});

const email = (
  state: DeliveryEntry['state'],
  failureCode: string | null,
  outcomeUnknown = false,
): DeliveryEntry => ({
  id: '00000000-0000-4000-8000-000000000001',
  channel: 'email',
  state,
  recipient: 'erika.musterfrau@example.com',
  subject: 'Rechnung RE-2037-0001',
  note: '',
  attempts: 1,
  failureCode,
  outcomeUnknown,
  createdAt: '2037-11-21T09:00:00.000Z',
  sentAt: state === 'sent' ? '2037-11-21T09:00:05.000Z' : null,
  createdBy: 'Erika Musterfrau',
  retryFrom: null,
  retryUntil: null,
});

test('a new email is warned off an earlier one whose outcome is unknown, never off one known not to have left', () => {
  // The provider may have taken the mail without answering, or answered without an id.
  for (const code of ['email_provider_unreachable', 'email_provider_invalid_response']) {
    const advice = priorEmailAdvice([email('failed', code, true)]);
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

test('an earlier attempt whose outcome is unknown still warns after a retry failed before the provider', () => {
  // Attempt 1 got no answer; attempt 2 could not read the original and never reached the provider.
  const advice = priorEmailAdvice([email('failed', 'attachment_unavailable', true)]);
  expect(advice).toContain('an erika.musterfrau@example.com rausging, ist unklar.');
  // A later attempt that went out reads as sent.
  expect(priorEmailAdvice([email('sent', null, true)])).toContain('Zuletzt ging sie am');
});
