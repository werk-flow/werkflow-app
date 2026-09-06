export const CODERABBIT_WSL_BINARY = "/root/.local/bin/coderabbit";
export const CODERABBIT_WSL_DISTRIBUTION = "Ubuntu";

const SCOPE_ARGUMENTS = new Set([
  "--uncommitted",
  "--committed",
  "--base",
  "--base-commit",
]);
const CONFIG_ARGUMENTS = new Set(["-c", "--config"]);

const RAW_CODERABBIT_COMMAND_PATTERN =
  /^\s*(?:\$\s*)?(?:(?:sudo|command)\s+|env(?:\s+[A-Za-z_][A-Za-z0-9_]*=\S+)*\s+|cmd(?:\.exe)?\s+\/c\s+|powershell(?:\.exe)?\s+(?:-Command|-c)\s+)*(?:(?:bunx|npx|pnpx)\s+|yarn\s+dlx\s+)?(?:(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|\/)(?:\S+[\\/])*)?(?:coderabbit|cr)(?:\.(?:exe|cmd))?(?:\s|$)/m;
const DIRECT_WSL_CODERABBIT_PATTERN =
  /^\s*(?:\$\s*)?wsl(?:\.exe)?\b.*(?:coderabbit|cr)(?:\.(?:exe|cmd))?(?:\s|$)/m;

function hasArgument(
  argumentsToCheck: readonly string[],
  acceptedArguments: ReadonlySet<string>,
): boolean {
  return argumentsToCheck.some((argument) =>
    acceptedArguments.has(argument.split("=")[0] ?? argument),
  );
}

export function findCodeRabbitInstructionViolations(
  content: string,
): string[] {
  const violations: string[] = [];
  if (content.includes("cli.coderabbit.ai/install.sh")) {
    violations.push("installer");
  }
  if (RAW_CODERABBIT_COMMAND_PATTERN.test(content)) {
    violations.push("raw-command");
  }
  if (DIRECT_WSL_CODERABBIT_PATTERN.test(content)) {
    violations.push("direct-wsl-command");
  }
  return violations;
}

export function buildCodeRabbitReviewArguments(
  rawArguments: readonly string[],
): string[] {
  // Ignore the retired wrapper flag so historical commands still work.
  const suppliedArguments = rawArguments.filter(
    (argument) => argument !== "--" && argument !== "--approve-uncommitted",
  );
  const isStoredReviewCommand =
    suppliedArguments[0] === "findings" ||
    suppliedArguments.includes("--show-prompts") ||
    suppliedArguments.includes("--help") ||
    suppliedArguments.includes("-h");

  if (isStoredReviewCommand) {
    return ["review", ...suppliedArguments];
  }

  const reviewArguments: string[] = [];
  for (let index = 0; index < suppliedArguments.length; index += 1) {
    const argument = suppliedArguments[index]!;
    const [name, ...inlineParts] = argument.split("=");
    if (name !== "--type" && name !== "-t") {
      reviewArguments.push(argument);
      continue;
    }
    const scope = inlineParts.length ? inlineParts.join("=") : suppliedArguments[++index];
    if (scope !== "uncommitted" && scope !== "committed") {
      throw new Error("Legacy --type/-t requires committed or uncommitted. Use the current --committed or --uncommitted flags to select the review scope.");
    }
    reviewArguments.push(`--${scope}`);
  }

  const argumentsWithDefaults = ["review"];
  if (!reviewArguments.includes("--agent")) {
    argumentsWithDefaults.push("--agent");
  }
  if (!hasArgument(reviewArguments, SCOPE_ARGUMENTS)) {
    argumentsWithDefaults.push("--uncommitted");
  }
  if (
    (argumentsWithDefaults.includes("--uncommitted") || reviewArguments.includes("--uncommitted")) &&
    !reviewArguments.includes("--include-untracked")
  ) {
    argumentsWithDefaults.push("--include-untracked");
  }
  if (!hasArgument(reviewArguments, CONFIG_ARGUMENTS)) {
    argumentsWithDefaults.push("-c", "AGENTS.md");
  }

  return [...argumentsWithDefaults, ...reviewArguments];
}

export function buildWindowsCodeRabbitCommand(input: {
  readonly workingDirectory: string;
  readonly reviewArguments: readonly string[];
}): string[] {
  return [
    "wsl.exe",
    "--distribution",
    CODERABBIT_WSL_DISTRIBUTION,
    "--cd",
    input.workingDirectory,
    "--exec",
    CODERABBIT_WSL_BINARY,
    ...input.reviewArguments,
  ];
}
