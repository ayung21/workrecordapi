const path = require('path');
const os = require('os');

const appRoot = __dirname;
const cpuCount = os.cpus().length;
/** ~90% RAM dibagi per instance cluster; sisanya untuk OS & PM2 */
const memPerInstanceMb = Math.max(
  512,
  Math.floor((os.totalmem() * 0.9) / cpuCount / 1024 / 1024),
);
const nodeHeapMb = Math.max(256, Math.floor(memPerInstanceMb * 0.85));

/**
 * PM2 ecosystem — WorkRecord API
 *
 * Production (setelah build, port 3001, cluster = semua core):
 *   npm run build
 *   pm2 start ecosystem.config.cjs --only work-record-api --env production
 *
 * Dev (watch, pakai .env di appRoot):
 *   pm2 start ecosystem.config.cjs --only work-record-api-dev
 *
 * Env tambahan: salin .env ke appRoot; Nest ConfigModule memuat .env dari cwd.
 * PORT di env_production (3001) mengalahkan .env saat pm2 --env production.
 */
module.exports = {
  apps: [
    {
      name: 'work-record-api',
      cwd: appRoot,
      script: 'dist/src/main.js',
      instances: cpuCount,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: `${memPerInstanceMb}M`,
      node_args: `--max-old-space-size=${nodeHeapMb}`,
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
    {
      name: 'work-record-api-dev',
      cwd: appRoot,
      script: 'npm',
      args: 'run start:dev',
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
    },
  ],
};
