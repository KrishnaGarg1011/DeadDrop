// Applies schema.sql to the configured DATABASE_URL.
// Idempotent: if the core tables already exist, it does nothing, so this is
// safe to run on every deploy/start. No local psql required.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../src/config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, '../../schema.sql');
// In a deploy the schema file is packaged alongside the app.
const schemaCandidates = [
  schemaPath,
  path.resolve(__dirname, '../schema.sql'),
  path.resolve(process.cwd(), 'schema.sql'),
];
const schemaFile = schemaCandidates.find((p) => fs.existsSync(p));

if (!schemaFile) {
  console.error('[migrate] Could not locate schema.sql');
  process.exit(1);
}

const client = new pg.Client({ connectionString: env.databaseUrl });

async function tableExists(name) {
  const { rows } = await client.query(
    `SELECT to_regclass($1) AS t`,
    [name]
  );
  return !!rows[0].t;
}

async function main() {
  await client.connect();
  console.log(`[migrate] connected (${env.databaseUrl.split('@')[1] || 'db'})`);

  if (await tableExists('packages')) {
    console.log('[migrate] schema already present — skipping.');
  } else {
    const script = fs.readFileSync(schemaFile, 'utf8');
    // execute as a single multi-statement query (psql-style);
    // pg supports this when there are no parameters.
    await client.query(script);
    console.log('[migrate] schema created successfully.');
  }

  await client.end();
}

main().catch((err) => {
  console.error('[migrate] failed:', err.message);
  process.exit(1);
});
