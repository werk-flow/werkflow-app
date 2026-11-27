/** The variable `identifier` names in its scope, or undefined for a global. */
export function variableOf(identifier, sourceCode) {
  for (let scope = sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
  }
  return undefined;
}
