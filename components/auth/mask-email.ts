/** Hides the local part of an address on screen: "test@example.com" becomes "t***@example.com". */
export function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (localPart === undefined || !domain) return email;
  const maskedLocal = localPart.length > 1 ? localPart[0] + '***' : localPart + '***';
  return `${maskedLocal}@${domain}`;
}
