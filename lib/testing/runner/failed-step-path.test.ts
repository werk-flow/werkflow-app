// A failed browser test's record names the action that broke, even under a wrapping error.
import { expect, test } from 'bun:test';
import { failedStepPath } from './failed-step-path';

type Step = Parameters<typeof failedStepPath>[0][number];
const step = (title: string, category: string, failed: boolean, steps: Step[] = []): Step => ({
  title,
  category,
  error: failed ? { message: `${title} failed` } : undefined,
  steps,
});

test('the path runs from the failed test step down to the action that broke', () => {
  const click = "Click getByRole('button', { name: 'Erfassung beenden (fehlt)' })";
  expect(
    failedStepPath([
      step('Before Hooks', 'hook', false),
      step('Declared clock sample 1', 'test.step', true, [
        step("Navigate to '/dashboard'", 'pw:api', false),
        step(click, 'pw:api', true),
      ]),
      step('After Hooks', 'hook', false),
    ]),
  ).toEqual(['Declared clock sample 1', click]);
});

test('a step that failed and was caught earlier, a hook and a fixture never name the break', () => {
  expect(
    failedStepPath([
      step('Expect toBeVisible', 'expect', true),
      step('Save the visit', 'test.step', true),
      step('After Hooks', 'hook', true, [step('fixture: world', 'fixture', true)]),
    ]),
  ).toEqual(['Save the visit']);
  expect(failedStepPath([step('After Hooks', 'hook', true)])).toEqual([]);
});
