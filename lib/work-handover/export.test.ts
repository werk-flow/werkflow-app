import { describe, expect, test } from 'bun:test';

import { buildWorkHandoverExport } from './export';

const input = {
  releaseId: '10000000-0000-4000-8000-000000000001',
  target: {
    targetType: 'job' as const,
    targetId: '10000000-0000-4000-8000-000000000002',
    number: 'A-17',
    title: 'Heizung warten',
    customerName: 'Müller & Sohn',
    contactName: 'Erika Muster',
    contactRole: 'Objektleitung',
    contactEmail: 'erika@example.test',
    contactPhone: '+49 30 123456',
    siteName: 'Hauptgebäude',
    siteAddress: 'Werkstraße 1',
  },
  timeSummary: { erfassteEintraege: 4 },
  materialSummary: { materialpositionen: 2 },
  sources: [{ label: 'Arbeitsbericht', customerPayload: { Zusammenfassung: '<fertig>' } }],
};

describe('buildWorkHandoverExport', () => {
  test('renders identical input byte-for-byte and escapes customer content', () => {
    const first = buildWorkHandoverExport(input);
    const second = buildWorkHandoverExport(input);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.html).toContain('Müller &amp; Sohn');
    expect(first.html).toContain('&lt;fertig&gt;');
    expect(first.html).not.toContain('<fertig>');
  });

  test('changes the identity when frozen content changes', () => {
    const first = buildWorkHandoverExport(input);
    const second = buildWorkHandoverExport({
      ...input,
      materialSummary: { materialpositionen: 3 },
    });
    expect(first.contentHash).not.toBe(second.contentHash);
  });

  test('canonicalizes object keys recursively without changing array order', () => {
    const first = buildWorkHandoverExport({
      ...input,
      timeSummary: { b: { second: 2, first: 1 }, a: ['eins', 'zwei'] },
    });
    const reordered = buildWorkHandoverExport({
      ...input,
      timeSummary: { a: ['eins', 'zwei'], b: { first: 1, second: 2 } },
    });
    const reorderedArray = buildWorkHandoverExport({
      ...input,
      timeSummary: { a: ['zwei', 'eins'], b: { first: 1, second: 2 } },
    });
    expect(first.contentHash).toBe(reordered.contentHash);
    expect(first.bytes.equals(reordered.bytes)).toBe(true);
    expect(first.contentHash).not.toBe(reorderedArray.contentHash);
  });
});
