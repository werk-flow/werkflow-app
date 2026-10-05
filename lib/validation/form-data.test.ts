import { expect, test } from 'bun:test';
import { z } from 'zod';

import { parseFormData } from './form-data';

function form(entries: readonly (readonly [string, string])[]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

test('a field named like an Object.prototype key is an ordinary field', () => {
  const schema = z.object({ constructor: z.string(), toString: z.string() });
  const data = form([
    ['constructor', 'a'],
    ['toString', 'b'],
  ]);
  expect(parseFormData(data, schema)).toBe(data);
});

test('a field sent twice is refused', () => {
  const schema = z.object({ name: z.string() });
  expect(
    parseFormData(
      form([
        ['name', 'a'],
        ['name', 'b'],
      ]),
      schema,
    ),
  ).toBeNull();
});
