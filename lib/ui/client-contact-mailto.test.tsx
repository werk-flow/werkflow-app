import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ClientContactsCard } from '@/components/kunden/client-contacts-card';
import type { ClientContact } from '@/lib/clients/types';

const createdAt = '2026-10-01T08:00:00.000Z';

function contactWithEmail(email: string): ClientContact {
  return {
    id: 'contact-1',
    organizationId: 'organization-1',
    clientId: 'client-1',
    name: 'Petra Pohl',
    role: null,
    email,
    phone: null,
    notes: null,
    isPrimary: true,
    isActive: true,
    createdBy: null,
    createdAt,
    updatedAt: createdAt,
  };
}

/** The contacts card's markup for one stored email. */
function renderedCard(email: string): string {
  return renderToStaticMarkup(
    <ClientContactsCard
      activeContacts={[contactWithEmail(email)]}
      inactiveContacts={[]}
      isAdminOrManager
      isPendingRow={() => false}
      onRequestContact={undefined}
      isCheckingContact={undefined}
      onAddContact={() => {}}
      onEditContact={() => {}}
      onToggleContactActive={() => {}}
    />,
  );
}

const mailtoHrefs = (markup: string): string[] =>
  [...markup.matchAll(/href="(mailto:[^"]*)"/g)].map((match) => match[1] ?? '');

describe('a contact mail link opens only for one address, and addresses exactly that one', () => {
  test.each(['petra.pohl@example.de', 'max+service@example.de'])(
    'stored address %p is the one recipient',
    (email) => {
      const [href, ...others] = mailtoHrefs(renderedCard(email));
      expect(others).toEqual([]);
      const url = new URL(href ?? '');
      expect(url.protocol).toBe('mailto:');
      expect(url.search).toBe('');
      expect(decodeURIComponent(url.pathname)).toBe(email);
    },
  );

  test('a plain address stays readable in the link', () => {
    expect(mailtoHrefs(renderedCard('petra.pohl@example.de'))).toEqual(['mailto:petra.pohl@example.de']);
  });

  test.each([
    'erste@example.de, zweite@example.de',
    'name@example.de?x',
    'name@example.de&x',
    'name@example.de#x',
    'name@example.de%0A',
    'kein Postfach',
  ])('stored text %p that is not one address shows as text without a mail link', (email) => {
    const markup = renderedCard(email);
    expect(mailtoHrefs(markup)).toEqual([]);
    expect(markup).toContain(email.replaceAll('&', '&amp;'));
  });
});
