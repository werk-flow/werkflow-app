import 'server-only';

import { isInventoryUnitCode } from '@/lib/inventory/units';
import { jobDetailHref, projectDetailHref } from '@/lib/jobs/routes';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import type { InvoiceListQuery, InvoicePage } from './list-page';
import {
  INVOICE_STATUSES,
  INVOICE_TAX_RATES,
  INVOICE_WORK_LABELS,
  invoiceWorkKindSchema,
  type InvoiceDetail,
  type InvoiceWorkKind,
} from './types';

// Internal readers: the page authorizes the current manager and resolves the
// organization before it calls one. A failed or malformed read throws; it
// never becomes an empty list or a missing invoice.

const invoicePageSchema = z.object({
  total: z.number().int().nonnegative(),
  hasAny: z.boolean(),
  rows: z
    .array(
      z.object({
        id: uuidSchema,
        invoiceNumber: z.string().nullable(),
        status: z.string(),
        clientName: z.string(),
        recipientName: z.string().nullable(),
        grossCents: z.number().int(),
        updatedAt: z.string(),
      }),
    )
    .max(LIST_PAGE_SIZE),
});

/** One page of the organization's invoices, last changed first. */
export async function readInvoicePage(organizationId: string, query: InvoiceListQuery): Promise<InvoicePage> {
  const selected = await createSupabaseAdminClient().rpc('list_invoice_page', {
    p_organization_id: organizationId,
    ...(query.status ? { p_status: query.status } : {}),
    p_search: query.search,
    p_page: query.page,
    p_page_size: LIST_PAGE_SIZE,
  });
  const parsed = invoicePageSchema.safeParse(selected.data);
  if (selected.error || !parsed.success) throw new Error('invoice_page_read_failed');
  return {
    total: parsed.data.total,
    hasAnyInvoice: parsed.data.hasAny,
    entries: parsed.data.rows.map((row) => ({
      ...row,
      status: constrainedValue(INVOICE_STATUSES, row.status, 'invoices.status'),
    })),
  };
}

const lineSchema = z.object({
  name: z.string(),
  description: z.string(),
  quantity: z.string(),
  unit: z.string().refine(isInventoryUnitCode),
  unitPriceCents: z.number().int(),
  priceQuantity: z.literal([1, 10, 100, 1000]),
  taxRateBasisPoints: z.literal(INVOICE_TAX_RATES),
  netCents: z.number().int(),
});

const invoiceSchema = z.object({
  id: uuidSchema,
  invoiceNumber: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
  serviceStart: z.iso.date().nullable(),
  serviceEnd: z.iso.date().nullable(),
  paymentDueDays: z.number().int(),
  discountDays: z.number().int().nullable(),
  discountBasisPoints: z.number().int().nullable(),
  orderReference: z.string(),
  buyerReference: z.string(),
  openingText: z.string(),
  closingText: z.string(),
  lineNetCents: z.number().int(),
  taxCents: z.number().int(),
  grossCents: z.number().int(),
  client: z.object({ id: uuidSchema, name: z.string() }),
  recipient: z.object({ id: uuidSchema, name: z.string(), address: z.string().nullable() }),
  work: z
    .object({ kind: invoiceWorkKindSchema, id: uuidSchema, number: z.string().nullable(), title: z.string() })
    .nullable(),
  lines: z.array(lineSchema).max(500),
});

type WorkRow = { kind: InvoiceWorkKind; id: string; number: string | null };

/** The work's detail route; a job of a project redirects to its project's route. */
function workHref(work: WorkRow): string {
  if (work.kind === 'job') return jobDetailHref({ id: work.id, jobNumber: work.number });
  if (work.kind === 'project') return projectDetailHref({ id: work.id, projectNumber: work.number });
  return `/service/faelle/${encodeURIComponent(work.number ?? work.id)}`;
}

/** One invoice of the organization with its lines; `null` when there is none. */
export async function readInvoice(organizationId: string, invoiceId: string): Promise<InvoiceDetail | null> {
  const selected = await createSupabaseAdminClient().rpc('get_invoice', {
    p_organization_id: organizationId,
    p_invoice_id: invoiceId,
  });
  if (selected.error) throw new Error('invoice_read_failed');
  if (selected.data === null) return null;
  const parsed = invoiceSchema.safeParse(selected.data);
  if (!parsed.success) throw new Error('invoice_read_failed');
  const { work, ...invoice } = parsed.data;
  return {
    ...invoice,
    status: constrainedValue(INVOICE_STATUSES, invoice.status, 'invoices.status'),
    work: work
      ? {
          kind: work.kind,
          label: `${INVOICE_WORK_LABELS[work.kind]} ${[work.number, work.title].filter(Boolean).join(' · ')}`,
          href: workHref(work),
        }
      : null,
  };
}
