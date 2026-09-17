import { redirect } from 'next/navigation';

import { InventoryContent } from '@/components/inventar/inventory-content';
import { getInventoryOverview } from '@/lib/inventory/actions';

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const result = await getInventoryOverview(await searchParams);

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

  return <InventoryContent overview={result.overview} />;
}
