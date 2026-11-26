import 'dotenv/config';
import { z } from 'zod';

// Define the schema for environment variables
const envSchema = z.object({
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  RESERVATIONS_URL: z.string().url().default('http://localhost:3001/api/reservations/confirm'),
  BANK_URL: z.string().url().default('http://localhost:3002/api/bank/charge'),
  CABIN_AVAILABILITY_URL: z.string().url().default('http://localhost:3003/api/cabins/availability'),
  CABIN_CHECKOUT_URL: z.string().url().default('http://localhost:3003/api/cabins/checkout-report'),
});

// Validate process.env against the schema
const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  process.exit(1); // Force exit if env is invalid
}

export const env = _env.data;
