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
  const dollarQuote = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;
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
    if (dollar && !/[A-Za-z0-9_]$/.test(current)) {
      const end = sql.indexOf(dollar[0], index + dollar[0].length);
      const stop = end === -1 ? sql.length : end + dollar[0].length;
      current += sql.slice(index, stop);
      index = stop;
      continue;
    }
    const char = sql.charAt(index);
    if (char === "'" || char === '"') {
      const escapes = char === "'" && /(^|[^A-Za-z0-9_])[eE]$/.test(current);
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

/** Words, quoted names, strings and single punctuation. A dollar-quoted body is one string token. */
function tokens(statement: string): Token[] {
  const result: Token[] = [];
  const pattern =
    /\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$|[eE]'(?:[^'\\]|\\.|'')*'|'(?:[^']|'')*'|"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*|\d+(?:\.\d+)?|::|\S/g;
  for (const match of statement.matchAll(pattern)) {
    const text = match[0];
    if (text.startsWith('"'))
      result.push({ text: text.slice(1, -1).replaceAll('""', '"'), quoted: true, string: false });
    else if (text.startsWith('$') && text.length > 1)
      result.push({ text: text.replace(/^\$\w*\$|\$\w*\$$/g, ''), quoted: false, string: true });
    else if (/^[eE]?'/.test(text))
      result.push({
        text: text.replace(/^[eE]?'|'$/g, '').replaceAll("''", "'"),
        quoted: false,
        string: true,
      });
    else result.push({ text: text.toLowerCase(), quoted: false, string: false });
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
    if (!token.quoted && !/^[a-z_][a-z0-9_$]*$/.test(token.text)) return null;
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

/** `<name> on <table>`, as policies and triggers are named. */
function attached(reader: Reader, kind: 'policy' | 'trigger'): Read {
  const name = reader.identifier();
  if (name === null || !reader.accept('on')) return null;
  const table = reader.qualified();
  return table === null ? null : [target(kind, table[0], `${table[1]}.${name}`)];
}

/** `rename to <name>` at the end of an ALTER: the new name is changed too. */
function renamedTo(reader: Reader, kind: TargetKind, schema: string): MigrationTarget[] {
  const at = reader.find('rename');
  if (at === -1) return [];
  reader.position = at + 1;
  if (!reader.accept('to')) return [];
  const name = reader.identifier();
  return name === null ? [] : [target(kind, schema, name)];
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
  return verb === 'alter' ? [...found, ...renamedTo(reader, 'relation', first.schema)] : found;
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
    return verb === 'alter' ? [...found, ...renamedTo(reader, kind, first.schema)] : found;
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
    if (['do', 'for', 'or', 'of'].includes(reader.tokens[at - 1]?.text ?? '')) continue;
    const after =
      word.text === 'insert' || word.text === 'merge'
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
    reader.skip(['table'], ['only']);
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

/** What one migration changes. `set search_path` moves the default schema of the statements after it. */
export function migrationChanges(sql: string): MigrationChanges {
  const changes: MigrationChanges = { targets: [], opaque: [] };
  let defaultSchema = 'public';
  for (const statement of statements(sql)) {
    const list = tokens(statement);
    const reader = new Reader(list, defaultSchema);
    if (reader.peek() === 'set') {
      reader.position = 1;
      reader.skip(['local'], ['session']);
      if (reader.accept('search_path')) {
        reader.skip(['to'], ['=']);
        defaultSchema = reader.identifier() ?? defaultSchema;
      }
      continue;
    }
    const found = statementTargets(reader);
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
