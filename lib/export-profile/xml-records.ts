import { ExportFormatError } from './zip-archive';
import { decodeXmlEntities, parseXmlAttributes } from './xml-text';

// XML record sets. Every element that holds text-only child elements or
// attributes is a record; records with the same element path form one
// table, whose fields are the child element names and the attributes (@name).

export type XmlRecord = { path: string; fields: ReadonlyMap<string, string> };

type OpenElement = {
  name: string;
  path: string;
  fields: Map<string, string>;
  /** How often each text-only child name occurred, for tag, tag #2, tag #3. */
  childCounts: Map<string, number>;
  hasChildElements: boolean;
  text: string;
};

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^>[]|\[[\s\S]*?\])*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;

/** The encoding an XML declaration names, if any. */
export function declaredXmlEncoding(head: string): string | null {
  return /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1]?.toLowerCase() ?? null;
}

/** Every record of an XML document, in document order. */
export function* xmlRecords(xml: string): Generator<XmlRecord> {
  const stack: OpenElement[] = [];
  let expectedOffset = 0;
  let rootSeen = false;
  for (const token of xml.matchAll(TOKEN)) {
    // A gap between tokens is markup no rule matched, such as a stray `<`.
    if (token.index !== expectedOffset) throw new ExportFormatError('xml_not_well_formed');
    expectedOffset = token.index + token[0].length;
    const [, cdata, closingName, openingName, attributeText, selfClosing, text] = token;
    const top = stack.at(-1);
    if (cdata !== undefined || text !== undefined) {
      // Outside the root element only whitespace is allowed.
      if (!top && (cdata !== undefined || /[^\t\n\r ]/.test(text ?? '')))
        throw new ExportFormatError('xml_not_well_formed');
      if (top) top.text += cdata ?? decodeXmlEntities(text ?? '');
      continue;
    }
    if (openingName !== undefined) {
      if (top) top.hasChildElements = true;
      else if (rootSeen) throw new ExportFormatError('xml_not_well_formed');
      rootSeen = true;
      const element: OpenElement = {
        name: openingName,
        path: top ? `${top.path}/${openingName}` : openingName,
        fields: new Map(
          [...parseXmlAttributes(attributeText ?? '')].map(([name, value]) => [`@${name}`, value]),
        ),
        childCounts: new Map(),
        hasChildElements: false,
        text: '',
      };
      if (selfClosing === '/') yield* closeElement(element, top);
      else stack.push(element);
      continue;
    }
    if (closingName !== undefined) {
      const element = stack.pop();
      if (!element || element.name !== closingName) throw new ExportFormatError('xml_not_well_formed');
      yield* closeElement(element, stack.at(-1));
    }
  }
  if (!rootSeen || stack.length > 0 || expectedOffset !== xml.length)
    throw new ExportFormatError('xml_not_well_formed');
}

function* closeElement(element: OpenElement, parent: OpenElement | undefined): Generator<XmlRecord> {
  if (!element.hasChildElements) {
    if (parent) parent.fields.set(repeatedFieldName(parent, element.name), element.text.trim());
    if (element.fields.size === 0) return;
  }
  if (element.fields.size > 0) yield { path: element.path, fields: element.fields };
}

/** A repeated text-only child keeps every value: tag, tag #2, tag #3, as with repeated header names. */
function repeatedFieldName(parent: OpenElement, name: string): string {
  const occurrence = (parent.childCounts.get(name) ?? 0) + 1;
  parent.childCounts.set(name, occurrence);
  return occurrence === 1 ? name : `${name} #${occurrence}`;
}
