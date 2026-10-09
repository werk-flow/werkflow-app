import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, parseProductSource, repositoryRoot } from './product-sources';

// Tier 2 for entity pickers (AGENTS.md "2. Performance and immediate
// feedback"; docs/technical/realtime-and-caching.md "Complete lists"). A
// picker of customers, jobs, projects, equipment, service cases, inventory
// items or coverages searches the whole permitted scope on the server, one
// page at a time, so no page or dialog hands it an organization-sized array.
// The unbounded kinds are named once below; a registry picker whose options,
// labels or placeholders name one of them passes `onSearchChange`, directly or
// by spreading an option hook's result, unless it is a reviewed bounded list.
// Every other picker offers a list bounded by nature (people of one company,
// a customer's sites, a small catalog, a fixed set). A call site that shows a
// load failure passes the retry with it.

const PICKERS = new Set(['SearchableSelect', 'SearchableMultiSelect', 'SelectWithCreate', 'JobMultiSelect']);

/** Option hooks whose results carry `onSearchChange`, `loadError` and `onRetryLoad`. */
const SEARCH_HOOKS = new Set(['useJobEntityOptions', 'usePlanningOptions']);

/** The organization-sized kinds, as code and German copy name them. */
const UNBOUNDED_KINDS: Readonly<Record<string, RegExp>> = {
  customers: /kunde|client|customer/i,
  jobs: /auftr[aä]g|jobs?/i,
  projects: /projekt|project/i,
  equipment: /anlage|equipment/i,
  serviceCases: /servicef[aä]ll|service.?case/i,
  inventoryItems: /artikel|inventory.?item/i,
  coverages: /abdeckung|coverage/i,
};

/**
 * Picker call sites whose options are bounded by nature, keyed
 * `file::<id, aria-label or options expression>`. An entry that matches no
 * call site fails as stale.
 */
const ONE_CUSTOMER = 'the sites or contacts of the one customer the form chose, read for that customer';
const BOUNDED_PICKER_SITES: Readonly<Record<string, string>> = {
  'components/kunden/communication-preference-dialog.tsx::Ansprechpartner suchen…': ONE_CUSTOMER,
  'components/service/maintenance-coverage-dialog.tsx::Einsatzort suchen…': ONE_CUSTOMER,
  'components/service/service-case-form-sections.tsx::Einsatzort suchen…': ONE_CUSTOMER,
  'components/service/service-case-form-sections.tsx::Ansprechpartner suchen…': ONE_CUSTOMER,
  'components/service/equipment-form-dialog.tsx::Anlage suchen…':
    'the parent units at the one site of the edited equipment',
  'components/service/service-case-list-content.tsx::Servicefälle nach Status filtern':
    'the fixed case statuses, not cases',
};

type PickerSite = {
  key: string;
  line: number;
  /** The kinds its options, labels and placeholders name. */
  kinds: string[];
  searches: boolean;
  loadError: boolean;
  retries: boolean;
};

function attributeText(attribute: ts.JsxAttribute, source: ts.SourceFile): string | undefined {
  const initializer = attribute.initializer;
  if (!initializer) return undefined;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer) && initializer.expression)
    return initializer.expression.getText(source);
  return undefined;
}

/** Types of an option hook's result, as a prop or parameter declares them. */
const SEARCH_STATE_TYPE =
  /JobEntityOptionsState|PlanningOptionsSelect|typeof (useJobEntityOptions|usePlanningOptions)\b/;

/**
 * Local names bound to an option hook's result: `const search = useJobEntityOptions(...)`,
 * its destructured fields, or a prop or parameter typed as such a result.
 */
function hookBindings(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  ts.forEachChild(source, function visit(node) {
    if (
      (ts.isPropertySignature(node) || ts.isParameter(node)) &&
      ts.isIdentifier(node.name) &&
      node.type &&
      SEARCH_STATE_TYPE.test(node.type.getText(source))
    )
      names.add(node.name.text);
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      SEARCH_HOOKS.has(node.initializer.expression.text)
    ) {
      if (ts.isIdentifier(node.name)) names.add(node.name.text);
      if (ts.isObjectBindingPattern(node.name))
        for (const element of node.name.elements) {
          if (element.dotDotDotToken && ts.isIdentifier(element.name)) names.add(element.name.text);
          if (!element.dotDotDotToken && (element.propertyName ?? element.name).getText(source) === 'select')
            names.add(element.name.getText(source));
        }
    }
    ts.forEachChild(node, visit);
  });
  return names;
}

