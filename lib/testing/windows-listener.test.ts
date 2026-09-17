import { expect, test } from "bun:test";
import type { SpawnSyncReturns } from "node:child_process";
import { inspectWindowsListenerCommand, parseWindowsListenerProcessId } from "./windows-listener";

function inspectionResult(code?: string): SpawnSyncReturns<string> {
  return { pid: 123, output: [], stdout: "TCP [::]:3000 [::]:0 LISTENING 12", stderr: "", status: code ? null : 0,
    signal: code ? "SIGKILL" : null, ...(code ? { error: Object.assign(new Error(code), { code }) } : {}) };
}

test("a timed-out read retries once and requires fresh successful socket evidence", () => {
  const results = [inspectionResult("ETIMEDOUT"), inspectionResult()];
  let calls = 0;
  const result = inspectWindowsListenerCommand(() => results[calls++]!);
  expect(calls).toBe(2);
  expect(result.error).toBeUndefined();
  expect(parseWindowsListenerProcessId(result.stdout, 3000)).toBe(12);
});

test("a second timeout remains failed and a non-timeout error does not retry", () => {
  for (const code of ["ETIMEDOUT", "ENOENT", "EACCES"]) {
    let calls = 0;
    const failure = inspectionResult(code);
    expect(inspectWindowsListenerCommand(() => { calls += 1; return failure; })).toBe(failure);
    expect(calls).toBe(code === "ETIMEDOUT" ? 2 : 1);
  }
  let calls = 0;
  const commandFailure = { ...inspectionResult(), status: 1 };
  expect(inspectWindowsListenerCommand(() => { calls += 1; return commandFailure; })).toBe(commandFailure);
  expect(calls).toBe(1);
});

test("finds the exact TCP listening port across Windows locales and address families", () => {
  expect(parseWindowsListenerProcessId(`
  TCP  0.0.0.0:3000  0.0.0.0:0  ABHÖREN  29144
  TCP  [::]:3000  [::]:0  LISTENING  29144
  TCP  127.0.0.1:3000  127.0.0.1:52345  HERGESTELLT  29144
  TCP  0.0.0.0:13000  0.0.0.0:0  LISTENING  123
  UDP  0.0.0.0:3000  *:*  456
`, 3000)).toBe(29144);
  expect(parseWindowsListenerProcessId("TCP [::1]:3000 [::]:0 LISTENING 12", 3000)).toBe(12);
});

test("an empty port or established connection does not authorize a listener", () => {
  expect(parseWindowsListenerProcessId("Active Connections\nProto Local Address Foreign Address State PID", 3000)).toBeNull();
  expect(parseWindowsListenerProcessId("TCP 127.0.0.1:3000 127.0.0.1:54321 ESTABLISHED 12", 3000)).toBeNull();
});

test("refuses conflicting ownership and malformed identities instead of choosing a process", () => {
  expect(() => parseWindowsListenerProcessId("TCP 0.0.0.0:3000 0.0.0.0:0 LISTENING 12\nTCP [::]:3000 [::]:0 LISTENING 13", 3000)).toThrow("multiple listening processes");
  for (const identity of ["0", "-1", "12;exit", "NaN", "9007199254740992", "12 extra"]) {
    expect(() => parseWindowsListenerProcessId(`TCP 0.0.0.0:3000 0.0.0.0:0 LISTENING ${identity}`, 3000)).toThrow();
  }
  expect(() => parseWindowsListenerProcessId("", 0)).toThrow("Invalid listener port");
});
