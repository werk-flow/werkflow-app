import { ZeiterfassungHeader } from '@/components/zeiterfassung/zeiterfassung-header';
import { ZeiterfassungContentSkeleton } from '@/components/loading-states/zeiterfassung-content-skeleton';

export default function ZeiterfassungLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ZeiterfassungHeader />

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <ZeiterfassungContentSkeleton />
      </div>
    </div>
  );
}
