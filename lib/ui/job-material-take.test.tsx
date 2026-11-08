import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  materialDialogCatalog,
  type MaterialDialogRow,
  type MaterialDialogState,
} from '@/components/inventar/job-material-dialog-model';
import { MaterialItemPicker } from '@/components/inventar/job-material-item-picker';
import { MaterialLineRow } from '@/components/inventar/job-material-line-row';
import type { JobMaterialLine } from '@/lib/inventory/types';

function dialogRow(patch: Partial<MaterialDialogRow> = {}): MaterialDialogRow {
  return {
    key: 'line-1',
    lineId: 'line-1',
    itemId: 'item-1',
    locationId: 'location-1',
    quantity: '2',
    notes: '',
    takenQuantity: 0,
    returnedQuantity: 0,
    ...patch,
  };
}

function dialog(patch: Partial<MaterialDialogState>): MaterialDialogState {
  return { mode: 'take', rows: [], search: '', error: null, catalogOpen: false, ...patch };
}

describe('the material dialog catalog', () => {
  test('a take opened on a planned line shows that line alone, not the catalog', () => {
    expect(materialDialogCatalog(dialog({ rows: [dialogRow()] }))).toBe('collapsed');
  });

  test('„Weiteres Material“ opens the catalog beside the line', () => {
    expect(materialDialogCatalog(dialog({ rows: [dialogRow()], catalogOpen: true }))).toBe('catalog');
  });

  test('a take without a line starts in the catalog', () => {
    expect(materialDialogCatalog(dialog({ rows: [], catalogOpen: true }))).toBe('catalog');
  });

  test('a return and an edit with bookings keep their item', () => {
    expect(materialDialogCatalog(dialog({ mode: 'return', rows: [dialogRow({ takenQuantity: 2 })] }))).toBe(
      'locked',
    );
    expect(materialDialogCatalog(dialog({ mode: 'edit', rows: [dialogRow({ takenQuantity: 2 })] }))).toBe(
      'locked',
    );
    expect(materialDialogCatalog(dialog({ mode: 'edit', rows: [dialogRow()] }))).toBe('catalog');
  });
});

const takenLine: JobMaterialLine = {
  id: 'line-1',
  jobId: 'job-1',
  projectId: null,
  itemId: 'item-1',
  itemName: 'Flachheizkörper Typ 22',
  itemType: 'material',
  unit: 'piece',
  categoryName: null,
  preferredLocationId: 'location-1',
  preferredLocationName: 'Hauptlager',
  plannedQuantity: 2,
  takenQuantity: 2,
  returnedQuantity: 0,
  billableQuantity: 0,
  isBillable: false,
  isUnplanned: false,
  status: 'taken',
  notes: null,
  availableQuantity: 0,
};

/** The line's visible text: class names such as `px-2` must not count as a „-2“. */
function renderLine(line: JobMaterialLine): string {
  return textOf(
    renderToStaticMarkup(
      <MaterialLineRow
        line={line}
        isAdminOrManager={false}
        isBusy={false}
        locations={[]}
        onTake={() => {}}
        onReturn={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    ),
  );
}

function textOf(markup: string): string {
  return markup.replace(/<[^>]+>/g, ' ');
}

describe('a booked material line', () => {
  test('a take reads as the taken quantity, never as a signed shortage', () => {
    const markup = renderLine(takenLine);
    expect(markup).toContain('2 Stück entnommen');
    expect(markup).not.toContain('-2');
    expect(markup).not.toContain('Noch draußen');
    expect(markup).not.toContain('Beim Auftrag');
  });

  test('after a return the line names what came back and what stays at the job', () => {
    const markup = renderLine({ ...takenLine, returnedQuantity: 1 });
    expect(markup).toContain('1 Stück zurückgelegt');
    expect(markup).toContain('Beim Auftrag: 1 Stück');
    expect(markup).not.toContain('+1');
  });
});

describe('the material search', () => {
  function renderPicker(showSupplier: boolean): string {
    return renderToStaticMarkup(
      <MaterialItemPicker
        mode="take"
        showSupplier={showSupplier}
        search=""
        onSearchChange={() => {}}
        filteredItems={[]}
        hasMoreItems={false}
        isSearching={false}
        searchFailed={false}
        onRetrySearch={() => {}}
        onAdd={() => {}}
      />,
    );
  }

  test('a field worker is never offered a supplier search', () => {
    expect(renderPicker(false)).not.toContain('Lieferant');
    expect(renderPicker(true)).toContain('Lieferant');
  });
});
