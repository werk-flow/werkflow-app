/** Await every declared assertion file; stop at the first unsuccessful session. */
export async function executeSqlAssertionFiles(
  files: readonly string[],
  execute: (file: string) => Promise<void>,
): Promise<void> {
  for (const file of files) await execute(file);
}
