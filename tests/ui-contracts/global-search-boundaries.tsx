import { useState, type ComponentProps } from 'react';

import { GlobalSearchDialog } from '@/components/search/global-search-dialog';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import type { GlobalSearchResult, SearchGroup, SearchSource } from '@/lib/search/global-search';

const organizationId = '48700000-0000-4000-8000-000000000010';

/** The search dialog reads the active organization only. */
export function useOrganization(): {
  activeOrgId: string;
  activeOrg: { role: 'buero' };
} {
  return { activeOrgId: organizationId, activeOrg: { role: 'buero' } };
}

// `next/link`: the fixture page has no router, so a hit stays on the page.
export default function Link({ onClick, ...props }: ComponentProps<'a'> & { href: string }) {
  return (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    />
  );
}

declare global {
  interface Window {
    /** Each `global-search` read the dialog made, in order. */
    uiContractSearchReads: Array<{ query: string; sources: SearchSource[] | null }>;
  }
}

function loaded(kind: SearchGroup['kind'], source: SearchSource, title: string, detail: string): SearchGroup {
  return {
    kind,
    source,
    status: 'loaded',
    hits: [{ id: `${kind}-1`, title, detail, href: `/${kind}/1` }],
    total: 1,
    moreHref: `/${kind}`,
  };
}

/**
 * „Lindenhof“ answers customers and fails the documents; the documents'
 * retry answers. „Leer“ fails the documents, whose retry finds nothing. „Störung“
 * fails the whole search. „Zwei“ fails customers and documents; each retry
 * answers its own source. Anything else finds nothing.
 */
export function readGlobalSearchContract(input: unknown): GlobalSearchResult {
  const query = input && typeof input === 'object' && 'query' in input ? String(input.query) : '';
  const sources =
    input && typeof input === 'object' && 'sources' in input && Array.isArray(input.sources)
      ? input.sources
          .map(String)
          .filter((source): source is SearchSource => source === 'dokumente' || source === 'kunden')
      : null;
  window.uiContractSearchReads.push({ query, sources });
  if (query === 'Störung') return { success: false, error: 'load_failed' };
  if (query === 'Zwei') {
    const kunden = loaded('kunden', 'kunden', 'Hausverwaltung Lindenhof GmbH', 'K-1001 · 0711 12345');
    const dokumente = loaded(
      'dokumente',
      'dokumente',
      'Wartungsvertrag Lindenhof',
      'Nummer im Altsystem 4711',
    );
    if (sources?.length === 1)
      return { success: true, query, groups: [sources[0] === 'kunden' ? kunden : dokumente] };
    return {
      success: true,
      query,
      groups: [
        { kind: 'kunden', source: 'kunden', status: 'failed' },
        { kind: 'dokumente', source: 'dokumente', status: 'failed' },
      ],
    };
  }
  if (query === 'Leer')
    return sources?.includes('dokumente')
      ? {
          success: true,
          query,
          groups: [
            {
              kind: 'dokumente',
              source: 'dokumente',
              status: 'loaded',
              hits: [],
              total: 0,
              moreHref: '/dokumente',
            },
          ],
        }
      : {
          success: true,
          query,
          groups: [
            { kind: 'kunden', source: 'kunden', status: 'loaded', hits: [], total: 0, moreHref: '/kunden' },
            { kind: 'dokumente', source: 'dokumente', status: 'failed' },
          ],
        };
  if (query !== 'Lindenhof') return { success: true, query, groups: [] };
  if (sources?.includes('dokumente'))
    return {
      success: true,
      query,
      groups: [loaded('dokumente', 'dokumente', 'Wartungsvertrag Lindenhof', 'Nummer im Altsystem 4711')],
    };
  return {
    success: true,
    query,
    groups: [
      loaded('kunden', 'kunden', 'Hausverwaltung Lindenhof GmbH', 'K-1001 · 0711 12345'),
      { kind: 'dokumente', source: 'dokumente', status: 'failed' },
    ],
  };
}

export function GlobalSearchContractFixture(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  window.uiContractSearchReads ??= [];
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <Button onClick={() => setOpen(true)}>Suche öffnen</Button>
        <GlobalSearchDialog open={open} onOpenChange={setOpen} />
      </main>
    </BannerProvider>
  );
}
