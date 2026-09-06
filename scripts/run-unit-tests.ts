import { withWorkspaceTestLock } from "../lib/testing/workspace-test-lock";

await withWorkspaceTestLock({ operation: "unit suite" }, async () => {
  const child = Bun.spawn([process.execPath, "test", "lib", ...process.argv.slice(2)], { stdout: "inherit", stderr: "inherit" });
  process.exitCode = await child.exited;
});
