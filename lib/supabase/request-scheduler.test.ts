import { expect, test } from 'bun:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequestScheduler, type RequestPriority } from './request-scheduler';

test('background queries leave capacity for foreground requests and queued cancellation never starts work', async () => {
  const schedule = createRequestScheduler(3, 1);
  const starts: string[] = [];
  function held(name: string, priority: RequestPriority) {
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<string>();
    const result = schedule(priority, controller.signal, () => { starts.push(name); started.resolve(); return release.promise; });
    return { controller, started: started.promise, result, complete: () => release.resolve(name) };
  }
  const background = held('background', 'background');
  const queued = held('cancelled-background', 'background');
  const foreground = held('foreground', 'foreground');
  const otherForeground = held('other-foreground', 'foreground');
  const urgent = held('queued-foreground', 'foreground');
  await Promise.all([background.started, foreground.started, otherForeground.started]);
  expect(starts).toEqual(['background', 'foreground', 'other-foreground']);
  const cancellation = queued.result.catch((error: unknown) => error);
  queued.controller.abort(new Error('cancelled'));
  expect(await cancellation).toEqual(new Error('cancelled'));
  foreground.complete();
  await urgent.started;
  expect(starts).toEqual(['background', 'foreground', 'other-foreground', 'queued-foreground']);
  background.complete(); otherForeground.complete(); urgent.complete();
  await Promise.all([background.result, foreground.result, otherForeground.result, urgent.result]);
});

test('failed operations release capacity, aborted requests reject, and unrelated work continues', async () => {
  const schedule = createRequestScheduler(1, 1);
  const failed = schedule('foreground', new AbortController().signal, () => { throw new Error('backend failed'); });
  const next = schedule('background', new AbortController().signal, async () => 'available');
  await expect(failed).rejects.toThrow('backend failed');
  expect(await next).toBe('available');
  const controller = new AbortController();
  controller.abort(new Error('expired'));
  let invoked = false;
  await expect(schedule('foreground', controller.signal, async () => { invoked = true; })).rejects.toThrow('expired');
  expect(invoked).toBe(false);
  expect(() => createRequestScheduler(0, 1)).toThrow();
  expect(() => createRequestScheduler(2, 3)).toThrow();
});

test('queued work resumes with its own request context after another caller releases capacity', async () => {
  const scope = new AsyncLocalStorage<string>();
  const schedule = createRequestScheduler(1, 1);
  const release = Promise.withResolvers<string | undefined>();
  const first = scope.run('first-caller', () => schedule('foreground', new AbortController().signal, () => release.promise));
  const second = scope.run('second-caller', () => schedule('background', new AbortController().signal, async () => scope.getStore()));
  release.resolve('first');
  await first;
  expect(await second).toBe('second-caller');
});

test('a waiting background read progresses despite a sustained foreground backlog', async () => {
  const schedule = createRequestScheduler(2, 1);
  const release = Promise.withResolvers<void>();
  const starts: string[] = [];
  const initial = Array.from({ length: 2 }, () => schedule('foreground', new AbortController().signal, () => release.promise));
  const foreground = Array.from({ length: 10 }, (_, index) => schedule('foreground', new AbortController().signal, async () => { starts.push(`foreground-${index}`); }));
  const background = schedule('background', new AbortController().signal, async () => { starts.push('background'); });
  release.resolve();
  await Promise.all([...initial, ...foreground, background]);
  expect(starts.indexOf('background')).toBeLessThan(2);
  expect(starts.length).toBe(11);
});
