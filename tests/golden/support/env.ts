import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Playwright runs under Node, which does not auto-load .env.local the way
// Bun/Next do. Load it manually without adding a dotenv dependency.
export function loadEnvLocal(): void {
  const envPath = resolve(__dirname, '../../../.env.local');

  let content: string;
  try {
    content = readFileSync(envPath, 'utf8');
  } catch {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const key = match[1];
    const value = match[2].replace(/^["']|["']$/g, '');
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name} (expected in .env.local)`);
  }
  return value;
}
