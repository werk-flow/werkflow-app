// The part of SaxonJS 2 (`saxon-js`, no bundled types) that check-en16931.ts
// and lib/testing/staging/original.ts call. Results are unknown and parsed at the call site.
declare module 'saxon-js' {
  type SaxonJS = {
    transform(
      options: { stylesheetInternal: unknown; sourceText: string; destination: 'document' },
      execution: 'async',
    ): Promise<{ principalResult: unknown }>;
    XPath: {
      evaluate(
        expression: string,
        contextItem: unknown,
        options: { namespaceContext: Record<string, string>; params?: Record<string, string> },
      ): unknown;
    };
  };
  const saxonJs: SaxonJS;
  export default saxonJs;
}
