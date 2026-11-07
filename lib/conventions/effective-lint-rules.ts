import { z } from '@/lib/zod';

// ESLint's calculateConfigForFile types the effective configuration `any`.
// ESLint resolves each rule in it to `[severity, ...options]`.
const effectiveConfigSchema = z.object({ rules: z.record(z.string(), z.array(z.unknown())) });

/** The rules of an effective ESLint configuration, each as `[severity, ...options]`. */
export function effectiveLintRules(config: unknown): Readonly<Record<string, readonly unknown[]>> {
  return effectiveConfigSchema.parse(config).rules;
}
