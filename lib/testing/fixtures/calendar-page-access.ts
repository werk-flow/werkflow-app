// The real Kalender page and its readers over the in-memory database: a field
// worker reads their own board row, their own visits and themself as the only
// member, never a colleague's or a no-login person's visit or name. A member
// of another organization reads none of its rows, visits or members, and its
// board and window readers refuse the organization's id. A Büro member of the
// owning organization reads every row and visit on the same page, so each
// refusal answers the role or the organization, not a missing row.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { CALLER_ID, ORGANIZATION_A, ORGANIZATION_B, signInAs } from './action-boundary-world';
import { field, installPageWorld, renderTree } from './page-render';

const colleagueId = '6c000000-0000-4000-8000-000000000001';
const ownRecord = '6c000000-0000-4000-8000-000000000011';
const colleagueRecord = '6c000000-0000-4000-8000-000000000012';
const noLoginRecord = '6c000000-0000-4000-8000-000000000013';
const outsiderRecord = '6c000000-0000-4000-8000-000000000014';
const date = '2026-11-04';

const people = [
  {
    id: ownRecord,
    organization_id: ORGANIZATION_A,
    user_id: CALLER_ID,
    first_name: 'Emil',
    last_name: 'Eigen',
  },
  {
    id: colleagueRecord,
    organization_id: ORGANIZATION_A,
    user_id: colleagueId,
    first_name: 'Berta',
    last_name: 'Bürokraft',
  },
  {
    id: noLoginRecord,
    organization_id: ORGANIZATION_A,
    user_id: null,
    first_name: 'Nora',
    last_name: 'Ohnelogin',
  },
  {
    id: outsiderRecord,
    organization_id: ORGANIZATION_B,
    user_id: CALLER_ID,
    first_name: 'Otto',
    last_name: 'Fremd',
  },
];

/** A timed internal visit of `recordIds`, embedded as the calendar and board reads select it. */
function visit(id: string, organizationId: string, title: string, recordIds: string[]) {
  return {
    id,
    organization_id: organizationId,
    series_id: null,
    series_lineage_id: null,
    job_id: null,
    entry_kind: 'internal',
    internal_type: 'internal_work',
    time_kind: 'timed',
    status: 'scheduled',
    is_exception: false,
    title,
    description: null,
    location: null,
    start_at: `${date}T07:00:00.000Z`,
    end_at: `${date}T08:00:00.000Z`,
    start_date: null,
    end_date_exclusive: null,
    version: 1,
    assignments: recordIds.map((recordId) => ({
      employee_record_id: recordId,
      employee_records: { user_id: people.find((person) => person.id === recordId)?.user_id ?? null },
    })),
    // The employee reads' inner-joined alias of the same assignments.
    own: recordIds.map((recordId) => ({ employee_record_id: recordId })),
    job: null,
  };
}

const world = await installPageWorld({
  employee_records: people.map((person) => ({ ...person, entry_date: null, exit_date: null })),
  profiles: people.flatMap((person) =>
    person.user_id === colleagueId
      ? [{ id: colleagueId, first_name: person.first_name, last_name: person.last_name }]
      : [],
  ),
  organization_members: [
    { organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'employee' },
    { organization_id: ORGANIZATION_A, user_id: colleagueId, role: 'buero' },
    { organization_id: ORGANIZATION_B, user_id: CALLER_ID, role: 'admin' },
  ],
  planning_occurrences: [
    visit('6c000000-0000-4000-8000-000000000021', ORGANIZATION_A, 'Eigener Termin', [ownRecord]),
    visit('6c000000-0000-4000-8000-000000000022', ORGANIZATION_A, 'Termin von Berta', [colleagueRecord]),
    visit('6c000000-0000-4000-8000-000000000023', ORGANIZATION_A, 'Termin ohne Login', [noLoginRecord]),
    visit('6c000000-0000-4000-8000-000000000024', ORGANIZATION_B, 'Fremder Termin', [outsiderRecord]),
  ],
});
// The page and the board read the organization's settings and holiday calendar
// through the cache; the defaults and the uncached calendar reader stand in.
const cached = { ...(await import('@/lib/data/cached')) };
const { getDefaultTimeTrackingSettings } = await import('@/lib/time-tracking/settings');
const { readOrganizationCalendar } = await import('@/lib/personnel/calendar-reader');
mock.module('@/lib/data/cached', () => ({
  ...cached,
  getCachedOrganizationSettings: async (organizationId: string) =>
    getDefaultTimeTrackingSettings(organizationId),
  getCachedOrganizationCalendar: (organizationId: string) => readOrganizationCalendar(organizationId),
}));
// The member list function answers every member of the organization it is asked for (SQL-tested).
world.rpc = ({ name, args }) => {
  if (name !== 'get_org_members_for_user') return { data: [], error: null };
  const members = (world.tables.organization_members ?? []).filter(
    (member) => member.organization_id === args.p_org_id,
  );
  return {
    data: members.map((member) => ({
      ...people.find(
        (person) => person.user_id === member.user_id && person.organization_id === args.p_org_id,
      ),
      user_id: member.user_id,
      role: member.role,
      email: 'member@example.test',
    })),
    error: null,
  };
};

