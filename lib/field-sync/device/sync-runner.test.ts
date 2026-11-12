import { describe, expect, test } from 'bun:test';

import { registerSender, runSync } from './sync-runner';
import { discardUnsentWork, flushUnsentWork, registerUnsentSource } from './unsent-work';

// The two seams every kind of unsent work plugs into
// (werk-flow/werkflow-planning#319): the runner sends in the registered
// order, and a session ends only over what the sources say is left.

/** A promise the test settles by hand, so two passes can overlap without a clock. */
function gate(): { opened: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

describe('the sync runner', () => {
  test('senders run in the order they registered, one after the other, and a failing one does not stop the next', async () => {
    const order: string[] = [];
    const first = gate();
    registerSender('time', async () => {
      order.push('time starts');
      await first.opened;
      order.push('time ends');
      throw new Error('the device storage failed');
    });
    registerSender('drafts', async () => {
      order.push('drafts');
    });

    const pass = runSync();
    await Promise.resolve();
    expect(order).toEqual(['time starts']);
    first.open();
    await pass;

    expect(order).toEqual(['time starts', 'time ends', 'drafts']);
  });

  test('a trigger during a pass sends once more after it, so work kept meanwhile is not left for the next trigger', async () => {
    let sends = 0;
    const held = gate();
    registerSender('time', async () => {
      sends += 1;
      if (sends === 1) await held.opened;
    });
    registerSender('drafts', async () => undefined);

    const pass = runSync();
    const during = runSync();
    const again = runSync();
    held.open();
    await Promise.all([pass, during, again]);

    expect(sends).toBe(2);
  });

  test('a sender registered again under its name replaces the first', async () => {
    const sent: string[] = [];
    registerSender('time', async () => void sent.push('old'));
    registerSender('time', async () => void sent.push('new'));
    registerSender('drafts', async () => void sent.push('drafts'));

    await runSync();

    expect(sent).toEqual(['new', 'drafts']);
  });
});

describe('unsent work before a session ends', () => {
  test('a flush sends every source and names what is left, in the sources’ order, without empty lines', async () => {
    const left = { time: 2, drafts: 1 };
    registerUnsentSource({
      name: 'time',
      summarize: async () => [
        { label: 'Stempelzeiten', count: left.time, ids: ['t1', 't2'].slice(0, left.time) },
      ],
      flush: async () => {
        left.time = 0;
      },
      discard: async () => undefined,
    });
    registerUnsentSource({
      name: 'drafts',
      summarize: async () => [{ label: 'Berichte', count: left.drafts, ids: ['d1'].slice(0, left.drafts) }],
      flush: async () => {
        throw new Error('no signal');
      },
      discard: async () => {
        left.drafts = 0;
      },
    });

    const shown = await flushUnsentWork();
    expect(shown).toEqual([{ label: 'Berichte', count: 1, ids: ['d1'] }]);
    expect(await discardUnsentWork(shown)).toEqual([]);
  });

  test('a source that cannot say what it holds fails the check: the session must not end over unread work', async () => {
    registerUnsentSource({
      name: 'time',
      summarize: async () => {
        throw new Error('the device storage failed');
      },
      flush: async () => undefined,
      discard: async () => undefined,
    });

    await expect(flushUnsentWork()).rejects.toThrow('the device storage failed');
  });
});
