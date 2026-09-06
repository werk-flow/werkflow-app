import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUiContractReport } from '../../tests/ui-contracts/report';

test('missing or malformed reports preserve failed child evidence but reject claimed success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'werkflow-ui-report-'));
  const path = join(directory, 'report.json');
  try {
    for (const source of [null, '{malformed']) {
      if (source !== null) await writeFile(path, source);
      const failed = await readUiContractReport({ path, exitCode: 1, listing: false });
      expect(failed.counts).toBeNull();
      expect(failed.reportError).toBeTruthy();
      await expect(readUiContractReport({ path, exitCode: 0, listing: false })).rejects.toThrow();
    }
    expect(await readUiContractReport({ path, exitCode: 1, listing: true })).toEqual({ counts: null, reportError: null });
    const stats = { expected: 3, unexpected: 1, flaky: 0, skipped: 0 };
    await writeFile(path, JSON.stringify({ stats }));
    expect(await readUiContractReport({ path, exitCode: 1, listing: false })).toEqual({ counts: stats, reportError: null });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
