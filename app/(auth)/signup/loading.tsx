import { FormCardSkeleton } from '@/components/loading-states/standalone-skeletons';

export default function SignupLoading() {
  return <FormCardSkeleton fields={4} footer />;
}
