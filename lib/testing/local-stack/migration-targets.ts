// What a migration changes, read from its SQL for the migration-order gate
// (docs/technical/environments.md, "The migration rule"). DEV and PROD apply a
// merged migration after main's newer ones, a fresh database in version order;
// two migrations commute when they change different objects. The reader names
// each statement's targets. A statement it cannot read is opaque, and an opaque
// statement conflicts with every other migration, so the gate refuses rather
// than guesses. It misses a change made only through a call: a function body or
// trigger that writes when a later statement runs it, and the targets of
// dynamic SQL in a function it creates.

/** One changed object: its kind, schema and name. A `*` name stands for every object of that kind in the schema. */
type MigrationTarget = { kind: TargetKind; schema: string; name: string };

type TargetKind =
  | 'relation'
  | 'function'
  | 'type'
  | 'schema'
  | 'extension'
  | 'role'
  | 'policy'
  | 'trigger'
  | 'publication'
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

/** Reads one statement's tokens from a position, with the default schema of the file at that point. */
class Reader {
  position = 0;
  constructor(
    readonly tokens: Token[],
    readonly defaultSchema: string,
  ) {}

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

  /** A possibly schema-qualified name, as [schema, name]. */
  qualified(): [string, string] | null {
    const first = this.identifier();
    if (first === null) return null;
    if (this.peek() !== '.') return [this.defaultSchema, first];
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

const RELATION_WORDS: Record<string, string[]> = {
  table: ['table'],
  view: ['view'],
  materialized: ['materialized', 'view'],
  sequence: ['sequence'],
  index: ['index'],
  foreign: ['foreign', 'table'],
};

type Read = MigrationTarget[] | null;

const target = (kind: TargetKind, schema: string, name: string): MigrationTarget => ({ kind, schema, name });

/** A comma list of qualified names of one kind; for functions, each argument list is skipped. */
function names(reader: Reader, kind: TargetKind): Read {
  const result: MigrationTarget[] = [];
  do {
    const name = reader.qualified();
    if (name === null) return null;
    result.push(target(kind, ...name));
    reader.group();
  } while (reader.accept(','));
  return result;
}

/** `<name> on <table>`, as policies and triggers are named, with a new name after `rename to`. */
function attached(reader: Reader, kind: 'policy' | 'trigger'): Read {
  const name = reader.identifier();
  if (name === null || !reader.accept('on')) return null;
  const table = reader.qualified();
  if (table === null) return null;
  const renamed = reader.accept('rename', 'to') ? reader.identifier() : null;
  return [name, ...(renamed === null ? [] : [renamed])].map((each) =>
    target(kind, table[0], `${table[1]}.${each}`),
  );
}

/** `rename to <name>` or `set schema <schema>` in an ALTER: the object under its new identity is changed too. */
function renamedTo(reader: Reader, kind: TargetKind, found: MigrationTarget[]): MigrationTarget[] {
  const result: MigrationTarget[] = [];
  const start = reader.position;
  const rename = reader.find('rename');
  reader.position = rename + 1;
  const name = rename !== -1 && reader.accept('to') ? reader.identifier() : null;
  reader.position = start;
  for (let at = reader.find('set'); at !== -1; at = reader.find('set')) {
    reader.position = at + 1;
    const schema = reader.accept('schema') ? reader.identifier() : null;
    if (schema !== null) result.push(...found.map((old) => target(kind, schema, old.name)));
  }
  const first = found[0];
  if (name !== null && first !== undefined) result.push(target(kind, first.schema, name));
  return result;
}

type Verb = 'create' | 'alter' | 'drop' | 'comment';

/** A relation after its kind word: CREATE INDEX names its table too, ALTER a new name. */
function relationTargets(reader: Reader, kind: string, verb: Verb): Read {
  reader.skip(['concurrently'], ['if', 'not', 'exists'], ['if', 'exists'], ['only']);
  if (kind === 'index' && verb === 'create') {
    // CREATE INDEX [name] ON table: the index, and the table it is built on.
    const index = reader.peek() === 'on' ? null : reader.identifier();
    if (!reader.accept('on')) return null;
    reader.skip(['only']);
    const table = reader.qualified();
    if (table === null) return null;
    return [target('relation', ...table), ...(index === null ? [] : [target('relation', table[0], index)])];
  }
  if (verb === 'comment') {
    const name = reader.qualified();
    return name === null ? null : [target('relation', ...name)];
  }
  const found = names(reader, 'relation');
  const first = found?.[0];
  if (found === null || first === undefined) return null;
  return verb === 'alter' ? [...found, ...renamedTo(reader, 'relation', found)] : found;
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
    const [schema, table] = parts.length === 3 ? parts : [reader.defaultSchema, parts[0]];
    return schema === undefined || table === undefined || parts.length < 2
      ? null
      : [target('relation', schema, table)];
  }
  if (!reader.accept('constraint') || reader.identifier() === null || !reader.accept('on')) return null;
  reader.skip(['domain']);
  const table = reader.qualified();
  return table === null ? null : [target('relation', ...table)];
}

const ROUTINE_AND_TYPE_WORDS = [
  ['function', 'function'],
  ['procedure', 'function'],
  ['routine', 'function'],
  ['aggregate', 'function'],
  ['type', 'type'],
  ['domain', 'type'],
] as const;

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
  return table === null ? null : [target('trigger', table[0], `${table[1]}.${name}`)];
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
  for (const words of Object.values(RELATION_WORDS))
    if (reader.accept(...words)) return relationTargets(reader, words[0] ?? '', verb);
  if (verb === 'comment' && (reader.peek() === 'column' || reader.peek() === 'constraint'))
    return tablePartTargets(reader);
  for (const [word, kind] of ROUTINE_AND_TYPE_WORDS) {
    if (!reader.accept(word)) continue;
    reader.skip(['if', 'not', 'exists'], ['if', 'exists']);
    const found = names(reader, kind);
    const first = found?.[0];
    if (found === null || first === undefined) return null;
    return verb === 'alter' ? [...found, ...renamedTo(reader, kind, found)] : found;
  }
  for (const kind of ['policy', 'trigger'] as const)
    if (reader.accept(kind)) return attachedTargets(reader, kind, verb);
  for (const kind of ['schema', 'extension', 'role', 'user', 'group', 'publication'] as const) {
    if (!reader.accept(kind)) continue;
    reader.skip(['if', 'not', 'exists'], ['if', 'exists']);
    const name = reader.identifier();
    if (name === null) return null;
    if (kind === 'publication' && verb === 'alter') return publication(reader, name);
    return [target(kind === 'user' || kind === 'group' ? 'role' : kind, '', name)];
  }
  return null;
}

