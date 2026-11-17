import { StandaloneScreen } from '@/components/shared/standalone-screen';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function CheckoutCancelledLoading() {
  return (
    <StandaloneScreen>
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <Skeleton className="mx-auto h-9 w-64" />
          <Skeleton className="mx-auto h-4 w-72" />
        </div>
        <Card>
          <CardHeader className="text-center">
            <Skeleton className="mx-auto size-12 rounded-full" />
            <Skeleton className="mx-auto h-7 w-44 mt-2" />
            <Skeleton className="mx-auto h-4 w-full mt-1" />
            <Skeleton className="mx-auto h-4 w-56" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      </div>
    </StandaloneScreen>
  );
}
