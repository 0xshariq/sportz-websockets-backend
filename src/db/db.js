import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config.js';

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  maxLifetimeSeconds: 3_600,
});

pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error:', error));

export const db = drizzle(pool);
