// What a migration changes, read from its SQL for the migration-order gate
// (docs/technical/environments.md, "The migration rule"). DEV and PROD apply a
// merged migration after main's newer ones, a fresh database in version order;
// two migrations commute when they change different objects. The reader names
// each statement's targets by bare name, with the schema only when the SQL
// writes it. It follows neither the search path nor an object's kind: an
// unqualified name matches that name in every schema, and a table, view,
// index, function or type of one name are one target. A statement it cannot
// read, or one with CASCADE, which removes dependents the SQL does not name, is
// opaque, and an opaque statement conflicts with every other migration. A table
// definition counts the tables and types it copies or hangs from (LIKE,
// INHERITS, PARTITION OF, OF), and a policy, trigger or publication member
// conflicts with every change to its table.
// Each choice can add a conflict PostgreSQL would not have, which costs a
// rename, and never drops one. It misses a change made only through a call: a
// function body or trigger that writes when a later statement runs it, and the
// targets of dynamic SQL in a function it creates.

/**
 * One changed object. `schema` is null for an unqualified name, which matches every schema; a `*`
 * name stands for every object in the schema. A policy or trigger is named on its table with its own
 * name in `part`; a publication member is its table with the publication in `part`.
 */
type MigrationTarget = { kind: TargetKind; schema: string | null; name: string; part: string | null };

type TargetKind =
  | 'object'
  | 'policy'
  | 'trigger'
  | 'publication'
  | 'schema'
  | 'extension'
  | 'role'
  | 'cron job';

export type MigrationChanges = {
  targets: MigrationTarget[];
  /** The opening words of each statement the reader cannot name a target for. */
  opaque: string[];
};

type Token = { text: string; quoted: boolean; string: boolean };

/** Splits SQL into statements without comments; strings and dollar-quoted bodies stay whole. */
function statements(sql: string): string[] {
  const result: string[] = [];
  let current = '';
  let index = 0;
  const flush = (): void => {
    if (current.trim()) result.push(current.trim());
    current = '';
  };
  const dollarQuote = /\$([\p{L}_][\p{L}\p{N}_]*)?\$/uy;
  while (index < sql.length) {
    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end;
      current += ' ';
      continue;
    }
    if (sql.startsWith('/*', index)) {
      let depth = 0;
      while (index < sql.length) {
        if (sql.startsWith('/*', index)) {
          depth += 1;
          index += 2;
        } else if (sql.startsWith('*/', index)) {
          depth -= 1;
          index += 2;
          if (depth === 0) break;
        } else index += 1;
      }
      current += ' ';
      continue;
    }
    dollarQuote.lastIndex = index;
    const dollar = dollarQuote.exec(sql);
    if (dollar && !/[\p{L}\p{N}_]$/u.test(current)) {
      const end = sql.indexOf(dollar[0], index + dollar[0].length);
      const stop = end === -1 ? sql.length : end + dollar[0].length;
      current += sql.slice(index, stop);
      index = stop;
      continue;
    }
    const char = sql.charAt(index);
    if (char === "'" || char === '"') {
      const escapes = char === "'" && /(^|[^\p{L}\p{N}_])[eE]$/u.test(current);
      let stop = index + 1;
      while (stop < sql.length) {
        const next = sql.charAt(stop);
        if (escapes && next === '\\') stop += 2;
        else if (next === char && sql.charAt(stop + 1) === char) stop += 2;
        else if (next === char) break;
        else stop += 1;
      }
      current += sql.slice(index, stop + 1);
      index = stop + 1;
      continue;
    }
    if (char === ';') flush();
    else current += char;
    index += 1;
  }
  flush();
  return result;
}

/** Words, quoted names, strings and single punctuation. A dollar-quoted body is one string token.
 * Like PostgreSQL, an unquoted name folds ASCII letters only, so `Büro` and `"büro"` are one name. */
