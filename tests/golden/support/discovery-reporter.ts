import type { FullConfig, Reporter, Suite } from "@playwright/test/reporter";
import { testIdentity } from "./test-identity";

export default class DiscoveryReporter implements Reporter {
  onBegin(_config: FullConfig, suite: Suite): void {
    process.stdout.write(`${JSON.stringify(suite.allTests().map((test) => ({
      id: testIdentity(test), file: testIdentity(test).split(' › ')[0], title: test.title,
      annotations: test.annotations.filter((annotation) => ['requires-test', 'requires-file'].includes(annotation.type)),
    })))}\n`);
  }
}
