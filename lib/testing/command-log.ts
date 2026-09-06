/** Flush command output without replacing the command's failure with a logging error. */
export async function runWithLogCleanup<T>(input: {
  command: () => Promise<T>;
  closeLog: () => Promise<void>;
  reportSecondaryFailure: (error: unknown) => void;
}): Promise<T> {
  let commandFailed = false;
  try { return await input.command(); }
  catch (error) { commandFailed = true; throw error; }
  finally {
    try { await input.closeLog(); }
    catch (error) {
      if (!commandFailed) throw error;
      // Even unavailable diagnostic output must not replace the primary error.
      try { input.reportSecondaryFailure(error); } catch { /* Best-effort secondary report. */ }
    }
  }
}