function tokens(statement: string): Token[] {
  const result: Token[] = [];
  const pattern =
    /\$([\p{L}_][\p{L}\p{N}_]*)?\$[\s\S]*?\$\1\$|[eE]'(?:[^'\\]|\\.|'')*'|'(?:[^']|'')*'|"(?:[^"]|"")*"|[\p{L}_][\p{L}\p{N}_$]*|\d+(?:\.\d+)?|::|\S/gu;
  for (const match of statement.matchAll(pattern)) {
    const text = match[0];
    if (text.startsWith('"'))
      result.push({ text: text.slice(1, -1).replaceAll('""', '"'), quoted: true, string: false });
    else if (text.startsWith('$') && text.length > 1)
      result.push({ text: text.replace(/^\$[^$]*\$|\$[^$]*\$$/g, ''), quoted: false, string: true });
    else if (/^[eE]?'/.test(text))
      result.push({
        text: text.replace(/^[eE]?'|'$/g, '').replaceAll("''", "'"),
        quoted: false,
        string: true,
      });
    else
      result.push({
        text: text.replace(/[A-Z]+/g, (upper) => upper.toLowerCase()),
        quoted: false,
        string: false,
      });
  }
  return result;
}

/** Reads one statement's tokens from a position. */
class Reader {
  position = 0;
  constructor(readonly tokens: Token[]) {}

  peek(offset = 0): string {
    const token = this.tokens[this.position + offset];
    return token === undefined || token.quoted || token.string ? '' : token.text;
  }

  /** Consumes the words if they come next, in order. */
  accept(...words: string[]): boolean {
    if (!words.every((word, offset) => this.peek(offset) === word)) return false;
    this.position += words.length;
    return true;
  }

  skip(...phrases: string[][]): void {
    let moved = true;
    while (moved) moved = phrases.some((phrase) => this.accept(...phrase));
  }

  identifier(): string | null {
    const token = this.tokens[this.position];
    if (token === undefined || token.string) return null;
    if (!token.quoted && !/^[\p{L}_][\p{L}\p{N}_$]*$/u.test(token.text)) return null;
    this.position += 1;
    return token.text;
  }

  /** A possibly schema-qualified name; the schema is null when the SQL does not write it. */
  qualified(): Name | null {
    const first = this.identifier();
    if (first === null) return null;
    if (this.peek() !== '.') return [null, first];
    this.position += 1;
    const second = this.identifier();
    return second === null ? null : [first, second];
  }

  /** Skips a parenthesized group if one comes next. */
  group(): void {
    if (this.peek() !== '(') return;
    let depth = 0;
    while (this.position < this.tokens.length) {
      const text = this.peek();
      this.position += 1;
      if (text === '(') depth += 1;
      else if (text === ')' && --depth === 0) return;
    }
  }

  /** The position of a top-level word at or after the current one, or -1. */
  find(word: string): number {
    let depth = 0;
    for (let at = this.position; at < this.tokens.length; at += 1) {
      const text = this.tokens[at]?.quoted || this.tokens[at]?.string ? '' : (this.tokens[at]?.text ?? '');
      if (text === '(') depth += 1;
      else if (text === ')') depth -= 1;
      else if (depth === 0 && text === word) return at;
    }
    return -1;
  }
}

type Name = [schema: string | null, name: string];

type Read = MigrationTarget[] | null;

const target = (
  kind: TargetKind,
  schema: string | null,
  name: string,
  part: string | null = null,
): MigrationTarget => ({
  kind,
  schema,
  name,
  part,
});

/** A comma list of qualified names; each argument list is skipped. */
function names(reader: Reader): Name[] | null {
  const result: Name[] = [];
  do {
    const name = reader.qualified();
    if (name === null) return null;
    result.push(name);
    reader.group();
  } while (reader.accept(','));
  return result;
}

const objects = (found: Name[] | null): Read => found?.map((name) => target('object', ...name)) ?? null;

/** `<name> on <table>`, as policies and triggers are named, with a new name after `rename to`. */
function attached(reader: Reader, kind: 'policy' | 'trigger'): Read {
  const name = reader.identifier();
  if (name === null || !reader.accept('on')) return null;
  const table = reader.qualified();
  if (table === null) return null;
  const renamed = reader.accept('rename', 'to') ? reader.identifier() : null;
  return [name, ...(renamed === null ? [] : [renamed])].map((each) => target(kind, ...table, each));
}

/** `rename to <name>` or `set schema <schema>` in an ALTER: the object under its new identity is changed too. */
function renamedTo(reader: Reader, found: MigrationTarget[]): MigrationTarget[] {
  const result: MigrationTarget[] = [];
  const start = reader.position;
  const rename = reader.find('rename');
  reader.position = rename + 1;
  const name = rename !== -1 && reader.accept('to') ? reader.identifier() : null;
  reader.position = start;
  for (let at = reader.find('set'); at !== -1; at = reader.find('set')) {
    reader.position = at + 1;
    const schema = reader.accept('schema') ? reader.identifier() : null;
    if (schema !== null) result.push(...found.map((old) => target('object', schema, old.name)));
  }
  const first = found[0];
  if (name !== null && first !== undefined) result.push(target('object', first.schema, name));
  return result;
}

