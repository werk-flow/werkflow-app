import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import ts from 'typescript';

// Lint probes lint planted sources under a file path, most of them paths that
// exist only in memory. A probe is linted with the repository's effective
// configuration, without type information: only the type-aware rules below
// need it, and they carry no path exception. A typed probe linter
// (`{ typed: true }`) types each probe in a program of its own, built from
// tsconfig.json's compiler options with the probe and the ambient declarations
// as its roots, at an in-memory or an existing path, so a probe
// costs the files it reaches instead of the whole project, which the
// TypeScript project service loads for any path tsconfig.json includes
// (twenty seconds and more per test file).
const repositoryRoot = resolve(import.meta.dirname, '..');
const TYPE_AWARE_RULES = [
  '@typescript-eslint/switch-exhaustiveness-check',
  '@typescript-eslint/no-floating-promises',
];
const typedFiles = { files: ['**/*.{ts,tsx}'], ignores: ['supabase/functions/**'] };

/** A compiler that builds one program per probe and reuses every file it read before. */
function createProbePrograms() {
  const { config } = ts.readConfigFile(resolve(repositoryRoot, 'tsconfig.json'), ts.sys.readFile);
  const { options, fileNames } = ts.parseJsonConfigFileContent(config, ts.sys, repositoryRoot);
  // Ambient declarations reach a file only through tsconfig.json, never an import: keep them as roots.
  const ambientRoots = fileNames.filter((name) => name.endsWith('.d.ts'));
  const compilerOptions = { ...options, incremental: false, plugins: [] };
  const base = ts.createCompilerHost(compilerOptions, true);
  /** @type {Map<string, ts.SourceFile | undefined>} */
  const files = new Map();
  /** @type {ts.Program | undefined} */
  let previous;
  const key = (/** @type {string} */ name) => resolve(name).toLowerCase();
  /**
   * @param {string} filePath
   * @param {string} text
   */
  return (filePath, text) => {
    const probe = resolve(repositoryRoot, filePath);
    const isProbe = (/** @type {string} */ name) => key(name) === probe.toLowerCase();
    /** @type {ts.CompilerHost} */
    const host = {
      ...base,
      fileExists: (name) => isProbe(name) || base.fileExists(name),
      readFile: (name) => (isProbe(name) ? text : base.readFile(name)),
      getSourceFile: (name, languageVersion, onError) => {
        if (isProbe(name)) return ts.createSourceFile(name, text, languageVersion, true);
        if (!files.has(key(name))) files.set(key(name), base.getSourceFile(name, languageVersion, onError));
        return files.get(key(name));
      },
    };
    previous = ts.createProgram({
      rootNames: [probe, ...ambientRoots],
      options: compilerOptions,
      host,
      oldProgram: previous,
    });
    return previous;
  };
}

/**
 * ESLint with the repository's effective configuration for probes. `lintText`
 * lints without type information, so the type-aware rules are off; a typed
 * linter lints a probe at any path with them, typed in the probe's own program.
 * @param {{ typed?: boolean }} [options]
 */
export function createProbeLinter({ typed = false } = {}) {
  const untyped = new ESLint({
    overrideConfig: {
      ...typedFiles,
      languageOptions: { parserOptions: { projectService: false } },
      rules: Object.fromEntries(TYPE_AWARE_RULES.map((rule) => [rule, 'off'])),
    },
  });
  if (!typed) return untyped;
  /** @type {ts.Program[]} */
  const programs = [];
  const programFor = createProbePrograms();
  const inMemory = new ESLint({
    overrideConfig: {
      ...typedFiles,
      languageOptions: { parserOptions: { projectService: false, programs } },
    },
  });
  // One typed probe at a time: the parser reads the program from the shared array as it parses.
  /** @type {Promise<unknown>} */
  let previousProbe = Promise.resolve();
  return {
    /** @type {ESLint['lintText']} */
    lintText: (source, options) => {
      const filePath = options?.filePath;
      // Without a path there is no program to type the probe in.
      if (!filePath) return untyped.lintText(source, options);
      const probe = previousProbe.then(() => {
        programs.splice(0, programs.length, programFor(filePath, source));
        return inMemory.lintText(source, options);
      });
      previousProbe = probe.then(
        () => undefined,
        () => undefined,
      );
      return probe;
    },
    /** @type {ESLint['calculateConfigForFile']} */
    calculateConfigForFile: (filePath) => inMemory.calculateConfigForFile(filePath),
  };
}
