import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// The loading states of the screens outside the app shell. Each route's
// loading.tsx renders the shape of its own screen inside the frame its layout
// already shows (StandaloneScreen): the form card of sign-in and onboarding
// with its number of fields, or the screen's own blocks.

/** The `StandaloneTitle` line and the description below it. */
function TitleSkeleton({ centered }: { centered: boolean }) {
  const align = centered ? 'mx-auto' : '';
  return (
    <>
      <Skeleton className={`h-8 w-56 max-w-full ${align}`} />
      <Skeleton className={`mt-1 h-4 w-72 max-w-full ${align}`} />
    </>
  );
}

/**
 * A form card: title, description, one label and control per field, the
 * submit button, and the link line below the card where the screen has one.
 */
export function FormCardSkeleton({
  fields,
  centered = false,
  footer = false,
  code = false,
}: {
  fields: number;
  centered?: boolean;
  footer?: boolean;
  /** The one-time code field: six separate slots instead of one input. */
  code?: boolean;
}) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className={centered ? 'text-center' : undefined}>
        <TitleSkeleton centered={centered} />
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from({ length: fields }, (_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-4 w-28" />
            {code ? (
              <div className="flex gap-2.5">
                {Array.from({ length: 6 }, (_, slot) => (
                  <Skeleton key={slot} className="size-10" />
                ))}
              </div>
            ) : (
              <Skeleton className="h-9 w-full" />
            )}
          </div>
        ))}
        <Skeleton className="h-9 w-full" />
      </CardContent>
      {footer && (
        <CardFooter className="flex justify-center">
          <Skeleton className="h-4 w-48" />
        </CardFooter>
      )}
    </Card>
  );
}

/** The onboarding start: the title and the two choice cards side by side from the tablet width. */
export function OnboardingChoiceSkeleton() {
  return (
    <div className="w-full max-w-2xl space-y-8">
      <div className="space-y-2 text-center">
        <TitleSkeleton centered />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((card) => (
          <Card key={card}>
            <CardHeader className="space-y-4">
              <Skeleton className="size-12 rounded-lg" />
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-9 w-full" />
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** The prestart page: the title and the list of the person's own onboarding tasks. */
export function PrestartTasksSkeleton() {
  return (
    <div className="w-full max-w-2xl space-y-6">
      <div className="space-y-2 text-center">
        <TitleSkeleton centered />
      </div>
      <Card>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-56 max-w-full" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
