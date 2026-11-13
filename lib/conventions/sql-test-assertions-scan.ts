import { isUuid } from '@/lib/validation/uuid';

// The pure scanner behind lib/conventions/sql-test-assertions.test.ts. It reads
// SQL text only, so the test can plant each real finding without touching the
// tree.

type Token = { readonly text: string; readonly lower: string; readonly offset: number };

/** One assertion that a NULL or another organization's row can satisfy. */
export type AssertionFinding = {
  readonly line: number;
  readonly rule: 'null-safe' | 'org-scope';
  readonly code: string;
};

// An operator is a run of operator characters, as PostgreSQL reads it: `#>>`
// and `<>` stay whole, and a run never ends in `+` or `-`, so `<>-1` is `<>`.
const TOKEN =
  /'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_$]*|\d+(?:\.\d+)?|::|[-+*/<>=~!@#%^&|`?]*[*/<>=~!@#%^&|`?]|[-+]|\$[A-Za-z_]*\$|\S/g;
const OPEN = new Set(['(', '[']);
const CLOSE = new Set([')', ']']);
const COMPARISONS = new Set(['=', '<', '>', '<=', '>=', '<>', '!=']);
/** Operators that bind looser than `+` or `||`, so they end an operand of `<>`. */
const LOOSER = ['is', 'in', 'like', 'ilike', 'similar', 'between', 'isnull', 'notnull'];
const LEFT_STOPS = new Set(['and', 'or', 'not', 'if', 'elsif', 'when', 'then', 'else', ',', ...LOOSER]);
const RIGHT_STOPS = new Set(['and', 'or', 'then', 'when', 'else', 'end', ',', ';', ...LOOSER]);
/** Expressions that are never NULL whatever the rows hold. */
const NEVER_NULL_WORDS = new Set(['true', 'false', 'sqlerrm', 'sqlstate', 'found']);

/** The text with comments blanked and every string literal's content kept; offsets stay. */
function blankComments(source: string): string {
  return source.replace(/'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g, (match) =>
    match.startsWith("'") ? match : match.replace(/[^\n]/g, ' '),
  );
}

function tokenize(source: string): Token[] {
  return [...blankComments(source).matchAll(TOKEN)].map((match) => ({
    text: match[0],
    lower: match[0].toLowerCase(),
    offset: match.index,
  }));
}

/** The index of the bracket that closes the one at `open`, or the last index. */
function closing(tokens: readonly Token[], open: number): number {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    const token = tokens[index]?.lower ?? '';
    if (OPEN.has(token)) depth += 1;
    if (CLOSE.has(token)) depth -= 1;
    if (depth === 0) return index;
  }
  return tokens.length - 1;
}

