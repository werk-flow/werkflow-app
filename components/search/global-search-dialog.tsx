'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { SearchX } from 'lucide-react';

import { useOrganization } from '@/components/organization/organization-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/search-input';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { useClientRead } from '@/hooks/use-client-read';
import { readInBackground } from '@/lib/data/background-read-client';
import {
  GLOBAL_SEARCH_MIN_LENGTH,
  SEARCH_GROUP_LABELS,
  type SearchGroup,
  type SearchSource,
} from '@/lib/search/global-search';

/** The pause after the last keystroke before the query counts as settled. */
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_FAILED = 'Die Suche konnte nicht geladen werden.';

export type GlobalSearchDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

type LoadedGroup = Extract<SearchGroup, { status: 'loaded' }>;

function ResultGroup({ group, onNavigate }: { group: LoadedGroup; onNavigate: () => void }) {
  const headingId = useId();
  const label = SEARCH_GROUP_LABELS[group.kind];
  const more = group.total !== null && group.total > group.hits.length;
  return (
    <section aria-labelledby={headingId} className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-semibold">
          {label}
        </h3>
        {group.moreHref ? (
          <Button asChild variant="link" size="sm" className="h-auto px-0">
            <Link href={group.moreHref} onClick={onNavigate}>
              {more ? `Alle ${group.total} anzeigen` : 'Alle anzeigen'}
              <span className="sr-only">: {label}</span>
            </Link>
          </Button>
        ) : (
          more && (
            <span className="text-xs text-muted-foreground">
              {group.hits.length} von {group.total}
            </span>
          )
        )}
      </div>
      <ul className="divide-y rounded-lg border">
        {group.hits.map((hit) => (
          <li key={hit.id}>
            {/* A Button row, not ListRow: list-row.tsx in this lazy chunk regroups the app shell's
                shared chunks into two more scripts on every cold start (lab.field.cold-start). */}
            <Button
              asChild
              variant="ghost"
              className="h-auto w-full flex-col items-stretch gap-0 rounded-none px-4 py-2.5 text-left font-normal"
            >
              <Link href={hit.href} onClick={onNavigate}>
                <span className="block truncate text-sm font-medium">{hit.title}</span>
                {hit.detail && (
                  <span className="block truncate text-xs text-muted-foreground">{hit.detail}</span>
                )}
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The groups of one settled query. A failed source shows its failure per kind;
 * its retry reads the failed sources alone for the same query, and the
 * answer replaces their groups here, so the empty state counts it too.
 */
function ResultGroups({
  groups,
  query,
  organizationId,
  onNavigate,
}: {
  groups: SearchGroup[];
  query: string;
  organizationId: string;
  onNavigate: () => void;
}) {
  // The source the person retries now, and the groups earlier retries recovered.
  const [retrying, setRetrying] = useState<SearchSource | null>(null);
  const [recovered, setRecovered] = useState<SearchGroup[]>([]);
  const retry = useClientRead({
    read: (signal) =>
      readInBackground(
        'global-search',
        { organizationId, query, sources: retrying ? [retrying] : undefined },
        signal,
      ),
    deps: [organizationId, query, retrying],
    enabled: retrying !== null,
    failureMessage: SEARCH_FAILED,
  });
  const answered = retry.data?.groups;
  // A source answers whole: a recovered one leaves the retry, so a later retry
  // of another source never reads it again. Adopted during render.
  if (retrying && answered && answered.every((group) => group.status === 'loaded')) {
    setRecovered((current) => [
      ...current.filter((group) => !answered.some((next) => next.kind === group.kind)),
      ...answered,
    ]);
    setRetrying(null);
  }
  const shown = groups.map(
    (group) =>
      recovered.find((next) => next.kind === group.kind) ??
      answered?.find((next) => next.kind === group.kind) ??
      group,
  );
  if (shown.every((group) => group.status === 'loaded' && group.hits.length === 0))
    return (
      <EmptyState
        icon={SearchX}
        title="Keine Treffer gefunden"
        description="Prüfe die Schreibweise oder suche nach einer Nummer, Telefonnummer oder Straße."
      />
    );
  const retryOf = (source: SearchSource) => () =>
    retrying === source ? retry.reload() : setRetrying(source);
  return (
    <>
      {shown.map((group) =>
        group.status === 'failed' ? (
          <SectionError
            key={group.kind}
            title={SEARCH_GROUP_LABELS[group.kind]}
            onRetry={retryOf(group.source)}
            retryPending={retrying === group.source && retry.loading}
          >
            {SEARCH_FAILED}
          </SectionError>
        ) : group.hits.length > 0 ? (
          <ResultGroup key={group.kind} group={group} onNavigate={onNavigate} />
        ) : null,
      )}
    </>
  );
}

function ResultsSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4">
      {[0, 1].map((group) => (
        <div key={group} className="space-y-1.5">
          <Skeleton className="h-4 w-24 rounded" />
          <div className="divide-y rounded-lg border">
            {[0, 1, 2].map((row) => (
              <div key={row} className="space-y-1.5 px-4 py-2.5">
                <Skeleton className="h-4 w-48 rounded" />
                <Skeleton className="h-3 w-32 rounded" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function GlobalSearchPanel({ onNavigate }: { onNavigate: () => void }) {
  const { activeOrgId, activeOrg } = useOrganization();
  const [query, setQuery] = useState('');
  const [settledQuery, setSettledQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSettledQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const searchable = settledQuery.length >= GLOBAL_SEARCH_MIN_LENGTH;
  const organizationId = activeOrgId ?? '';
  // One read per settled query; a newer query cancels the read of the older one.
  const read = useClientRead({
    read: (signal) => readInBackground('global-search', { organizationId, query: settledQuery }, signal),
    deps: [organizationId, settledQuery],
    enabled: Boolean(activeOrgId) && searchable,
    failureMessage: SEARCH_FAILED,
    keepPreviousData: true,
  });
  const fieldWorker = activeOrg?.role === 'employee';
  const result = searchable ? read.data : undefined;

  return (
    <>
      <SearchInput
        aria-label="Suchbegriff"
        placeholder={fieldWorker ? 'Auftrag, Anlage oder Nummer' : 'Name, Telefon, Adresse, Nr.'}
        value={query}
        onValueChange={setQuery}
        pending={searchable && read.loading}
        enterKeyHint="search"
      />
      <DialogBody className="space-y-4">
        {!searchable ? (
          <EmptyState
            size="compact"
            title={`Gib mindestens ${GLOBAL_SEARCH_MIN_LENGTH} Zeichen ein.`}
            description={
              fieldWorker
                ? 'Du findest deine Aufträge, Projekte und ihre Anlagen.'
                : 'Du findest Kunden, Einsatzorte, Ansprechpartner, Aufträge, Projekte, Anfragen, Anlagen und Dokumente.'
            }
          />
        ) : read.failure ? (
          <SectionError failure={read.failure} />
        ) : !result ? (
          <ResultsSkeleton />
        ) : (
          <ResultGroups
            key={result.query}
            groups={result.groups}
            query={result.query}
            organizationId={organizationId}
            onNavigate={onNavigate}
          />
        )}
      </DialogBody>
    </>
  );
}

/**
 * The header search: one field, results grouped by kind, each hit opening
 * its own page. Full screen on a phone. Closing drops the query.
 */
export function GlobalSearchDialog({ open, onOpenChange }: GlobalSearchDialogProps) {
  // The shell's dialog sits outside the page's organization scope: a switch
  // starts the panel afresh, so no hit of the previous organization stays.
  const { activeOrgId } = useOrganization();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="2xl"
        workspace
        className="max-sm:h-dvh max-sm:max-h-dvh max-sm:rounded-none max-sm:border-t-0"
      >
        <DialogHeader>
          <DialogTitle>Suchen</DialogTitle>
          <DialogDescription className="sr-only">
            Die Treffer erscheinen nach Art gruppiert; ein Treffer öffnet seine Seite.
          </DialogDescription>
        </DialogHeader>
        <GlobalSearchPanel key={activeOrgId} onNavigate={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
