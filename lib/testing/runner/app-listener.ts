import { spawnSync } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';
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

/** A process group, named by its leader's start so a group id the system reused never matches it. */
export type ListenerGroup = { groupId: number; leaderStart: string };

/**
 * The group id and start of a running process, or undefined once it is gone. Linux reads
 * /proc/<pid>/stat, whose start counts clock ticks since boot; macOS reads `ps`, to the second.
 */
function processIdentity(processId: number): { groupId: number; start: string } | undefined {
  if (process.platform === 'darwin') {
    const details = inspect(
      'ps',
      ['-o', 'pgid=', '-o', 'lstart=', '-p', String(processId)],
      `process ${processId}`,
    ).trim();
    const match = /^(\d+)\s+(\S.*)$/.exec(details);
    if (!match?.[1] || !match[2]) return undefined;
    return { groupId: Number(match[1]), start: match[2] };
  }
  let stat: string;
  try {
    stat = readFileSync(`/proc/${processId}/stat`, 'utf8');
  } catch {
    return undefined;
  }
  // The fields after the command name in parentheses start at field 3: pgrp is field 5, starttime 22.
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const groupId = Number(fields[2]);
  const start = fields[19];
  if (!Number.isInteger(groupId) || groupId < 1 || !start) return undefined;
  return { groupId, start };
}

/** The process group of a port's one listener, or null when nothing listens; throws when unreadable. */
export function getListenerGroup(port: number): ListenerGroup | null {
  const listener = getAppListener(port);
  if (!listener) return null;
  const groupId = processIdentity(listener.processId)?.groupId;
  if (groupId === undefined)
    throw new Error(`Listener process ${listener.processId} disappeared during inspection.`);
  if (groupId === processIdentity(process.pid)?.groupId)
    throw new Error(`Listener process ${listener.processId} shares this process's group.`);
  const leader = processIdentity(groupId);
  if (leader?.groupId !== groupId) throw new Error(`Process group ${groupId} has no running leader.`);
  return { groupId, leaderStart: leader.start };
}

/** Whether the group's leader is still the process recorded; false when its start cannot be read. */
export function isRecordedGroup(group: ListenerGroup): boolean {
  const leader = processIdentity(group.groupId);
  return leader?.groupId === group.groupId && leader.start === group.leaderStart;
}

/** Names a port's current listener with its process, group and command, for a failure message. */
export function describeListener(port: number): string {
  try {
    const listener = getAppListener(port);
    if (!listener) return `No process listens on port ${port} now.`;
    const groupId = processIdentity(listener.processId)?.groupId ?? 'unknown';
    return `Listener: pid ${listener.processId}, pgid ${groupId}, command ${listener.command}.`;
  } catch (error) {
    return `The listener could not be inspected: ${error instanceof Error ? error.message : String(error)}`;
  }
}
