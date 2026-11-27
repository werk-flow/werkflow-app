import { expect, test } from 'bun:test';

import type { AiChatMessage, AiQuestionRow, AiThreadEntry, AiToolRow } from '@/lib/ai/thread-types';
import { questionAnswer, rowRunning, timelineOrder, toolDetailLines } from '@/lib/ui/ki-rows';

const message = (key: string, sequence: number, patch: Partial<AiChatMessage> = {}): AiChatMessage => ({
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

test('a question waits for an answer until a message follows it, and then shows that message', () => {
  const asked = question('c1:tool:1', 3);
  const thread: AiThreadEntry[] = [message('c1:user', 1), message('c1:assistant', 2), asked];
  expect(questionAnswer(thread, asked)).toBe('open');
  expect(questionAnswer([...thread, message('c2:user', 4, { text: 'Müller Bau' })], asked)).toEqual({
    answered: 'Müller Bau',
  });
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
          einsatzorte: [],
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
      { text: 'Müller Haustechnik · K-1001', href: '/kunden/34000000-0000-4000-8000-000000000001' },
      { text: 'Fremd', href: null },
    ],
    total: 12,
  });
});
