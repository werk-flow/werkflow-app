import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function toLocalDateString(date: Date): string {
  // Pad the year too: intermediate DatePicker states can hold years like 202,
  // and an unpadded "202-01-01" is not parseable ISO ("Invalid Date"), which
  // wedges string-state date round trips at NaN.
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
