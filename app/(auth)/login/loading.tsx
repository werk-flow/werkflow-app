import { FormCardSkeleton } from '@/components/loading-states/standalone-skeletons';

export default function LoginLoading() {
  return <FormCardSkeleton fields={2} footer />;
}
