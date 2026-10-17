// A mechanism tag that names a lint rule must name a rule the ESLint configuration enables for some
// file, or a selector or import-restriction set that eslint.config.mjs declares and uses. A rule
// that is declared but switched off everywhere, or a name that only appears in a comment, is no
// mechanism. check-docs resolves the configuration of every tracked lintable file through ESLint.

type RuleEntry = unknown;

function severityOf(entry: RuleEntry): unknown {
  return Array.isArray(entry) ? entry[0] : entry;
}

function isEnabled(entry: RuleEntry): boolean {
  const severity = severityOf(entry);
  return severity !== 0 && severity !== 'off' && severity !== undefined;
}

/** The rules at least one resolved file configuration enables. */
export function enabledRuleNames(
  configs: Iterable<{ rules?: Readonly<Record<string, RuleEntry>> } | undefined>,
): Set<string> {
  const enabled = new Set<string>();
  for (const config of configs) {
    for (const [name, entry] of Object.entries(config?.rules ?? {})) {
      if (isEnabled(entry)) enabled.add(name);
    }
  }
  return enabled;
}

/**
 * The module-level `const` bindings of eslint.config.mjs that its configuration uses: a name
 * declared once and referenced at least once more, such as a selector set spread into a rule.
 */
export function usedConfigBindings(configSource: string): Set<string> {
  const used = new Set<string>();
  for (const match of configSource.matchAll(
    /^(?:const ([A-Za-z_$][\w$]*) = |function ([A-Za-z_$][\w$]*)\()/gm,
  )) {
    const name = match[1] ?? match[2];
    if (name === undefined) continue;
    const references = configSource.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0;
    if (references > 1) used.add(name);
  }
  // A linter option such as reportUnusedDisableDirectives is a mechanism while it is not off.
  for (const block of configSource.matchAll(/linterOptions:\s*\{([^}]*)\}/g)) {
    for (const option of (block[1] ?? '').matchAll(/(\w+):\s*(['"]?)(\w+)\2/g)) {
      const [, name, , value] = option;
      if (name !== undefined && value !== 'off' && value !== 'false') used.add(name);
    }
  }
  return used;
}

const RECOMMENDED_SET = /^([\w@/-]+)\/recommended$/;

/**
 * Whether a lint name in a mechanism tag is in force: an enabled rule, a used configuration
 * binding, or `<plugin>/recommended` while the plugin has an enabled rule.
 */
export function lintNameInForce(
  name: string,
  enabled: ReadonlySet<string>,
  bindings: ReadonlySet<string>,
): boolean {
  if (enabled.has(name) || bindings.has(name)) return true;
  const plugin = name.match(RECOMMENDED_SET)?.[1];
  return plugin !== undefined && [...enabled].some((rule) => rule.startsWith(`${plugin}/`));
}
