import { expect, mock, test } from 'bun:test';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import type { JobInstructionItemRow } from './types';

// A manager can grow one instruction list to a thousand items. Hydration gave
// each item its evidence requirements and predecessors by scanning every
// requirement and every dependency of the list again, so its work grew with
// the square of the list. Each requirement and dependency is now looked at a
// fixed number of times, and the hydrated items stay exactly as before.

const ORGANIZATION = '20000000-0000-4000-8000-00000000000a';
const MANAGER = '30000000-0000-4000-8000-000000000001';
const NOW = '2026-10-01T08:00:00.000Z';
const LONG_LIST_LENGTH = 300;

type TableRow = Record<string, unknown>;
type Tables = Record<string, TableRow[]>;

const id = (kind: number, index: number) =>
  `${String(kind).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`;

function itemRow(itemId: string, sortOrder: number, content: string): JobInstructionItemRow {
  return {
    id: itemId,
    organization_id: ORGANIZATION,
    job_id: '91000000-0000-4000-8000-000000000101',
    project_id: null,
    content,
    item_kind: 'task',
    requirement_state: 'required',
    group_label: null,
    notes: null,
    work_template_application_id: null,
    source_work_template_item_id: null,
    sort_order: sortOrder,
    is_completed: false,
    completion_version: 0,
    created_by: MANAGER,
    last_status_changed_by: null,
    last_status_changed_at: null,
    created_at: NOW,
    updated_at: NOW,
  };
}

/**
 * A real service-role client whose PostgREST requests the tables answer, in
 * table order (the order the database sorts them in), with the `eq` and `in`
 * filters each request really sent.
 */
function adminOver(tables: Tables) {
  const request: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === '/rest/v1/rpc/list_profile_references') {
        return Response.json([
          {
            id: MANAGER,
            first_name: 'Bea',
            last_name: 'Büro',
            email: 'bea@example.test',
            avatar_path: 'avatars/bea.png',
            is_member: true,
          },
        ]);
      }
      if (init?.method && init.method !== 'GET') throw new Error(`Unexpected ${init.method} ${url.pathname}`);
      let rows = tables[url.pathname.replace('/rest/v1/', '')] ?? [];
      for (const [column, filter] of url.searchParams) {
        if (filter.startsWith('eq.')) rows = rows.filter((row) => row[column] === filter.slice(3));
        if (filter.startsWith('in.')) {
          const values = new Set(filter.slice(4, -1).split(','));
          rows = rows.filter((row) => values.has(String(row[column])));
        }
      }
      return Response.json(rows);
    },
    { preconnect: () => {} },
  );
  return createClient<Database>('http://127.0.0.1:54321', 'isolated-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: request },
  });
}

// How often hydration reads the item a requirement or a dependency belongs to.
const GROUPING_KEYS = new Set<PropertyKey>(['instruction_item_id', 'dependent_item_id']);
let groupingKeyReads = 0;

