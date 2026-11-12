import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { isUuid } from '../lib/validation/uuid';

// A report thread's one door to the problem-report hand-out
// (.claude/skills/report-thread/SKILL.md, docs/features/problem-reports.md).
//
//   bun scripts/report-thread.ts hand-out <id>     claims the report, prints its scrubbed copy
//   bun scripts/report-thread.ts screenshot <id>   saves the redrawn screenshot outside the checkout, prints its path
//   bun scripts/report-thread.ts write-back <id>   sends the JSON on stdin, prints `written` or the refusal
//
// The origin and the bearer secret come from SECRET_FILE in the home folder,
// mode 600, the file werkflow-planning's ops/report-dispatch.py reads too. The
// secret goes only into the Authorization header. Nothing here prints it, a
// header or an answer other than the copy, the screenshot's path and a code.

const SECRET_FILE = join(homedir(), '.config/werkflow/problem-report-handout.env');
const API_PATH = '/api/problem-reports/v1/reports';
// As lib/security/shared-secret.ts: a shorter value counts as unset.
const MINIMUM_SECRET_LENGTH = 32;
const TIMEOUT_MILLISECONDS = 30_000;
const SCREENSHOT_TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Exit codes a thread reads: 2 the hand-out is off, 3 a refusal with its code. */
const EXIT = { failed: 1, off: 2, refused: 3 } as const;

class Stop extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

type Handout = { origin: string; secret: string; bypass: string | null };

function readHandout(): Handout {
  let mode: number;
  try {
    mode = statSync(SECRET_FILE).mode;
  } catch {
    throw new Stop('off: this machine has no hand-out secret', EXIT.off);
  }
  if (mode & 0o077)
    throw new Stop(`the hand-out secret file is readable by others; chmod 600 it`, EXIT.failed);
  const values = new Map<string, string>();
  for (const line of readFileSync(SECRET_FILE, 'utf8').split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) values.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  const secret = values.get('PROBLEM_REPORT_HANDOUT_SECRET') ?? '';
  const origin = (values.get('PROBLEM_REPORT_HANDOUT_ORIGIN') ?? '').replace(/\/+$/, '');
  if (secret.length < MINIMUM_SECRET_LENGTH || !origin) {
    throw new Stop('off: this machine has no hand-out secret', EXIT.off);
  }
  const url = URL.canParse(origin) ? new URL(origin) : null;
  const local = url?.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (!url || !(url.protocol === 'https:' || local) || url.origin !== origin) {
    throw new Stop('PROBLEM_REPORT_HANDOUT_ORIGIN is no https origin', EXIT.failed);
  }
  return { origin, secret, bypass: values.get('VERCEL_AUTOMATION_BYPASS_SECRET') || null };
}

async function post(handout: Handout, path: string, body?: string): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${handout.secret}` };
  if (handout.bypass) headers['x-vercel-protection-bypass'] = handout.bypass;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    return await fetch(`${handout.origin}${API_PATH}/${path}`, {
      method: 'POST',
      headers,
      body: body ?? null,
      signal: AbortSignal.timeout(TIMEOUT_MILLISECONDS),
    });
  } catch (error) {
    throw new Stop(
      `the hand-out did not answer (${error instanceof Error ? error.name : 'unknown'})`,
      EXIT.failed,
    );
  }
}

const errorSchema = z.object({ error: z.string().regex(/^[a-z_]+$/) });
// A conflict names the report's state now, never its text.
const conflictSchema = z.object({
  error: z.literal('triage_conflict'),
  current: z.object({
    status: z.string().regex(/^[a-z_]+$/),
    bucket: z
      .string()
      .regex(/^[a-z_]+$/)
      .nullable(),
    hasAnswer: z.boolean(),
  }),
});

/** Stops on a refusal: its code, and for a triage conflict the current state; never another word of the answer. */
async function refuse(response: Response): Promise<never> {
  if (response.status === 503) throw new Stop('off: the hand-out answers 503', EXIT.off);
  const body: unknown = await response.json().catch(() => null);
  const conflict = conflictSchema.safeParse(body);
  if (conflict.success) {
    const { status, bucket, hasAnswer } = conflict.data.current;
    throw new Stop(`refused: triage_conflict ${JSON.stringify({ status, bucket, hasAnswer })}`, EXIT.refused);
  }
  const error = errorSchema.safeParse(body);
  throw new Stop(`refused: ${error.success ? error.data.error : `status ${response.status}`}`, EXIT.refused);
}

const copySchema = z.looseObject({ reportId: z.string(), description: z.string() });

async function handOut(handout: Handout, reportId: string): Promise<string> {
  const response = await post(handout, `${reportId}/hand-out`);
  if (!response.ok) return refuse(response);
  const copy = copySchema.safeParse(await response.json().catch(() => null));
  if (!copy.success || copy.data.reportId !== reportId) {
    throw new Stop('the hand-out answered a copy of an unknown shape', EXIT.failed);
  }
  return JSON.stringify(copy.data, null, 2);
}

async function screenshot(handout: Handout, reportId: string): Promise<string> {
  const response = await post(handout, `${reportId}/screenshot`);
  if (!response.ok) return refuse(response);
  const extension = SCREENSHOT_TYPES[response.headers.get('content-type') ?? ''];
  if (!extension) throw new Stop('the hand-out answered a screenshot of an unknown type', EXIT.failed);
  // Outside every checkout, so no commit can take it along.
  const folder = mkdtempSync(join(tmpdir(), 'report-screenshot-'));
  const file = join(folder, `screenshot.${extension}`);
  writeFileSync(file, new Uint8Array(await response.arrayBuffer()));
  chmodSync(file, 0o600);
  return file;
}

async function writeBack(handout: Handout, reportId: string): Promise<string> {
  const input = await Bun.stdin.text();
  const parsed: unknown = (() => {
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  })();
  if (!z.record(z.string(), z.unknown()).safeParse(parsed).success) {
    throw new Stop('write-back reads one JSON object on stdin', EXIT.failed);
  }
  const response = await post(handout, `${reportId}/write-back`, JSON.stringify(parsed));
  if (!response.ok) return refuse(response);
  return 'written';
}

const COMMANDS = { 'hand-out': handOut, screenshot, 'write-back': writeBack } as const;

function isCommand(value: string | undefined): value is keyof typeof COMMANDS {
  return value !== undefined && Object.hasOwn(COMMANDS, value);
}

async function main(): Promise<number> {
  const [command, reportId, ...rest] = process.argv.slice(2);
  try {
    if (!isCommand(command) || reportId === undefined || rest.length > 0) {
      throw new Stop(
        'usage: bun scripts/report-thread.ts hand-out|screenshot|write-back <report id>',
        EXIT.failed,
      );
    }
    if (!isUuid(reportId)) throw new Stop('a report id is a UUID', EXIT.failed);
    console.log(await COMMANDS[command](readHandout(), reportId));
    return 0;
  } catch (error) {
    // Any other error by its type only: its message could quote an answer.
    console.error(
      error instanceof Stop ? error.message : `failed: ${error instanceof Error ? error.name : 'unknown'}`,
    );
    return error instanceof Stop ? error.code : EXIT.failed;
  }
}

process.exit(await main());
