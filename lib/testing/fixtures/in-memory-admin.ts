// A minimal in-memory stand-in for the service-role client: it evaluates the
// filters a query really sends, so a write that omits an ownership filter
// changes the rows it would change in Postgres. Only the builder calls the
// boundary fixtures use are implemented.
type Row = Record<string, unknown>;
export type InMemoryTables = Record<string, Row[]>;
type QueryResult = { data: unknown; error: { code: string; message?: string } | null; count: number | null };
/**
 * Runs right before an update or delete selects its rows, so a test can
 * change or remove a row between an action's read and its write.
 */
export type BeforeWrite = (table: string) => void;

const comparators: Readonly<Record<string, (left: number | string, right: number | string) => boolean>> = {
  eq: (left, right) => left === right,
  neq: (left, right) => left !== right,
  gt: (left, right) => left > right,
  gte: (left, right) => left >= right,
  lt: (left, right) => left < right,
  lte: (left, right) => left <= right,
};

/** Numbers compare as numbers, everything else as text, as PostgREST filter values arrive. */
function comparable(value: unknown, filterValue: string): [number | string, number | string] {
  const number = Number(filterValue);
  return typeof value === 'number' && filterValue.trim() !== '' && Number.isFinite(number)
    ? [value, number]
    : [String(value ?? ''), filterValue];
}

/** One `column.operator.value` term of a PostgREST `or` filter. */
function orTerm(term: string): (row: Row) => boolean {
  const [column = '', operator = '', ...rest] = term.split('.');
  const compare = comparators[operator];
  if (!compare) throw new Error(`The in-memory admin does not implement the "${operator}" or-filter.`);
  const value = rest.join('.');
  return (row) => compare(...comparable(row[column], value));
}

class InMemoryQuery implements PromiseLike<QueryResult> {
  private operation: 'select' | 'update' | 'delete' | 'insert' | null = null;
  private payload: Row | Row[] = {};
  private predicates: Array<(row: Row) => boolean> = [];
  private cardinality: 'many' | 'single' | 'maybeSingle' = 'many';
  private headOnly = false;

  constructor(
    private readonly tables: InMemoryTables,
    private readonly table: string,
    private readonly columnDefaults: () => Row,
    private readonly beforeWrite: BeforeWrite = () => {},
  ) {}

  select(_columns?: string, options?: { head?: boolean }): this {
    this.operation ??= 'select';
    this.headOnly = options?.head ?? false;
    return this;
  }
  update(payload: Row): this {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }
  delete(): this {
    this.operation = 'delete';
    return this;
  }
  insert(payload: Row | Row[]): this {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }
  private where(predicate: (row: Row) => boolean): this {
    this.predicates.push(predicate);
    return this;
  }
  eq(column: string, value: unknown): this {
    return this.where((row) => row[column] === value);
  }
  neq(column: string, value: unknown): this {
    return this.where((row) => row[column] !== value);
  }
  is(column: string, value: unknown): this {
    return this.where((row) => (row[column] ?? null) === value);
  }
  in(column: string, values: readonly unknown[]): this {
    return this.where((row) => values.includes(row[column]));
  }
  gte(column: string, value: string): this {
    return this.where((row) => String(row[column]) >= value);
  }
  lte(column: string, value: string): this {
    return this.where((row) => String(row[column]) <= value);
  }
  lt(column: string, value: string): this {
    return this.where((row) => String(row[column]) < value);
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  range(): this {
    return this;
  }
  not(): this {
    return this;
  }
  /** Comparison terms only (`taken_quantity.gt.0,returned_quantity.gt.0`); anything else throws. */
  or(filter: string): this {
    const terms = filter.split(',').map(orTerm);
    return this.where((row) => terms.some((term) => term(row)));
  }
  single(): this {
    this.cardinality = 'single';
    return this;
  }
  maybeSingle(): this {
    this.cardinality = 'maybeSingle';
    return this;
  }

  private run(): QueryResult {
    if (this.operation === 'update' || this.operation === 'delete') this.beforeWrite(this.table);
    const rows = this.tables[this.table] ?? [];
    let affected: Row[];
    if (this.operation === 'insert') {
      affected = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((row) => ({
        id: crypto.randomUUID(),
        ...this.columnDefaults(),
        ...row,
      }));
      this.tables[this.table] = [...rows, ...affected];
    } else {
      affected = rows.filter((row) => this.predicates.every((predicate) => predicate(row)));
      if (this.operation === 'update') for (const row of affected) Object.assign(row, this.payload);
      if (this.operation === 'delete')
        this.tables[this.table] = rows.filter((row) => !affected.includes(row));
    }
    if (this.headOnly) return { data: null, error: null, count: affected.length };
    if (this.cardinality === 'many') return { data: affected, error: null, count: affected.length };
    if (this.cardinality === 'single' && affected.length !== 1)
      return { data: null, error: { code: 'PGRST116' }, count: null };
    return { data: affected[0] ?? null, error: null, count: null };
  }

  then<Fulfilled = QueryResult, Rejected = never>(
    onFulfilled?: ((value: QueryResult) => Fulfilled | PromiseLike<Fulfilled>) | null,
    onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
  ): Promise<Fulfilled | Rejected> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onFulfilled, onRejected);
  }
}

