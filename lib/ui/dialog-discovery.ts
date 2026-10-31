import { readFileSync, readdirSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import ts from 'typescript';

// Dialog discovery for the rule tests: every DialogContent, AlertDialogContent
// and SheetContent that a component in app/ or components/ renders, keyed by
// its owner component and the source text of its title. The form contract
// (lib/ui/dialog-contracts.test.ts) and the dialog inventory of the rendered
// audit (lib/testing/selection/dialog-inventory.test.ts) read the same keys.

const LAYER_ROOTS: Readonly<Record<string, DialogKind>> = {
  DialogContent: 'dialog',
  AlertDialogContent: 'alert-dialog',
  SheetContent: 'sheet',
};

const LAYER_TITLES: Readonly<Record<DialogKind, string>> = {
  dialog: 'DialogTitle',
  'alert-dialog': 'AlertDialogTitle',
  sheet: 'SheetTitle',
};

type Component = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;
type FormBoundary = { id: string; conditions: string[] };
/** The registry root that renders a layer: a dialog, a destructive confirmation or a sheet. */
type DialogKind = 'dialog' | 'alert-dialog' | 'sheet';

export type DialogContract = {
  /** `file#Owner|title`: the owner component and the source text of its title. */
  key: string;
  kind: DialogKind;
  owner: string;
  forms: number;
  bodies: number;
  uncoveredControls: string[];
  contentScrolls: boolean;
  formBoundaries: FormBoundary[];
  associatedSubmits: FormBoundary[];
};

const portalBoundaries = new Set([
  'Dialog',
  'DialogContent',
  'DialogPortal',
  'AlertDialog',
  'AlertDialogContent',
  'Sheet',
  'SheetContent',
  'Portal',
  'PopoverContent',
  'SelectContent',
  'DropdownMenuContent',
  'TooltipContent',
]);
const editableControls = new Set([
  'input',
  'textarea',
  'select',
  'Input',
  'Textarea',
  'Select',
  'SearchableSelect',
  'SearchableMultiSelect',
  'Checkbox',
  'DatePicker',
  'DateTimeField',
  'TimeInput',
  'QuantityStepper',
  'DurationHoursInput',
  'SignaturePad',
]);

function isComponent(node: ts.Node): node is Component {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
}

function ownerName(node: ts.Node): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!isComponent(parent)) continue;
    if ('name' in parent && parent.name) return parent.name.getText();
    if (ts.isVariableDeclaration(parent.parent)) return parent.parent.name.getText();
  }
  return '<anonymous>';
}

function attributeValue(opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string): string {
  const attribute = opening.attributes.properties.find(
    (part): part is ts.JsxAttribute => ts.isJsxAttribute(part) && part.name.getText() === name,
  );
  if (!attribute?.initializer) return '';
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  return ts.isJsxExpression(attribute.initializer) ? (attribute.initializer.expression?.getText() ?? '') : '';
}

function renderConditions(node: ts.Node): string[] {
  const conditions: string[] = [];
  function complement(condition: ts.Expression): string {
    if (ts.isBinaryExpression(condition)) {
      if (condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
        return `${condition.left.getText()} !== ${condition.right.getText()}`;
      }
      if (condition.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
        return `${condition.left.getText()} === ${condition.right.getText()}`;
      }
    }
    if (ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken) {
      return condition.operand.getText();
    }
    return `!(${condition.getText()})`;
  }
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isConditionalExpression(parent)) {
      if (parent.whenTrue === child) conditions.push(parent.condition.getText());
      if (parent.whenFalse === child) conditions.push(complement(parent.condition));
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.right === child &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      conditions.push(parent.left.getText());
    }
    if (isComponent(parent)) break;
  }
  return conditions.map((condition) => condition.replace(/\s/g, ''));
}

function localInitializer(identifier: ts.Identifier): ts.Expression | undefined {
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const declaration = statement.declarationList.declarations.find(
        (entry) => ts.isIdentifier(entry.name) && entry.name.text === identifier.text,
      );
      if (declaration) return declaration.initializer;
    }
  }
  return undefined;
}

/** Whether a className attribute, or a local constant it reads, makes the whole content scroll. */
function classScrolls(classAttribute: ts.Node, source: ts.SourceFile): boolean {
  const inspected = new Set<ts.Node>();
  let scrolls = false;
  function inspectClass(part: ts.Node): void {
    if (inspected.has(part)) return;
    inspected.add(part);
    if (
      (ts.isStringLiteralLike(part) ||
        ts.isTemplateHead(part) ||
        ts.isTemplateMiddle(part) ||
        ts.isTemplateTail(part)) &&
      /(?:^|[\s:])!?overflow(?:-[xy])?-(?:auto|scroll)(?:\s|$)/.test(part.text)
    ) {
      scrolls = true;
    }
    if (ts.isIdentifier(part)) {
      function findInitializer(candidate: ts.Node): void {
        if (
          ts.isVariableDeclaration(candidate) &&
          candidate.name.getText() === part.getText() &&
          candidate.initializer
        ) {
          inspectClass(candidate.initializer);
        }
        ts.forEachChild(candidate, findInitializer);
      }
      findInitializer(source);
    }
    ts.forEachChild(part, inspectClass);
  }
  inspectClass(classAttribute);
  return scrolls;
}

