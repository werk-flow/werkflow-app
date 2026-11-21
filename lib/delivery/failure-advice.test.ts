import { expect, test } from 'bun:test';
import { deliveryFailureAdvice } from './failure-advice';

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