type Verb = 'create' | 'alter' | 'drop' | 'comment';

const RELATION_WORDS = [
  ['table'],
  ['view'],
  ['materialized', 'view'],
  ['sequence'],
  ['index'],
  ['foreign', 'table'],
];

/** A relation after its kind word: CREATE INDEX names its table too, ALTER a new name. */
function relationTargets(reader: Reader, kind: string, verb: Verb): Read {
  reader.skip(['concurrently'], ['if', 'not', 'exists'], ['if', 'exists'], ['only']);
  if (kind === 'index' && verb === 'create') {
    // CREATE INDEX [name] ON table: the index, in the table's schema, and the table.
    const index = reader.peek() === 'on' ? null : reader.identifier();
    if (!reader.accept('on')) return null;
    reader.skip(['only']);
    const table = reader.qualified();
    if (table === null) return null;
    return [target('object', ...table), ...(index === null ? [] : [target('object', table[0], index)])];
  }
  if (verb === 'comment') {
    const name = reader.qualified();
    return name === null ? null : [target('object', ...name)];
  }
  if (
    verb === 'create' &&
    (kind === 'view' || kind === 'materialized' || (kind === 'table' && reader.find('as') !== -1))
  ) {
    // A view or CREATE TABLE AS fixes what it reads when it runs, `select *` included.
    const name = reader.qualified();
    return name === null ? null : [target('object', ...name), ...readTargets(reader)];
  }
  const found = objects(names(reader));
  if (found === null || !found.length) return null;
  const renamed = verb === 'alter' ? renamedTo(reader, found) : [];
  const sources = kind === 'table' || kind === 'foreign' ? shapeSources(reader) : [];
  return sources === null ? null : [...found, ...renamed, ...sources];
}

/**
 * What a CREATE or ALTER TABLE takes its shape from: `(LIKE t`, `INHERITS (t, u)`, `[NO] INHERIT t`,
 * `PARTITION OF t`, `ATTACH|DETACH PARTITION t` and `OF type`. A later change to the source would
 * reach the table in one order and not the other. Null when a source cannot be read.
 */
function shapeSources(reader: Reader): Read {
  const result: MigrationTarget[] = [];
  const word = (at: number): string => {
    const token = reader.tokens[at];
    return token === undefined || token.quoted || token.string ? '' : token.text;
  };
  for (let at = 0; at < reader.tokens.length; at += 1) {
    const text = word(at);
    const previous = word(at - 1);
    reader.position = at + 1;
    let found: Name[] | null;
    if (text === 'inherits') found = reader.accept('(') ? names(reader) : null;
    else if (
      (text === 'like' && (previous === '(' || previous === ',')) ||
      text === 'inherit' ||
      (text === 'partition' && (previous === 'attach' || previous === 'detach')) ||
      // `NOT OF` names nothing.
      (text === 'of' && previous !== 'not')
    )
      found = names(reader);
    else continue;
    if (found === null) return null;
    result.push(...found.map((name) => target('object', ...name)));
  }
  return result;
}

/** COMMENT ON COLUMN and COMMENT ON CONSTRAINT: the table they belong to. */
function tablePartTargets(reader: Reader): Read {
  if (reader.accept('column')) {
    const parts: string[] = [];
    do {
      const part = reader.identifier();
      if (part === null) return null;
      parts.push(part);
    } while (reader.accept('.'));
    const [schema, table] = parts.length === 3 ? parts : [null, parts[0]];
    return schema === undefined || table === undefined || parts.length < 2
      ? null
      : [target('object', schema, table)];
  }
  if (!reader.accept('constraint') || reader.identifier() === null || !reader.accept('on')) return null;
  reader.skip(['domain']);
  const table = reader.qualified();
  return table === null ? null : [target('object', ...table)];
}

const ROUTINE_AND_TYPE_WORDS = ['function', 'procedure', 'routine', 'aggregate', 'type', 'domain'];

