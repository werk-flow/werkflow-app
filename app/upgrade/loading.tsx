import {
  Card,
  CardContent,
  CardHeader
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function UpgradeLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <Skeleton className="mx-auto h-9 w-48" />
          <Skeleton className="mx-auto h-4 w-72" />
        </div>
        <Card>
          <CardHeader className="text-center">
            <Skeleton className="mx-auto size-12 rounded-full" />
            <Skeleton className="mx-auto h-7 w-32 mt-2" />
            <Skeleton className="mx-auto h-4 w-64 mt-1" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-10 w-full mt-4" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
