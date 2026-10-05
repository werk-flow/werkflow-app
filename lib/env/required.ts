/** Returns the value, or throws `message` when it is missing or empty. */
export function readRequiredEnv(value: string | undefined, message: string): string {
  if (!value) {
    throw new Error(message);
  }

  return value;
}
