import type { TestGroup } from './test-groups';

/**
 * The component contracts by area: `ui:contracts:<area>` takes each spec under tests/ui-contracts/
 * that an entry names, `<entry>.spec.ts` exactly or, for an entry ending in `-`, every spec whose
 * name starts with it. Every spec belongs to exactly one area (test-groups.test.ts). A CI plan
 * selects areas by their own specs; a change the contract bundle reaches runs every area
 * (fast-tier.ts).
 */
const COMPONENT_AREAS: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  ['calendar', ['calendar', 'calendar-', 'planning-options'], ['planning']],
  [
    'time',
    [
      'absences',
      'approvals',
      'break-rule-week',
      'clock-',
      'correction-timeline',
      'entry-details',
      'offline-clock',
      'team-qualifications',
      'time-',
    ],
    ['time', 'personnel'],
  ],
  [
    'work',
    [
      'document-',
      'draft-',
      'edit-job',
      'lifecycle-',
      'material-',
      'service-evidence-link',
      'site-access',
      'work-',
    ],
    ['work', 'service', 'documents'],
  ],
  [
    'inventory',
    ['article-terms', 'inventory-', 'leistungen', 'offers', 'supplier-catalog', 'wholesaler-import'],
    ['inventory', 'commercial'],
  ],
  ['customers', ['billing-parties', 'client-relations', 'customer', 'customer-', 'request-'], ['customers']],
  [
    'organization',
    ['auth-url-session', 'company-', 'join-requests', 'member-role', 'organization', 'organization-'],
    ['personnel', 'standalone'],
  ],
  ['reports', ['problem-report', 'support-'], ['*']],
  // Its browser-side import of the redraw bundle has no resolvable path, so it runs for every code
  // change (fast-tier.ts); alone, that costs seconds.
  ['report-redraw', ['problem-report-redraw'], ['*']],
  [
    'shell',
    [
      'audit-measures',
      'browser-observation',
      'busy-elements',
      'controls',
      'hidden-copy',
      'hydration-settle',
      'interaction',
      'lazy-dialog',
      'list-navigation',
      'locator-observation',
      'offline-retry',
      'offline-today',
      'options',
      'presentation',
      'receiver-navigation',
      'route-refresh',
      'sidebar',
      'streamed-content',
      'task-sections',
      'today-refresh',
    ],
    ['*'],
  ],
];

/** Whether a component area entry names a spec: `<entry>.spec.ts`, or any spec it starts when it ends in `-`. */
export function componentAreaOwns(entry: string, file: string): boolean {
  const name = file.split('/').at(-1) ?? file;
  return entry.endsWith('-') ? name.startsWith(entry) : name === `${entry}.spec.ts`;
}

/** The component areas over the contract specs: one process-isolated, untimed group each. */
export function componentAreaGroups(contracts: readonly string[]): TestGroup[] {
  return COMPONENT_AREAS.map(([area, entries, scopes]) => ({
    id: `ui:contracts:${area}`,
    kind: 'ui',
    files: contracts.filter((file) => entries.some((entry) => componentAreaOwns(entry, file))),
    scopes,
    isolation: 'process',
    timing: { requireFreshness: false, requireReadiness: false, exclusive: false },
  }));
}

/** A former group id that names every group of its kind: `--group ui:contracts` runs every component area. */
const GROUP_ALIASES: Readonly<Record<string, TestGroup['kind']>> = { 'ui:contracts': 'ui' };

/** The requested group ids with each alias replaced by the groups of its kind, in registry order. */
export function expandGroupAliases(ids: readonly string[], groups: readonly TestGroup[]): string[] {
  return [
    ...new Set(
      ids.flatMap((id) => {
        const kind = Object.hasOwn(GROUP_ALIASES, id) ? GROUP_ALIASES[id] : undefined;
        return kind ? groups.filter((group) => group.kind === kind).map((group) => group.id) : [id];
      }),
    ),
  ];
}
