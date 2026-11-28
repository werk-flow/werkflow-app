import { expect, test } from 'bun:test';

import type { AiChatMessage, AiQuestionRow, AiThreadEntry, AiToolRow } from '@/lib/ai/thread-types';
import { questionAnswer, rowRunning, timelineOrder, toolDetailLines } from '@/lib/ui/ki-rows';

type TextMessage = Extract<AiChatMessage, { role: 'user' | 'assistant' }>;

const message = (key: string, sequence: number, patch: Partial<TextMessage> = {}): TextMessage => ({
  key,
  sequence,
  role: key.endsWith(':user') ? 'user' : 'assistant',
  status: 'complete',
  text: '',
  failure: null,
  ...patch,
});
const tool = (key: string, sequence: number, patch: Partial<AiToolRow> = {}): AiToolRow => ({
  key,
  sequence,
  role: 'tool',
  status: 'complete',
  revision: 2,
  label: 'Kunden und Einsatzorte finden',
  control: 'read',
  outcome: 'ok',
  hasDetail: true,
  ...patch,
});
const question = (key: string, sequence: number): AiQuestionRow => ({
  key,
  sequence,
  role: 'question',
  status: 'complete',
  revision: 1,
  question: 'Welchen Kunden meinst du?',
  options: ['Müller Haustechnik', 'Müller Bau'],
});

test("a turn's tool rows stand above its answer, and its question below it", () => {
  const entries: AiThreadEntry[] = [
    message('c1:user', 1),
    message('c1:assistant', 2),
    tool('c1:tool:1', 3),
    question('c1:tool:2', 4),
    message('c2:user', 5),
  ];
  expect(timelineOrder(entries).map((entry) => entry.key)).toEqual([
    'c1:user',
    'c1:tool:1',
    'c1:assistant',
    'c1:tool:2',
    'c2:user',
  ]);
});

test('a question waits for an answer once its turn ended, until a message follows it, and then shows that message', () => {
  const asked = question('c1:tool:1', 3);
  const thread: AiThreadEntry[] = [message('c1:user', 1), message('c1:assistant', 2), asked];
  expect(
    questionAnswer(
      [message('c1:user', 1), message('c1:assistant', 2, { status: 'streaming' }), asked],
      asked,
    ),
  ).toBe('closed');
  expect(questionAnswer(thread, asked)).toBe('open');
  const reply = message('c2:user', 4, { text: 'Müller Bau' });
  expect(questionAnswer([...thread, reply, message('c2:assistant', 5)], asked)).toEqual({
    answered: 'Müller Bau',
  });
  // A reply refused before its turn started leaves the question open, so a tap sends it again.
  expect(questionAnswer([...thread, reply], asked)).toBe('open');
  // A later reply that got its turn answers it, past a refused one.
  const later = message('c3:user', 5, { text: 'Müller Haustechnik' });
  expect(questionAnswer([...thread, reply, later, message('c3:assistant', 6)], asked)).toEqual({
    answered: 'Müller Haustechnik',
  });
  // Two questions of one turn: a reply answers only the latest one before it.
  const second = question('c1:tool:2', 4);
  const both = [...thread, second, message('c2:user', 5, { text: 'Müller Bau' }), message('c2:assistant', 6)];
  expect(questionAnswer(both, asked)).toBe('closed');
  expect(questionAnswer(both, second)).toEqual({ answered: 'Müller Bau' });
  // A question whose asking answer is on an older page has ended its turn.
  expect(questionAnswer([asked], asked)).toBe('open');
  expect(questionAnswer([...thread, question('c1:tool:2', 4)], asked)).toBe('closed');
});

test('a tool row left running by a turn that ended shows as broken off', () => {
  const running = tool('c1:tool:1', 3, { status: 'streaming', revision: 1, outcome: null });
  const answer = message('c1:assistant', 2, { status: 'streaming' });
  expect(rowRunning([answer, running], running)).toBe(true);
  expect(rowRunning([{ ...answer, status: 'failed' }, running], running)).toBe('stopped');
  expect(rowRunning([answer], tool('c1:tool:2', 4))).toBe(false);
});

test('an opened tool row lists its input and records without ids, and links only into the app', () => {
  const lines = toolDetailLines({
    input: { suche: 'Müller' },
    result: {
      kunden: [
        {
          kundeId: '34000000-0000-4000-8000-000000000001',
          name: { source: 'record_text', text: 'Müller Haustechnik' },
          kundennummer: { source: 'record_text', text: 'K-1001' },
          einsatzorte: [{ name: { source: 'record_text', text: 'Heizraum' }, adresse: null }],
          link: '/kunden/34000000-0000-4000-8000-000000000001',
        },
        { name: { source: 'record_text', text: 'Fremd' }, link: 'https://evil.example/k?d=geheim' },
      ],
      gesamt: 12,
    },
  });
  expect(lines).toEqual({
    input: ['suche: Müller'],
    entries: [
      {
        text: 'Müller Haustechnik · K-1001',
        details: ['Heizraum'],
        href: '/kunden/34000000-0000-4000-8000-000000000001',
      },
      { text: 'Fremd', details: [], href: null },
    ],
    total: 12,
  });
});

test('an opened article row names each of its numbers', () => {
  const lines = toolDetailLines({
    result: {
      artikel: [
        {
          name: { source: 'record_text', text: 'Dichtung' },
          bestand: 12,
          verfuegbar: 8,
          lieferanten: [{ artikelnummer: { source: 'record_text', text: 'GC-1' }, packungsmenge: 10 }],
        },
      ],
      gesamt: 1,
    },
  });
  expect(lines.entries).toEqual([
    { text: 'Dichtung · Bestand: 12 · verfügbar: 8', details: ['GC-1 · Packungsmenge: 10'], href: null },
  ]);
});

test('a question shows its first reply by sequence, whatever order the page holds the turns in', () => {
  const asked = question('c1:tool:1', 3);
  // A later turn of another tab landed before this tab's own turn settled.
  const entries: AiThreadEntry[] = [
    message('c1:user', 1),
    message('c1:assistant', 2),
    asked,
    message('c3:user', 6, { text: 'Müller Haustechnik' }),
    message('c3:assistant', 7),
    message('c2:user', 4, { text: 'Müller Bau' }),
    message('c2:assistant', 5),
  ];
  expect(questionAnswer(entries, asked), 'the reply right after the question answers it').toEqual({
    answered: 'Müller Bau',
  });
});
