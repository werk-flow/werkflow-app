import { expect, test } from 'bun:test';

import { offerSendBlocker } from './types';

const position = { kind: 'text' };

test('the preview offers sending only for a draft with a Position that is valid today', () => {
  const cases: Array<[string, Parameters<typeof offerSendBlocker>[0], ReturnType<typeof offerSendBlocker>]> =
    [
      ['no Titel', { sections: [], validUntil: '2037-12-31' }, 'offer_empty'],
      ['only an empty Titel', { sections: [{ positions: [] }], validUntil: '2037-12-31' }, 'offer_empty'],
      [
        'valid until yesterday',
        { sections: [{ positions: [position] }], validUntil: '2037-11-19' },
        'offer_expired',
      ],
      ['valid until today', { sections: [{ positions: [position] }], validUntil: '2037-11-20' }, null],
      [
        'a Position in a later Titel',
        { sections: [{ positions: [] }, { positions: [position] }], validUntil: '2037-12-31' },
        null,
      ],
    ];
  for (const [label, offer, expected] of cases)
    expect(offerSendBlocker(offer, '2037-11-20'), label).toBe(expected);
});
