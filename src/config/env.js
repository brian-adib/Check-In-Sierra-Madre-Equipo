import 'dotenv/config';
import { z } from 'zod';

const optionalServiceUrl = (defaultUrl) =>
  z.preprocess(
    (val) => {
      if (typeof val !== 'string') return defaultUrl;
      const trimmed = val.trim();
      if (!trimmed) return defaultUrl;
      try {
        new URL(trimmed);
        return trimmed;
      } catch {
        return defaultUrl;
      }
    },
    z.string().url()
  );

const envSchema = z.object({
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  PUBLIC_URL: optionalServiceUrl('https://onrender.com'),
  RESERVATIONS_URL: optionalServiceUrl('http://localhost:3001/api/reservations/confirm'),
  BANK_URL: optionalServiceUrl('http://localhost:3002/api/bank/charge'),
  CABIN_AVAILABILITY_URL: optionalServiceUrl('http://localhost:3003/api/cabins/availability'),
  CABIN_CHECKOUT_URL: optionalServiceUrl('http://localhost:3003/api/cabins/checkout-report'),
  BOARDING_URL: optionalServiceUrl('http://localhost:3004/api/boarding/passengers'),
  LUGGAGE_URL: z.string().trim().optional().default(''),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const env = _env.data;
