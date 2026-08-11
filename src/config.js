import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_URL: z.string().url().optional(),
  ARCJET_KEY: z.string().min(1).optional(),
  ARCJET_MODE: z.enum(['LIVE', 'DRY_RUN']).default('LIVE'),
  ARCJET_ENV: z.string().default('development'),
  BROADCAST: z.preprocess((value) => {
    if (value === undefined) return true;
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  }, z.boolean()),
  DELAY_MS: z.coerce.number().int().nonnegative().default(250),
  MATCH_COUNT: z.coerce.number().int().nonnegative().default(0),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const config = parsed.data;
export const isProduction = config.NODE_ENV === 'production';
export const publicBaseUrl = config.API_URL ?? `http://localhost:${config.PORT}`;

export function validateEnvironment({ requireArcjet = true } = {}) {
  if (requireArcjet && !config.ARCJET_KEY) {
    throw new Error('ARCJET_KEY is required outside test mode');
  }
}
