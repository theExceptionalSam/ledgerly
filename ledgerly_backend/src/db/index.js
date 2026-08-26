const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// --- Database connection ---
// Uses a connection string (DATABASE_URL) standard for Postgres hosts
// (Supabase, Render, Neon, etc.). Example:
//   postgresql://user:password@host:5432/database
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[db] FATAL: DATABASE_URL environment variable is not set.');
  console.error('[db] For local dev, set it in .env (see .env.example).');
  console.error('[db] For production, set it on your hosting provider (Render, Vercel, etc.).');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  // Supabase and most managed Postgres hosts require SSL.
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 10,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

// --- Query helper ---
// Converts SQLite-style ? placeholders to Postgres $N placeholders so the
// existing SQL strings don't need to be rewritten. This is the bridge that
// makes the migration from better-sqlite3 to pg tractable.
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Main query function. Outside a transaction, uses the pool directly.
// Inside a transaction, pass the client from db.transaction().
async function query(sql, params, client) {
  const conn = client || pool;
  const converted = convertPlaceholders(sql);
  return conn.query(converted, params || []);
}

// --- Transaction helper ---
// Replaces better-sqlite3's db.transaction(fn). The callback receives a
// pg.Client to use for all queries inside the transaction.
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// --- Schema bootstrap + migrations ---
// On startup: run schema.sql (base snapshot), then apply numbered migrations
// in order, skipping any already recorded in the migrations table.

async function init() {
  // 1. Base schema
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('[db] Base schema applied');

  // 2. Migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // 3. Run numbered migrations in order
  const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
  const migrationFiles = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    : [];

  const { rows: applied } = await pool.query('SELECT id FROM migrations');
  const alreadyApplied = applied.map((r) => r.id);

  for (const file of migrationFiles) {
    if (alreadyApplied.includes(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await pool.query('BEGIN');
      await pool.query(sql);
      await pool.query('INSERT INTO migrations (id) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      console.log(`[db] Applied migration ${file}`);
    } catch (err) {
      await pool.query('ROLLBACK');
      console.error(`[db] Migration ${file} failed:`, err.message);
      throw err;
    }
  }
}

// Run init and export a promise so callers can await readiness.
const ready = init().catch((err) => {
  console.error('[db] Initialization failed:', err.message);
  process.exit(1);
});

module.exports = {
  query,
  transaction,
  ready,
};
