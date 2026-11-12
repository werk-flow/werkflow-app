// Rule test: an attention count reads rows in proportion to the pending work, never to the organization's history.
import { describe, expect, mock, setSystemTime, test } from 'bun:test';
import { addLocalDays } from '@/lib/date-time/berlin';
import { compare, parseOperand, termFilter, type Filter } from '@/lib/testing/postgrest-filter-fake';

// Tier 2 for "attention count reads" (docs/technical/realtime-and-caching.md), beside count-reads.test.ts,
// which pins the queries of the steady state. The counts run on every debounced Realtime event of every
// signed-in session, so the rows one derivation reads are a budget too. This test drives the real derivation
// against a fake client that applies the query filters (eq, neq, in, is, gt/gte/lt/lte, not, or, range) to a
// seeded world: pending work in every collection the counts derive from, and a large closed history (decided
// requests, approved entries, resolved defects, handed-over work, acknowledged dispatches, ended sickness
// reports). The rows read may grow with the pending work only: the closed history adds no row except the
// reviewed HISTORY_READS below, each of which names the change that removes it.

const ORG = '6b0c3f8e-1d2a-4c5b-9e7f-0a1b2c3d4e5f';
const USER = '7c1d4a9f-2e3b-4d6c-8f0a-1b2c3d4e5f60';
const OWN_RECORD = '8d2e5b0a-3f4c-4e7d-9a1b-2c3d4e5f6071';
const COLLEAGUE = '9e3f6c1b-4a5d-4f8e-8b2c-3d4e5f607182';
const COLLEAGUE_RECORD = 'af4a7d2c-5b6e-4a9f-9c3d-4e5f60718293';
/** Closed rows per collection: more than two pages of a complete read. */
const HISTORY = 2_500;

type Role = 'admin' | 'buero' | 'employee';
type Row = Record<string, unknown>;
type World = Map<string, Row[]>;

let role: Role = 'admin';
let world: World = new Map();
let reads: { table: string; rows: number }[] = [];
let failures: unknown[] = [];

/** The pinned instant of the isolated process; the pending rows date from the day before. */
const NOW = new Date('2026-10-14T10:00:00.000Z');
const RECENT = '2026-10-13T10:00:00.000Z';
const DUE = RECENT.slice(0, 10);
const OLD = '2024-01-02T09:00:00.000Z';
const OLD_DATE = OLD.slice(0, 10);
/** One day per pending item: the database refuses overlapping active requests or reports of one person. */
const pendingDay = (index: number): string => addLocalDays(DUE, index);
/** One past day per closed report: a report stays `reported` after it ends. */
const closedDay = (index: number): string => addLocalDays(OLD_DATE, 10_000 - index);
/** One future day per approved vacation, clear of the pending requests' days. */
const upcomingDay = (index: number): string => addLocalDays(DUE, 100 + index);
/** The person of a request, a vacation and its visit: the viewer and the colleague alternate. */
const personOf = (index: number): string => (index % 2 ? OWN_RECORD : COLLEAGUE_RECORD);

