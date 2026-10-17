import { describe, expect, test } from 'bun:test';
import { declaredTitles, resolveTitleReference } from './test-titles';

const spec = [
  "test.describe('Area @TAG', () => {",
  "  test.describe.configure({ mode: 'serial' });",
  '  test.beforeEach(async () => {});',
  "  test('A-01: first', async () => {",
  "    await test.step('opens the page', async () => {});",
  '  });',
  "  test.skip('A-02: skipped', async () => {});",
  "  test(`A-03: ${'templated'} title`, async () => {});",
  '  test(dynamicTitle, async () => {});',
  '});',
].join('\n');

describe('declared test titles', () => {
  test('reads describe, test, modified test and step titles, and skips hooks and configuration', () => {
    expect(declaredTitles('tests/area.spec.ts', spec)).toEqual([
      { kind: 'describe', title: 'Area @TAG' },
      { kind: 'test', title: 'A-01: first' },
      { kind: 'step', title: 'opens the page' },
      { kind: 'test', title: 'A-02: skipped' },
      { kind: 'test', title: 'A-03: ${…} title' },
    ]);
  });
  test('reads bun describe, test and it titles of a unit file', () => {
    const unit =
      "describe('rules', () => { it('keeps one', () => {}); test.each([1])('case %d', () => {}); });";
    expect(declaredTitles('lib/rules.test.ts', unit)).toEqual([
      { kind: 'describe', title: 'rules' },
      { kind: 'test', title: 'keeps one' },
    ]);
  });
  test('reads each distinct raise message of an SQL file once', () => {
    const sql = [
      "if a then raise exception 'row % is missing', id; end if;",
      "if b then raise exception 'row % is missing', id; end if;",
      "RAISE EXCEPTION 'the owner''s role changed';",
      "-- raise exception 'a commented-out line assertion';",
      "/* raise exception 'a commented-out block assertion'; */",
    ].join('\n');
    expect(declaredTitles('supabase/tests/x.sql', sql)).toEqual([
      { kind: 'sql', title: 'row % is missing' },
      { kind: 'sql', title: "the owner's role changed" },
    ]);
  });
  test('resolves an exact title before a tag and a tag only at whole-tag boundaries', () => {
    const titles = declaredTitles('tests/area.spec.ts', spec);
    expect(resolveTitleReference(titles, 'A-01: first')).toHaveLength(1);
    expect(resolveTitleReference(titles, 'A-01')).toHaveLength(1);
    expect(resolveTitleReference(titles, 'A-0')).toHaveLength(0);
    expect(resolveTitleReference(titles, '@TAG')).toHaveLength(1);
  });
});
