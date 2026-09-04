import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('custom web time input', () => {
  test('does not fall back to a native picker on coarse pointers', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'components/ui/time-input.tsx'),
      'utf8'
    );

    expect(source).not.toContain('type="time"');
    expect(source).not.toContain("matchMedia('(pointer: coarse)')");
  });
});
