import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const countsSchema = z.object({ expected: z.number(), unexpected: z.number(), flaky: z.number(), skipped: z.number() });
type ReportCounts = z.infer<typeof countsSchema>;

export async function readUiContractReport(input: { path: string; exitCode: number; listing: boolean }): Promise<{ counts: ReportCounts | null; reportError: string | null }> {
  if (input.listing) return { counts: null, reportError: null };
  try {
    const report = z.object({ stats: countsSchema }).parse(JSON.parse(await readFile(input.path, 'utf8')));
    return { counts: report.stats, reportError: null };
  } catch (error) {
    if (input.exitCode === 0) throw error;
    return { counts: null, reportError: error instanceof Error ? error.message : String(error) };
  }
}
