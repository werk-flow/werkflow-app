'use client';

import { SearchableListSkeleton } from '@/components/shared/searchable-list-skeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { OFFER_COLUMNS } from './offers-columns';

// Content-only skeletons: the Angebote layout keeps the h1 and the area nav on screen.

/** The facts the offer header lists, one placeholder row each. */
const OFFER_FACTS = [
  'Kunde',
  'Einsatzort',
  'Ansprechpartner',
  'Rechnungsempfänger',
  'Gültig bis',
  'Verantwortlich',
  'Einleitung',
  'Schluss',
] as const;

/** Toolbar, count and rows of the list. */
export function OffersListSkeleton() {
  return <SearchableListSkeleton columns={OFFER_COLUMNS} />;
}

export function OffersPageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Angebote werden geladen">
      <span className="sr-only">Angebote werden geladen.</span>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
      <OffersListSkeleton />
    </div>
  );
}

/** The offer's page: its title line and the header's stacked facts. */
export function OfferDetailSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Angebot wird geladen">
      <span className="sr-only">Angebot wird geladen.</span>
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-6 w-72 max-w-full" />
        <Skeleton className="h-4 w-56 max-w-full" />
      </div>
      <div className="space-y-4 rounded-lg border bg-card p-4 sm:p-5">
        <Skeleton className="h-4 w-32" />
        {OFFER_FACTS.map((fact) => (
          <div key={fact} className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-48 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