// The batched time-entry functions write every named entry of the
// organization. Their refusals run in SQL: supabase/tests/closed_period_writes.sql.
async function runTimeEntryBatch(tables: InMemoryTables, name: string, args: Row): Promise<QueryResult> {
  const query = new InMemoryQuery(tables, 'time_entries', () => ({}));
  const write =
    name === 'review_time_entries'
      ? query.update({
          status: args.p_decision,
          reviewed_by: args.p_actor_id,
          reviewed_at: new Date().toISOString(),
        })
      : query.delete();
  const ids = Array.isArray(args.p_entry_ids) ? args.p_entry_ids : [];
  const { count } = await write.eq('organization_id', args.p_organization_id).in('id', ids);
  return { data: count, error: null, count: null };
}

// decide_entry_change_request records the decision of a pending request of
// the organization and applies it to the entries. Its refusals and its
// all-or-nothing rule run in SQL: supabase/tests/entry_change_request_decisions.sql.
async function decideEntryChangeRequest(tables: InMemoryTables, args: Row): Promise<QueryResult> {
  const request = (tables.entry_change_requests ?? []).find(
    (row) => row.id === args.p_request_id && row.organization_id === args.p_organization_id,
  );
  if (!request) return { data: null, error: { code: 'P0001', message: 'request_not_found' }, count: null };
  if (request.status !== 'pending')
    return { data: null, error: { code: 'P0001', message: 'request_already_reviewed' }, count: null };
  const approve = args.p_decision === 'approve';
  Object.assign(request, {
    status: approve ? 'approved' : 'rejected',
    reviewed_by: args.p_actor_id,
    reviewed_at: new Date().toISOString(),
  });
  const decided = structuredClone(request);
  const entries = new InMemoryQuery(tables, 'time_entries', () => ({}));
  const pair = [request.entry_id, request.paired_entry_id ?? request.entry_id];
  if (approve && request.change_type === 'delete') {
    await entries.delete().eq('organization_id', args.p_organization_id).in('id', pair);
    tables.entry_change_requests = (tables.entry_change_requests ?? []).filter((row) => row !== request);
  } else if (!approve && request.change_type === 'edit' && request.original_timestamp) {
    await entries
      .update({ timestamp: request.original_timestamp })
      .eq('organization_id', args.p_organization_id)
      .eq('id', request.entry_id);
  } else if (!approve && request.change_type === 'delete') {
    await entries.update({ status: 'approved' }).eq('organization_id', args.p_organization_id).in('id', pair);
  }
  return { data: decided, error: null, count: null };
}

/** `columnDefaults` stands in for database column defaults on insert, per table. */
export function createInMemoryAdmin(
  tables: InMemoryTables,
  columnDefaults: Record<string, () => Row> = {},
  beforeWrite?: BeforeWrite,
): { from: (table: string) => InMemoryQuery; rpc: (name: string, args?: Row) => Promise<QueryResult> } {
  return {
    from: (table) => new InMemoryQuery(tables, table, columnDefaults[table] ?? (() => ({})), beforeWrite),
    rpc: async (name, args = {}) => {
      if (name === 'review_time_entries' || name === 'delete_time_entries')
        return runTimeEntryBatch(tables, name, args);
      if (name === 'decide_entry_change_request') return decideEntryChangeRequest(tables, args);
      return { data: [], error: null, count: null };
    },
  };
}
