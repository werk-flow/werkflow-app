import { expect, test } from 'bun:test';
import { untilPageLeaves } from '../../hooks/use-server-action';

// A task that leaves the page ends with `return untilPageLeaves()`, so the
// owner hook keeps its pending count until the page unmounts and the control
// cannot be used a second time while the next page loads.
test('untilPageLeaves never settles, so the owner hook stays pending while the page leaves', async () => {
  const outcome = await Promise.race([
    untilPageLeaves().then(
      () => 'resolved',
      () => 'rejected',
    ),
    new Promise<string>((resolve) => setImmediate(() => resolve('still pending'))),
  ]);
  expect(outcome).toBe('still pending');
});