export function pickerSites(file: string, text: string): PickerSite[] {
  const source = parseProductSource(file, text);
  const bindings = hookBindings(source);
  const sites: PickerSite[] = [];
  ts.forEachChild(source, function visit(node) {
    ts.forEachChild(node, visit);
    if (!ts.isJsxSelfClosingElement(node) && !ts.isJsxOpeningElement(node)) return;
    const name = node.tagName.getText(source);
    if (!PICKERS.has(name)) return;
    const attributes = new Map<string, string | undefined>();
    let spreadsSearch = false;
    for (const property of node.attributes.properties) {
      if (ts.isJsxAttribute(property))
        attributes.set(property.name.getText(source), attributeText(property, source));
      else if (ts.isJsxSpreadAttribute(property)) {
        const spread = property.expression.getText(source);
        if (bindings.has(spread.split('.')[0] ?? '')) spreadsSearch = true;
      }
    }
    const label =
      attributes.get('id') ??
      attributes.get('ariaLabel') ??
      attributes.get('searchPlaceholder') ??
      attributes.get('placeholder') ??
      name;
    const texts = ['id', 'ariaLabel', 'placeholder', 'searchPlaceholder', 'emptyMessage', 'options', 'items']
      .map((attribute) => attributes.get(attribute) ?? '')
      .join(' ');
    sites.push({
      key: `${file}::${label}`,
      kinds: Object.entries(UNBOUNDED_KINDS).flatMap(([kind, pattern]) =>
        pattern.test(texts) ? [kind] : [],
      ),
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      searches:
        spreadsSearch ||
        attributes.has('onSearchChange') ||
        (name === 'JobMultiSelect' && attributes.has('search')),
      loadError: attributes.has('loadError'),
      retries: spreadsSearch || attributes.has('onRetryLoad'),
    });
  });
  return sites;
}

const productSites = (): PickerSite[] =>
  listProductSources(['app', 'components']).flatMap((file) => {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    return [...PICKERS].some((picker) => text.includes(`<${picker}`)) ? pickerSites(file, text) : [];
  });

test('every picker of an unbounded kind searches on the server', () => {
  const sites = productSites().filter((site) => site.kinds.length > 0);
  const keys = new Set(sites.map((site) => site.key));
  expect(
    sites
      .filter((site) => !site.searches && !(site.key in BOUNDED_PICKER_SITES))
      .map(
        (site) =>
          `${site.key.split('::')[0]}:${site.line} ${site.key.split('::')[1]} (${site.kinds.join(', ')})`,
      ),
    'Pass the option hook to the picker (useJobEntityOptions or usePlanningOptions: onSearchChange, loading, loadError, onRetryLoad, onLoadMore). A list bounded by nature goes into BOUNDED_PICKER_SITES with its bound.',
  ).toEqual([]);
  expect(
    Object.keys(BOUNDED_PICKER_SITES).filter((key) => !keys.has(key)),
    'These BOUNDED_PICKER_SITES entries match no picker; remove them.',
  ).toEqual([]);
});

test('a picker that shows a load failure offers the retry', () => {
  expect(
    productSites()
      .filter((site) => site.loadError && !site.retries)
      .map((site) => `${site.key.split('::')[0]}:${site.line}`),
    'Pass onRetryLoad beside loadError, so the failure shows „Erneut laden“.',
  ).toEqual([]);
});

test('the scan reports a picker handed a whole catalog and accepts the searched forms', () => {
  // The Arbeitsvorlagen material picker before the pickers package.
  const planted = pickerSites(
    'components/planted.tsx',
    `function Line() { return <SelectWithCreate id="material-item" items={inventoryItems} searchPlaceholder="Artikel suchen…" getOption={(item) => item} />; }`,
  );
  expect(planted.map((site) => [site.key, site.kinds, site.searches])).toEqual([
    ['components/planted.tsx::material-item', ['inventoryItems'], false],
  ]);
  const searched = pickerSites(
    'components/planted.tsx',
    `function Line() { const search = useJobEntityOptions({ kind: 'inventory-items' }, []); return <><SearchableSelect {...search} value="" onChange={() => {}} /><SearchableSelect options={search.options} onSearchChange={search.onSearchChange} loadError={search.loadError} /></>; }`,
  );
  expect(searched.map((site) => [site.searches, site.loadError && !site.retries])).toEqual([
    [true, false],
    [true, true],
  ]);
});

test('a picker of people or a fixed set is not taken for an unbounded kind', () => {
  const sites = pickerSites(
    'components/planted.tsx',
    `function F() { return <><SearchableSelect options={memberOptions} searchPlaceholder="Mitarbeiter suchen…" /><SearchableSelect options={REASONS} searchPlaceholder="Grund suchen" /></>; }`,
  );
  expect(sites.map((site) => site.kinds)).toEqual([[], []]);
});
