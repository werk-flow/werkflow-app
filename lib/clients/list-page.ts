import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import type { Client } from '@/lib/jobs/types';

/** `aktiv` lists the active customers, `archiviert` only the archived ones. */
export const customerListViewSchema = z.enum(['aktiv', 'archiviert']);
export type CustomerListView = z.infer<typeof customerListViewSchema>;

export const customerPageInputSchema = z.object({
  organizationId: uuidSchema,
  page: z.coerce.number().int().min(1).max(1_000_000),
  search: z.string().trim().max(250),
  // An open tab of the previous release asks without a view.
  view: customerListViewSchema.default('aktiv'),
});
export type CustomerPageInput = z.infer<typeof customerPageInputSchema>;

const clientSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  name: z.string(),
  clientType: z.enum(['privat', 'gewerblich']),
  customerNumber: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Client>;

/** The shown Anlagen of a matched Objekt; `equipmentTotal` counts all active ones. */
const MATCHED_SITE_EQUIPMENT_LIMIT = 5;
/** The shown matched Objekte of one customer; `matchedSiteTotal` counts all. */
const MATCHED_SITE_LIMIT = 3;

const matchedSiteSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  street: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  sourceNumber: z.string().nullable(),
  /** The customer the Objekt is filed under. */
  clientId: uuidSchema,
  clientName: z.string(),
  // Current roles; the list shows the kinds it knows.
  roles: z.array(z.object({ role: z.string(), holderClientId: uuidSchema, holderName: z.string() })),
  equipment: z
    .array(z.object({ id: uuidSchema, name: z.string(), equipmentNumber: z.string() }))
    .max(MATCHED_SITE_EQUIPMENT_LIMIT),
  equipmentTotal: z.number().int().nonnegative(),
});
/** An Objekt the search matched, under its own customer or a customer holding a role on it. */
export type CustomerPageSite = z.infer<typeof matchedSiteSchema>;

// A response without matched Einsatzorte, as a search without one, lists none.
const customerPageRowSchema = clientSchema.extend({
  matchedSites: z.array(matchedSiteSchema).max(MATCHED_SITE_LIMIT).default([]),
  matchedSiteTotal: z.number().int().nonnegative().default(0),
});
/** A customer of the list; a just created one carries no matched Objekte yet. */
export type CustomerListItem = Client & {
  matchedSites?: CustomerPageSite[];
  matchedSiteTotal?: number;
};

export const customerPageSchema = z.object({
  clients: z.array(customerPageRowSchema).max(LIST_PAGE_SIZE),
  total: z.number().int().nonnegative(),
});
export type CustomerPage = z.infer<typeof customerPageSchema>;

export async function fetchCustomerPage(
  input: CustomerPageInput,
  signal: AbortSignal,
): Promise<CustomerPage> {
  const query = new URLSearchParams({
    organizationId: input.organizationId,
    page: String(input.page),
    search: input.search,
    view: input.view,
  });
  const response = await fetch(`/api/customer-page?${query}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('customer_page_read_failed');
  const data = customerPageSchema.parse(await response.json());
  if (data.clients.some((client) => client.organizationId !== input.organizationId))
    throw new Error('customer_page_scope_changed');
  return data;
}
