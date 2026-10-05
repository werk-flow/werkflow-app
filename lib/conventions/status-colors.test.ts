import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { listProductSources, repositoryRoot } from './product-sources';

// Job, project and work states take their colors from one owner, so a state
// keeps one color on every screen. Four local copies of the map once let
// „In Bearbeitung“ drift; the owner decision of 2026-10-03 gave it its own
// family and moved every copy into the owner.
const OWNER = 'components/auftraege/status-classes.ts';
// A state key of a job, project or work state mapped to a color class.
const LOCAL_STATE_COLOR =
  /\b(?:nicht_bearbeitet|in_bearbeitung|nicht_begonnen|abgeschlossen|not_started|in_progress|execution_complete|handed_over)\s*:\s*(?:\{[^}]*className\s*:\s*)?['"`][^'"`]*\b(?:bg|text)-/;

test('job, project and work state colors live only in their owner', () => {
  const offenders = listProductSources(['app', 'components', 'hooks', 'lib'])
    .filter((file) => file !== OWNER)
    .flatMap((file) =>
      readFileSync(resolve(repositoryRoot, file), 'utf8')
        .split(/\r?\n/)
        .flatMap((line, index) =>
          LOCAL_STATE_COLOR.test(line) || line.includes('ongoing-soft') ? [`${file}:${index + 1}`] : [],
        ),
    );
  expect(offenders).toEqual([]);
});

test('the pattern catches a local state color map', () => {
  expect(LOCAL_STATE_COLOR.test("  in_bearbeitung: 'bg-warning-soft text-warning-soft-foreground',")).toBe(
    true,
  );
  expect(
    LOCAL_STATE_COLOR.test("  in_bearbeitung: { label: 'In Bearbeitung', className: 'bg-warning-soft' },"),
  ).toBe(true);
  expect(LOCAL_STATE_COLOR.test("  in_progress: 'In Bearbeitung',")).toBe(false);
});
