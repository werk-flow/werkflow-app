import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const globalsCss = readFileSync(
  resolve(import.meta.dir, '../../app/globals.css'),
  'utf8'
);

test('Tailwind scans only class-bearing application sources', () => {
  expect(globalsCss).toContain("@import 'tailwindcss' source(none);");
  expect(globalsCss).toContain("@source '.';");
  expect(globalsCss).toContain("@source '../components';");
  expect(globalsCss).toContain("@source '../hooks';");
  expect(globalsCss).toContain("@source '../lib';");
  expect(globalsCss).toContain("@source '../proxy.ts';");
});
