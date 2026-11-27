// Which text an invoice can carry: the XML (`to-en16931.ts`) refuses the rest,
// so an input that becomes invoice text refuses it first, at its field.

/** Characters XML 1.0 cannot carry, not even as a character reference. */
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

/** Whether invoice XML can carry this text; tab and line breaks it can. */
export function carriesAsXml(text: string): boolean {
  return !NOT_XML.test(text) && text.isWellFormed();
}
