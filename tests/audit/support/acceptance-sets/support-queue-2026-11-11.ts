import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import { stateCaptureId } from '../acceptance-state-plan';

/**
 * werk-flow/werkflow-planning#335 of 2026-11-11: WerkFlow support's queue with
 * reports and empty, a report's page, the report filed for a caller, and the
 * loading state of the queue and of a report.
 */
function supportQueueCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const report = '/support/meldungen/[reportId]' as const;
  return {
    id: 'support-queue-2026-11-11',
    captures: [],
    standalone: [
      { id: 'support-meldungen', screen: '/support', query: '?status=alle', ...both },
      { id: 'support-meldungen-leer', screen: '/support', ...both },
      {
        id: stateCaptureId('support-meldungen', 'loading'),
        screen: '/support',
        loadingFrom: '/support/aufnehmen',
        ...both,
      },
      { id: 'support-meldung', screen: report, ...both },
      { id: stateCaptureId('support-meldung', 'loading'), screen: report, loadingFrom: '/support', ...both },
      { id: 'support-aufnehmen', screen: '/support/aufnehmen', ...both },
    ],
  };
}

acceptanceSet(supportQueueCaptures());
