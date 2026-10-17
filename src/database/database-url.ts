/**
 * Resolves PostgreSQL connection string from env.
 * Prefer `DB_*` variables; `DATABASE_URL` overrides when set (e.g. production).
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DATABASE_URL?.trim()) {
    return env.DATABASE_URL.trim();
  }

  const host = env.DB_HOST ?? 'localhost';
  const port = env.DB_PORT ?? '5432';
  const user = env.DB_USERNAME ?? 'postgres';
  const password = env.DB_PASSWORD ?? '';
  const database = env.DB_NAME ?? 'workrecord';

  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);

  return `postgresql://${encodedUser}:${encodedPassword}@${host}:${port}/${database}?schema=public`;
}
