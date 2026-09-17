import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { z } from "zod";
import { getSpawnFailureDetail } from "./spawn-result";

const listenerSchema = z.object({
  processId: z.number().int().positive(),
  commandLine: z.string().nullable(),
  creationDate: z.string().datetime({ offset: true }),
});

/** A killed read-only inspection may retry once; failed ownership proof never passes. */
export function inspectWindowsListenerCommand(
  inspect: () => SpawnSyncReturns<string>,
): SpawnSyncReturns<string> {
  const result = inspect();
  if ((result.error as NodeJS.ErrnoException | undefined)?.code !== "ETIMEDOUT") return result;
  console.warn("[werkflow-test] Windows listener inspection timed out; repeating the read once.");
  return inspect();
}

/** Windows localizes the state column. A TCP listener has a zero remote endpoint. */
export function parseWindowsListenerProcessId(output: string, port: number): number | null {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid listener port.");
  const owners = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns[0] !== "TCP" || !columns[1]?.endsWith(`:${port}`)) continue;
    if (columns[2] !== "0.0.0.0:0" && columns[2] !== "[::]:0") continue;
    if (columns.length !== 5 || !/^[1-9]\d*$/.test(columns[4]!)) throw new Error("Invalid TCP listener record.");
    const processId = Number(columns[4]);
    if (!Number.isSafeInteger(processId)) throw new Error("Invalid TCP listener process identity.");
    owners.add(processId);
  }
  if (owners.size > 1) throw new Error(`Port ${port} has multiple listening processes.`);
  return owners.values().next().value ?? null;
}

export function getWindowsListener(port: number): z.infer<typeof listenerSchema> | null {
  // Get-NetTCPConnection repeatedly exceeded 20 seconds on this host. netstat reads
  // the same port ownership without loading that PowerShell networking module.
  const sockets = inspectWindowsListenerCommand(() => spawnSync("netstat.exe", ["-ano"], { encoding: "utf8", timeout: 20_000, killSignal: "SIGKILL" }));
  if (sockets.error || sockets.status !== 0) {
    throw new Error(`Could not inspect port ${port}: ${getSpawnFailureDetail(sockets, "netstat failed")}`);
  }
  const processId = parseWindowsListenerProcessId(sockets.stdout, port);
  if (processId === null) return null;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$listenerProcess = Get-CimInstance Win32_Process -Filter 'ProcessId = ${processId}'`,
    "if (-not $listenerProcess) { throw 'Listener process disappeared during inspection' }",
    `$started = (Get-Process -Id ${processId}).StartTime.ToUniversalTime().ToString('o')`,
    `[pscustomobject]@{ processId = ${processId}; commandLine = $listenerProcess.CommandLine; creationDate = $started } | ConvertTo-Json -Compress`,
  ].join("; ");
  const details = inspectWindowsListenerCommand(() => spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", timeout: 20_000, killSignal: "SIGKILL" }));
  if (details.error || details.status !== 0) {
    throw new Error(`Could not inspect listener process ${processId}: ${getSpawnFailureDetail(details, "PowerShell failed")}`);
  }
  return listenerSchema.parse(JSON.parse(details.stdout.trim()));
}
