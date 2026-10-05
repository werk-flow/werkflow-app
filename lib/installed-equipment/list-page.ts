import { z } from '@/lib/zod';

import { parseListPage } from '@/lib/ui/list-pagination';
import { EQUIPMENT_CATEGORIES, type EquipmentListItem } from './types';

export const equipmentListQuerySchema = z.object({
  search: z.string().trim().max(250),
  category: z.enum(['all', ...EQUIPMENT_CATEGORIES]),
  includeArchived: z.boolean(),
  page: z.number().int().min(1).max(1_000_000),
});
export type EquipmentListQuery = z.infer<typeof equipmentListQuerySchema>;

export type EquipmentPage = {
  equipment: EquipmentListItem[];
  /** Equipment that matches the scope and the search, before the page boundary. */
  total: number;
  /** False while the organization has no listed equipment at all. */
  hasAnyEquipment: boolean;
};

/** URL state of `/service/anlagen`; an unknown value falls back to the first page of all active equipment. */
export function parseEquipmentListQuery(
  params: Record<string, string | string[] | undefined>,
): EquipmentListQuery {
  const single = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : undefined;
  };
  return {
    search: (single('q') ?? '').trim().slice(0, 250),
    category: equipmentListQuerySchema.shape.category.catch('all').parse(single('category')),
    includeArchived: single('archived') === '1',
    page: parseListPage(single('page')),
  };
}