function counted<Row>(row: Row): Row {
  if (typeof row !== 'object' || row === null) return row;
  return new Proxy(row, {
    get(target, property, receiver) {
      if (GROUPING_KEYS.has(property)) groupingKeyReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
}

// Module mocks are process-wide, so the mocked scenario runs in its own process.
const ISOLATED = process.env.INSTRUCTION_ITEM_HYDRATION_ISOLATED === '1';

test.skipIf(ISOLATED)('instruction item hydration passes in an isolated process', async () => {
  const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
    env: { ...process.env, INSTRUCTION_ITEM_HYDRATION_ISOLATED: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(status, `${stdout}\n${stderr}`).toBe(0);
  expect(stderr).toContain('2 pass');
});

async function loadHydration() {
  mock.module('server-only', () => ({}));
  // Every row the batched reads return counts the reads of its item key.
  const batches = await import('@/lib/supabase/query-batches');
  const readInBatches = batches.readInBatches;
  mock.module('@/lib/supabase/query-batches', () => ({
    ...batches,
    readInBatches: async <Row, ReadError extends { message: string }>(
      ids: readonly string[],
      read: (batch: readonly string[]) => PromiseLike<{ data: Row[] | null; error: ReadError | null }>,
      size?: number,
    ) => {
      const result = await readInBatches(ids, read, size);
      return { ...result, data: result.data.map(counted) };
    },
  }));
  return (await import('./instruction-item-hydration')).hydrateInstructionItems;
}

test.skipIf(!ISOLATED)(
  'hydration reads each requirement and dependency a fixed number of times, however long the list',
  async () => {
    const hydrateInstructionItems = await loadHydration();
    const rows = Array.from({ length: LONG_LIST_LENGTH }, (_, index) =>
      itemRow(id(1, index), index, `Schritt ${index}`),
    );
    const requirements = rows.flatMap((row, index) =>
      [0, 1].map((slot) => ({
        id: id(2, index * 2 + slot),
        organization_id: ORGANIZATION,
        instruction_item_id: row.id,
        description: `Nachweis ${index}.${slot}`,
        document_category: 'photo',
      })),
    );
    const dependencies = rows.slice(1).map((row, index) => ({
      organization_id: ORGANIZATION,
      dependent_item_id: row.id,
      predecessor_item_id: id(1, index),
    }));
    groupingKeyReads = 0;

    const items = await hydrateInstructionItems(
      adminOver({
        job_instruction_item_evidence_requirements: requirements,
        job_instruction_item_dependencies: dependencies,
      }),
      ORGANIZATION,
      rows,
    );

    if (!items) throw new Error('hydration failed');
    expect(items).toHaveLength(LONG_LIST_LENGTH);
    expect(items.every((item) => item.evidenceRequirements.length === 2)).toBe(true);
    expect(items.at(-1)?.predecessors).toEqual([{ id: id(1, LONG_LIST_LENGTH - 2), content: 'Schritt 298' }]);
    // Scanning the whole list again for each item reads these keys about 270,000 times here.
    expect(groupingKeyReads).toBeLessThanOrEqual(2 * (requirements.length + dependencies.length));
  },
);

test.skipIf(!ISOLATED)(
  'hydrated items keep their requirements in sort order with fulfillments and predecessor labels',
  async () => {
    const hydrateInstructionItems = await loadHydration();
    const first = itemRow(id(1, 1), 0, 'Heizkreis entleeren');
    const second = itemRow(id(1, 2), 1, 'Pumpe tauschen');
    const outsideItemId = id(1, 9);
    const goneItemId = id(1, 8);
    const requirement = (index: number, itemId: string, description: string) => ({
      id: id(2, index),
      organization_id: ORGANIZATION,
      instruction_item_id: itemId,
      description,
      document_category: 'photo',
    });

    const items = await hydrateInstructionItems(
      adminOver({
        // In `sort_order`, with the two items' requirements interleaved.
        job_instruction_item_evidence_requirements: [
          requirement(1, second.id, 'Foto alte Pumpe'),
          requirement(2, first.id, 'Foto Manometer'),
          requirement(3, second.id, 'Foto neue Pumpe'),
        ],
        job_instruction_item_evidence_fulfillments: [
          {
            id: id(3, 1),
            organization_id: ORGANIZATION,
            evidence_requirement_id: id(2, 3),
            document_id: id(4, 1),
            artifact_revision_id: id(5, 1),
            version: 2,
          },
        ],
        job_instruction_item_dependencies: [
          { organization_id: ORGANIZATION, dependent_item_id: second.id, predecessor_item_id: first.id },
          { organization_id: ORGANIZATION, dependent_item_id: second.id, predecessor_item_id: outsideItemId },
          { organization_id: ORGANIZATION, dependent_item_id: second.id, predecessor_item_id: goneItemId },
        ],
        job_instruction_items: [
          { id: outsideItemId, organization_id: ORGANIZATION, content: 'Anlage abschalten' },
        ],
      }),
      ORGANIZATION,
      [first, second],
    );

    const manager = {
      userId: MANAGER,
      firstName: 'Bea',
      lastName: 'Büro',
      email: 'bea@example.test',
      avatarPath: 'avatars/bea.png',
    };
    expect(
      items?.map(
        ({ id: itemId, creator, lastStatusChangedByProfile, evidenceRequirements, predecessors }) => ({
          itemId,
          creator,
          lastStatusChangedByProfile,
          evidenceRequirements,
          predecessors,
        }),
      ),
    ).toEqual([
      {
        itemId: first.id,
        creator: manager,
        lastStatusChangedByProfile: null,
        evidenceRequirements: [
          { id: id(2, 2), description: 'Foto Manometer', documentCategory: 'photo', fulfillment: null },
        ],
        predecessors: [],
      },
      {
        itemId: second.id,
        creator: manager,
        lastStatusChangedByProfile: null,
        evidenceRequirements: [
          { id: id(2, 1), description: 'Foto alte Pumpe', documentCategory: 'photo', fulfillment: null },
          {
            id: id(2, 3),
            description: 'Foto neue Pumpe',
            documentCategory: 'photo',
            fulfillment: { id: id(3, 1), documentId: id(4, 1), artifactRevisionId: id(5, 1), version: 2 },
          },
        ],
        predecessors: [
          { id: first.id, content: 'Heizkreis entleeren' },
          { id: outsideItemId, content: 'Anlage abschalten' },
          { id: goneItemId, content: 'Früherer Eintrag' },
        ],
      },
    ]);
  },
);
