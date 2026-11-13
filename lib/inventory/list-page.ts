import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { INVENTORY_HISTORY_KINDS } from './types';

/** A Berlin calendar day of the movement date range; anything else means no bound. */
const dateBoundSchema = z.union([z.literal(''), z.string().date()]).catch('');

/**
 * The URL state of `/inventar`. Search and Lager apply to the item views and
 * the movement history alike; kind, person and the date range only to the
 * history.
 */
export const inventoryPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).catch(1),
  search: z.string().trim().max(200).catch(''),
  type: z.enum(['all', 'material', 'consumable', 'tool', 'asset']).catch('all'),
  stock: z.enum(['all', 'in_stock', 'shortfall', 'low_stock', 'out_of_stock']).catch('all'),
  location: z.union([z.literal('all'), uuidSchema]).catch('all'),
  tab: z.enum(['all', 'planned', 'locations', 'movements']).catch('all'),
  kind: z.enum(['all', ...INVENTORY_HISTORY_KINDS]).catch('all'),
  person: z.union([z.literal('all'), uuidSchema]).catch('all'),
  from: dateBoundSchema,
  to: dateBoundSchema,
});
export type InventoryPageQuery = z.infer<typeof inventoryPageQuerySchema>;
export const inventoryPageResultSchema = z.object({
  ids: z.array(uuidSchema).max(50),
  supportIds: z.array(uuidSchema).max(200),
  total: z.number().int().nonnegative(),
  locationIds: z.array(uuidSchema).max(12),
  locationCounts: z.record(z.string(), z.number().int().nonnegative()),
  summary: z.object({
    totalItems: z.number(),
    shortfallItems: z.number(),
    lowStockItems: z.number(),
    outOfStockItems: z.number(),
    plannedQuantity: z.number(),
    totalOnHand: z.number(),
    stockedItems: z.number(),
    plannedItems: z.number(),
  }),
});

const nullableText = z.string().nullable();
const nullableNumber = z.number().nullable();
/** One page of the movement history as `list_inventory_movement_page` returns it. */
export const inventoryMovementPageResultSchema = z.object({
  total: z.number().int().nonnegative(),
  hasAny: z.boolean(),
  people: z.array(
    z.object({ id: uuidSchema, firstName: nullableText, lastName: nullableText, email: nullableText }),
  ),
  rows: z
    .array(
      z.object({
        id: uuidSchema,
        kind: z.enum(INVENTORY_HISTORY_KINDS),
        itemId: uuidSchema,
        itemName: z.string(),
        unit: z.string(),
        locationId: uuidSchema.nullable(),
        locationName: nullableText,
        quantity: z.number(),
        quantityBefore: nullableNumber,
        quantityAfter: nullableNumber,
        jobId: uuidSchema.nullable(),
        jobNumber: nullableText,
        jobTitle: nullableText,
        projectId: uuidSchema.nullable(),
        projectNumber: nullableText,
        projectName: nullableText,
        reason: nullableText,
        actorId: uuidSchema.nullable(),
        createdAt: z.string(),
        correctsEventId: uuidSchema.nullable(),
      }),
    )
    .max(LIST_PAGE_SIZE),
});
export type InventoryMovementPageRow = z.infer<typeof inventoryMovementPageResultSchema>['rows'][number];