/** The parsed product sources, keyed by their repository path. */
type ParsedSources = ReadonlyMap<string, ts.SourceFile>;

/** The file and export an imported name of a source refers to; undefined for a local name. */
function resolveImportBinding(
  sources: ParsedSources,
  source: ts.SourceFile,
  name: string,
): { file: string; name: string } | undefined {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    let exported: string | undefined;
    if (bindings && ts.isNamedImports(bindings)) {
      const match = bindings.elements.find((element) => element.name.text === name);
      if (match) exported = match.propertyName?.text ?? match.name.text;
    }
    if (bindings && ts.isNamespaceImport(bindings) && name.startsWith(`${bindings.name.text}.`)) {
      exported = name.slice(bindings.name.text.length + 1);
    }
    if (statement.importClause?.name?.text === name) exported = 'default';
    if (!exported) continue;
    const specifier = statement.moduleSpecifier.text;
    const base = specifier.startsWith('@/')
      ? specifier.slice(2)
      : posix.normalize(posix.join(dirname(source.fileName), specifier));
    const file = [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`].find((candidate) =>
      sources.has(candidate),
    );
    return { file: file ?? base, name: exported };
  }
  return undefined;
}

/** The tag of a JSX element under its exported name when it is imported. */
function layerTagName(sources: ParsedSources, node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string {
  const raw = node.tagName.getText();
  return resolveImportBinding(sources, node.getSourceFile(), raw)?.name ?? raw;
}

/** The function that implements a rendered component, followed across imports; undefined for a UI primitive. */
function findComponentImplementation(
  sources: ParsedSources,
  source: ts.SourceFile,
  name: string,
): Component | undefined {
  const binding = resolveImportBinding(sources, source, name);
  if (binding) {
    // UI primitives own their implementation; their children retain the caller's form context.
    if (binding.file.startsWith('components/ui/')) return undefined;
    const target = sources.get(binding.file);
    return target ? findComponentImplementation(sources, target, binding.name) : undefined;
  }
  let found: Component | undefined;
  function visit(node: ts.Node): void {
    if (
      ts.isFunctionDeclaration(node) &&
      (node.name?.text === name ||
        (name === 'default' &&
          node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)))
    ) {
      found = node;
      return;
    }
    if (ts.isVariableDeclaration(node) && node.name.getText() === name && node.initializer) {
      if (isComponent(node.initializer)) found = node.initializer;
      else if (ts.isCallExpression(node.initializer)) {
        found = node.initializer.arguments.find(
          (argument): argument is ts.ArrowFunction | ts.FunctionExpression =>
            ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
        );
      }
    }
    if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

/** The source text of a layer's title element, outside nested portals. */
function readLayerTitle(sources: ParsedSources, layer: ts.JsxElement, titleTag: string): string {
  let title = '';
  function findTitle(child: ts.Node): void {
    if (ts.isJsxElement(child)) {
      const tag = layerTagName(sources, child.openingElement);
      if (child !== layer && portalBoundaries.has(tag)) return;
      if (tag === titleTag) {
        title = child.children
          .filter((part) => ts.isJsxText(part) || ts.isJsxExpression(part))
          .map((part) => part.getText())
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }
    ts.forEachChild(child, findTitle);
  }
  findTitle(layer);
  return title;
}

/** One layer's walk: the parsed sources, the layer root and the contract it fills. */
type LayerWalk = { sources: ParsedSources; layer: ts.JsxElement; contract: DialogContract };

/**
 * Records a rendered element on the contract: a submitting form, a submit
 * associated by `form`, a dialog body, a control outside any form. Returns
 * whether the element's content is inside a submitting form.
 */
function recordLayerElement(
  contract: DialogContract,
  element: ts.JsxElement | ts.JsxSelfClosingElement,
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  tag: string,
  inForm: boolean,
): boolean {
  if (tag === 'form') {
    const submits = opening.attributes.properties.some(
      (attribute) =>
        ts.isJsxAttribute(attribute) && ['onSubmit', 'action'].includes(attribute.name.getText()),
    );
    if (submits) {
      contract.forms += 1;
      contract.formBoundaries.push({
        id: attributeValue(opening, 'id'),
        conditions: renderConditions(element),
      });
    }
    inForm = submits;
  }
  if (
    ['Button', 'button', 'input'].includes(tag) &&
    attributeValue(opening, 'type') === 'submit' &&
    attributeValue(opening, 'form')
  ) {
    contract.associatedSubmits.push({
      id: attributeValue(opening, 'form'),
      conditions: renderConditions(element),
    });
  }
  if (tag === 'DialogBody') contract.bodies += 1;
  if (editableControls.has(tag) && !inForm) contract.uncoveredControls.push(tag);
  return inForm;
}

/** Walks what a rendered component returns, with the children its caller passed. */
function walkRenderedComponent(
  walk: LayerWalk,
  implementation: Component,
  inForm: boolean,
  active: ReadonlySet<ts.Node>,
  passedChildren: readonly ts.JsxChild[],
): void {
  function render(part: ts.Node): void {
    if (part !== implementation && isComponent(part)) return;
    if (ts.isReturnStatement(part) && part.expression) {
      walkLayer(walk, part.expression, inForm, active, passedChildren);
      return;
    }
    ts.forEachChild(part, render);
  }
  if (ts.isArrowFunction(implementation) && !ts.isBlock(implementation.body)) {
    walkLayer(walk, implementation.body, inForm, active, passedChildren);
  } else render(implementation);
}

/** A rendered element: stops at a nested portal, records it, then follows its component or its children. */
function walkLayerElement(
  walk: LayerWalk,
  current: ts.JsxElement | ts.JsxSelfClosingElement,
  inForm: boolean,
  active: ReadonlySet<ts.Node>,
  children: readonly ts.JsxChild[],
): void {
  const opening = ts.isJsxElement(current) ? current.openingElement : current;
  const tag = layerTagName(walk.sources, opening);
  if (current !== walk.layer && portalBoundaries.has(tag)) return;
  inForm = recordLayerElement(walk.contract, current, opening, tag, inForm);
  const implementation = editableControls.has(tag)
    ? undefined
    : findComponentImplementation(walk.sources, current.getSourceFile(), opening.tagName.getText());
  if (implementation && !active.has(implementation)) {
    const passedChildren = ts.isJsxElement(current) ? current.children : [];
    walkRenderedComponent(walk, implementation, inForm, new Set([...active, implementation]), passedChildren);
    return;
  }
  if (ts.isJsxElement(current))
    for (const child of current.children) walkLayer(walk, child, inForm, active, children);
}

/** Walks one node of a layer, resolving `children` and local JSX constants to what they render. */
function walkLayer(
  walk: LayerWalk,
  current: ts.Node,
  inForm: boolean,
  active: ReadonlySet<ts.Node>,
  children: readonly ts.JsxChild[] = [],
): void {
  if (
    ts.isJsxExpression(current) &&
    current.expression &&
    ['children', 'props.children'].includes(current.expression.getText())
  ) {
    for (const child of children) walkLayer(walk, child, inForm, active);
    return;
  }
  if (ts.isJsxExpression(current) && current.expression && ts.isIdentifier(current.expression)) {
    const initializer = localInitializer(current.expression);
    if (initializer && !active.has(initializer)) {
      walkLayer(walk, initializer, inForm, new Set([...active, initializer]), children);
      return;
    }
  }
  if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) {
    walkLayerElement(walk, current, inForm, active, children);
    return;
  }
  ts.forEachChild(current, (child) => walkLayer(walk, child, inForm, active, children));
}

/** The form contract of one rendered layer, following the components it renders. */
function inspectLayer(
  sources: ParsedSources,
  file: string,
  source: ts.SourceFile,
  node: ts.JsxElement,
  kind: DialogKind,
): DialogContract {
  const owner = `${file}#${ownerName(node)}`;
  const contract: DialogContract = {
    key: `${owner}|${readLayerTitle(sources, node, LAYER_TITLES[kind])}`,
    kind,
    owner,
    forms: 0,
    bodies: 0,
    uncoveredControls: [],
    contentScrolls: false,
    formBoundaries: [],
    associatedSubmits: [],
  };
  const classAttribute = node.openingElement.attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'className',
  );
  if (classAttribute) contract.contentScrolls = classScrolls(classAttribute, source);
  walkLayer({ sources, layer: node, contract }, node, false, new Set());
  return contract;
}

