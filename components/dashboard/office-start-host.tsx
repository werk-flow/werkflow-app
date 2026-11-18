import { OfficeStartSkeleton } from '@/components/loading-states/office-start-skeleton';
import { OFFICE_START_HOST_ID } from './office-start-host-id';

/**
 * Where the office start renders on the dashboard of Admin and Büro. The app
 * shell renders the office start into this element (`OfficeStartPortal` in
 * components/aufgaben/aufgaben-content.tsx); until it is there, the server's
 * skeleton holds the place. A server file, so the dashboard's client entry
 * gains no module of the shell's Aufgaben code (see that portal).
 */
export function OfficeStartHost() {
  return (
    <div id={OFFICE_START_HOST_ID} className="group/office-start">
      <div className="mx-auto max-w-3xl group-has-[[data-office-start]]/office-start:hidden">
        <OfficeStartSkeleton />
      </div>
    </div>
  );
}
