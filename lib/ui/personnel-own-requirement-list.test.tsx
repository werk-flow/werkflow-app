import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PersonnelOwnRequirementList } from '@/components/mitarbeiter/personnel-own-actions-lists';
import { saveRequirementInputSchema } from '@/lib/personnel/lifecycle';
import type { PersonnelLifecycleRequirement } from '@/lib/personnel/lifecycle-rows';

// An employee confirms only an acknowledgement; Admin or Büro completes every
// other requirement type, so the own list offers no confirm button for it.
test('the own requirement list offers „Bestätigen“ only on an open acknowledgement', () => {
  const requirements = saveRequirementInputSchema.shape.requirementType.options.map(
    (requirementType, index): PersonnelLifecycleRequirement => ({
      id: `requirement-${requirementType}`,
      planId: 'plan-1',
      requirementType,
      title: `Aufgabe ${requirementType}`,
      description: null,
      isRequired: true,
      blocksAccess: true,
      ownerEmployeeRecordId: null,
      dueDate: null,
      state: 'missing',
      blockerReason: null,
      version: index + 1,
    }),
  );
  const markup = renderToStaticMarkup(
    <PersonnelOwnRequirementList
      requirements={requirements}
      isBusy={() => false}
      onAcknowledge={async () => {}}
    />,
  );
  const rows = markup.split('<li').slice(1);
  expect(rows).toHaveLength(requirements.length);
  const rowsWithButton = rows.flatMap((row) =>
    row.includes('Bestätigen') ? [row.match(/Aufgabe (\w+)/)?.[1]] : [],
  );
  expect(rowsWithButton).toEqual(['acknowledgement']);
});
