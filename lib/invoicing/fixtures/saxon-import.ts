/**
 * Imports a module that loads SaxonJS, for a unit test. Bun's Error.captureStackTrace refuses a
 * non-Error object once a module set Error.prepareStackTrace, as ESLint does in earlier test files of
 * the same unit run. follow-redirects, which SaxonJS loads through axios, calls it on a prototype
 * object at load; Node, which serves the app, accepts that. Assigning undefined restores Bun's own
 * behavior; deleting the property does not.
 */
export async function importLoadingSaxon<T>(load: () => Promise<T>): Promise<T> {
  const prepareStackTrace = Error.prepareStackTrace;
  Reflect.set(Error, 'prepareStackTrace', undefined);
  try {
    return await load();
  } finally {
    Reflect.set(Error, 'prepareStackTrace', prepareStackTrace);
  }
}
