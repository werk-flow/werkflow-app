import { defineConfig } from "@playwright/test";

// No app server, accounts, network, or mutable test world.
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 15_000,
  expect: { timeout: 3_000 },
  workers: 1,
  retries: 0,
  reporter: process.env.WERKFLOW_UI_CONTRACT_RUN_DIRECTORY
    ? [
        ["list"],
        [
          "json",
          {
            outputFile: `${process.env.WERKFLOW_UI_CONTRACT_RUN_DIRECTORY}/report.json`,
          },
        ],
      ]
    : "list",
  outputDir: process.env.WERKFLOW_UI_CONTRACT_RUN_DIRECTORY
    ? `${process.env.WERKFLOW_UI_CONTRACT_RUN_DIRECTORY}/results`
    : "../../.agent-logs/ui-contracts/discovery",
  use: {
    browserName: "chromium",
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    viewport: { width: 900, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
