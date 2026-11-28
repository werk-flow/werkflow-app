import { Skeleton } from '@/components/ui/skeleton';

// The chat's timeline while a thread loads. It lives apart from `KiTimeline`: the
// organization-switch overlay loads the chat's page skeleton from the shared (app)
// layout, and a skeleton that imported the timeline brought the chat's rows into the
// layout's chunk packing (lib/conventions/app-layout-reaches-no-ki-chat.test.ts).
export function KiTimelineSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-6" aria-hidden="true">
      <Skeleton className="ml-auto h-10 w-2/3 rounded-lg" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="ml-auto h-10 w-1/2 rounded-lg" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}
