import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkRequestEntriesView } from '@/components/auftraege/shared/work-request-entries-view';
import type { WorkRequestEntry } from '@/lib/requests/types';

// werk-flow/werkflow-planning#328: the requests attached to a job, project or
// Servicefall. A work without entries shows nothing, but a failed refresh
// must never hide behind that empty state: another manager may just have
// attached the first request.

const entry: WorkRequestEntry = {
  id: 'entry-1',
  requestId: 'request-1',
  requestNumber: 'ANF-2026-0007',
  summary: 'Heizkörper im Bad wird nicht warm',
  details: 'Wohnung 3 links',
  createdAt: '2026-11-09T09:00:00.000Z',
  actorName: 'Erika Musterfrau',
};

function render(view: Partial<Parameters<typeof WorkRequestEntriesView>[0]['view']>): string {
  return renderToStaticMarkup(
    <WorkRequestEntriesView
      id="job-1"
      view={{
        data: undefined,
        isLoading: false,
        isStale: false,
        isRefreshing: false,
        error: null,
        refresh: async () => {},
        ...view,
      }}
    />,
  );
}

describe('the attached requests of one work', () => {
  test('show nothing while the first read runs or the work has none', () => {
    expect(render({ isLoading: true })).toBe('');
    expect(render({ data: [] })).toBe('');
  });

  test('a failed refresh after an empty read shows the failure with its retry', () => {
    const markup = render({ data: [], isStale: true });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('konnten nicht aktualisiert werden');
    expect(markup).toContain('Erneut');
  });

  test('a failed first read shows the failure with its retry', () => {
    const markup = render({ error: 'Die hinzugefügten Anfragen konnten nicht geladen werden.' });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('konnten nicht geladen werden');
  });

  test('an entry shows the request words, who added it and its request', () => {
    const markup = render({ data: [entry] });
    expect(markup).toContain('Hinzugefügte Anfragen');
    expect(markup).toContain('Heizkörper im Bad wird nicht warm');
    expect(markup).toContain('Wohnung 3 links');
    expect(markup).toContain('Erika Musterfrau');
    expect(markup).toContain('href="/anfragen/request-1"');
    expect(markup).toContain('Anfrage ANF-2026-0007');
  });
});
