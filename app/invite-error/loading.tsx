import { Skeleton } from '@/components/ui/skeleton';

export default function InviteErrorLoading() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mx-auto max-w-md text-center">
        <Skeleton className="mx-auto mb-6 size-20 rounded-full" />
        <Skeleton className="mx-auto mb-2 h-8 w-48" />
        <Skeleton className="mx-auto mb-8 h-4 w-72" />
        <Skeleton className="mx-auto h-10 w-36" />
      </div>
    </main>
  );
}
