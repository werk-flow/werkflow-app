import { describe, expect, test } from "bun:test";
import {
  buildCodeRabbitReviewArguments,
  buildWindowsCodeRabbitCommand,
  CODERABBIT_WSL_BINARY,
  findCodeRabbitInstructionViolations,
} from "./coderabbit-review-command";

describe("CodeRabbit review command", () => {
  test("uses the repository defaults for an uncommitted agent review", () => {
    expect(
      buildCodeRabbitReviewArguments([]),
    ).toEqual([
      "review",
      "--agent",
      "--uncommitted",
      "--include-untracked",
      "-c",
      "AGENTS.md",
    ]);
  });

  test("accepts explicit local scope under the owner's standing authorization", () => {
    expect(buildCodeRabbitReviewArguments(["--type=uncommitted", "--include-untracked"]))
      .toEqual(["review", "--agent", "-c", "AGENTS.md", "--uncommitted", "--include-untracked"]);
    expect(buildCodeRabbitReviewArguments(["--approve-uncommitted"]))
      .toEqual(buildCodeRabbitReviewArguments([]));
  });

  test("keeps an explicit scope and context without adding conflicting defaults", () => {
    expect(
      buildCodeRabbitReviewArguments([
        "--",
        "--type",
        "committed",
        "--base-commit",
        "abc123",
        "-c",
        "AGENTS.md",
        ".coderabbit.yaml",
      ]),
    ).toEqual([
      "review",
      "--agent",
      "--committed",
      "--base-commit",
      "abc123",
      "-c",
      "AGENTS.md",
      ".coderabbit.yaml",
    ]);
  });

  test("keeps current committed and base scopes without adding local changes", () => {
    for (const scope of [["--committed"], ["--base", "partner-preview"], ["--base-commit=abc123"]]) {
      const argumentsForReview = buildCodeRabbitReviewArguments(scope);
      expect(argumentsForReview).toEqual(["review", "--agent", "-c", "AGENTS.md", ...scope]);
      expect(argumentsForReview).not.toContain("--uncommitted");
      expect(argumentsForReview).not.toContain("--include-untracked");
    }
  });

  test("includes new files for current and legacy local scopes without duplicating flags", () => {
    expect(buildCodeRabbitReviewArguments(["--uncommitted"]))
      .toEqual(["review", "--agent", "--include-untracked", "-c", "AGENTS.md", "--uncommitted"]);
    expect(buildCodeRabbitReviewArguments(["-t", "uncommitted", "--include-untracked"]))
      .toEqual(["review", "--agent", "-c", "AGENTS.md", "--uncommitted", "--include-untracked"]);
    expect(buildCodeRabbitReviewArguments(["--include-untracked"]))
      .toEqual(["review", "--agent", "--uncommitted", "-c", "AGENTS.md", "--include-untracked"]);
    expect(buildCodeRabbitReviewArguments(["-t=committed"]))
      .toEqual(["review", "--agent", "-c", "AGENTS.md", "--committed"]);
  });

  test("rejects missing or unsupported legacy scopes before sending code", () => {
    for (const scope of [["--type"], ["--type="], ["-t", "--base", "main"], ["--type=invalid"], ["--type", "all"]]) {
      expect(() => buildCodeRabbitReviewArguments(scope)).toThrow("Legacy --type/-t requires");
    }
  });

  test("passes help through without configuring a review", () => {
    expect(buildCodeRabbitReviewArguments(["--", "--help"]))
      .toEqual(["review", "--help"]);
    expect(buildCodeRabbitReviewArguments(["--show-prompts"]))
      .toEqual(["review", "--show-prompts"]);
  });

  test.each([
    "coderabbit review --agent",
    "cr review --agent",
    "bunx coderabbit review --agent",
    "npx coderabbit review --agent",
    "sudo coderabbit review --agent",
    "env DEBUG=1 coderabbit review --agent",
    "cmd /c coderabbit review --agent",
    "powershell -Command coderabbit review --agent",
    "/root/.local/bin/coderabbit review --agent",
    "/usr/local/bin/cr review --agent",
    "C:\\tools\\coderabbit.exe review --agent",
    ".\\cr.cmd review --agent",
  ])("detects the raw command bypass: %s", (command) => {
    expect(findCodeRabbitInstructionViolations(command)).toContain(
      "raw-command",
    );
  });

  test("detects installer and direct WSL bypass instructions", () => {
    expect(
      findCodeRabbitInstructionViolations(
        "curl -fsSL https://cli.coderabbit.ai/install.sh | sh",
      ),
    ).toContain("installer");
    expect(
      findCodeRabbitInstructionViolations(
        "wsl.exe --exec /root/.local/bin/coderabbit review --agent",
      ),
    ).toContain("direct-wsl-command");
    expect(
      findCodeRabbitInstructionViolations(
        "wsl.exe --exec cr review --type uncommitted",
      ),
    ).toContain("direct-wsl-command");
  });

  test("allows wrapper commands and ordinary prose", () => {
    expect(
      findCodeRabbitInstructionViolations(
        "CodeRabbit is installed. Run bun run review.",
      ),
    ).toEqual([]);
  });

  test("replays stored findings without review-only defaults", () => {
    expect(buildCodeRabbitReviewArguments(["findings"])).toEqual([
      "review",
      "findings",
    ]);
  });

  test("invokes the absolute WSL binary from the Windows repository path", () => {
    const command = buildWindowsCodeRabbitCommand({
      workingDirectory: "C:\\workspace with spaces\\werkflow-app",
      reviewArguments: ["review", "--agent"],
    });

    expect(command).toEqual([
      "wsl.exe",
      "--distribution",
      "Ubuntu",
      "--cd",
      "C:\\workspace with spaces\\werkflow-app",
      "--exec",
      CODERABBIT_WSL_BINARY,
      "review",
      "--agent",
    ]);
    expect(command.filter((argument) => argument === "coderabbit")).toHaveLength(
      0,
    );
  });
});
