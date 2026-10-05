import { describe, expect, test } from 'bun:test';

import {
  applyMaterialLinePlan,
  buildPlannedMaterialLineDraft,
  type MaterialLinePlan,
} from './material-line-echo';
import type { JobMaterialLine } from './types';

const plan: MaterialLinePlan = {
  item: {
    id: 'item-1',
    itemType: 'material',
    name: 'Kupferrohr 15 mm',
    unit: 'm',
    internalSku: null,
    manufacturer: null,
    supplierName: null,
    supplierArticleNumber: null,
    primaryBarcode: null,
    categoryName: 'Rohre',
    isBillable: true,
    availableQuantity: 40,
    stockByLocation: [],
  },
  preferredLocationId: 'location-1',
  preferredLocationName: 'Hauptlager',
  plannedQuantity: 12,
  notes: '  ',
};

describe('material line echo', () => {
  test('a planned draft books nothing and carries the dialog row', () => {
    const draft = buildPlannedMaterialLineDraft({ id: 'temp-1', jobId: 'job-1', projectId: null }, plan);
    expect(draft).toMatchObject({
      id: 'temp-1',
      jobId: 'job-1',
      itemName: 'Kupferrohr 15 mm',
      preferredLocationName: 'Hauptlager',
      plannedQuantity: 12,
      takenQuantity: 0,
      returnedQuantity: 0,
      status: 'planned',
      isUnplanned: false,
      notes: null,
    });
  });

  test('an edit keeps booked quantities and status', () => {
    const line: JobMaterialLine = {
      ...buildPlannedMaterialLineDraft({ id: 'line-1', jobId: 'job-1', projectId: null }, plan),
      takenQuantity: 5,
      returnedQuantity: 1,
      status: 'partially_taken',
    };
    const edited = applyMaterialLinePlan(line, { ...plan, plannedQuantity: 20, notes: 'Nachbestellt' });
    expect(edited).toMatchObject({
      id: 'line-1',
      plannedQuantity: 20,
      notes: 'Nachbestellt',
      takenQuantity: 5,
      returnedQuantity: 1,
      status: 'partially_taken',
    });
  });
});