/** The index of the bracket that opens the one at `close`, or -1. */
function opening(tokens: readonly Token[], close: number): number {
  let depth = 0;
  for (let index = close; index >= 0; index -= 1) {
    const token = tokens[index]?.lower ?? '';
    if (CLOSE.has(token)) depth += 1;
    if (OPEN.has(token)) depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

/** The left operand of the operator at `at`, inside the condition's tokens. */
function leftOperand(tokens: readonly Token[], at: number): Token[] {
  let start = at;
  for (let index = at - 1; index >= 0; index -= 1) {
    const token = tokens[index]?.lower ?? '';
    if (CLOSE.has(token)) index = opening(tokens, index);
    else if (OPEN.has(token) || LEFT_STOPS.has(token) || COMPARISONS.has(token)) break;
    start = index;
  }
  return tokens.slice(start, at);
}

function rightOperand(tokens: readonly Token[], at: number): Token[] {
  let end = at + 1;
  for (let index = at + 1; index < tokens.length; index += 1) {
    const token = tokens[index]?.lower ?? '';
    if (CLOSE.has(token) || RIGHT_STOPS.has(token) || COMPARISONS.has(token)) break;
    if (OPEN.has(token)) index = closing(tokens, index);
    end = index + 1;
  }
  return tokens.slice(at + 1, end);
}

/** The operand without its `::type` casts and a leading sign. */
function uncast(operand: readonly Token[]): Token[] {
  const kept: Token[] = [];
  for (let index = 0; index < operand.length; index += 1) {
    if (operand[index]?.lower === '::') {
      index += 1;
      while (operand[index + 1]?.lower === '[' && operand[index + 2]?.lower === ']') index += 2;
    } else {
      const token = operand[index];
      if (token) kept.push(token);
    }
  }
  return kept[0]?.lower === '-' ? kept.slice(1) : kept;
}

/** The comma-separated arguments between the brackets at `open` and `close`. */
function argumentsOf(tokens: readonly Token[], open: number, close: number): Token[][] {
  const parts: Token[][] = [[]];
  for (let index = open + 1; index < close; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (token.lower === ',') parts.push([]);
    else if (OPEN.has(token.lower)) {
      const end = closing(tokens, index);
      parts.at(-1)?.push(...tokens.slice(index, end + 1));
      index = end;
    } else parts.at(-1)?.push(token);
  }
  return parts;
}

/** Whether the expression is NULL for no rows and no variable value. */
function neverNull(expression: readonly Token[]): boolean {
  const tokens = uncast(expression);
  const [first, second] = tokens;
  if (!first) return false;
  if (tokens.length === 1)
    return NEVER_NULL_WORDS.has(first.lower) || first.lower.startsWith("'") || /^\d/.test(first.lower);
  const last = tokens.length - 1;
  const groupAt = first.lower === '(' ? 0 : second && OPEN.has(second.lower) ? 1 : -1;
  if (groupAt < 0 || closing(tokens, groupAt) !== last) return false;
  if (groupAt === 0) {
    const inner = tokens.slice(1, last);
    // `select count(…) [filter (…)] from …` without grouping, HAVING, LIMIT or OFFSET always returns one row.
    if (inner[0]?.lower === 'select' && inner[1]?.lower === 'count' && inner[2]?.lower === '(') {
      const after = closing(inner, 2) + 1;
      const from = inner[after]?.lower === 'filter' ? closing(inner, after + 1) + 1 : after;
      return (
        inner[from]?.lower === 'from' &&
        !inner.some((token) => ['group', 'having', 'limit', 'offset'].includes(token.lower))
      );
    }
    return neverNull(inner);
  }
  if (first.lower === 'exists' || first.lower === 'array') return true;
  if (first.lower === 'coalesce') return argumentsOf(tokens, 1, last).some(neverNull);
  return false;
}

/** Whether the token at `at` sits inside a bracketed subquery of the condition. */
function insideSubquery(tokens: readonly Token[], at: number): boolean {
  let depth = 0;
  for (let index = at - 1; index >= 0; index -= 1) {
    const token = tokens[index]?.lower ?? '';
    if (CLOSE.has(token)) depth += 1;
    if (OPEN.has(token)) {
      if (depth === 0) {
        if (tokens[index + 1]?.lower === 'select' || tokens[index + 1]?.lower === 'with') return true;
      } else depth -= 1;
    }
  }
  return false;
}

/** The condition of each `if … then raise` (or `elsif`), as its tokens. */
function assertionConditions(tokens: readonly Token[]): Token[][] {
  const conditions: Token[][] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]?.lower;
    if ((token !== 'if' && token !== 'elsif') || tokens[index - 1]?.lower === 'end') continue;
    let depth = 0;
    let cases = 0;
    for (let end = index + 1; end < tokens.length; end += 1) {
      const current = tokens[end]?.lower ?? '';
      if (OPEN.has(current)) depth += 1;
      if (CLOSE.has(current)) depth -= 1;
      if (current === 'case') cases += 1;
      if (current === 'end' && cases > 0) cases -= 1;
      if (current === 'then' && depth === 0 && cases === 0) {
        if (tokens[end + 1]?.lower === 'raise') conditions.push(tokens.slice(index + 1, end));
        break;
      }
      if (current === ';') break;
    }
  }
  return conditions;
}

/** The source text the tokens span, on one line. */
function code(source: string, tokens: readonly Token[]): string {
  const first = tokens[0];
  const last = tokens.at(-1);
  if (!first || !last) return '';
  return source.slice(first.offset, last.offset + last.text.length).replace(/\s+/g, ' ');
}

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

function nullableComparisons(source: string, tokens: readonly Token[]): AssertionFinding[] {
  return assertionConditions(tokens).flatMap((condition) =>
    condition.flatMap((token, at) => {
      if (token.lower !== '<>' && token.lower !== '!=') return [];
      if (insideSubquery(condition, at)) return [];
      const left = leftOperand(condition, at);
      const right = rightOperand(condition, at);
      if (neverNull(left) && neverNull(right)) return [];
      const line = lineOf(source, token.offset);
      return [{ line, rule: 'null-safe' as const, code: code(source, [...left, token, ...right]) }];
    }),
  );
}

/**
 * A relation a select reads, the index of its name token, whether it is a
 * function call, and whether an inner `join … on` adds it.
 */
type Relation = {
  readonly schema: string | null;
  readonly name: string;
  readonly at: number;
  readonly call: boolean;
  readonly joinedOn: boolean;
  /** The tokens of the join's `on` condition, empty for a relation without one. */
  readonly on: Token[];
};