/** Policies and triggers, named with their table. */
function attachedTargets(reader: Reader, kind: 'policy' | 'trigger', verb: Verb): Read {
  reader.skip(['if', 'not', 'exists'], ['if', 'exists']);
  if (kind !== 'trigger' || verb !== 'create') return attached(reader, kind);
  // CREATE TRIGGER name {BEFORE|AFTER|INSTEAD OF} events ON table.
  const name = reader.identifier();
  const on = reader.find('on');
  if (name === null || on === -1) return null;
  reader.position = on + 1;
  const table = reader.qualified();
  return table === null ? null : [target('trigger', ...table, name)];
}

/** The object after CREATE, ALTER, DROP or COMMENT ON, from its kind word on. */
function objectTargets(reader: Reader, verb: Verb): Read {
  reader.skip(
    ['or', 'replace'],
    ['unique'],
    ['temporary'],
    ['temp'],
    ['unlogged'],
    ['constraint'],
    ['recursive'],
  );
  for (const words of RELATION_WORDS)
    if (reader.accept(...words)) return relationTargets(reader, words[0] ?? '', verb);
  if (verb === 'comment' && (reader.peek() === 'column' || reader.peek() === 'constraint'))
    return tablePartTargets(reader);
  for (const word of ROUTINE_AND_TYPE_WORDS) {
    if (!reader.accept(word)) continue;
    reader.skip(['if', 'not', 'exists'], ['if', 'exists']);
    const found = objects(names(reader));
    if (found === null || !found.length) return null;
    return verb === 'alter' ? [...found, ...renamedTo(reader, found)] : found;
  }
  for (const kind of ['policy', 'trigger'] as const)
    if (reader.accept(kind)) return attachedTargets(reader, kind, verb);
  for (const kind of ['schema', 'extension', 'role', 'user', 'group', 'publication'] as const) {
    if (!reader.accept(kind)) continue;
    reader.skip(['if', 'not', 'exists'], ['if', 'exists']);
    const name = reader.identifier();
    if (name === null) return null;
    if (kind === 'publication')
      return verb === 'alter' ? publication(reader, name) : [target('publication', null, '*', name)];
    return [target(kind === 'user' || kind === 'group' ? 'role' : kind, null, name)];
  }
  return null;
}

/** ALTER PUBLICATION p ADD|DROP TABLE t: that table's membership; any other change: the whole publication. */
function publication(reader: Reader, name: string): Read {
  if (!(reader.accept('add', 'table') || reader.accept('drop', 'table')))
    return [target('publication', null, '*', name)];
  reader.skip(['only']);
  return names(reader)?.map((table) => target('publication', ...table, name)) ?? null;
}

/** GRANT and REVOKE: the objects after ON, or the roles when there is no ON. */
function privilegeTargets(reader: Reader): Read {
  const on = reader.find('on');
  if (on === -1) {
    const to = Math.max(reader.find('to'), reader.find('from'));
    if (to === -1) return null;
    reader.position = to + 1;
    return names(reader)?.map(([, role]) => target('role', null, role)) ?? null;
  }
  reader.position = on + 1;
  if (reader.accept('all')) {
    const kind = reader.identifier() ?? '';
    if (!reader.accept('in', 'schema')) return null;
    const schemas = names(reader);
    return !['tables', 'sequences', 'functions', 'routines', 'procedures'].includes(kind) || schemas === null
      ? null
      : schemas.map(([, schema]) => target('object', schema, '*'));
  }
  if (reader.accept('schema'))
    return names(reader)?.map(([, schema]) => target('schema', null, schema)) ?? null;
  if (['database', 'language', 'tablespace', 'foreign', 'large'].includes(reader.peek())) return null;
  reader.skip(['function'], ['procedure'], ['routine'], ['type'], ['domain'], ['sequence'], ['table']);
  return objects(names(reader));
}

/** `select f(...)` with one known call; any other call in a SELECT is opaque. */
function selectTargets(reader: Reader): Read {
  const calls: { name: string; first: Token | undefined }[] = [];
  for (let at = 0; at < reader.tokens.length; at += 1) {
    const token = reader.tokens[at];
    if (token === undefined || token.string || reader.tokens[at + 1]?.text !== '(') continue;
    const schema = reader.tokens[at - 1]?.text === '.' ? `${reader.tokens[at - 2]?.text ?? ''}.` : '';
    calls.push({ name: `${schema}${token.text}`, first: reader.tokens[at + 2] });
  }
  const result: MigrationTarget[] = [];
  for (const call of calls) {
    if (['set_config', 'pg_catalog.set_config', 'pg_notify', 'count', 'exists'].includes(call.name)) continue;
    if (['cron.schedule', 'cron.unschedule'].includes(call.name) && call.first?.string)
      result.push(target('cron job', null, call.first.text));
    else return null;
  }
  return result;
}

