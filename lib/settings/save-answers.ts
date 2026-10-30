import { describeFailure } from '@/lib/action-messages';

/** A banner a settings save shows: the answer to an unchanged form, or a refused save. */
type SaveAnswer = { variant: 'info' | 'error'; message: string };

/**
 * The answer to a settings save pressed without a change. The save button
 * stays enabled (werkflow-design: Forms and Enter), so the press says why
 * nothing happened instead of sending an empty write.
 */
export const NOTHING_TO_SAVE: SaveAnswer = {
  variant: 'info',
  message: 'Es gibt keine Änderungen zu speichern.',
};

/**
 * The banner for a refused settings save. The server answers `no_changes`
 * when the normalized values equal the saved ones, such as a name that
 * differs only in spaces: that is nothing to save, never an error.
 */
export function saveFailureBanner(
  error: string,
  messages: Readonly<Record<string, string>>,
  fallback: string,
): SaveAnswer {
  if (error === 'no_changes') return NOTHING_TO_SAVE;
  return { variant: 'error', message: describeFailure(error, messages, fallback) };
}
