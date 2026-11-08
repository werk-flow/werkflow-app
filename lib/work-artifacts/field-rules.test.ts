import { describe, expect, test } from 'bun:test';

import { requiredWorkArtifactFields, workArtifactFieldIssues } from './field-rules';

const fields = (draft: Parameters<typeof workArtifactFieldIssues>[0]) =>
  workArtifactFieldIssues(draft).map((issue) => issue.field);

describe('workArtifactFieldIssues', () => {
  test('a submitted work report names a missing Beginn and Ende, not only a sentence', () => {
    expect(
      fields({
        kind: 'work_report',
        title: 'Wartung',
        submit: true,
        content: { performedWork: 'Brenner geprüft' },
      }),
    ).toEqual(['visitStartedAt', 'visitEndedAt']);
  });

  test('a work report draft needs only its performed work; Beginn and Ende wait for the submit', () => {
    expect(fields({ kind: 'work_report', title: 'Wartung', submit: false, content: {} })).toEqual([
      'performedWork',
    ]);
  });

  test('a title shorter than three characters and whitespace-only text count as missing', () => {
    expect(
      fields({
        kind: 'site_diary',
        title: ' ab ',
        submit: true,
        content: { workDate: '2026-11-09', progress: '  ' },
      }),
    ).toEqual(['title', 'progress']);
  });

  test('the visit window must run forward', () => {
    expect(
      workArtifactFieldIssues({
        kind: 'work_report',
        title: 'Wartung',
        submit: true,
        content: {
          performedWork: 'Brenner geprüft',
          visitStartedAt: '2026-11-09T10:00',
          visitEndedAt: '2026-11-09T09:00',
        },
      }),
    ).toEqual([{ field: 'visitEndedAt', code: 'visit_end_must_be_after_start' }]);
  });

  test('a measurement draft needs a location or a line, and every line its description', () => {
    expect(fields({ kind: 'measurement', title: 'Aufmaß', submit: false, content: {} })).toEqual([
      'measurementLocation',
    ]);
    expect(
      workArtifactFieldIssues({
        kind: 'measurement',
        title: 'Aufmaß',
        submit: false,
        content: { measurementLines: [{ description: 'Rohr' }, { description: ' ' }] },
      }),
    ).toEqual([
      { field: 'measurementLineDescription', line: 1, code: 'measurement_line_description_required' },
    ]);
  });

  test('a defect and a change work need their fields even as a draft', () => {
    expect(fields({ kind: 'defect', title: 'Mangel', submit: false, content: {} })).toEqual([
      'defectDescription',
      'defectLocation',
      'defectSeverity',
    ]);
    expect(fields({ kind: 'change_work', title: 'Regie', submit: false, content: {} })).toEqual([
      'changeDescription',
      'changeReason',
      'requestedByContext',
    ]);
  });

  test('every field a submit can name carries the required mark of its kind', () => {
    for (const kind of ['site_diary', 'work_report', 'measurement', 'defect', 'change_work'] as const) {
      const marked = requiredWorkArtifactFields(kind);
      for (const field of fields({ kind, title: '', submit: true, content: {} }))
        expect(
          marked.has(field === 'measurementLineDescription' ? 'measurementLines' : field),
          `${kind}: ${field}`,
        ).toBe(true);
    }
  });
});
