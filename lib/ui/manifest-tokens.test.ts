import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import manifest from '@/app/manifest';

// Tier 2: the installed app's splash and title bar take the light theme's page
// background token, so a token change cannot leave the manifest behind.
const root = join(import.meta.dir, '..', '..');
const stylesheet = readFileSync(join(root, 'app/globals.css'), 'utf8');

test('the manifest colors are the light theme background token', () => {
  const lightTheme = stylesheet.match(/:root\s*\{([^}]+)\}/)?.[1] ?? '';
  const background = lightTheme.match(/--background:\s*(#[\da-f]{6});/i)?.[1];
  expect(background).toBeDefined();
  const { background_color, theme_color } = manifest();
  expect(background_color).toBe(background);
  expect(theme_color).toBe(background);
});

test('every manifest icon exists under public/ with its declared size, maskable included', () => {
  const icons = manifest().icons ?? [];
  expect(icons.map((icon) => icon.purpose)).toContain('maskable');
  for (const icon of icons) {
    const png = readFileSync(join(root, 'public', icon.src));
    // The PNG header stores width and height as big-endian integers at bytes 16 and 20.
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes ?? '');
  }
});
