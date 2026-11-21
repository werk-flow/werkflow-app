import { closure, isDocsFile } from './fast-tier';

/** CI's e-invoice check, recorded as a step of the `E-invoices` job (scripts/ci/job.ts). */
export const E_INVOICE_STEP = 'step:e-invoices';

/** The check: it renders the reference invoices, then runs Mustang and veraPDF on them. */
export const E_INVOICE_CHECK = 'lib/document-rendering/fixtures/check-reference-e-invoices.ts';
const E_INVOICE_WRITER = 'lib/document-rendering/fixtures/write-reference-e-invoices.ts';

/**
 * The folders whose files the renderer and the invoice core read at run time besides their imports:
 * fonts, the colour profile, the EN 16931 rules and the reference invoices.
 */
const RUN_TIME_FOLDERS = ['lib/invoicing/', 'lib/document-rendering/'];

/** The dependencies and the module resolution every rendered byte comes through. */
const DEPENDENCY_INPUTS = ['package.json', 'bun.lock', 'bunfig.toml', 'tsconfig.json'];

/**
 * Why a CI run checks the reference e-invoices, or undefined when no change reaches them. It fails
 * open, like the fast tier: an unreadable diff, a full run (`fullReason`) or a tooling input of the
 * `invoices` job (`toolingReason`) checks them, and so does a code change beside an unresolved
 * import of the check. Otherwise a change to
 * what the check and the renderer import, to a file of the invoice core or the renderer, or to the
 * dependencies selects it. Documentation and a lint-only dependency change never do.
 */
export function eInvoiceReason(input: {
  graph: ReadonlyMap<string, readonly string[]>;
  /** The files the change touches, or undefined when the diff could not be read. */
  changedFiles: readonly string[] | undefined;
  /** The dependency files whose change moves only lint and type packages (ci-plan.ts `tooling.lintOnly`): no rendered byte. */
  lintOnly: readonly string[];
  /** Why the browser plan runs every group (ci-plan.ts), or undefined. */
  fullReason: string | undefined;
  /** Why a changed tooling input runs the `invoices` job (ci-plan.ts `tooling.invoices`), or undefined. */
  toolingReason: string | undefined;
}): string | undefined {
  if (input.changedFiles === undefined) return 'The diff against the base could not be read';
  if (input.fullReason !== undefined) return input.fullReason;
  if (input.toolingReason !== undefined) return input.toolingReason;
  const code = input.changedFiles.filter((file) => !isDocsFile(file) && !input.lintOnly.includes(file));
  const reached = closure(input.graph, [E_INVOICE_CHECK, E_INVOICE_WRITER]);
  if (reached.unresolved && code.length) return 'The e-invoice check has an unresolved import';
  const file = code.find(
    (candidate) =>
      reached.files.has(candidate) ||
      RUN_TIME_FOLDERS.some((folder) => candidate.startsWith(folder)) ||
      DEPENDENCY_INPUTS.includes(candidate),
  );
  return file && `The renderer, the invoice core or their dependencies changed (${file})`;
}
