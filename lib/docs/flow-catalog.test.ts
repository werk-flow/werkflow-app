import { describe, expect, test } from 'bun:test';
import { findCatalogProblems } from './flow-catalog';

function section(id: string, flows: string[], invariant?: number): string {
  return [
    `### \`${id}\` — Titel`,
    '',
    ...flows.map((flow) => `- \`${flow}\` — Ablauf.`),
    ...(invariant === undefined
      ? []
      : ['', `**Acceptance invariant:** \`${invariant}/${invariant} mapped\`.`]),
    '',
  ].join('\n');
}

describe('flow catalog', () => {
  test('ordered sections with sequential ids and a matching invariant pass', () => {
    expect(
      findCatalogProblems(section('P1-01', ['P1-01-F01', 'P1-01-F02'], 2) + section('P1-02', ['P1-02-F01'])),
    ).toEqual([]);
  });

  test('probe: an out-of-order section, a gap and a wrong invariant fail', () => {
    const markdown = section('P1-02', ['P1-02-F01']) + section('P1-01', ['P1-01-F01', 'P1-01-F03'], 3);
    expect(findCatalogProblems(markdown)).toEqual([
      'section P1-01 is out of id order',
      'P1-01 flow ids are not sequential; expected P1-01-F02, found P1-01-F03',
      'P1-01 invariant says 3 flows but the section defines 2',
    ]);
  });
});
