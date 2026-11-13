import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repositoryRoot } from './product-sources';

/** One function as its latest committed migration defines it. */
export type DatabaseFunction = {
  /** `schema.name(type, …)`, the identity a drop names. */
  signature: string;
  /** `schema.name`. */
  name: string;
  /** Parameter names, lower case, in order. */
  parameters: readonly string[];
  /** A trigger function acts on the row its statement changes and takes no parameters. */
  isTrigger: boolean;
  /** The body between its dollar quotes, lower case, comments removed. */
  body: string;
  /** The migration file that defines it. */
  file: string;
};

export type Migration = { file: string; sql: string };

/** Committed migrations in the order `supabase db push` applies them. */
export function committedMigrations(): Migration[] {
  const directory = join(repositoryRoot, 'supabase/migrations');
  return readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      file: `supabase/migrations/${file}`,
      sql: readFileSync(join(directory, file), 'utf8'),
    }));
}

/** The SQL without `--` and block comments, string literals and dollar-quoted bodies kept. */
function withoutComments(sql: string): string {
  let result = '';
  let index = 0;
  while (index < sql.length) {
    const rest = sql.slice(index);
    const dollar = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (rest.startsWith('--')) {
      const newline = sql.indexOf('\n', index);
      index = newline < 0 ? sql.length : newline;
    } else if (rest.startsWith('/*')) {
      const close = sql.indexOf('*/', index + 2);
      index = close < 0 ? sql.length : close + 2;
      result += ' ';
    } else if (rest.startsWith("'")) {
      const close = /^'(?:[^']|'')*'/.exec(rest);
      const literal = close ? close[0] : rest;
      result += literal;
      index += literal.length;
    } else if (dollar) {
      // A body: keep its tags, strip comments inside it.
      const close = sql.indexOf(dollar[0], index + dollar[0].length);
      const end = close < 0 ? sql.length : close;
      result += `${dollar[0]}${withoutComments(sql.slice(index + dollar[0].length, end))}${dollar[0]}`;
      index = end + dollar[0].length;
    } else {
      result += sql[index];
      index += 1;
    }
  }
  return result;
}

/** The text up to the parenthesis that closes the one before `start`. */
function insideParentheses(text: string, start: number): string {
  let depth = 1;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    if (text[index] === ')') depth -= 1;
    if (depth === 0) return text.slice(start, index);
  }
  return text.slice(start);
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += char;
  }
  return current.trim() ? [...parts, current.trim()] : parts;
}

const TYPE_ALIASES: Readonly<Record<string, string>> = {
  int: 'integer',
  int4: 'integer',
  int8: 'bigint',
  bool: 'boolean',
  timestamptz: 'timestamp with time zone',
  'character varying': 'varchar',
  'time without time zone': 'time',
  'timestamp without time zone': 'timestamp',
  float8: 'double precision',
};
// A first word that starts a type, so it is no parameter name.
const TYPE_START = /^(?:timestamp|time|double|character|bit|interval|setof)$/;

/** A parameter as name and normalized type; a drop names the type alone. */
function parameter(declaration: string): { name: string | null; type: string } {
  const words = declaration
    .replace(/\s+(?:default\b|=)[\s\S]*$/, '')
    .replace(/^(?:in|out|inout|variadic)\s+/, '')
    .split(/\s+/);
  const named = words.length > 1 && !TYPE_START.test(words[0] ?? '');
  const type = (named ? words.slice(1) : words).join(' ').replace(/^public\./, '');
  return { name: named ? (words[0] ?? null) : null, type: TYPE_ALIASES[type] ?? type };
}

// An unqualified name is in public, as every migration's search path has it.
const NAME = String.raw`((?:public\.|app_private\.)?[a-z_][a-z_0-9]*)`;
const EVENT = new RegExp(
  String.raw`\b(create\s+(?:or\s+replace\s+)?function|drop\s+function(?:\s+if\s+exists)?|alter\s+function)\s+${NAME}\s*(\()?`,
  'g',
);
const RENAME = /^\s*rename\s+to\s+([a-z_][a-z_0-9]*)/;
const SET_SCHEMA = /^\s*set\s+schema\s+([a-z_][a-z_0-9]*)/;

const qualified = (name: string): string => (name.includes('.') ? name : `public.${name}`);

/**
 * The latest definition of every function in `public` and `app_private` that
 * no later migration drops, keyed by schema, name and parameter types.
 */
export function latestDatabaseFunctions(migrations: readonly Migration[]): DatabaseFunction[] {
  const functions = new Map<string, DatabaseFunction>();
  for (const { file, sql: raw } of migrations) {
    const sql = withoutComments(raw)
      .toLowerCase()
      .replace(/"([a-z_][a-z_0-9]*)"/g, '$1');
    for (const match of sql.matchAll(EVENT)) {
      const [whole, verb = '', unqualified = '', open] = match;
      const name = qualified(unqualified);
      const start = match.index + whole.length;
      const list = open ? insideParentheses(sql, start) : '';
      const declarations = open ? splitTopLevel(list).map(parameter) : null;
      const signature = `${name}(${(declarations ?? []).map((item) => item.type).join(', ')})`;
      if (verb.startsWith('alter')) {
        const rest = sql.slice(start + list.length + 1);
        const renamed = RENAME.exec(rest)?.[1];
        const schema = SET_SCHEMA.exec(rest)?.[1];
        const existing = functions.get(signature);
        if (!existing || (!renamed && !schema)) continue;
        const [currentSchema = '', currentName = ''] = name.split('.');
        const target = `${schema ?? currentSchema}.${renamed ?? currentName}`;
        functions.delete(signature);
        functions.set(`${target}${signature.slice(name.length)}`, {
          ...existing,
          signature: `${target}${signature.slice(name.length)}`,
          name: target,
        });
        continue;
      }
      if (verb.startsWith('drop')) {
        if (declarations) functions.delete(signature);
        else for (const key of functions.keys()) if (key.startsWith(`${name}(`)) functions.delete(key);
        continue;
      }
      const after = sql.slice(start);
      const tag = /\$(?:[a-z_][a-z0-9_]*)?\$/.exec(after);
      if (!tag) continue;
      const close = after.indexOf(tag[0], tag.index + tag[0].length);
      functions.set(signature, {
        signature,
        name,
        parameters: (declarations ?? []).flatMap((item) => (item.name ? [item.name] : [])),
        isTrigger: /\breturns\s+trigger\b/.test(after.slice(list.length, tag.index)),
        body: after.slice(tag.index + tag[0].length, close < 0 ? undefined : close),
        file,
      });
    }
  }
  return [...functions.values()];
}
