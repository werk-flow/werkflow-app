function comparableName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
}

/**
 * The customer line under a work pack's contact, or null when it would repeat
 * the name above it: a private customer is usually their own contact, and the
 * pack showed the same name above and below the contact's role.
 */
export function contactCustomerLine(contactName: string | null, customerName: string | null): string | null {
  if (!contactName || !customerName) return null;
  return comparableName(contactName) === comparableName(customerName) ? null : customerName;
}
