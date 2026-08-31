import { app } from './app.js';
import { env } from './config/env.js';
import { query } from './config/db.js';
import { expirePackages } from './services/package.service.js';

async function start() {
  try {
    await query('SELECT 1');
    console.log('[db] connected to PostgreSQL');

    // Verify the schema is present before accepting traffic.
    await expirePackages();

    app.listen(env.port, '0.0.0.0', () => {
      console.log(`[server] DeadDrop API listening on http://0.0.0.0:${env.port}`);
    });

    // Periodic job that flips time-expired packages into the 'expired' state.
    const timer = setInterval(async () => {
      try {
        await expirePackages();
      } catch (err) {
        console.error('[expire] job failed', err.message);
      }
    }, env.expireIntervalMs);
    timer.unref();
  } catch (err) {
    console.error('[server] failed to start:', err.message);
    process.exit(1);
  }
}

start();
