import { WorkerStart } from '@/components/dashboard/worker-start';
import './worker-start-service-boundaries';

/** The field worker's start page over the stand-ins of worker-start-service-boundaries.ts. */
export function WorkerStartContractFixture(): React.JSX.Element {
  return (
    <main>
      <WorkerStart />
    </main>
  );
}
