import { OfflineToday } from '@/components/auftraege/work-pack/offline-today';
import './offline-today-service-boundaries';

/** The offline view over a device read the spec answers (offline-today-service-boundaries.ts). */
export function OfflineTodayContractFixture(): React.JSX.Element {
  return (
    <main>
      <OfflineToday withoutDay={<p>Gerade kein Netz</p>} />
    </main>
  );
}
