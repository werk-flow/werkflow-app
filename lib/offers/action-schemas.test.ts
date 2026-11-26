import { expect, test } from 'bun:test';
import { saveOfferContentSchema } from './action-schemas';

const save = (description: string, count: number) => ({
  offerId: '96000000-0000-4000-8000-000000000001',
  expectedContentVersion: 1,
  attemptKey: '96000000-0000-4000-8000-000000000002',
  sections: [
    {
      title: 'Vorbemerkungen',
      positions: Array.from({ length: count }, () => ({ kind: 'text', name: 'Hinweis', description })),
    },
  ],
});

// A caller without the editor meets the editor's byte limit too: otherwise an
// offer could be saved that the editor then refuses to save again.
test('a content save above the editor byte limit is refused for every caller', () => {
  expect(
    saveOfferContentSchema.safeParse(save('Ausführung nach Herstellerangabe. '.repeat(30), 80)).success,
  ).toBe(true);
  expect(saveOfferContentSchema.safeParse(save('x'.repeat(4000), 240)).success).toBe(false);
});
