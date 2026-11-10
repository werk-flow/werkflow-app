import { TodayRefreshOnStart } from '@/components/auftraege/work-pack/today-refresh-on-start';
import { BannerProvider } from '@/components/ui/banner';

/** The field worker's start page refresh, whose code cannot load (today-refresh-service-boundaries.ts). */
export function TodayRefreshContractFixture(): React.JSX.Element {
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <TodayRefreshOnStart
          userId="9a000000-0000-4000-8000-000000000001"
          organizationId="9a000000-0000-4000-8000-0000000000a1"
        />
      </main>
    </BannerProvider>
  );
}
