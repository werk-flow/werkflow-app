import {
  buildCodeRabbitReviewArguments,
  buildWindowsCodeRabbitCommand,
  CODERABBIT_WSL_BINARY,
  CODERABBIT_WSL_DISTRIBUTION,
} from "../lib/testing/coderabbit-review-command";

const rawArguments = process.argv.slice(2);
const doctorOnly = rawArguments.includes("--doctor");

function runCommand(command: readonly string[]): number {
  const result = Bun.spawnSync({
    cmd: [...command],
    cwd: process.cwd(),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return result.exitCode;
}

function fail(message: string): never {
  console.error(`[coderabbit-review] ${message}`);
  process.exit(1);
}

if (process.platform !== "win32") {
  fail(
    "This repository command currently supports the configured Windows and WSL workstation only.",
  );
}

const binaryCheckExitCode = runCommand([
  "wsl.exe",
  "--distribution",
  CODERABBIT_WSL_DISTRIBUTION,
  "--exec",
  "/usr/bin/test",
  "-x",
  CODERABBIT_WSL_BINARY,
]);
if (binaryCheckExitCode !== 0) {
  fail(
    `${CODERABBIT_WSL_BINARY} is missing or not executable. Do not install or reinstall CodeRabbit. Report this host problem to the owner.`,
  );
}

const authExitCode = runCommand([
  "wsl.exe",
  "--distribution",
  CODERABBIT_WSL_DISTRIBUTION,
  "--exec",
  CODERABBIT_WSL_BINARY,
  "auth",
  "status",
  "--agent",
]);
if (authExitCode !== 0) {
  fail(
    "CodeRabbit is installed but not authenticated. Ask the owner to restore authentication. Do not install or reinstall the CLI.",
  );
}

if (doctorOnly) {
  console.info(
    `[coderabbit-review] ready: ${CODERABBIT_WSL_BINARY} in ${CODERABBIT_WSL_DISTRIBUTION}`,
  );
  process.exit(0);
}

let reviewArguments: string[];
try {
  reviewArguments = buildCodeRabbitReviewArguments(rawArguments);
} catch (error) {
  fail(error instanceof Error ? error.message : "Invalid review arguments.");
}

const reviewExitCode = runCommand(
  buildWindowsCodeRabbitCommand({
    workingDirectory: process.cwd(),
    reviewArguments,
  }),
);
process.exit(reviewExitCode);
