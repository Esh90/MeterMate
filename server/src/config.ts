import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

// Load the repo-root .env (one level up from server/) so both workspaces share it.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
loadDotenv({ path: path.join(repoRoot, '.env') });

/**
 * Typed, validated environment. Parsing happens once at module load; an invalid
 * environment fails fast with a clear message instead of surfacing as a vague
 * runtime error deep inside a request.
 */
const EnvSchema = z.object({
  // Maxio Advanced Billing
  MAXIO_API_KEY: z.string().default(''),
  MAXIO_SITE_SUBDOMAIN: z.string().default('your-test-site'),
  MAXIO_ENVIRONMENT: z.enum(['US', 'EU']).default('US'),
  MAXIO_DEFAULT_PRODUCT_FAMILY: z.string().default(''),

  // Slack (bot-token app)
  SLACK_BOT_TOKEN: z.string().default(''),
  SLACK_DIGEST_CHANNEL: z.string().default(''),
  CONSULTANT_C1_EMAIL: z.string().default(''),
  CONSULTANT_C2_EMAIL: z.string().default(''),

  // Admin (placeholder auth)
  ADMIN_USER: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().default('changeme'),

  // App
  PORT: z.coerce.number().int().positive().default(4000),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  DIGEST_CRON: z.string().default('0 9 * * 1'),
  DIGEST_CRON_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const config = Object.freeze(parsed.data);

export type Config = typeof config;
