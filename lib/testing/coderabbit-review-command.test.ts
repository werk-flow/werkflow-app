import { describe, expect, test } from "bun:test";
import {
  buildCodeRabbitReviewArguments,
  buildWindowsCodeRabbitCommand,
  CODERABBIT_UNCOMMITTED_APPROVAL_ARGUMENT,
  CODERABBIT_WSL_BINARY,
  findCodeRabbitInstructionViolations,
} from "./coderabbit-review-command";

describe("CodeRabbit review command", () => {
  test("uses the repository defaults for an uncommitted agent review", () => {
    expect(
      buildCodeRabbitReviewArguments([
        CODERABBIT_UNCOMMITTED_APPROVAL_ARGUMENT,
      ]),
    ).toEqual([
      "review",
      "--agent",
      "--type",
      "uncommitted",
      "-c",
      "AGENTS.md",
    ]);
  });

  test("refuses to send an uncommitted diff without explicit approval", () => {
    expect(() => buildCodeRabbitReviewArguments([])).toThrow(
      CODERABBIT_UNCOMMITTED_APPROVAL_ARGUMENT,
    );
    expect(() =>
      buildCodeRabbitReviewArguments(["--type=uncommitted"]),
    ).toThrow(CODERABBIT_UNCOMMITTED_APPROVAL_ARGUMENT);
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
      "--type",
      "committed",
      "--base-commit",
      "abc123",
      "-c",
      "AGENTS.md",
      ".coderabbit.yaml",
    ]);
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
        "CodeRabbit is installed. Run bun run review -- --approve-uncommitted.",
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