const NOT_AN_ALIAS = new Set([
  'where',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'cross',
  'natural',
  'on',
  'using',
  'group',
  'order',
  'limit',
  'offset',
  'having',
  'union',
  'except',
  'intersect',
  'returning',
  'set',
  'window',
  'for',
  'when',
  'then',
  'into',
  'values',
  'select',
  'lateral',
  'with',
  'do',
]);

/**
 * What a view, CREATE TABLE AS or data statement reads: the names after FROM, JOIN and USING, and
 * every name it calls. Each copies what it reads when it runs, so a newer change to one of them
 * conflicts with it. A WITH query's name counts too: telling it from a table of that name needs scopes.
 */
function readTargets(reader: Reader): MigrationTarget[] {
  const result: MigrationTarget[] = [];
  reader.tokens.forEach((token, at) => {
    if (token.string) return;
    if (reader.tokens[at + 1]?.text === '(' && !reader.tokens[at + 1]?.quoted) {
      const dot = reader.tokens[at - 1];
      reader.position = dot?.text === '.' && !dot.quoted ? at - 2 : at;
      const called = reader.qualified();
      if (called !== null) result.push(target('object', ...called));
    }
    if (token.quoted || !['from', 'join', 'using'].includes(token.text)) return;
    reader.position = at + 1;
    for (;;) {
      reader.skip(['only'], ['lateral']);
      // A subquery's own FROM is read where it stands; the list goes on after it.
      if (reader.peek() === '(') reader.group();
      else {
        const name = reader.qualified();
        if (name === null) return;
        result.push(target('object', ...name));
        reader.group();
      }
      reader.accept('as');
      if (!NOT_AN_ALIAS.has(reader.peek()) && reader.peek() !== ',' && reader.identifier() !== null)
        reader.group();
      if (!reader.accept(',')) return;
    }
  });
  return result;
}

/** INSERT, UPDATE, DELETE, MERGE and TRUNCATE anywhere in a statement, CTEs included. */
function dataTargets(reader: Reader): Read {
  const result: MigrationTarget[] = [];
  for (let at = 0; at < reader.tokens.length; at += 1) {
    const word = reader.tokens[at];
    if (word === undefined || word.quoted || word.string) continue;
    // `on conflict do update`, `for update` and `insert or update` name no table.
    const previous = reader.tokens[at - 1]?.text ?? '';
    if (['do', 'for', 'or', 'of'].includes(previous)) continue;
    // SELECT ... INTO t creates the table t.
    const after =
      word.text === 'into' && previous !== 'insert' && previous !== 'merge'
        ? at + 1
        : word.text === 'insert' || word.text === 'merge'
          ? reader.tokens[at + 1]?.text === 'into'
            ? at + 2
            : -1
          : word.text === 'delete'
            ? reader.tokens[at + 1]?.text === 'from'
              ? at + 2
              : -1
            : word.text === 'update' || word.text === 'truncate'
              ? at + 1
              : -1;
    if (after === -1) continue;
    reader.position = after;
    reader.skip(['temporary'], ['temp'], ['unlogged'], ['table'], ['only']);
    const found = objects(names(reader));
    if (found === null) return null;
    result.push(...found);
  }
  if (!result.length) return selectTargets(reader);
  const unique = new Map(
    [...result, ...readTargets(reader)].map((found) => [`${found.schema ?? ''}\u0001${found.name}`, found]),
  );
  return [...unique.values()];
}

const NO_TARGET = new Set([
  'begin',
  'commit',
  'end',
  'start',
  'rollback',
  'abort',
  'savepoint',
  'release',
  'set',
  'reset',
  'notify',
  'analyze',
  'vacuum',
  'reindex',
  'lock',
  'discard',
]);

