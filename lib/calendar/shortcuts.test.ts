import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The `?` overlay is the contract for the calendar's keys (owner review of 2026-09-25: half the list
// did not hold). Every single-character key the overlay lists is a case of the container's handler,
// every case the handler has is listed, and a line that holds in one view only says so.
const root = join(import.meta.dir, '..', '..', 'components', 'kalender');
const help = readFileSync(join(root, 'board', 'shortcuts-help.tsx'), 'utf8');
const container = readFileSync(join(root, 'calendar-container.tsx'), 'utf8');

const listed = [...help.matchAll(/^\s*\['([^']+)', '([^']+)'\],$/gm)].map(([, keys, description]) => ({ keys: keys ?? '', description: description ?? '' }));
const handled = new Set([...container.matchAll(/case '(.)':/g)].map(([, key]) => key ?? ''));

describe('calendar shortcuts', () => {
  test('every listed single key is handled by the container and every handled key is listed', () => {
    const listedKeys = listed.flatMap(({ keys }) => keys.split(' / ').map((key) => key.trim())).filter((key) => key.length === 1);
    expect(listed.length).toBeGreaterThan(8);
    expect(new Set(listedKeys)).toEqual(handled);
  });

  test('a line that holds in one view only names the view', () => {
    const viewBound: Record<string, RegExp> = { '+ / -': /^Nur Tag:/, Pfeiltasten: /^Nur Plantafel:/, 'Alt + Ziehen': /^Nur Plantafel:/ };
    for (const [keys, pattern] of Object.entries(viewBound)) {
      const line = listed.find((entry) => entry.keys === keys);
      expect(line, keys).toBeDefined();
      expect(line?.description).toMatch(pattern);
    }
    // The zoom keys act in the day view only, exactly as the list says.
    expect(container).toMatch(/case '\+': if \(view === 'day'\)/);
    expect(container).toMatch(/case '-': if \(view === 'day'\)/);
  });
});
