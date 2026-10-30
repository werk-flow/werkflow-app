import { expect, test } from 'bun:test';

import { NOTHING_TO_SAVE, saveFailureBanner } from '@/lib/settings/save-answers';

// The organization and break-rule saves answer `no_changes` when the
// normalized values equal the saved ones, such as a name that differs only in
// spaces. The press then has nothing to save: it reads as the info answer of
// an unchanged form, never as an error, even where an area map names the code.
test('a refused empty settings save reads as nothing to save, not as an error', () => {
  expect(
    saveFailureBanner('no_changes', { no_changes: 'Es wurden keine Änderungen vorgenommen.' }, 'Fehler.'),
  ).toEqual(NOTHING_TO_SAVE);
});

test('every other refused settings save stays an error with its area sentence', () => {
  expect(saveFailureBanner('name_taken', { name_taken: 'Name vergeben.' }, 'Fehler.')).toEqual({
    variant: 'error',
    message: 'Name vergeben.',
  });
  expect(saveFailureBanner('update_failed', {}, 'Fehler.')).toEqual({ variant: 'error', message: 'Fehler.' });
});
