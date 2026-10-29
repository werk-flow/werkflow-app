// XML text helpers shared by the Excel and XML readers.

const NAMED_ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Replaces the five named entities and numeric character references. */
export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity: string, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X'))
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return NAMED_ENTITIES[body] ?? entity;
  });
}

/** The attributes of a start tag's attribute text, entities decoded. */
export function parseXmlAttributes(text: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of text.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const [, name = '', doubleQuoted, singleQuoted] = match;
    attributes.set(name, decodeXmlEntities(doubleQuoted ?? singleQuoted ?? ''));
  }
  return attributes;
}
