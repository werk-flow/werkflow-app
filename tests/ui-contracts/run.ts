import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { calculateCandidateFingerprint } from "@/lib/testing/candidate-identity";
import { withWorkspaceTestLock } from "@/lib/testing/workspace-test-lock";
import { runWithLogCleanup } from "@/lib/testing/command-log";
import { readUiContractReport } from "./report";

const repository = resolve(import.meta.dir, "../..");
await withWorkspaceTestLock(
  { operation: "UI component contracts", repositoryRoot: repository },
  async () => {
    const startedAt = new Date().toISOString();
    const runId = `${startedAt.replaceAll(":", "-").replaceAll(".", "-")}-${randomUUID().slice(0, 8)}`;
    const runDirectory = join(repository, ".agent-logs/ui-contracts", runId);
    await mkdir(runDirectory, { recursive: true });
    const candidateFingerprint = calculateCandidateFingerprint(repository);
    const manifestPath = join(runDirectory, "manifest.json");
    const logPath = join(runDirectory, "runner.log");
    const manifest = {
      version: 1,
      runId,
      startedAt,
      candidateFingerprint,
      arguments: process.argv.slice(2),
      kind: "isolated-component-contracts",
      logPath,
    };
    let bundleSha256: string | undefined;
    let childExitCode: number | null = null;
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, status: "running" }, null, 2),
    );
    const directory = await mkdtemp(join(tmpdir(), "werkflow-ui-contracts-"));
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "fixture.tsx")],
        outdir: directory,
        target: "browser",
        format: "iife",
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        plugins: [
          {
            name: "isolated-service-boundaries",
            setup(builder) {
              builder.onResolve(
                {
                  filter:
                    /^@\/lib\/(personnel\/lifecycle-actions|documents\/upload-client)$/,
                },
                () => ({
                  path: join(import.meta.dir, "personnel-boundaries.ts"),
                }),
              );
              builder.onResolve(
                {
                  filter:
                    /^(@\/lib\/work-lifecycle\/actions|@\/components\/realtime\/realtime-provider)$/,
                },
                () => ({
                  path: join(import.meta.dir, "lifecycle-boundaries.ts"),
                }),
              );
              builder.onResolve(
                {
                  filter:
                    /^(next\/navigation|@\/lib\/(subscription\/actions|settings\/email-change-actions|time-tracking\/actions|inventory\/actions|supabase\/client))$/,
                },
                () => ({
                  path: join(import.meta.dir, "service-boundaries.ts"),
                }),
              );
              builder.onResolve(
                {
                  filter:
                    /(^server-only$|supabase\/(admin|server|service-role))/,
                },
                (args) => {
                  throw new Error(
                    `Server dependency must never enter the UI fixture: ${args.path}`,
                  );
                },
              );
            },
          },
        ],
      });
      if (!build.success)
        throw new AggregateError(
          build.logs,
          "UI contract fixture compilation failed.",
        );
      const bundle = build.outputs.find((output) =>
        output.path.endsWith(".js"),
      );
      if (!bundle) throw new Error("UI contract fixture bundle is missing.");
      // Refuse an empty bundle before Playwright launches a browser.
      const bundleSource = await readFile(bundle.path, "utf8");
      if (!bundleSource.trim())
        throw new Error("UI contract fixture bundle is empty.");
      bundleSha256 = createHash("sha256").update(bundleSource).digest("hex");
      const child = Bun.spawn(
        [
          process.execPath,
          "x",
          "playwright",
          "test",
          "--config",
          join(import.meta.dir, "playwright.config.ts"),
          ...process.argv.slice(2),
        ],
        {
          cwd: repository,
          env: {
            ...process.env,
            WERKFLOW_UI_CONTRACT_BUNDLE: bundle.path,
            WERKFLOW_UI_CONTRACT_RUN_DIRECTORY: runDirectory,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const log = createWriteStream(logPath, { flags: "a" });
      let logError: Error | null = null;
      log.on("error", (error) => {
        logError ??= error;
      });
      const capture = async (
        source: ReadableStream<Uint8Array>,
        destination: NodeJS.WriteStream,
      ): Promise<void> => {
        const reader = source.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            destination.write(value);
            log.write(value);
          }
        } finally {
          reader.releaseLock();
        }
      };
      process.exitCode = await runWithLogCleanup({
        command: async () => {
          const output = Promise.allSettled([
            capture(child.stdout, process.stdout),
            capture(child.stderr, process.stderr),
          ]);
          childExitCode = await child.exited;
          for (const result of await output)
            if (result.status === "rejected") throw result.reason;
          return childExitCode;
        },
        closeLog: () =>
          new Promise<void>((resolveLog, rejectLog) => {
            log.end((error?: Error | null) => {
              const failure = logError ?? error;
              if (failure) rejectLog(failure);
              else resolveLog();
            });
          }),
        reportSecondaryFailure: (error) => {
          console.error(`UI runner log cleanup also failed: ${String(error)}`);
        },
      });
      const listing = process.argv.includes("--list");
      const { counts, reportError } = await readUiContractReport({
        path: join(runDirectory, "report.json"),
        exitCode: process.exitCode,
        listing,
      });
      const finalCandidateFingerprint =
        calculateCandidateFingerprint(repository);
      const status =
        process.exitCode !== 0
          ? "failed"
          : listing
            ? "discovery"
            : candidateFingerprint !== finalCandidateFingerprint
              ? "stale"
              : "passed";
      await writeFile(
        manifestPath,
        JSON.stringify(
          {
            ...manifest,
            status,
            bundleSha256,
            completedAt: new Date().toISOString(),
            exitCode: process.exitCode,
            finalCandidateFingerprint,
            counts,
            reportError,
            ...(process.exitCode !== 0
              ? {
                  error: `Playwright exited with code ${process.exitCode}. Original output is recorded in runner.log.`,
                }
              : {}),
          },
          null,
          2,
        ),
      );
      if (status === "stale")
        throw new Error(
          "UI contract inputs changed during the run. Results remain recorded but do not qualify the final candidate.",
        );
    } catch (error) {
      const current = z
        .object({ status: z.string() })
        .parse(JSON.parse(await readFile(manifestPath, "utf8")));
      if (current.status === "running")
        await writeFile(
          manifestPath,
          JSON.stringify(
            {
              ...manifest,
              status: "failed",
              bundleSha256,
              exitCode: childExitCode,
              completedAt: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2,
          ),
        );
      throw error;
    } finally {
      // mkdtemp owns this exact directory; no repository or user files are removed.
      await rm(directory, { recursive: true, force: true });
    }
  },
);
