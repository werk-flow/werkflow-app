// Boundary test: scripts/report-thread.ts, a report thread's door to the
// hand-out, sends the bearer secret only in its header and prints the scrubbed
// copy, a screenshot path or a code, never the secret or another word of an answer.
import { afterAll, beforeEach, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '../../scripts/report-thread.ts');
const SECRET = `${'h'.repeat(40)}-handout-secret`;
const REPORT_ID = '0b9f3c1e-5d2a-4c7b-9e8f-1a2b3c4d5e6f';
const COPY = {
  reportId: REPORT_ID,
  description: 'Die Plantafel zeigt [Kunde 1] doppelt.',
  context: null,
  status: 'eingegangen',
  bucket: null,
  screenshot: `/api/problem-reports/v1/reports/${REPORT_ID}/screenshot`,
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Seen = { method: string; path: string; authorization: string | null; body: string };
let seen: Seen[] = [];
let answer: () => Response = () => Response.json(COPY);

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    seen.push({
      method: request.method,
      path: new URL(request.url).pathname,
      authorization: request.headers.get('authorization'),
      body: await request.text(),
    });
    return answer();
  },
});
afterAll(() => server.stop(true));

let home = '';
beforeEach(() => {
  seen = [];
  answer = () => Response.json(COPY);
  home = mkdtempSync(join(tmpdir(), 'report-thread-home-'));
  writeSecretFile();
});

function writeSecretFile(mode = 0o600): void {
  mkdirSync(join(home, '.config/werkflow'), { recursive: true });
  const file = join(home, '.config/werkflow/problem-report-handout.env');
  writeFileSync(
    file,
    `PROBLEM_REPORT_HANDOUT_ORIGIN=http://127.0.0.1:${server.port}\nPROBLEM_REPORT_HANDOUT_SECRET=${SECRET}\n`,
  );
  chmodSync(file, mode);
}

async function helper(args: string[], stdin = ''): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(['bun', SCRIPT, ...args], {
    env: { ...process.env, HOME: home },
    stdin: new TextEncoder().encode(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(`${stdout}${stderr}`).not.toContain(SECRET);
  return { code, stdout, stderr };
}

test('the hand-out sends the bearer secret in its header and prints only the scrubbed copy', async () => {
  const run = await helper(['hand-out', REPORT_ID]);
  expect(run).toEqual({ code: 0, stdout: `${JSON.stringify(COPY, null, 2)}\n`, stderr: '' });
  expect(seen).toEqual([
    {
      method: 'POST',
      path: `/api/problem-reports/v1/reports/${REPORT_ID}/hand-out`,
      authorization: `Bearer ${SECRET}`,
      body: '',
    },
  ]);
});

test('a second hand-out stops with its code and prints no copy', async () => {
  answer = () => Response.json({ error: 'already_handed_out' }, { status: 409 });
  expect(await helper(['hand-out', REPORT_ID])).toEqual({
    code: 3,
    stdout: '',
    stderr: 'refused: already_handed_out\n',
  });
});

test('a refusal prints its code and never the rest of the answer', async () => {
  answer = () => Response.json({ error: 'failed', detail: COPY.description }, { status: 500 });
  const run = await helper(['hand-out', REPORT_ID]);
  expect(run).toEqual({ code: 3, stdout: '', stderr: 'refused: failed\n' });
});

test('the hand-out switched off on the server answers as off', async () => {
  answer = () => Response.json({ error: 'handout_off' }, { status: 503 });
  expect(await helper(['hand-out', REPORT_ID])).toEqual({
    code: 2,
    stdout: '',
    stderr: 'off: the hand-out answers 503\n',
  });
});

test('a machine without the secret file is off and sends nothing', async () => {
  home = mkdtempSync(join(tmpdir(), 'report-thread-home-'));
  expect((await helper(['hand-out', REPORT_ID])).code).toBe(2);
  expect(seen).toEqual([]);
});

test('a secret file others can read stops before any request', async () => {
  writeSecretFile(0o644);
  const run = await helper(['hand-out', REPORT_ID]);
  expect(run.code).toBe(1);
  expect(run.stderr).toContain('chmod 600');
  expect(seen).toEqual([]);
});

test('an id that is no UUID is refused before any request', async () => {
  expect((await helper(['hand-out', '../../reports'])).code).toBe(1);
  expect(seen).toEqual([]);
});

test('the screenshot lands outside the checkout, readable only by its owner', async () => {
  answer = () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
  const run = await helper(['screenshot', REPORT_ID]);
  const file = run.stdout.trim();
  expect(run.code).toBe(0);
  expect(file.startsWith(resolve(import.meta.dir, '../..'))).toBe(false);
  expect(new Uint8Array(readFileSync(file))).toEqual(PNG);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(seen[0]?.path).toBe(`/api/problem-reports/v1/reports/${REPORT_ID}/screenshot`);
});

test('the write-back sends the JSON object on stdin with the bearer secret', async () => {
  answer = () => new Response(null, { status: 204 });
  const body = { changes: { bucket: 'fehler', status: 'erledigt' }, expected: { status: 'eingegangen' } };
  expect(await helper(['write-back', REPORT_ID], JSON.stringify(body))).toEqual({
    code: 0,
    stdout: 'written\n',
    stderr: '',
  });
  expect(seen[0]?.authorization).toBe(`Bearer ${SECRET}`);
  expect(JSON.parse(seen[0]?.body ?? '')).toEqual(body);
});

test('a triage conflict prints the current state and nothing of an answer', async () => {
  answer = () =>
    Response.json(
      {
        error: 'triage_conflict',
        status: 'in_bearbeitung',
        bucket: 'fehler',
        hasAnswer: true,
        response: 'Hallo',
      },
      { status: 409 },
    );
  expect(await helper(['write-back', REPORT_ID], '{"changes":{"status":"erledigt"}}')).toEqual({
    code: 3,
    stdout: '',
    stderr: 'refused: triage_conflict {"status":"in_bearbeitung","bucket":"fehler","hasAnswer":true}\n',
  });
});

test('a write-back without a JSON object on stdin sends nothing', async () => {
  expect((await helper(['write-back', REPORT_ID], 'erledigt')).code).toBe(1);
  expect(seen).toEqual([]);
});
