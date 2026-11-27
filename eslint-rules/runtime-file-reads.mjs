const FILE_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);
const READS = new Set(['readFile', 'readFileSync', 'createReadStream']);

function bindingOf(sourceCode, node) {
  for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(node.name);
    if (variable) return variable;
  }
}

function importedFromFs(sourceCode, node) {
  if (node?.type !== 'Identifier') return false;
  return bindingOf(sourceCode, node)?.defs.some(
    (definition) => definition.type === 'ImportBinding' && FILE_MODULES.has(definition.parent.source.value),
  );
}

function isFileRead(sourceCode, callee) {
  if (callee.type === 'Identifier') {
    return bindingOf(sourceCode, callee)?.defs.some(
      (definition) =>
        definition.type === 'ImportBinding' &&
        definition.node.type === 'ImportSpecifier' &&
        FILE_MODULES.has(definition.parent.source.value) &&
        READS.has(definition.node.imported.name),
    );
  }
  if (callee.type !== 'MemberExpression' || callee.computed || !READS.has(callee.property.name)) return false;
  const object = callee.object;
  if (importedFromFs(sourceCode, object)) return true;
  return (
    object.type === 'MemberExpression' &&
    !object.computed &&
    object.property.name === 'promises' &&
    importedFromFs(sourceCode, object.object)
  );
}

function isImportMetaUrl(sourceCode, node, seen = new Set()) {
  if (node?.type === 'Identifier') {
    const variable = bindingOf(sourceCode, node);
    if (!variable || seen.has(variable)) return false;
    seen.add(variable);
    return (
      variable.defs.some(
        (definition) =>
          definition.type === 'Variable' && isImportMetaUrl(sourceCode, definition.node.init, seen),
      ) || variable.references.some((reference) => isImportMetaUrl(sourceCode, reference.writeExpr, seen))
    );
  }
  if (node?.type !== 'NewExpression' || node.callee.name !== 'URL') return false;
  const base = node.arguments[1];
  return (
    base?.type === 'MemberExpression' &&
    !base.computed &&
    base.property.name === 'url' &&
    base.object.type === 'MetaProperty' &&
    base.object.meta.name === 'import' &&
    base.object.property.name === 'meta'
  );
}

// Tier 2: Turbopack can turn this URL into a protocol-less object in Server Actions.
export const noImportMetaFileReadRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      bundledUrl:
        'Turbopack can turn new URL(…, import.meta.url) into an object fs cannot read in a Server Action. Read an app-root path with join(process.cwd(), …) and include the asset in outputFileTracingIncludes.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          isFileRead(context.sourceCode, node.callee) &&
          isImportMetaUrl(context.sourceCode, node.arguments[0])
        ) {
          context.report({ node, messageId: 'bundledUrl' });
        }
      },
    };
  },
};