/** ALTER PUBLICATION p ADD|DROP TABLE t: that table's membership; any other change: the whole publication. */
function publication(reader: Reader, name: string): Read {
  if (!(reader.accept('add', 'table') || reader.accept('drop', 'table')))
    return [target('publication', '', `${name}.*`)];
  reader.skip(['only']);
  const tables = names(reader, 'relation');
  return tables === null
    ? null
    : tables.map((table) => target('publication', '', `${name}.${table.schema}.${table.name}`));
}

/** GRANT and REVOKE: the objects after ON, or the roles when there is no ON. */
function privilegeTargets(reader: Reader): Read {
  const on = reader.find('on');
  if (on === -1) {
    const to = Math.max(reader.find('to'), reader.find('from'));
    if (to === -1) return null;
    reader.position = to + 1;
    return names(reader, 'role')?.map((role) => target('role', '', role.name)) ?? null;
  }
  reader.position = on + 1;
  if (reader.accept('all')) {
    const kind = reader.identifier();
    if (!reader.accept('in', 'schema')) return null;
    const schemas = names(reader, 'schema');
    const as: TargetKind | null =
      kind === 'tables' || kind === 'sequences'
        ? 'relation'
        : kind === 'functions' || kind === 'routines' || kind === 'procedures'
          ? 'function'
          : null;
    return as === null || schemas === null ? null : schemas.map((schema) => target(as, schema.name, '*'));
  }
  for (const [word, kind] of [
    ['function', 'function'],
    ['procedure', 'function'],
    ['routine', 'function'],
    ['type', 'type'],
    ['domain', 'type'],
    ['sequence', 'relation'],
    ['table', 'relation'],
  ] as const)
    if (reader.accept(word)) return names(reader, kind);
  if (reader.accept('schema'))
    return names(reader, 'schema')?.map((schema) => target('schema', '', schema.name)) ?? null;
  if (['database', 'language', 'tablespace', 'foreign', 'large'].includes(reader.peek())) return null;
  return names(reader, 'relation');
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
      result.push(target('cron job', 'cron', call.first.text));
    else return null;
  }
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
    const found = names(reader, 'relation');
    if (found === null) return null;
    result.push(...found);
  }
  return result.length ? result : selectTargets(reader);
}

const NO_TARGET = new Set([
  'begin',
  'commit',
  'end',
  'start',
  'rollback',
  'savepoint',
  'release',
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
    return names(reader, 'relation');
  }
  if (['insert', 'update', 'delete', 'merge', 'truncate', 'with', 'select'].includes(verb))
    return dataTargets(reader);
  return null;
}

