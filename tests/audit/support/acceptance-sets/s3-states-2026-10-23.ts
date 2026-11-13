import { slug, type CaptureSpec } from '../acceptance-rounds';
import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * Package S, item S3 of 2026-10-23: one state capture per way a state is
 * reached: a route's loading.tsx behind its held navigation (office and field
 * worker), a client section's failure on a page, a dialog's held and failed
 * option read.
 */
function stateCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const templates = { kind: 'dialog', opener: 'templates.apply' } as const;
  const specs: readonly Omit<CaptureSpec, 'id' | 'widths' | 'schemes'>[] = [
    { role: 'admin', route: '/auftraege', view: { kind: 'page' }, state: 'loading' },
    { role: 'employee', route: '/dashboard', view: { kind: 'page' }, state: 'loading' },
    { role: 'admin', route: '/auftraege/projekt/[projectNumber]', view: { kind: 'page' }, state: 'error' },
    { role: 'admin', route: '/auftraege/[jobNumber]', view: templates, state: 'loading' },
    { role: 'admin', route: '/auftraege/[jobNumber]', view: templates, state: 'error' },
  ];
  return {
    id: 's3-states-2026-10-23',
    captures: specs.map((spec): CaptureSpec => {
      const view = spec.view.kind === 'dialog' ? `-dialog-${spec.view.opener.replace('.', '-')}` : '';
      const base = `${spec.role}-${slug(spec.route)}${view}`;
      return { ...spec, id: spec.state ? stateCaptureId(base, spec.state) : base, ...both };
    }),
    standalone: [],
  };
}

acceptanceSet(stateCaptures());
