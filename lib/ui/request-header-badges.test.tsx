import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { RequestHeaderBadges } from '@/components/anfragen/request-badges';
import type { RequestStatus } from '@/lib/requests/types';

const STATUSES: RequestStatus[] = ['offen', 'in_klaerung', 'umgewandelt', 'geschlossen', 'hinzugefuegt'];

// PageHeader wraps each top-level badge on its own, so a status and an urgency
// pill rendered side by side could split across two lines. The request header
// hands it one group, which wraps as a whole.
describe('request header pills', () => {
  for (const status of STATUSES) {
    test(`status ${status} and urgency render inside one wrap group`, () => {
      const html = renderToStaticMarkup(<RequestHeaderBadges status={status} urgency="hoch" />);
      const group = /^<span class="([^"]*)">(.*)<\/span>$/.exec(html);
      expect(group, 'one root element holds both pills').not.toBeNull();
      expect(group?.[1]).toContain('flex');
      expect(group?.[2]).toContain('Hoch');
      expect((group?.[2]?.match(/rounded-full/g) ?? []).length).toBe(2);
    });
  }
});