/** Follow rendered component returns, never unrelated functions or nested portals. */
export function inspectDialogs(files: ReadonlyMap<string, string>): DialogContract[] {
  const sources = new Map(
    [...files].map(([file, text]) => [
      file,
      ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
    ]),
  );

  const contracts: DialogContract[] = [];
  for (const [file, source] of sources) {
    function discover(node: ts.Node): void {
      const kind = ts.isJsxElement(node)
        ? LAYER_ROOTS[layerTagName(sources, node.openingElement)]
        : undefined;
      if (ts.isJsxElement(node) && kind) contracts.push(inspectLayer(sources, file, source, node, kind));
      ts.forEachChild(node, discover);
    }
    discover(source);
  }
  return contracts;
}

/** The product sources the discovery reads: every `.ts` and `.tsx` file under `app/` and `components/`. */
export function readProductSources(repositoryRoot: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const directory of ['app', 'components']) {
    for (const entry of readdirSync(resolve(repositoryRoot, directory), {
      recursive: true,
      encoding: 'utf8',
    })) {
      const file = `${directory}/${entry.replaceAll('\\', '/')}`;
      if (file.endsWith('.tsx') || file.endsWith('.ts'))
        files.set(file, readFileSync(resolve(repositoryRoot, file), 'utf8'));
    }
  }
  return files;
}
