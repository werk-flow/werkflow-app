import { expect, test } from 'bun:test';

import { KI_LIVE_PROTOCOL, type KiLiveEvent } from '@/lib/ai/live/events';
import {
  applyKiLiveEvents,
  fresherMessage,
  kiLiveCursor,
  kiLiveGapFillable,
  mergeNewer,
} from '@/lib/ai/live/follow';
import type { AiChatMessage, AiThreadWindow } from '@/lib/ai/thread-types';

const command = 'c1';
const v = KI_LIVE_PROTOCOL;
const started: KiLiveEvent = {
  v,
  type: 'started',
  command,
  user: { sequence: 3, text: 'Wie entlüfte ich?' },
  answer: { sequence: 4 },
};
const text = (at: number, delta: string, saved = 0): KiLiveEvent => ({
  v,
  type: 'text',
  command,
  at,
  delta,
  saved,
});
const end = (length: number): KiLiveEvent => ({
  v,
  type: 'end',
  command,
  status: 'complete',
  failure: null,
  length,
});

const message = (key: string, sequence: number, patch: Partial<AiChatMessage> = {}): AiChatMessage => ({
  key,
  sequence,
  role: 'assistant',
  status: 'complete',
  text: '',
  failure: null,
  ...patch,
});
const earlier: AiThreadWindow = {
  hasOlder: false,
  messages: [
    message('c0:user', 1, { role: 'user', text: 'Hallo' }),
    message('c0:assistant', 2, { text: 'Hi' }),
  ],
};
/** One event through the page's apply step: `applied` when nothing of it waits for a read. */
function applyKiLiveEvent(
  window: AiThreadWindow,
  event: KiLiveEvent,
): { window: AiThreadWindow; applied: boolean } {
  const result = applyKiLiveEvents(window, [event]);
  return { window: result.window, applied: result.held.length === 0 };
}
const answerOf = (window: AiThreadWindow): AiChatMessage | undefined =>
  window.messages.find((entry) => entry.key === `${command}:assistant`);

test('a started turn adds the message and an empty answer in sequence order, once', () => {
  const { window } = applyKiLiveEvent(earlier, started);
  expect(window.messages.map((entry) => [entry.key, entry.sequence, entry.status])).toEqual([
    ['c0:user', 1, 'complete'],
    ['c0:assistant', 2, 'complete'],
    ['c1:user', 3, 'complete'],
    ['c1:assistant', 4, 'streaming'],
  ]);
  expect(applyKiLiveEvent(window, started).window, 'a repeated start must change nothing').toBe(window);
});

test('text extends the answer at its offset; text the page holds changes nothing; an overlap adds only the rest', () => {
  let window = applyKiLiveEvent(earlier, started).window;
  window = applyKiLiveEvent(window, text(0, 'Erst ')).window;
  window = applyKiLiveEvent(window, text(5, 'das Ventil')).window;
  expect(answerOf(window)?.text).toBe('Erst das Ventil');
  expect(applyKiLiveEvent(window, text(5, 'das')).window, 'repeated text must not render again').toBe(window);
  window = applyKiLiveEvent(window, text(9, 'Ventil öffnen')).window;
  expect(answerOf(window)?.text).toBe('Erst das Ventil öffnen');
});

test('text past a gap is not applied, and a read from the cursor lets it apply', () => {
  const window = applyKiLiveEvent(earlier, started).window;
  const late = text(16, 'öffnen', 16);
  const gap = applyKiLiveEvent(window, late);
  expect(gap.applied, 'text past what the page holds must wait for a read').toBe(false);
  expect(gap.window).toBe(window);
  const snapshot: AiThreadWindow = {
    hasOlder: false,
    messages: [message(`${command}:assistant`, 4, { status: 'streaming', text: 'Erst das Ventil ' })],
  };
  const result = applyKiLiveEvents(mergeNewer(window, snapshot), [late]);
  expect(result.held).toEqual([]);
  expect(answerOf(result.window)?.text).toBe('Erst das Ventil öffnen');
});

