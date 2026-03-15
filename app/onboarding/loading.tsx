import { Skeleton } from '@/components/ui/skeleton';

export default function OnboardingLoading() {
  return (
    <div className="w-full max-w-md">
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
