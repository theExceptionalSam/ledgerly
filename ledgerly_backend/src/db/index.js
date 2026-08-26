const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// --- Database connection ---
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[db] FATAL: DATABASE_URL environment variable is not set.');
  process.exit(1);
}

// SSL: managed hosts (Supabase, Render, Neon) require it. We verify the
// certificate against the system CA bundle — never use rejectUnauthorized:false.
// Set DB_SSL=false only for local dev without SSL.
let sslConfig;
if (process.env.DB_SSL === 'false') {
  sslConfig = false;
} else {
  sslConfig = {
    rejectUnauthorized: true,
    // Fall back to the system CA bundle (works on Render, most Linux hosts).
    ca: process.env.DB_SSL_CA ? fs.readFileSync(process.env.DB_SSL_CA) : undefined,
  };
  // If no explicit CA is provided, let pg use the system trust store by
  // leaving ca undefined — node will use the OS CA bundle.
  if (!sslConfig.ca) delete sslConfig.ca;
}

const pool = new Pool({
  connectionString,
  ssl: sslConfig,
  max: 10,
  // Supabase/Render poolers use PgBouncer in transaction mode, which breaks
  // prepared statements. Disable them for broad compatibility.
  prepare: false,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

// --- Query helper ---
// All SQL must use native $N placeholders. The old ?→$N auto-converter was a
// footgun (it replaced ? inside string literals too) and has been removed.
async function query(sql, params, client) {
  const conn = client || pool;
  return conn.query(sql, params || []);
}

// --- Transaction helper ---
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
async function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('[db] Base schema applied');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

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

const ready = init().catch((err) => {
  console.error('[db] Initialization failed:', err.message);
  process.exit(1);
});

module.exports = { query, transaction, ready, pool };
