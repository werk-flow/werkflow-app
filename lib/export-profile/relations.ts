import type { ColumnAccumulator, ColumnType } from './column-statistics';

// Candidate relations between tables: a key-like column whose values another
// table's column repeats. Both sides are compared as salted hashes in memory.

type RelationColumn = {
  label: string;
  accumulator: ColumnAccumulator;
  type: ColumnType;
  keyLike: boolean;
  maxLength: number | null;
};

/** `id` tells tables apart; `table` is the shown label, which masking can make equal for two tables. */
export type TableColumns = { id: number; table: string; columns: readonly RelationColumn[] };

export type Relation = {
  key: { table: string; column: string };
  referencedBy: { table: string; column: string };
  sharedValues: number;
  coverage: number;
  note: string | null;
};

const MIN_SHARED = 3;
const MIN_COVERAGE = 0.6;
const RELATION_LIMIT = 200;
const COMPARABLE: readonly ColumnType[] = ['integer', 'digit_code', 'text', 'mixed'];

/** Columns of other tables whose values mostly appear in a key-like column. */
export function findRelations(tables: readonly TableColumns[]): Relation[] {
  const relations: Relation[] = [];
  for (const keyTable of tables) {
    for (const key of keyTable.columns) {
      if (!key.keyLike || key.accumulator.hashes.size < MIN_SHARED) continue;
      for (const otherTable of tables) {
        if (otherTable.id === keyTable.id) continue;
        for (const candidate of otherTable.columns) {
          const relation = compare(keyTable.table, key, otherTable.table, candidate);
          if (relation) relations.push(relation);
        }
      }
    }
  }
  return relations
    .sort((first, second) => second.coverage - first.coverage || second.sharedValues - first.sharedValues)
    .slice(0, RELATION_LIMIT);
}

function compare(
  keyTable: string,
  key: RelationColumn,
  otherTable: string,
  candidate: RelationColumn,
): Relation | null {
  if (!COMPARABLE.includes(candidate.type) || candidate.accumulator.hashes.size < MIN_SHARED) return null;
  let shared = 0;
  for (const hash of candidate.accumulator.hashes) {
    if (key.accumulator.hashes.has(hash)) shared += 1;
  }
  const coverage = shared / candidate.accumulator.hashes.size;
  if (shared < MIN_SHARED || coverage < MIN_COVERAGE) return null;
  const smallNumbers =
    key.type === 'integer' && candidate.type === 'integer' && (candidate.maxLength ?? 0) <= 3;
  return {
    key: { table: keyTable, column: key.label },
    referencedBy: { table: otherTable, column: candidate.label },
    sharedValues: shared,
    coverage: Math.round(coverage * 1000) / 1000,
    note: smallNumbers ? 'small numbers on both sides: may be a coincidence' : null,
  };
}
