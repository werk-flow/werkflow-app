import { parseListPage } from '@/lib/ui/list-pagination';
import { isUuid } from '@/lib/validation/uuid';
import { offerStatusSchema, type OfferListEntry, type OfferStatus } from './types';

export type OfferListQuery = {
  /** `null` lists every status. */
  status: OfferStatus | null;
  search: string;
  /** Only this customer's offers, from the customer detail's link. */
  clientId: string | null;
  page: number;
};

export type OfferPage = {
  entries: OfferListEntry[];
  /** Offers that match the filters and the search, before the page boundary. */
  total: number;
  /** False while the organization (or the filtered customer) has no offer at all. */
  hasAnyOffer: boolean;
};

/** URL state of `/angebote`; an unknown value falls back to the first page of every offer. */
export function parseOfferListQuery(params: Record<string, string | string[] | undefined>): OfferListQuery {
  const single = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : undefined;
  };
  const clientId = single('kunde');
  return {
    status: offerStatusSchema.safeParse(single('status')).data ?? null,
    search: (single('q') ?? '').trim().slice(0, 250),
    clientId: clientId && isUuid(clientId) ? clientId : null,
    page: parseListPage(single('page')),
  };
}
