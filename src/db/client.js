import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

const isProduction = env.NODE_ENV === 'production' || !env.DATABASE_URL.includes('localhost');

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

// Helper compatible para ejecutar consultas SQL en PostgreSQL
export const query = (text, params) => pool.query(text, params);