/** A deterministic UUID per kind of record and index. */
function uuid(kind: number, index: number): string {
  return `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

const indexes = (from: number, count: number): number[] =>
  Array.from({ length: count }, (_, at) => from + at);
const scoped = (row: Row): Row => ({ organization_id: ORG, ...row });

function rosterRows(): Record<string, Row[]> {
  const organizations = { id: ORG, name: 'Organisation', unique_code: 'ORG', employee_records: [] };
  return {
    organization_members: [
      { user_id: USER, role, joined_at: '2026-01-01T00:00:00Z', organizations },
      { user_id: COLLEAGUE, role: 'employee', joined_at: '2026-01-01T00:00:00Z', organizations },
    ].map(scoped),
    employee_records: [
      { id: OWN_RECORD, user_id: USER, first_name: 'Erika', last_name: 'Muster', exit_date: null },
      { id: COLLEAGUE_RECORD, user_id: COLLEAGUE, first_name: 'Max', last_name: 'Muster', exit_date: null },
    ]
      // The responsibility read embeds the access lifecycle and open access blockers as arrays.
      .map((record) => ({
        ...record,
        personnel_access_lifecycles: [],
        personnel_onboarding_requirements: [],
      }))
      .map(scoped),
    profiles: [
      { id: USER, first_name: 'Erika', last_name: 'Muster', email: 'erika@example.test' },
      { id: COLLEAGUE, first_name: 'Max', last_name: 'Muster', email: 'max@example.test' },
    ],
  };
}

/** Jobs, projects, artifacts, defects and blockers: pending ones first, then the closed history. */
function workRows(pending: number, history: number): Record<string, Row[]> {
  const open = indexes(0, pending);
  const closed = indexes(10_000, history);
  const job = (index: number, state: string, projectId: string | null): Row =>
    scoped({
      id: uuid(1, index),
      job_number: `A-${index}`,
      title: `Auftrag ${index}`,
      description: null,
      execution_version: 1,
      execution_state: state,
      planned_date: projectId ? OLD_DATE : DUE,
      status: 'fertig',
      project_id: projectId,
      updated_at: RECENT,
    });
  const project = (index: number, override: string): Row =>
    scoped({
      id: uuid(2, index),
      project_number: `P-${index}`,
      name: `Projekt ${index}`,
      description: null,
      execution_version: 1,
      execution_state_override: override,
      status_override: null,
      updated_at: RECENT,
    });
  const artifact = (index: number, status: string): Row =>
    scoped({ id: uuid(3, index), job_id: uuid(1, index), project_id: null, status, kind: 'note' });
  return {
    jobs: [
      ...open.map((index) => job(index, 'execution_complete', null)),
      ...closed.map((index) => job(index, 'handed_over', uuid(2, index))),
    ],
    projects: [
      ...open.map((index) => project(index, 'execution_complete')),
      ...closed.map((index) => project(index, 'handed_over')),
    ],
    work_artifacts: [
      ...open.map((index) => ({
        ...artifact(index, 'submitted'),
        current_revision_id: uuid(6, index),
        version: 1,
      })),
      ...closed.map((index) => ({
        ...artifact(index, 'approved'),
        current_revision_id: uuid(6, index),
        version: 1,
      })),
    ],
    work_artifact_revisions: open.map((index) =>
      scoped({
        id: uuid(6, index),
        title: `Nachweis ${index}`,
        kind: 'note',
        revision_number: 1,
        created_by: COLLEAGUE,
      }),
    ),
    work_artifact_defect_details: [
      ...open.map((index) =>
        scoped({ revision_id: uuid(6, index), due_date: DUE, severity: 'high', state: 'open' }),
      ),
      ...closed.map((index) =>
        scoped({ revision_id: uuid(6, index), due_date: DUE, severity: 'low', state: 'resolved' }),
      ),
    ],
    work_blockers: [...open, ...closed].map((index) =>
      scoped({
        id: uuid(7, index),
        job_id: uuid(1, index),
        project_id: null,
        instruction_item_id: null,
        kind: 'parking',
        next_review_date: DUE,
        responsible_employee_record_id: COLLEAGUE_RECORD,
        version: 1,
        state: index < 10_000 ? 'open' : 'resolved',
      }),
    ),
    work_handover_packages: closed.map((index) =>
      scoped({
        id: uuid(8, index),
        job_id: uuid(1, index),
        project_id: uuid(2, index),
        state: 'released',
        version: 1,
      }),
    ),
    job_assignments: [...open, ...closed].flatMap((index) => {
      const jobs = { planned_date: index < 10_000 ? DUE : OLD_DATE, project_id: null, organization_id: ORG };
      return [
        scoped({ job_id: uuid(1, index), employee_record_id: OWN_RECORD, user_id: USER, jobs }),
        scoped({ job_id: uuid(1, index), employee_record_id: COLLEAGUE_RECORD, user_id: COLLEAGUE, jobs }),
      ];
    }),
  };
}

/** Dispatches to the viewer: open ones wait for the acknowledgement, the closed ones were acknowledged. */
function dispatchRows(pending: number, history: number): Record<string, Row[]> {
  const all = [...indexes(0, pending), ...indexes(10_000, history)];
  const closed = (index: number): boolean => index >= 10_000;
  return {
    planning_dispatches: all.map((index) =>
      scoped({
        id: uuid(4, index),
        occurrence_id: null,
        job_id: uuid(1, index),
        current_revision_id: uuid(5, index),
        status: 'active',
      }),
    ),
    planning_dispatch_revisions: all.map((index) =>
      scoped({
        id: uuid(5, index),
        dispatch_id: uuid(4, index),
        revision_number: 1,
        occurrence_id: null,
        job_id: uuid(1, index),
        planned_start_at: RECENT,
        planned_start_date: DUE,
      }),
    ),
    planning_dispatch_recipients: all.map((index) =>
      scoped({
        id: uuid(9, index),
        revision_id: uuid(5, index),
        dispatch_id: uuid(4, index),
        employee_record_id: OWN_RECORD,
      }),
    ),
    planning_dispatch_acknowledgements: all.map((index) =>
      scoped({
        id: uuid(10, index),
        dispatch_id: uuid(4, index),
        revision_id: uuid(5, index),
        employee_record_id: closed(index) ? OWN_RECORD : COLLEAGUE_RECORD,
        state: closed(index) ? 'acknowledged' : 'challenged',
        reason: closed(index) ? null : 'Termin passt nicht',
        challenge_resolved_at: null,
        created_at: RECENT,
      }),
    ),
  };
}

const vacationRequest = (index: number, isOpen: boolean): Row =>
  scoped({
    id: uuid(15, index),
    employee_record_id: personOf(index),
    status: isOpen ? 'pending' : 'approved',
    start_date: isOpen ? pendingDay(index) : OLD_DATE,
    end_date: isOpen ? pendingDay(index) : OLD_DATE,
    day_portion: 'full',
    decided_at: isOpen ? null : OLD,
    cancelled_at: null,
    decision_comment: null,
    cancellation_reason: null,
    created_at: isOpen ? RECENT : OLD,
  });

/** Requests, follow-ups, absences, time and join requests: pending ones, then decided ones. */
function requestRows(pending: number, history: number): Record<string, Row[]> {
  const open = indexes(0, pending);
  const closed = indexes(10_000, history);
  const both = (make: (index: number, isOpen: boolean) => Row): Row[] => [
    ...open.map((index) => make(index, true)),
    ...closed.map((index) => make(index, false)),
  ];
  return {
    client_requests: both((index, isOpen) =>
      scoped({
        id: uuid(11, index),
        request_number: `R-${index}`,
        summary: 'Heizung',
        status: isOpen ? 'offen' : 'umgewandelt',
        urgency: 'normal',
        assigned_to: COLLEAGUE,
        received_at: isOpen ? RECENT : OLD,
      }),
    ),
    client_follow_ups: both((index, isOpen) =>
      scoped({
        id: uuid(12, index),
        client_id: uuid(13, index),
        title: 'Rückruf',
        due_at: isOpen ? RECENT : OLD,
        owner_user_id: USER,
        status: isOpen ? 'open' : 'done',
      }),
    ),
    clients: open.map((index) => scoped({ id: uuid(13, index), name: `Kunde ${index}` })),
    // A field worker's access proposal: open ones wait for the office, decided ones are history.
    site_access_proposals: both((index, isOpen) =>
      scoped({
        id: uuid(27, index),
        job_id: uuid(1, index),
        site_id: uuid(28, index),
        status: isOpen ? 'open' : 'accepted',
        proposed_by: COLLEAGUE,
        proposed_at: isOpen ? RECENT : OLD,
        contact_name: isOpen ? 'Erika Musterfrau' : null,
        contact_phone: null,
        contact_note: null,
        access_notes: null,
      }),
    ),
    client_sites: open.map((index) =>
      scoped({
        id: uuid(28, index),
        name: `Haus ${index}`,
        street: null,
        postal_code: null,
        city: null,
        access_notes: null,
      }),
    ),
    client_contacts: open.map((index) =>
      scoped({
        id: uuid(29, index),
        site_id: uuid(28, index),
        site_role: 'zugangskontakt',
        is_active: true,
        name: `Hausmeister ${index}`,
        phone: null,
      }),
    ),
    organization_join_requests: both((index, isOpen) =>
      scoped({
        id: uuid(14, index),
        user_id: COLLEAGUE,
        requested_at: RECENT,
        status: isOpen ? 'pending' : 'approved',
      }),
    ),
    vacation_requests: [
      ...both(vacationRequest),
      // Approved and still ahead: each takes its person away from one planned visit.
      ...open.map((index) => ({
        ...vacationRequest(index, true),
        id: uuid(21, index),
        status: 'approved',
        start_date: upcomingDay(index),
        end_date: upcomingDay(index),
        decided_at: RECENT,
      })),
    ],
    sickness_reports: both((index, isOpen) =>
      scoped({
        id: uuid(16, index),
        employee_record_id: COLLEAGUE_RECORD,
        status: 'reported',
        start_date: isOpen ? pendingDay(index) : closedDay(index),
        end_date: isOpen ? pendingDay(index) : closedDay(index),
        day_portion: 'full',
        reported_by: COLLEAGUE,
        cancelled_by: null,
        cancelled_at: null,
        updated_at: isOpen ? RECENT : OLD,
      }),
    ),
    time_entries: both((index, isOpen) =>
      scoped({
        id: uuid(17, index),
        user_id: COLLEAGUE,
        status: isOpen ? 'pending' : 'approved',
        entry_type: index % 2 ? 'clock_out' : 'clock_in',
        timestamp: isOpen ? RECENT : OLD,
        created_at: isOpen ? RECENT : OLD,
        job_id: null,
        pair_id: null,
      }),
    ),
    time_correction_requests: both((index, isOpen) =>
      scoped({
        id: uuid(18, index),
        requested_by: COLLEAGUE,
        subject_user_id: COLLEAGUE,
        subject_employee_record_id: COLLEAGUE_RECORD,
        status: isOpen ? 'submitted' : 'approved',
        kind: 'missing_time',
        current_revision: 1,
        created_at: isOpen ? RECENT : OLD,
        updated_at: isOpen ? RECENT : OLD,
      }),
    ),
    time_correction_request_revisions: both((index) =>
      scoped({
        request_id: uuid(18, index),
        revision: 1,
        reason: 'vergessen',
        before_snapshot: { schemaVersion: 1, facts: [] },
        proposed_snapshot: { schemaVersion: 1, facts: [] },
        created_by: COLLEAGUE,
        created_at: RECENT,
      }),
    ),
    entry_change_requests: both((index, isOpen) =>
      scoped({
        id: uuid(19, index),
        requested_by: COLLEAGUE,
        status: isOpen ? 'pending' : 'approved',
        change_type: 'edit',
        created_at: isOpen ? RECENT : OLD,
      }),
    ),
    organization_responsibility_delegations: closed.map((index) =>
      scoped({
        id: uuid(20, index),
        responsibility: 'time_approval',
        delegator_employee_record_id: OWN_RECORD,
        substitute_employee_record_id: COLLEAGUE_RECORD,
        valid_from: '2024-01-01',
        valid_until: '2024-01-05',
        revoked_from: null,
      }),
    ),
  };
}

/** One visit on each approved vacation ahead; the closed history lies on past days no window reaches. */
function planningRows(pending: number, history: number): Record<string, Row[]> {
  const visit = (index: number, day: string, person = personOf(index)): Row =>
    scoped({
      id: uuid(22, index),
      status: 'scheduled',
      entry_kind: 'job_visit',
      internal_type: null,
      time_kind: 'timed',
      title: null,
      start_at: `${day}T07:00:00.000Z`,
      end_at: `${day}T09:00:00.000Z`,
      start_date: null,
      end_date_exclusive: null,
      absent: [{ id: uuid(23, index), employee_record_id: person }],
      job: { title: 'Einsatz', description: null, job_number: `A-${index}`, status: 'nicht_bearbeitet' },
    });
  return {
    planning_occurrences: [
      ...indexes(0, pending).map((index) => visit(index, upcomingDay(index))),
      // Someone with no vacation that day: the absence read's `!inner` team filter drops it.
      ...indexes(0, pending).map((index) => visit(20_000 + index, upcomingDay(index), uuid(26, index))),
      ...indexes(10_000, history).map((index) => visit(index, closedDay(index))),
    ],
  };
}

function buildWorld(size: { pending: number; history: number }): World {
  return new Map(
    Object.entries({
      ...rosterRows(),
      ...workRows(size.pending, size.history),
      ...dispatchRows(size.pending, size.history),
      ...requestRows(size.pending, size.history),
      ...planningRows(size.pending, size.history),
    }),
  );
}

// ---- The filtering fake client ----

/** A query against the seeded world that applies its filters and records the rows it returns. */
function query(table: string) {
  const filters: Filter[] = [];
  const innerEmbeds = new Set<string>();
  let single = false;
  let head = false;
  let window: [number, number] | null = null;
  // A filter on an embedded resource narrows the embedding only, unless the
  // select joins it with `!inner`: then a row without a match drops out.
  const on = (name: string, test: (value: unknown) => boolean): void => {
    const [embed = '', nested = ''] = name.split('.');
    if (!name.includes('.')) filters.push((row) => test(row[name]));
    // A to-many embed keeps its parent while one embedded row matches.
    else if (innerEmbeds.has(embed))
      filters.push((row) => [row[embed]].flat().some((item) => test(field(item, nested))));
  };
  const builder: Record<string, unknown> = {};
  const chain =
    (apply: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      apply(...args);
      return builder;
    };
  const column = (value: unknown): string => (typeof value === 'string' ? value : '');
  for (const operator of ['eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte'])
    builder[operator] = chain((name, operand) =>
      on(column(name), (value) => compare(operator, value, operand)),
    );
  builder.not = chain((name, operator, raw) => {
    const operand = parseOperand(column(operator), typeof raw === 'string' ? raw : 'null');
    on(
      column(name),
      (value) => value !== null && value !== undefined && !compare(column(operator), value, operand),
    );
  });
  builder.or = chain((text) => filters.push(termFilter(`or(${column(text)})`)));
  builder.select = chain((columns, options) => {
    // An aliased embed (`absent:planning_occurrence_assignments!inner(`) is filtered under its alias.
    for (const match of column(columns).matchAll(/(?:(\w+):)?(\w+)(?:!\w+)*?!inner\(/g))
      innerEmbeds.add(match[1] ?? match[2] ?? '');
    head = typeof options === 'object' && options !== null && 'head' in options && options.head === true;
  });
  builder.order = chain(() => undefined);
  builder.limit = chain((count, options) => {
    if (typeof count === 'number' && (typeof options !== 'object' || options === null))
      window = [0, count - 1];
  });
  builder.range = chain((from, to) => {
    if (typeof from === 'number' && typeof to === 'number') window = [from, to];
  });
  builder.maybeSingle = chain(() => {
    single = true;
  });
  builder.single = builder.maybeSingle;
  builder.then = (resolve: (result: unknown) => unknown) => {
    const matched = (world.get(table) ?? []).filter((row) => filters.every((filter) => filter(row)));
    const rows = window ? matched.slice(window[0], window[1] + 1) : matched;
    const returned = head ? [] : single ? rows.slice(0, 1) : rows;
    reads.push({ table, rows: returned.length });
    const data = head ? null : single ? (rows[0] ?? null) : rows;
    return Promise.resolve(resolve({ data, error: null, count: matched.length }));
  };
  return builder;
}

/** One field of an embedded row, or undefined when the embedding is missing. */
function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const entry: [string, unknown] | undefined = Object.entries(value).find(([name]) => name === key);
  return entry?.[1];
}

/** `list_pending_dispatch_recipients` as migration 20261016100000 defines it. */
function pendingRecipients(organizationId: unknown, employeeRecordId: unknown): Row[] {
  const rows = (table: string) =>
    (world.get(table) ?? []).filter((row) => row.organization_id === organizationId);
  const dispatches = rows('planning_dispatches');
  return rows('planning_dispatch_recipients').filter((recipient) => {
    if (recipient.employee_record_id !== employeeRecordId) return false;
    const current = dispatches.some(
      (dispatch) =>
        dispatch.id === recipient.dispatch_id &&
        dispatch.status === 'active' &&
        dispatch.current_revision_id === recipient.revision_id,
    );
    const latest = rows('planning_dispatch_acknowledgements')
      .filter(
        (ack) => ack.revision_id === recipient.revision_id && ack.employee_record_id === employeeRecordId,
      )
      .toSorted((left, right) => String(right.created_at).localeCompare(String(left.created_at)))[0];
    return current && latest?.state !== 'acknowledged' && latest?.state !== 'carried_forward';
  });
}

/** `list_handover_candidate_projects` as migration 20261016100000 defines it. */
function handoverCandidates(organizationId: unknown): Row[] {
  const open = new Set(
    (world.get('projects') ?? [])
      .filter(
        (project) => project.organization_id === organizationId && project.execution_state_override === null,
      )
      .map((project) => project.id),
  );
  const terminal = termFilter(
    'or(execution_state.in.(execution_complete,handed_over,cancelled),and(execution_state.is.null,status.eq.fertig))',
  );
  const ids = (world.get('jobs') ?? [])
    .filter((job) => job.organization_id === organizationId && open.has(job.project_id) && terminal(job))
    .map((job) => job.project_id);
  return [...new Set(ids)].map((projectId) => ({ project_id: projectId }));
}

/** The open requests of `read_manager_attention_sets`, as migration 20261129100001 defines them, without a promised callback. */
function openRequests(organizationId: unknown): Row[] {
  return (world.get('client_requests') ?? [])
    .filter(
      (row) =>
        row.organization_id === organizationId && (row.status === 'offen' || row.status === 'in_klaerung'),
    )
    .map((row) => ({ ...row, callback_due_at: null, callback_overdue: false, owner_is_manager: true }));
}

/** The open access proposals of `read_manager_attention_sets` (migration 20261130100003). */
function openProposals(organizationId: unknown): Row[] {
  return (world.get('site_access_proposals') ?? []).filter(
    (row) => row.organization_id === organizationId && row.status === 'open',
  );
}

/** The derivations' read functions, from the seeded world: whole vacation rows, and nobody has left. */
function rpc(name: string, args: unknown) {
  if (name === 'read_manager_attention_sets') {
    const requests = openRequests(field(args, 'p_organization_id'));
    const accessProposals = openProposals(field(args, 'p_organization_id'));
    reads.push({ table: `rpc ${name}`, rows: requests.length + accessProposals.length });
    return Promise.resolve({ data: { requests, access_proposals: accessProposals }, error: null });
  }
  if (name === 'read_open_absences') {
    const today = String(field(args, 'p_today'));
    const open = termFilter(`or(status.eq.pending,and(status.eq.approved,end_date.gte.${today}))`);
    const vacations = (world.get('vacation_requests') ?? [])
      .filter((row) => row.organization_id === field(args, 'p_organization_id') && open(row))
      .map((row): Row => ({ approved_days_by_year: null, cancelled_by: null, comment: null, ...row }))
      .map((row) => ({ decided_by: null, requested_by: null, updated_at: row.created_at, ...row }));
    reads.push({ table: 'vacation_requests', rows: vacations.length });
    return Promise.resolve({ data: { vacations, leaverWindows: [] }, error: null });
  }
  const rows =
    name === 'list_pending_dispatch_recipients'
      ? pendingRecipients(field(args, 'p_organization_id'), field(args, 'p_employee_record_id'))
      : name === 'list_handover_candidate_projects'
        ? handoverCandidates(field(args, 'p_organization_id'))
        : [];
  // The readers page a function's result like a table read: .range(from, to).
  return {
    range: (from: number, to: number) => {
      reads.push({ table: `rpc ${name}`, rows: rows.slice(from, to + 1).length });
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  };
}

const client = {
  from: (table: string) => query(table),
  rpc,
  auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
};

type Size = { pending: number; history: number };

/** The rows each table returned to one read in a world of the given size, and the requests it sent. */
async function rowsRead(nextRole: Role, size: Size, read: () => Promise<unknown>) {
  role = nextRole;
  world = buildWorld(size);
  reads = [];
  failures = [];
  const { withReadRequest } = await import('@/lib/data/read-request-cache');
  const result = await withReadRequest(new Request('http://localhost/api/attention-counts'), read, {
    priority: 'background',
  });
  const byTable = new Map<string, number>();
  const requestsByTable = new Map<string, number>();
  for (const entry of reads) {
    byTable.set(entry.table, (byTable.get(entry.table) ?? 0) + entry.rows);
    requestsByTable.set(entry.table, (requestsByTable.get(entry.table) ?? 0) + 1);
  }
  const total = reads.reduce((sum, entry) => sum + entry.rows, 0);
  return { result, byTable, requestsByTable, total, requests: reads.length, failures: [...failures] };
}

/** The tables that returned more rows once the closed history was seeded, and how many more. */
function historyGrowth(base: Map<string, number>, withHistory: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...withHistory]
      .filter(([table, rows]) => rows > (base.get(table) ?? 0))
      .map(([table, rows]) => [table, rows - (base.get(table) ?? 0)])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}

/**
 * table -> the closed-history rows each role still reads, in units of HISTORY, and why. Shrink-only: more
 * growth fails, and less fails until the entry is lowered or removed. Empty: the counts read no history. The
 * viewer's own dispatches (list_pending_dispatch_recipients) and the handover candidates
 * (list_handover_candidate_projects) are pending sets of the database since migration 20261016100000.
 */
const HISTORY_READS: Readonly<
  Record<string, { rows: Readonly<Record<Role, number>>; pagesOnly?: readonly Role[]; reason: string }>
> = {};

/** Each table whose history growth for this role differs from its reviewed entry. */
function historyProblems(nextRole: Role, growth: Record<string, number>): string[] {
  const tables = [...new Set([...Object.keys(growth), ...Object.keys(HISTORY_READS)])].sort();
  return tables.flatMap((table) => {
    const reviewed = (HISTORY_READS[table]?.rows[nextRole] ?? 0) * HISTORY;
    const grown = growth[table] ?? 0;
    return grown === reviewed
      ? []
      : [`${table}: the closed history adds ${grown} rows for ${nextRole}, reviewed ${reviewed}`];
  });
}

/**
 * Rows read with `pending` open items in every collection and no history: at most `fixed + perPendingItem *
 * pending`, in at most `requests` requests. Measured at 3 and 6 pending items; a new read raises it and fails.
 */
// werk-flow/werkflow-planning#267 added the approved vacations ahead with their visits: the office reads
// their visits once per 15 vacations plus dispatches and names, and own approvals add a marker read.
// werk-flow/werkflow-planning#329 added the open access proposals: they come with the open requests in one
// read, so without any the requests stay as before; with them, their job, Einsatzort and Zugangskontakte (a
// row each per proposal) and the proposers' names add four requests.
const ROW_BUDGET: Readonly<Record<Role, { fixed: number; perPendingItem: number; requests: number }>> = {
  admin: { fixed: 35, perPendingItem: 37, requests: 79 },
  buero: { fixed: 34, perPendingItem: 36, requests: 76 },
  employee: { fixed: 13, perPendingItem: 17, requests: 31 },
};

// Module mocks are process-wide, so the mocked scenario runs in its own process.
const ISOLATED = process.env.ATTENTION_COUNT_VOLUME_ISOLATED === '1';

test.skipIf(ISOLATED)('the attention count volume cases pass in an isolated process', async () => {
  const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
    env: { ...process.env, ATTENTION_COUNT_VOLUME_ISOLATED: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(status, `${stdout}\n${stderr}`).toBe(0);
  expect(stderr).toContain(' 0 fail');
});

if (ISOLATED) {
  setSystemTime(NOW);
  mock.module('server-only', () => ({}));
  mock.module('@/lib/logging', () => ({ logError: (...args: unknown[]) => failures.push(args) }));
  mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => client }));
  mock.module('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => client }));
  mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: ORG }) }) }));
  // The vacation approver reads the organization calendar through the data cache; here it reads through.
  mock.module('next/cache', () => ({
    unstable_cache: <Read>(read: Read) => read,
    cacheTag: () => undefined,
    revalidatePath: () => undefined,
    revalidateTag: () => undefined,
    updateTag: () => undefined,
  }));
  const { getAttentionCounts } = await import('./actions');

  const { readCompleteRows } = await import('@/lib/supabase/query-batches');
  const { createSupabaseAdminClient } = await import('@/lib/supabase/admin');
  const ROLES: Role[] = ['admin', 'buero', 'employee'];
  const counts = async () => {
    const result = await getAttentionCounts();
    if (!result.success) throw new Error(`the counts failed: ${JSON.stringify(failures)}`);
    return result;
  };

  describe('attention count volume', () => {
    test.each(ROLES)('%s: the closed history adds only the reviewed reads', async (nextRole) => {
      const base = await rowsRead(nextRole, { pending: 3, history: 0 }, counts);
      const full = await rowsRead(nextRole, { pending: 3, history: HISTORY }, counts);
      expect(historyProblems(nextRole, historyGrowth(base.byTable, full.byTable))).toEqual([]);
      // Pages follow rows: only a reviewed history read may send more requests, and a pages-only entry must still.
      const morePages = Object.keys(historyGrowth(base.requestsByTable, full.requestsByTable));
      expect(
        morePages.filter((table) => {
          const reviewed = HISTORY_READS[table];
          return !reviewed?.rows[nextRole] && !reviewed?.pagesOnly?.includes(nextRole);
        }),
      ).toEqual([]);
      expect(
        Object.entries(HISTORY_READS)
          .filter(([table, entry]) => entry.pagesOnly?.includes(nextRole) && !morePages.includes(table))
          .map(([table]) => table),
      ).toEqual([]);
    });

    test.each(ROLES)(
      '%s: the rows and requests stay within the budget of the pending work',
      async (nextRole) => {
        const budget = ROW_BUDGET[nextRole];
        for (const pending of [3, 6]) {
          const read = await rowsRead(nextRole, { pending, history: 0 }, counts);
          expect(read.total, `${nextRole} with ${pending} pending items per collection`).toBeLessThanOrEqual(
            budget.fixed + budget.perPendingItem * pending,
          );
          expect(read.requests).toBeLessThanOrEqual(budget.requests);
        }
      },
    );

    test('a planted derivation that reads the whole history fails the budget', async () => {
      const wholeHistory = () =>
        readCompleteRows(
          (from, to) =>
            createSupabaseAdminClient()
              .from('client_requests')
              .select('id')
              .eq('organization_id', ORG)
              .order('id')
              .range(from, to),
          10_000,
        );
      const base = await rowsRead('admin', { pending: 3, history: 0 }, wholeHistory);
      const full = await rowsRead('admin', { pending: 3, history: HISTORY }, wholeHistory);
      expect(historyProblems('admin', historyGrowth(base.byTable, full.byTable))).toContain(
        `client_requests: the closed history adds ${HISTORY} rows for admin, reviewed 0`,
      );
    });

    test('the fake applies the filters the derivations send', () => {
      const terminal = termFilter(
        'or(execution_state.in.(execution_complete,handed_over),and(execution_state.is.null,status.eq.fertig))',
      );
      expect(terminal({ execution_state: 'handed_over' })).toBe(true);
      expect(terminal({ execution_state: null, status: 'fertig' })).toBe(true);
      expect(terminal({ execution_state: 'in_progress', status: 'fertig' })).toBe(false);
      expect(termFilter('decided_at.gte.2026-08-17T00:00:00.000Z')({ decided_at: OLD })).toBe(false);
      expect(compare('neq', null, 'resolved')).toBe(false);
      expect(() => compare('ilike', 'a', 'a')).toThrow();
    });
  });
}
