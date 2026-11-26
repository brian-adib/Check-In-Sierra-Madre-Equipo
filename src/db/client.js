import { createClient } from '@libsql/client';
import { env } from '../config/env.js';

// Create the database client (Local file or Turso cloud URL)
export const db = createClient({
  url: env.DATABASE_URL,
  authToken: env.DATABASE_AUTH_TOKEN,
});
