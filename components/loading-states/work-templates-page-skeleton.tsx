import { Skeleton } from '@/components/ui/skeleton'

export function WorkTemplatesPageSkeleton() {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2"><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-80 max-w-full" /></div>
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
      <div className="space-y-3 rounded-lg border p-4">
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}
      </div>
    </div>
  )
}