/** Stands for the search path in an unqualified name until the statement's targets are known. */
const UNQUALIFIED = '\u0000';

/** The schemas of a search path value, or null when it cannot be read or names none. */
function pathSchemas(values: Token[]): string[] | null {
  const schemas: string[] = [];
  for (const value of values) {
    if (!value.quoted && !value.string && value.text === ',') continue;
    const parts = value.string
      ? value.text.split(',').map((part) => part.trim().replace(/^"|"$/g, ''))
      : [value.text];
    for (const part of parts) {
      if (!value.quoted && !value.string && part === 'default') return ['public'];
      if (!/^[\p{L}_][\p{L}\p{N}_$]*$/u.test(part)) {
        if (part === '$user' || part === '') continue;
        return null;
      }
      schemas.push(part);
    }
  }
  return schemas.length ? schemas : null;
}

/**
 * The search path after a statement: SET, RESET or `set_config('search_path', ...)` changes it,
 * any other statement keeps `path`. A value the reader cannot take apart leaves no path.
 */
function nextPath(list: Token[], path: string[] | null): string[] | null {
  const words = list.map((token) => (token.quoted || token.string ? '' : token.text));
  if (words[0] === 'reset' && (words[1] === 'search_path' || words[1] === 'all')) return ['public'];
  if (words[0] === 'set') {
    const at = words.indexOf('search_path');
    if (at === -1 || at > 2) return path;
    return pathSchemas(list.slice(at + 1).filter((token) => token.text !== 'to' && token.text !== '='));
  }
  for (let at = 0; at < list.length; at += 1) {
    if (words[at] !== 'set_config' || list[at + 2]?.text !== 'search_path') continue;
    const value = list[at + 4];
    return value?.string ? pathSchemas([value]) : null;
  }
  return path;
}

/** One target per schema of the search path for an unqualified name; null when the path is unknown. */
function resolved(found: MigrationTarget[], path: string[] | null): Read {
  const result: MigrationTarget[] = [];
  for (const each of found) {
    if (!each.schema.includes(UNQUALIFIED) && !each.name.includes(UNQUALIFIED)) result.push(each);
    else if (path === null) return null;
    else
      for (const schema of path)
        result.push({
          ...each,
          schema: each.schema.replaceAll(UNQUALIFIED, schema),
          name: each.name.replaceAll(UNQUALIFIED, schema),
        });
  }
  return result;
}

/**
 * What one migration changes. An unqualified name stands for every schema on the search path,
 * which starts at `public`; under a path the reader cannot read, it is opaque.
 */
export function migrationChanges(sql: string): MigrationChanges {
  const changes: MigrationChanges = { targets: [], opaque: [] };
  let path: string[] | null = ['public'];
  for (const statement of statements(sql)) {
    const list = tokens(statement);
    const next = nextPath(list, path);
    if (list[0]?.text === 'set') {
      path = next;
      continue;
    }
    const read = statementTargets(new Reader(list, UNQUALIFIED));
    const found = read === null ? null : resolved(read, path);
    path = next;
    if (found === null) changes.opaque.push(statement.replace(/\s+/g, ' ').slice(0, 60));
    else changes.targets.push(...found);
  }
  return changes;
}

const label = (found: MigrationTarget): string =>
  `${found.kind} ${found.schema ? `${found.schema}.` : ''}${found.name}`;

function overlaps(left: MigrationTarget, right: MigrationTarget): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'publication') {
    const [leftName, ...leftTable] = left.name.split('.');
    const [rightName, ...rightTable] = right.name.split('.');
    return (
      leftName === rightName &&
      (leftTable.join('.') === rightTable.join('.') || left.name.endsWith('.*') || right.name.endsWith('.*'))
    );
  }
  return (
    left.schema === right.schema && (left.name === right.name || left.name === '*' || right.name === '*')
  );
}

/** What two migrations both change, each named once; an opaque statement in either conflicts with the other. */
export function sharedChanges(left: MigrationChanges, right: MigrationChanges): string[] {
  const shared = new Set<string>();
  for (const statement of left.opaque) shared.add(`a statement it cannot read ("${statement}")`);
  for (const statement of right.opaque)
    shared.add(`a statement it cannot read on the other side ("${statement}")`);
  for (const mine of left.targets)
    for (const theirs of right.targets)
      if (overlaps(mine, theirs)) shared.add(label(mine.name === '*' ? theirs : mine));
  return [...shared].sort();
}