/** The targets of one statement, or null when it is opaque. */
function statementTargets(reader: Reader): Read {
  const verb = reader.peek();
  reader.position = 1;
  if (NO_TARGET.has(verb)) return [];
  if (verb === 'create' || verb === 'alter' || verb === 'drop') return objectTargets(reader, verb);
  if (verb === 'comment') return reader.accept('on') ? objectTargets(reader, 'comment') : null;
  if (verb === 'grant' || verb === 'revoke') return privilegeTargets(reader);
  if (verb === 'refresh' && reader.accept('materialized', 'view')) {
    reader.skip(['concurrently']);
    return objects(names(reader));
  }
  if (['insert', 'update', 'delete', 'merge', 'truncate', 'with', 'select'].includes(verb))
    return dataTargets(reader);
  return null;
}

/**
 * CASCADE also removes or changes what depends on its object, which the SQL does not name. A
 * foreign key's `ON DELETE|UPDATE CASCADE` only declares a rule and removes nothing now.
 */
const cascades = (words: Token[]): boolean =>
  words.some((token, at) => {
    const action = words[at - 1];
    const on = words[at - 2];
    // Only `ON DELETE CASCADE` and `ON UPDATE CASCADE` after a `REFERENCES` are a foreign key rule: a
    // schema or table may itself be named `delete` or `update` (`DROP SCHEMA delete CASCADE`,
    // `DROP TRIGGER cleanup ON delete CASCADE`).
    const rule =
      action !== undefined &&
      on !== undefined &&
      !action.quoted &&
      !on.quoted &&
      on.text === 'on' &&
      ['delete', 'update'].includes(action.text) &&
      words.slice(0, at - 2).some((word) => !word.quoted && !word.string && word.text === 'references');
    return !token.quoted && !token.string && token.text === 'cascade' && !rule;
  });

/** What one migration changes. */
export function migrationChanges(sql: string): MigrationChanges {
  const changes: MigrationChanges = { targets: [], opaque: [] };
  for (const statement of statements(sql)) {
    const words = tokens(statement);
    const found = cascades(words) ? null : statementTargets(new Reader(words));
    if (found === null) changes.opaque.push(statement.replace(/\s+/g, ' ').slice(0, 60));
    else changes.targets.push(...found);
  }
  return changes;
}

const qualifiedName = (found: MigrationTarget): string =>
  found.schema === null ? found.name : `${found.schema}.${found.name}`;

function label(found: MigrationTarget): string {
  if (found.kind === 'object') return qualifiedName(found);
  if (found.kind === 'policy' || found.kind === 'trigger')
    return `${found.kind} ${found.part ?? ''} on ${qualifiedName(found)}`;
  if (found.kind === 'publication')
    return `publication ${found.part ?? ''}${found.name === '*' ? '' : `, table ${qualifiedName(found)}`}`;
  return `${found.kind} ${found.name}`;
}

/** Kinds that hang from a table: dropping, recreating or renaming the table removes or moves them. */
const ATTACHED: ReadonlySet<TargetKind> = new Set(['policy', 'trigger', 'publication']);

/**
 * A schema that matches (an unqualified name matches every one) and one name or `*`, with one kind and
 * one part. A policy, trigger or publication member also overlaps any change to its table, since the
 * reader cannot tell an added column from a drop; two of them with different parts stay apart.
 */
function overlaps(left: MigrationTarget, right: MigrationTarget): boolean {
  if (left.schema !== null && right.schema !== null && left.schema !== right.schema) return false;
  if (left.kind === right.kind)
    return left.part === right.part && (left.name === right.name || left.name === '*' || right.name === '*');
  const table = (attached: MigrationTarget, object: MigrationTarget): boolean =>
    ATTACHED.has(attached.kind) &&
    object.kind === 'object' &&
    attached.name !== '*' &&
    attached.name === object.name;
  return table(left, right) || table(right, left);
}

/** What two migrations both change, each named once; an opaque statement in either conflicts with the other. */
export function sharedChanges(left: MigrationChanges, right: MigrationChanges): string[] {
  const shared = new Set<string>();
  for (const statement of left.opaque) shared.add(`a statement it cannot read ("${statement}")`);
  for (const statement of right.opaque)
    shared.add(`a statement it cannot read on the other side ("${statement}")`);
  for (const mine of left.targets)
    for (const theirs of right.targets)
      if (overlaps(mine, theirs))
        shared.add(
          label(
            // The attached object, else the more specific name.
            mine.kind !== theirs.kind
              ? mine.kind === 'object'
                ? theirs
                : mine
              : mine.name === '*' || (mine.schema === null && theirs.name !== '*')
                ? theirs
                : mine,
          ),
        );
  return [...shared].sort();
}
