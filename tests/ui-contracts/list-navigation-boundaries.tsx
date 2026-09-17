import { useListNavigation } from '@/hooks/use-list-navigation';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ListPagination } from '@/components/shared/list-pagination';
import { parseListPage } from '@/lib/ui/list-pagination';
import { useSearchParams } from './list-navigation-service-boundaries';

function ListControls(): React.JSX.Element {
  const navigation = useListNavigation();
  const searchParams = useSearchParams();
  return <main>
    <Input aria-label="Liste durchsuchen" onChange={(event) => navigation.navigate({ q: event.target.value, page: 1 }, 250)} />
    <Button onClick={() => navigation.navigate({ page: 2 })}>Zweite Seite laden</Button>
    <output aria-label="Listenstatus">{navigation.busy ? 'Wird geladen' : 'Bereit'}</output>
    <ListPagination label="Testliste" page={parseListPage(searchParams.get('page') ?? undefined)} total={61}
      busy={navigation.busy} onPageChange={(page) => navigation.navigate({ page })} />
  </main>;
}
export function ListNavigationFixture(): React.JSX.Element {
  return <BannerProvider><ListControls /></BannerProvider>;
}