/** The relations a select reads in its own FROM clause. */
function relationsRead(select: readonly Token[]): Relation[] {
  const relations: Relation[] = [];
  let depth = 0;
  for (let index = 0; index < select.length; index += 1) {
    const token = select[index]?.lower ?? '';
    if (OPEN.has(token)) depth += 1;
    if (CLOSE.has(token)) depth -= 1;
    if (depth !== 0 || (token !== 'from' && token !== 'join' && token !== ',')) continue;
    if (token === ',' && !select.slice(0, index).some((earlier) => earlier.lower === 'from')) continue;
    const first = select[index + 1]?.lower ?? '';
    if (!/^[a-z_]/.test(first)) continue;
    const at = select[index + 2]?.lower === '.' ? index + 3 : index + 1;
    const call = select[at + 1]?.lower === '(';
    // `cross join` and the outer joins restrict nothing.
    const kind = select[index - 1]?.lower ?? '';
    const joinedOn =
      token === 'join' &&
      !['cross', 'left', 'right', 'full', 'outer', 'natural'].includes(kind) &&
      select.slice(at + 1, at + 4).some((part) => part.lower === 'on');
    const schema = at > index + 1 ? first : null;
    relations.push({
      schema,
      name: select[at]?.lower ?? '',
      at,
      call,
      joinedOn,
      on: joinedOn ? onClause(select, at) : [],
    });
  }
  return relations;
}

const CLAUSE_ENDS = new Set([
  'join',
  'where',
  'group',
  'order',
  'limit',
  'offset',
  'union',
  'cross',
  'left',
  'right',
  'full',
  'inner',
  'natural',
]);

/** The tokens after the first `on` past `at`, up to the next join or clause at the same depth. */
function onClause(select: readonly Token[], at: number): Token[] {
  const start = select.findIndex((token, index) => index > at && token.lower === 'on') + 1;
  let end = start;
  for (; end < select.length; end += 1) {
    const token = select[end]?.lower ?? '';
    if (CLOSE.has(token) || CLAUSE_ENDS.has(token)) break;
    if (OPEN.has(token)) end = closing(select, end);
  }
  return select.slice(start, end);
}

/** A variable or parameter that holds the test's organization. */
const ORGANIZATION_VARIABLE = /^(?:[vp]_)?org(?:anization)?(?:_id)?$/;

/** The select's own tokens after its first WHERE, without nested subqueries. */
function ownFilter(select: readonly Token[]): Token[] {
  const own: Token[] = [];
  let depth = 0;
  let filtering = false;
  for (let index = 0; index < select.length; index += 1) {
    const token = select[index];
    if (!token) continue;
    if (token.lower === '(' && select[index + 1]?.lower === 'select') {
      index = closing(select, index);
      continue;
    }
    if (OPEN.has(token.lower)) depth += 1;
    if (CLOSE.has(token.lower)) depth -= 1;
    if (depth === 0 && (token.lower === 'where' || token.lower === 'on')) filtering = true;
    if (filtering) own.push(token);
  }
  return own;
}

/** A restricting comparison in the filter: `=`, `in`, `like` or `is not distinct from`, as its first and last index. */
type Restriction = { readonly start: number; readonly end: number };

function restrictions(filter: readonly Token[]): Restriction[] {
  return filter.flatMap((token, index) => {
    const before = (back: number) => filter[index - back]?.lower;
    if (token.lower === '=') return [{ start: index, end: index }];
    if ((token.lower === 'in' || token.lower === 'like') && before(1) !== 'not')
      return [{ start: index, end: index }];
    if (token.lower === 'from' && before(1) === 'distinct' && before(2) === 'not' && before(3) === 'is')
      return [{ start: index - 3, end: index }];
    return [];
  });
}

/** The operands on both sides of a restriction, the left one cut at the clause that opens it. */
function restrictedOperands(filter: readonly Token[], { start, end }: Restriction): Token[] {
  const left = leftOperand(filter, start);
  const clause = left.findLastIndex((token) => ['where', 'on', 'join'].includes(token.lower));
  return [...left.slice(clause + 1), ...rightOperand(filter, end)];
}

const ID_COLUMN = /^(?:id|\w+_id|\w+_by)$/;

/**
 * Whether the select's own filter keeps to the test's rows: a restricting
 * comparison has an id column (`organization_id` included) as one side, or an
 * organization variable or a literal that starts with a fixture id in an operand.
 */
function scoped(select: readonly Token[]): boolean {
  const filter = ownFilter(select);
  return restrictions(filter).some((restriction) => {
    if (ID_COLUMN.test(filter[restriction.start - 1]?.lower ?? '')) return true;
    if (ID_COLUMN.test(filter[restriction.end + 1]?.lower ?? '')) return true;
    // An organization variable or a fixture-id literal, such as a storage path, may sit in a list or a concatenation.
    return restrictedOperands(filter, restriction).some(
      (token) =>
        ORGANIZATION_VARIABLE.test(token.lower) ||
        (token.text.startsWith("'") && isUuid(token.text.slice(1, 37))),
    );
  });
}

