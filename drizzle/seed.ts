import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { resolveDatabaseUrl } from '../src/database/database-url';
import { schema } from '../src/database/schema';
import { seedSystem } from './seed-system';

async function main() {
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });
  const db = drizzle(pool, { schema });
  await seedSystem(db);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
