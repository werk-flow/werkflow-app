import { spawnSync } from 'node:child_process';
import { readlinkSync } from 'node:fs';
import { getSpawnFailureDetail } from './spawn-result';

export type AppListener = {
  processId: number;
  /** The process's command line, or its title: `next start` renames itself `next-server (vX)`. */
  command: string;
  workingDirectory: string;
  startedAt: number;
};

function inspect(command: string, args: readonly string[], what: string): string {
  // LC_ALL=C and TZ=UTC keep the start time in the one format and zone Date.parse reads.
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 20_000,
    killSignal: 'SIGKILL',
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
  });
  // lsof exits 1 when nothing matches; an empty answer is the caller's to read.
  if (result.error || (result.status !== 0 && result.status !== 1))
    throw new Error(`Could not inspect ${what}: ${getSpawnFailureDetail(result, `${command} failed`)}`);
  return result.stdout;
}

/** The values of one lsof field (`-F<field>`): each output line that starts with the field letter. */
export function lsofField(output: string, field: string): string[] {
  return output
    .split('\n')
    .filter((line) => line.startsWith(field))
    .map((line) => line.slice(1));
}

/** The process ids in `ss -ltnpH` output, one `pid=` per listening socket. */
export function ssProcessIds(output: string): string[] {
  return [...output.matchAll(/\bpid=(\d+)\b/g)].flatMap((match) => (match[1] ? [match[1]] : []));
}

/**
 * The listening processes and their working directory. Linux reads them from
 * ss and /proc: lsof in WSL lists no socket of `next-server`. macOS has no
 * /proc and reads both through lsof.
 */
function listeningProcessIds(port: number): string[] {
  if (process.platform === 'darwin')
    return lsofField(
      inspect('lsof', ['-w', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], `port ${port}`),
      'p',
    );
  return ssProcessIds(inspect('ss', ['-ltnpH', `sport = :${port}`], `port ${port}`));
}

function workingDirectoryOf(processId: string): string | undefined {
  if (process.platform === 'darwin')
    return lsofField(
      inspect('lsof', ['-w', '-a', '-p', processId, '-d', 'cwd', '-Fn'], `process ${processId}`),
      'n',
    )[0];
  try {
    return readlinkSync(`/proc/${processId}/cwd`);
  } catch {
    // The process ended during the inspection; the caller reports it as gone.
    return undefined;
  }
}

/** The one process listening on a TCP port, or null when none does. */
export function getAppListener(port: number): AppListener | null {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Invalid listener port.');
  const owners = new Set(listeningProcessIds(port));
  if (owners.size > 1) throw new Error(`Port ${port} has multiple listening processes.`);
  const [processIdText] = owners;
  if (processIdText === undefined) return null;
  if (!/^[1-9]\d*$/.test(processIdText)) throw new Error('Invalid TCP listener process identity.');
  const processId = Number(processIdText);
  const workingDirectory = workingDirectoryOf(processIdText);
  const details = inspect(
    'ps',
    ['-o', 'lstart=', '-o', 'args=', '-p', processIdText],
    `listener process ${processId}`,
  ).trim();
  // lstart is a fixed 24-character date, for example `Sun Oct 25 15:56:01 2026`.
  const startedAt = Date.parse(`${details.slice(0, 24)} UTC`);
  if (!workingDirectory || !details || !Number.isFinite(startedAt))
    throw new Error(`Listener process ${processId} disappeared during inspection.`);
  return { processId, command: details.slice(24).trim(), workingDirectory, startedAt };
}
