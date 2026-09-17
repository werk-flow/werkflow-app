import { uuidSchema } from '@/lib/validation/uuid';
import { z } from 'zod';
export const inventoryPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).catch(1),
  search: z.string().trim().max(200).catch(''),
  type: z.enum(['all','material','consumable','tool','asset']).catch('all'),
  stock: z.enum(['all','in_stock','low_stock','out_of_stock']).catch('all'),
  location: z.union([z.literal('all'), uuidSchema]).catch('all'),
  tab: z.enum(['all','planned','locations','movements']).catch('all'),
});
export type InventoryPageQuery = z.infer<typeof inventoryPageQuerySchema>;
export const inventoryPageResultSchema = z.object({
  ids: z.array(uuidSchema).max(50), supportIds: z.array(uuidSchema).max(200), total: z.number().int().nonnegative(),
  locationIds: z.array(uuidSchema).max(12), locationCounts: z.record(z.string(),z.number().int().nonnegative()),
  summary: z.object({totalItems:z.number(),lowStockItems:z.number(),outOfStockItems:z.number(),plannedQuantity:z.number(),totalOnHand:z.number(),stockedItems:z.number(),plannedItems:z.number()}),
});
