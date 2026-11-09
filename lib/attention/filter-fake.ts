// The PostgREST filter semantics the attention count fakes apply to a seeded
// world (count-volume.test.ts): comparisons, `not` and nested `or`/`and` terms.

type Row = Record<string, unknown>;
export type Filter = (row: Row) => boolean;

/** SQL semantics: a null column fails every comparison but `is null`. */
export function compare(operator: string, value: unknown, operand: unknown): boolean {
  if (operator === 'is') return operand === null ? value === null || value === undefined : value === operand;
  if (value === null || value === undefined) return false;
  const ordered = (test: (left: string | number, right: string | number) => boolean): boolean =>
    (typeof value === 'number' || typeof value === 'string') &&
    (typeof operand === 'number' || typeof operand === 'string') &&
    test(value, operand);
  switch (operator) {
    case 'eq':
      return value === operand;
    case 'neq':
      return value !== operand;
    case 'in':
      return Array.isArray(operand) && operand.includes(value);
    case 'gt':
      return ordered((left, right) => left > right);
    case 'gte':
      return ordered((left, right) => left >= right);
    case 'lt':
      return ordered((left, right) => left < right);
    case 'lte':
      return ordered((left, right) => left <= right);
    default:
      throw new Error(
        `The fake client cannot apply the operator ${operator}; teach it before you rely on it.`,
      );
  }
}

/** A PostgREST filter value: `null`, a boolean, a `(a,b)` list, or the text itself. */
export function parseOperand(operator: string, raw: string): unknown {
  if (operator === 'in') return raw.replace(/^\(|\)$/g, '').split(',');
  return raw === 'null' ? null : raw === 'true' ? true : raw === 'false' ? false : raw;
}

/** Splits `a,and(b,c),d` at its top-level commas. */
function topLevelTerms(text: string): string[] {
  const terms: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '(') depth += 1;
    else if (text[at] === ')') depth -= 1;
    else if (text[at] === ',' && depth === 0) {
      terms.push(text.slice(start, at));
      start = at + 1;
    }
  }
  return [...terms, text.slice(start)];
}

/** One term of an `or(...)` string: `col.op.value`, `col.not.op.value`, `and(...)` or `or(...)`. */
export function termFilter(term: string): Filter {
  const group = /^(and|or)\((.*)\)$/.exec(term);
  if (group) {
    const parts = topLevelTerms(group[2] ?? '').map(termFilter);
    return group[1] === 'and'
      ? (row) => parts.every((part) => part(row))
      : (row) => parts.some((part) => part(row));
  }
  const [column = '', operator = '', ...rest] = term.split('.');
  if (operator === 'not') {
    const [inner = '', ...value] = rest;
    const operand = parseOperand(inner, value.join('.'));
    return (row) =>
      row[column] !== null && row[column] !== undefined && !compare(inner, row[column], operand);
  }
  const operand = parseOperand(operator, rest.join('.'));
  return (row) => compare(operator, row[column], operand);
}