test('an end applies only when the page holds the whole answer; otherwise the saved answer is read', () => {
  let window = applyKiLiveEvent(earlier, started).window;
  window = applyKiLiveEvent(window, text(0, 'Fertig.')).window;
  expect(applyKiLiveEvent(window, end(12)).applied, 'an end with text the page missed must be read').toBe(
    false,
  );
  const ended = applyKiLiveEvent(window, end(7)).window;
  expect(answerOf(ended)?.status).toBe('complete');
  expect(applyKiLiveEvent(ended, text(7, ' Noch was')).window, 'a finished answer takes no more text').toBe(
    ended,
  );
});

test('a turn that starts past messages the page never saw waits for a read, so the cursor does not skip them', () => {
  const later: KiLiveEvent = {
    ...started,
    user: { sequence: 5, text: 'Noch was?' },
    answer: { sequence: 6 },
  };
  expect(applyKiLiveEvent(earlier, later).applied).toBe(false);
  expect(kiLiveCursor(earlier), 'the catch-up starts at the first message the page lacks').toBe(3);
});

test('a retried command whose answer lands past a missing sequence waits for a read', () => {
  const held: AiThreadWindow = { hasOlder: false, messages: [message('c1:user', 1, { role: 'user' })] };
  const retried: KiLiveEvent = {
    ...started,
    user: { sequence: 1, text: 'Wie entlüfte ich?' },
    answer: { sequence: 3 },
  };
  expect(applyKiLiveEvent(held, retried).applied).toBe(false);
  expect(applyKiLiveEvent(held, { ...retried, answer: { sequence: 2 } }).applied).toBe(true);
});

test('text for an answer the page never saw waits for a read', () => {
  expect(applyKiLiveEvent(earlier, text(0, 'Erst')).applied).toBe(false);
});

test('a read never takes back a finished answer or shortens one still being written', () => {
  const writing = message('a', 4, { status: 'streaming', text: 'Erst das Ventil' });
  const older = message('a', 4, { status: 'streaming', text: 'Erst das' });
  expect(fresherMessage(writing, older), 'an older snapshot must not shorten the answer').toBe(writing);
  const finished = message('a', 4, { text: 'Erst das Ventil öffnen.' });
  expect(fresherMessage(finished, writing), 'a snapshot must not reopen a finished answer').toBe(finished);
  expect(fresherMessage(writing, finished)).toBe(finished);
  expect(fresherMessage(writing, { ...writing }), 'an unchanged message keeps its object').toBe(writing);
});

test('the cursor starts at the first answer still being written, else after the last message', () => {
  expect(kiLiveCursor(null)).toBe(1);
  expect(kiLiveCursor(earlier)).toBe(3);
  expect(kiLiveCursor(applyKiLiveEvent(earlier, started).window)).toBe(4);
});

test('the cursor stops at the first sequence missing between held messages, even when a later turn settled', () => {
  const later: AiThreadWindow = {
    hasOlder: false,
    messages: [...earlier.messages, message('c5:user', 5, { role: 'user' }), message('c5:assistant', 6)],
  };
  expect(kiLiveCursor(later)).toBe(3);
});

test('a new turn that starts while an older answer still shows as written asks for one catch-up', () => {
  const stuck: AiThreadWindow = {
    hasOlder: false,
    messages: [message('c0:user', 1, { role: 'user' }), message('c0:assistant', 2, { status: 'streaming' })],
  };
  expect(applyKiLiveEvents(stuck, [started]).stale).toBe(true);
  expect(applyKiLiveEvents(earlier, [started]).stale).toBe(false);
});

test('a catch-up keeps every message the page holds and adds the newer ones', () => {
  const merged = mergeNewer(earlier, {
    hasOlder: false,
    messages: [message('c1:user', 3, { role: 'user' })],
  });
  expect(merged.messages.map((entry) => entry.key)).toEqual(['c0:user', 'c0:assistant', 'c1:user']);
  expect(mergeNewer(earlier, { hasOlder: false, messages: [] }).messages).toEqual(earlier.messages);
});

test('a gap is read only once the partial save covers it, and an end is read at once', () => {
  expect(kiLiveGapFillable([])).toBe(false);
  expect(
    kiLiveGapFillable([text(40, 'x', 20), text(41, 'y', 30)]),
    'a save short of the gap cannot fill it',
  ).toBe(false);
  expect(kiLiveGapFillable([text(40, 'x', 20), text(41, 'y', 41)])).toBe(true);
  expect(kiLiveGapFillable([text(40, 'x', 20), end(42)])).toBe(true);
});
