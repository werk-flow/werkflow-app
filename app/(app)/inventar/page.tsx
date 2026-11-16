import { redirect } from 'next/navigation';

import { InventoryContent } from '@/components/inventar/inventory-content';
import { getInventoryMovementHistory, getInventoryOverview } from '@/lib/inventory/catalog-actions';
import { inventoryPageQuerySchema } from '@/lib/inventory/list-page';
import type { InventoryMovementPage } from '@/lib/inventory/types';

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // The movement history is read only for its own tab, beside the overview.
  const showsHistory = inventoryPageQuerySchema.safeParse(params).data?.tab === 'movements';
  const [result, historyResult] = await Promise.all([
    getInventoryOverview(params),
    showsHistory ? getInventoryMovementHistory(params) : null,
  ]);

  if (!result.success) {
    if (
      result.error === 'not_authenticated' ||
      result.error === 'no_active_org' ||
      result.error === 'not_a_member'
    ) {
      redirect('/login');
    }

    if (result.error === 'not_authorized') {
      redirect('/dashboard');
    }

    throw new Error(`Failed to load inventory: ${result.error}`);
  }

  // A failed history read, or a Lager that is not the organization's, fails
  // the movements tab alone; the rest of the page stays usable.
  const history: InventoryMovementPage | null = historyResult
    ? historyResult.success
      ? historyResult.history
      : { status: 'failed' }
    : null;

  return <InventoryContent overview={result.overview} history={history} />;
}
