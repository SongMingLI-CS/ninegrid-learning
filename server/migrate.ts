import 'dotenv/config';
import { createPool, runMigrations } from './db';

const pool = createPool();
try {
  await runMigrations(pool);
  console.log('Database migrations are up to date.');
} finally {
  await pool.end();
}
