/**
 * A module channel from a create button to the list that shows its result. The service pages
 * mount the create button in its own Suspense tree beside the heading, so a submission reaches
 * the list through this channel instead of props. The list is the one listener: it renders the
 * pending row, settles through its live read, and shows the failure banner.
 */
export type SubmissionChannel<Submission> = {
  announce: (submission: Submission) => void;
  /** Adds the listener and returns its removal, the shape an effect cleanup takes. */
  subscribe: (listener: (submission: Submission) => void) => () => void;
};

export function createSubmissionChannel<Submission>(): SubmissionChannel<Submission> {
  const listeners = new Set<(submission: Submission) => void>();
  return {
    announce: (submission) => {
      for (const listener of listeners) listener(submission);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