/** Whether a join condition equates a column of one relation with a column of another. */
function correlates(on: readonly Token[]): boolean {
  const qualifiers = (operand: readonly Token[]) =>
    operand.flatMap((token, index) => (operand[index + 1]?.lower === '.' ? [token.lower] : []));
  return restrictions(on).some(({ start, end }) => {
    const left = qualifiers(leftOperand(on, start));
    const right = qualifiers(rightOperand(on, end));
    return left.some((qualifier) => right.some((other) => other !== qualifier));
  });
}

/** Roles whose reads row-level security already limits to what the session may see. */
const CLIENT_ROLES = new Set(['authenticated', 'anon']);
const ROLE_CHANGE = /\b(?:set\s+(?:local\s+|session\s+)?role\s+(\w+)|(reset)\s+role)\b/gi;

/** The session role in force at each token, from `set [local] role` and `reset role` in file order. */
function rolesAt(tokens: readonly Token[]): string[] {
  const roles: string[] = [];
  let role = 'postgres';
  tokens.forEach((token, index) => {
    // A role change is a statement of up to four tokens, or a string that `execute` runs.
    const statement = token.lower === 'set' || token.lower === 'reset';
    const text = statement
      ? tokens
          .slice(index, index + 4)
          .map((part) => part.lower)
          .join(' ')
      : token.lower.startsWith("'") && tokens[index - 1]?.lower === 'execute'
        ? token.lower
        : '';
    for (const [, set, reset] of text.matchAll(ROLE_CHANGE)) role = reset ? 'postgres' : (set ?? role);
    roles.push(role);
  });
  return roles;
}

/** Each `exists (select …)` and `select count(…)` read with its tokens. */
function countingReads(tokens: readonly Token[]): { readonly at: number; readonly select: Token[] }[] {
  const reads: { at: number; select: Token[] }[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]?.lower;
    if (token === 'exists' && tokens[index + 1]?.lower === '(' && tokens[index + 2]?.lower === 'select') {
      reads.push({ at: index, select: tokens.slice(index + 2, closing(tokens, index + 1)) });
    } else if (
      token === 'select' &&
      tokens[index + 1]?.lower === 'count' &&
      tokens[index + 2]?.lower === '('
    ) {
      let end = index + 1;
      let depth = 0;
      for (; end < tokens.length; end += 1) {
        const current = tokens[end]?.lower ?? '';
        if (OPEN.has(current)) depth += 1;
        if (CLOSE.has(current)) depth -= 1;
        if (depth < 0 || (depth === 0 && current === ';')) break;
      }
      reads.push({ at: index, select: tokens.slice(index, end) });
    }
  }
  return reads;
}

function unscopedReads(
  source: string,
  tokens: readonly Token[],
  tenantTables: ReadonlySet<string>,
): AssertionFinding[] {
  const roles = rolesAt(tokens);
  return countingReads(tokens).flatMap(({ at, select }) => {
    // Under a client role the read proves a policy: a filter would hide a leak.
    if (CLIENT_ROLES.has(roles[at] ?? '')) return [];
    const relations = relationsRead(select);
    const tenant = relations.find(
      ({ schema, name }) => (schema === null || schema === 'public') && tenantTables.has(name),
    );
    if (!tenant) return [];
    // A join with the test's own temporary rows keeps the read to them.
    const joinsOwnRows =
      relations.some(({ joinedOn, on }) => joinedOn && correlates(on)) &&
      relations.some(
        ({ schema, name, call }) =>
          !call && (schema === null || schema === 'pg_temp') && !tenantTables.has(name),
      );
    if (joinsOwnRows || scoped(select)) return [];
    const line = lineOf(source, tokens[at]?.offset ?? 0);
    return [{ line, rule: 'org-scope' as const, code: code(source, select.slice(0, tenant.at + 1)) }];
  });
}

/**
 * The assertions in one SQL test that can pass for the wrong reason: a `<>` or
 * `!=` in an `if … then raise` condition that a NULL operand turns into NULL,
 * and a count or existence read over a tenant table that another
 * organization's rows can answer.
 */
export function sqlAssertionFindings(source: string, tenantTables: ReadonlySet<string>): AssertionFinding[] {
  const tokens = tokenize(source);
  return [...nullableComparisons(source, tokens), ...unscopedReads(source, tokens, tenantTables)].sort(
    (a, b) => a.line - b.line,
  );
}
