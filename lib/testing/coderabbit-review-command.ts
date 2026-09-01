export const CODERABBIT_WSL_BINARY = "/root/.local/bin/coderabbit";
export const CODERABBIT_WSL_DISTRIBUTION = "Ubuntu";
export const CODERABBIT_UNCOMMITTED_APPROVAL_ARGUMENT =
  "--approve-uncommitted";

const SCOPE_ARGUMENTS = new Set([
  "-t",
  "--type",
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

function getArgumentValue(
  argumentsToCheck: readonly string[],
  acceptedArguments: ReadonlySet<string>,
): string | undefined {
  for (const [index, argument] of argumentsToCheck.entries()) {
    const [argumentName, inlineValue] = argument.split("=", 2);
    if (argumentName !== undefined && acceptedArguments.has(argumentName)) {
      return inlineValue ?? argumentsToCheck[index + 1];
    }
  }
  return undefined;
}

function isUncommittedReview(reviewArguments: readonly string[]): boolean {
  if (hasArgument(reviewArguments, new Set(["--base", "--base-commit"]))) {
    return false;
  }
  return getArgumentValue(reviewArguments, new Set(["-t", "--type"])) !==
    "committed";
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
  const wrapperArguments = rawArguments.filter((argument) => argument !== "--");
  const uncommittedReviewApproved = wrapperArguments.includes(
    CODERABBIT_UNCOMMITTED_APPROVAL_ARGUMENT,
  );
  const reviewArguments = wrapperArguments.filter(
    (argument) => argument !== CODERABBIT_UNCOMMITTED_APPROVAL_ARGUMENT,
  );
  const isStoredReviewCommand =
    reviewArguments[0] === "findings" ||
    reviewArguments.includes("--show-prompts");

  if (isStoredReviewCommand) {
    return ["review", ...reviewArguments];
  }

  if (isUncommittedReview(reviewArguments) && !uncommittedReviewApproved) {
    throw new Error(
      `Uncommitted reviews require ${CODERABBIT_UNCOMMITTED_APPROVAL_ARGUMENT} to confirm that sending the local diff was approved.`,
    );
  }

  const argumentsWithDefaults = ["review"];
  if (!reviewArguments.includes("--agent")) {
    argumentsWithDefaults.push("--agent");
  }
  if (!hasArgument(reviewArguments, SCOPE_ARGUMENTS)) {
    argumentsWithDefaults.push("--type", "uncommitted");
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
