import { describe, expect, test } from 'bun:test';

import { contactCustomerLine } from '@/components/auftraege/work-pack/contact-customer-line';

describe('the work pack contact names a person once', () => {
  test('a private customer who is their own contact gets no second name line', () => {
    expect(contactCustomerLine('Erika Muster', 'Erika Muster')).toBeNull();
    expect(contactCustomerLine('Erika  Muster ', 'erika muster')).toBeNull();
  });

  test('a business customer stays under the contact person', () => {
    expect(contactCustomerLine('Erika Muster', 'Muster Hausverwaltung GmbH')).toBe(
      'Muster Hausverwaltung GmbH',
    );
  });

  test('without a contact the customer is already the headline, so no second line', () => {
    expect(contactCustomerLine(null, 'Muster Hausverwaltung GmbH')).toBeNull();
    expect(contactCustomerLine('Erika Muster', null)).toBeNull();
  });
});
