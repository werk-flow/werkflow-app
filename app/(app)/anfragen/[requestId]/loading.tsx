import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function AnfrageDetailLoading() {
  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: 'Anfragen', href: '/anfragen' }]}
        title={<Skeleton className="h-7 w-64 max-w-full sm:h-8" />}
        badges={<Skeleton className="h-5 w-20 rounded-full" />}
        subtitle={<Skeleton className="h-4 w-72 max-w-full" />}
        actions={<Skeleton className="h-9 w-32" />}
      />
      <PageBody maxWidth="content">
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-40 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      </PageBody>
    </PageShell>
  );
}
