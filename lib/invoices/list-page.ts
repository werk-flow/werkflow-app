import { parseListPage } from '@/lib/ui/list-pagination';
import { invoiceStatusSchema, type InvoiceListEntry, type InvoiceStatus } from './types';

export type InvoiceListQuery = {
  /** `null` lists every status. */
  status: InvoiceStatus | null;
  search: string;
  page: number;
};

export type InvoicePage = {
  entries: InvoiceListEntry[];
  /** Invoices that match the filters and the search, before the page boundary. */
  total: number;
  /** False while the organization has no invoice at all. */
  hasAnyInvoice: boolean;
};

/** URL state of `/rechnungen`; an unknown value falls back to the first page of every invoice. */
export function parseInvoiceListQuery(
  params: Record<string, string | string[] | undefined>,
): InvoiceListQuery {
  const single = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : undefined;
  };
  return {
    status: invoiceStatusSchema.safeParse(single('status')).data ?? null,
    search: (single('q') ?? '').trim().slice(0, 250),
    page: parseListPage(single('page')),
  };
}
