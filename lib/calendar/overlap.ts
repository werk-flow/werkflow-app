export interface OverlapBlock {
  id: string;
  left: number;
  width: number;
}

export interface OverlapResult {
  id: string;
  columnIndex: number;
  totalColumns: number;
}

const OVERLAP_EPSILON = 0.5;

/**
 * Greedy column-packing algorithm (Google Calendar style).
 *
 * 1. Sort blocks by left edge, then wider first for stable layout.
 * 2. Place each block in the first column where it doesn't overlap.
 * 3. Find connected overlap groups via union-find so each group
 *    independently determines its own totalColumns.
 */
export function computeOverlapLayout(blocks: OverlapBlock[]): Map<string, OverlapResult> {
  if (blocks.length === 0) return new Map();

  const sorted = [...blocks].sort((a, b) => {
    if (a.left !== b.left) return a.left - b.left;
    return b.width - a.width;
  });

  const columns: Array<Array<{ id: string; left: number; right: number }>> = [];
  const blockColumn = new Map<string, number>();

  for (const block of sorted) {
    const right = block.left + block.width;
    let placed = false;

    for (let col = 0; col < columns.length; col++) {
      const hasOverlap = columns[col].some(
        (existing) =>
          block.left < existing.right - OVERLAP_EPSILON &&
          existing.left < right - OVERLAP_EPSILON
      );
      if (!hasOverlap) {
        columns[col].push({ id: block.id, left: block.left, right });
        blockColumn.set(block.id, col);
        placed = true;
        break;
      }
    }

    if (!placed) {
      columns.push([{ id: block.id, left: block.left, right }]);
      blockColumn.set(block.id, columns.length - 1);
    }
  }

  // Union-find for connected overlap groups
  const parent = new Map<string, string>();
  for (const b of sorted) parent.set(b.id, b.id);

  function find(x: string): string {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (cur !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (b.left >= a.left + a.width - OVERLAP_EPSILON) continue;
      union(a.id, b.id);
    }
  }

  // Compute totalColumns per group
  const groupColumns = new Map<string, Set<number>>();
  for (const b of sorted) {
    const root = find(b.id);
    if (!groupColumns.has(root)) groupColumns.set(root, new Set());
    groupColumns.get(root)!.add(blockColumn.get(b.id)!);
  }

  const result = new Map<string, OverlapResult>();
  for (const b of sorted) {
    const root = find(b.id);
    const totalColumns = groupColumns.get(root)!.size;
    result.set(b.id, {
      id: b.id,
      columnIndex: blockColumn.get(b.id)!,
      totalColumns,
    });
  }

  return result;
}
