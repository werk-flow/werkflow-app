import type { ReactElement } from 'react';

import { ErrorText } from '@/components/ui/error-text';

/**
 * One key per button group. The busy state and the feedback line are scoped
 * to the operation so only the clicked button spins and the message appears
 * where the click happened, not at the foot of a long card.
 */
export type HandoverOperation = 'draft' | 'preview' | 'release' | 'withdraw' | 'correction' | 'document';
export type HandoverFeedback = { operation: HandoverOperation; tone: 'success' | 'error'; message: string };

export function FeedbackText({ feedback }: { feedback: HandoverFeedback | null }): ReactElement | null {
  if (!feedback) return null;
  if (feedback.tone === 'error') return <ErrorText>{feedback.message}</ErrorText>;
  return (
    <p role="status" className="text-sm text-success-text">
      {feedback.message}
    </p>
  );
}
