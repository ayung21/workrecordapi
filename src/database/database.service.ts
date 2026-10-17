import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { schema } from './schema';
import { resolveDatabaseUrl } from './database-url';

export type AppDatabase = NodePgDatabase<typeof schema>;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;
  readonly db: AppDatabase;

  constructor(config: ConfigService) {
    const url =
      config.get<string>('DATABASE_URL')?.trim() ||
      resolveDatabaseUrl({
        DB_HOST: config.get('DB_HOST'),
        DB_PORT: config.get('DB_PORT'),
        DB_USERNAME: config.get('DB_USERNAME'),
        DB_PASSWORD: config.get('DB_PASSWORD'),
        DB_NAME: config.get('DB_NAME'),
      });
    this.pool = new Pool({ connectionString: url });
    this.db = drizzle(this.pool, { schema });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
