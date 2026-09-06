import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createConnection } from "node:net";
import { calculateBuildInputs, type BuildReceipt } from "../lib/testing/build-identity";
import { withWorkspaceTestLock } from "../lib/testing/workspace-test-lock";

const repositoryRoot = realpathSync(resolve(import.meta.dir, ".."));
await withWorkspaceTestLock({ operation: "production build", repositoryRoot }, async () => {
  // A next start process keeps reading .next after startup. Refuse to replace
  // its chunks even when no browser battery currently owns the workspace lock.
  for (const host of ["127.0.0.1", "::1"]) {
    await new Promise<void>((resolveProbe, reject) => {
      const socket = createConnection({ host, port: 3000 });
      socket.setTimeout(2_000);
      socket.once("connect", () => {
        socket.destroy();
        reject(new Error("Port 3000 is serving an application. Stop the workspace server before rebuilding .next."));
      });
      socket.once("error", (error: NodeJS.ErrnoException) => {
        socket.destroy();
        if (error.code === "ECONNREFUSED" || error.code === "EAFNOSUPPORT") resolveProbe();
        else reject(new Error(`Cannot verify that port 3000 is free: ${error.code}`));
      });
      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error("Port 3000 ownership check timed out. Inspect the server before building."));
      });
    });
  }
  const receiptPath = resolve(repositoryRoot, ".next/werkflow-build-receipt.json");
  if (existsSync(receiptPath)) rmSync(receiptPath);
  const inputs = calculateBuildInputs(repositoryRoot);
  const buildId = randomUUID();
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    const child = spawn("node", [resolve(repositoryRoot, "node_modules/next/dist/bin/next"), "build", ...process.argv.slice(2)], {
      cwd: repositoryRoot,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production", WERKFLOW_BUILD_ID: buildId },
    });
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) { process.exitCode = exitCode; return; }
  const after = calculateBuildInputs(repositoryRoot);
  if (JSON.stringify(after) !== JSON.stringify(inputs)) throw new Error("Build inputs changed during compilation. Freeze application and environment edits, then rebuild.");
  if (readFileSync(resolve(repositoryRoot, ".next/BUILD_ID"), "utf8").trim() !== buildId) throw new Error("Next did not persist the requested build identity.");
  const receipt: BuildReceipt = { version: 1, ...inputs, repositoryRoot, buildId, completedAt: new Date().toISOString() };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`[werkflow-build] Recorded ${buildId} for this workspace and environment.`);
});
