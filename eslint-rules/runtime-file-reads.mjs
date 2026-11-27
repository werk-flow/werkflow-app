import { variableOf } from './bindings.mjs';

const FILE_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);
const READS = new Set(['readFile', 'readFileSync', 'createReadStream']);

function propertyName(node, computed = false) {
  if (node?.type === 'Literal') return node.value;
  if (!computed && node?.type === 'Identifier') return node.name;
}

// A named reader, or * for the fs namespace, resolved at the lexical binding.
function fsBinding(sourceCode, node) {
  if (node?.type !== 'Identifier') return;
  for (const definition of variableOf(node, sourceCode)?.defs ?? []) {
    if (definition.type === 'ImportBinding' && FILE_MODULES.has(definition.parent.source.value)) {
      return definition.node.type === 'ImportSpecifier' ? propertyName(definition.node.imported) : '*';
    }
    if (definition.type !== 'Variable') continue;
    const declaration = definition.node;
    const init = declaration.init?.type === 'AwaitExpression' ? declaration.init.argument : null;
    if (init?.type !== 'ImportExpression' || !FILE_MODULES.has(init.source.value)) continue;
    if (declaration.id.type === 'Identifier') return '*';
    if (declaration.id.type !== 'ObjectPattern') continue;
    const property = declaration.id.properties.find(
      (entry) =>
        entry.type === 'Property' && entry.value.type === 'Identifier' && entry.value.name === node.name,
    );
    if (property) return propertyName(property.key, property.computed);
  }
}

function isFileRead(sourceCode, callee) {
  if (callee.type === 'Identifier') return READS.has(fsBinding(sourceCode, callee));
  if (callee.type !== 'MemberExpression' || !READS.has(propertyName(callee.property, callee.computed)))
    return false;
  const object = callee.object;
  if (['*', 'promises'].includes(fsBinding(sourceCode, object))) return true;
  return (
    object.type === 'MemberExpression' &&
    propertyName(object.property, object.computed) === 'promises' &&
    fsBinding(sourceCode, object.object) === '*'
  );
}

// A direct declaration or assignment in the read's block supersedes earlier writes.
// Conditional writes after it still count: source order alone cannot prove which branch ran.
function writesBeforeRead(variable, node, before) {
  let block = node.parent;
  while (block && !['BlockStatement', 'Program'].includes(block.type)) block = block.parent;
  const writes = variable.references.filter((reference) => {
    const target = reference.identifier.parent;
    const wholeValue =
      (target.type === 'VariableDeclarator' && target.id.type === 'Identifier') ||
      (target.type === 'AssignmentExpression' && target.left.type === 'Identifier');
    return wholeValue && reference.writeExpr && reference.writeExpr.range[0] < before;
  });
  const definite = writes.findLast((reference) => {
    const statement = reference.identifier.parent.parent;
    return (
      ['VariableDeclaration', 'ExpressionStatement'].includes(statement.type) && statement.parent === block
    );
  });
  return writes.filter(
    (reference) => !definite || reference.writeExpr.range[0] >= definite.writeExpr.range[0],
  );
}

function isImportMetaUrl(sourceCode, node, before = node?.range[0], seen = new Set()) {
  if (node?.type === 'Identifier') {
    const variable = variableOf(node, sourceCode);
    if (!variable || seen.has(variable)) return false;
    seen.add(variable);
    return writesBeforeRead(variable, node, before).some((reference) =>
      isImportMetaUrl(sourceCode, reference.writeExpr, reference.writeExpr.range[0], new Set(seen)),
    );
  }
  if (node?.type !== 'NewExpression' || node.callee.name !== 'URL') return false;
  const base = node.arguments[1];
  return (
    base?.type === 'MemberExpression' &&
    propertyName(base.property, base.computed) === 'url' &&
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