const { default: KalenderPage } = await import('@/app/(app)/kalender/page');
const { getCalendarWindow } = await import('@/lib/calendar/actions');
const { getCalendarBoardContext } = await import('@/lib/calendar/board-actions');
const { getPlanningEntries } = await import('@/lib/planning/actions');

const allTitles = ['Eigener Termin', 'Fremder Termin', 'Termin ohne Login', 'Termin von Berta'];
const allNames = people.map((person) => person.last_name);
const window = (organizationId: string) => ({
  organizationId,
  from: `${date}T00:00:00.000Z`,
  to: `${date}T22:59:59.999Z`,
  fromDate: date,
  toDate: date,
});

/** What the page hands the calendar: its members, board rows and visit titles, and every name and title in it. */
async function renderedCalendar() {
  const tree = await renderTree(() => KalenderPage({ searchParams: Promise.resolve({ date }) }));
  const props = field(
    tree.find((element) => field(element, 'props', 'initialData') !== undefined),
    'props',
  );
  assert.ok(props, 'the page rendered no calendar');
  const serialized = JSON.stringify(props);
  const list = (value: unknown, key: string) =>
    Array.isArray(value) ? value.map((item: unknown) => String(field(item, key))).sort() : [];
  return {
    members: list(field(props, 'members'), 'user_id'),
    rows: list(field(props, 'initialData', 'board', 'rows'), 'employeeRecordId'),
    titles: list(field(props, 'initialData', 'jobs'), 'title'),
    names: allNames.filter((name) => serialized.includes(name)),
    shownTitles: allTitles.filter((title) => serialized.includes(title)),
  };
}

async function readTitles(): Promise<string[]> {
  const entries = await getPlanningEntries(date, date);
  assert.ok(entries.success, 'the planning read failed');
  return entries.entries.map((entry) => entry.title).sort();
}

// A field worker of the organization sees their own row, visit and name only.
signInAs(world, 'employee');
assert.deepEqual(await renderedCalendar(), {
  members: [CALLER_ID],
  rows: [ownRecord],
  titles: ['Eigener Termin'],
  names: ['Eigen'],
  shownTitles: ['Eigener Termin'],
});
// The readers narrow the field worker themselves, not only the page.
assert.deepEqual(await readTitles(), ['Eigener Termin']);
const ownBoard = await getCalendarBoardContext({
  organizationId: ORGANIZATION_A,
  fromDate: date,
  toDate: date,
});
assert.ok(ownBoard.success, 'the field worker’s board read failed');
assert.deepEqual(
  ownBoard.rows.map((row) => row.employeeRecordId),
  [ownRecord],
);

// An admin of another organization sees only their own organization, and its
// board and window readers refuse this organization's id.
signInAs(world, 'admin', ORGANIZATION_B);
assert.deepEqual(await renderedCalendar(), {
  members: [CALLER_ID],
  rows: [outsiderRecord],
  titles: ['Fremder Termin'],
  names: ['Fremd'],
  shownTitles: ['Fremder Termin'],
});
assert.deepEqual(await readTitles(), ['Fremder Termin']);
const organizationChanged = { success: false, error: 'organization_changed' };
assert.deepEqual(
  await getCalendarBoardContext({ organizationId: ORGANIZATION_A, fromDate: date, toDate: date }),
  organizationChanged,
);
assert.deepEqual(await getCalendarWindow(window(ORGANIZATION_A)), organizationChanged);

// Büro of the owning organization sees every row, visit and member on the same page.
signInAs(world, 'buero');
assert.deepEqual(await renderedCalendar(), {
  members: [CALLER_ID, colleagueId].sort(),
  rows: [ownRecord, colleagueRecord, noLoginRecord].sort(),
  titles: ['Eigener Termin', 'Termin ohne Login', 'Termin von Berta'],
  names: ['Eigen', 'Bürokraft', 'Ohnelogin'],
  shownTitles: ['Eigener Termin', 'Termin ohne Login', 'Termin von Berta'],
});
assert.deepEqual(await readTitles(), ['Eigener Termin', 'Termin ohne Login', 'Termin von Berta']);
