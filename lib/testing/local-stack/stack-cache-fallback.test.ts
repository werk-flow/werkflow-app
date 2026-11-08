// Rule test: a cache service error never fails the CI stack start. The stack's cached images and
// environment are a speed-up; on a failed restore the step continues as a miss and `supabase
// start` pulls from the registry (.github/actions/local-stack/action.yml).
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const action = readFileSync(
  join(resolve(import.meta.dir, '../../..'), '.github/actions/local-stack/action.yml'),
  'utf8',
);

/** The YAML text of the composite step with this name, up to the next step. */
function step(name: string): string {
  const start = action.indexOf(`- name: ${name}\n`);
  expect(start, name).toBeGreaterThan(-1);
  const next = action.indexOf('\n    - name: ', start + 1);
  return action.slice(start, next === -1 ? undefined : next);
}

test('every cache restore of the stack continues as a miss when the cache service fails', () => {
  const restores = action.match(/uses: actions\/cache\/restore@/g) ?? [];
  expect(restores.length).toBe(2);
  for (const name of ['Restore the stack environment', 'Restore the stack images'])
    expect(step(name), name).toContain('continue-on-error: true');
  // A failed restore reports no hit, so the images are pulled, not loaded from a partial file.
  expect(step('Load the stack images')).toContain("steps.images.outputs.cache-hit == 'true'");
});
