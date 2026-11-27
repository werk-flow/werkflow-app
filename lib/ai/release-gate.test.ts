import { afterEach, expect, test } from 'bun:test';

const { isAiReleasedFor } = await import('./release-gate');

const RELEASED = '0a000001-0000-4000-8000-000000000001';
const OTHER = '0a000002-0000-4000-8000-000000000002';
const original = process.env.AI_ORGANIZATION_IDS;

afterEach(() => {
  if (original === undefined) delete process.env.AI_ORGANIZATION_IDS;
  else process.env.AI_ORGANIZATION_IDS = original;
});

test('no organization is released while the list is unset or empty', () => {
  delete process.env.AI_ORGANIZATION_IDS;
  expect(isAiReleasedFor(RELEASED)).toBe(false);
  process.env.AI_ORGANIZATION_IDS = '';
  expect(isAiReleasedFor(RELEASED)).toBe(false);
});

test('only a listed organization id is released, whatever its spacing and case', () => {
  process.env.AI_ORGANIZATION_IDS = ` ${RELEASED.toUpperCase()} , not-an-id`;
  expect(isAiReleasedFor(RELEASED)).toBe(true);
  expect(isAiReleasedFor(OTHER)).toBe(false);
  expect(isAiReleasedFor('not-an-id')).toBe(false);
});
