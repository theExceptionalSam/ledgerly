const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/app.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// --- Phase 0: pre-upgrade backup ---
// Take a one-time backup before the first migration runs, so the pre-upgrade
// state can always be restored. Only created if a db file already exists and
// no backup exists yet.
const BACKUP_PATH = path.join(path.dirname(DB_PATH), 'app.db.backup-pre-upgrade');
if (fs.existsSync(DB_PATH) && !fs.existsSync(BACKUP_PATH)) {
  try {
    fs.copyFileSync(DB_PATH, BACKUP_PATH);
  } catch (err) {
    console.error('[db] Could not create pre-upgrade backup:', err.message);
  }
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Lightweight migration for databases created before a column existed.
// CREATE TABLE IF NOT EXISTS does not alter existing tables, so add the
// column explicitly. Phone became required for new schools; older rows keep
// a placeholder value.
function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}
if (!columnExists('tenants', 'phone')) {
  db.prepare(`ALTER TABLE tenants ADD COLUMN phone TEXT`).run();
  db.prepare(`UPDATE tenants SET phone = '' WHERE phone IS NULL`).run();
}
if (!columnExists('users', 'email_verified')) {
  db.prepare(`ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0`).run();
  // Existing accounts predate the OTP requirement; treat them as verified.
  db.prepare(`UPDATE users SET email_verified = 1`).run();
}

// --- Phase 0: numbered migration runner ---
// Every schema change from the v2 upgrade onward ships as a numbered .sql file
// in migrations/. On startup we read them in filename order, skip any already
// recorded in the migrations table, and otherwise run each inside a transaction.
db.exec(`
  CREATE TABLE IF NOT EXISTS migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const migrationFiles = fs.existsSync(MIGRATIONS_DIR)
  ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  : [];

const alreadyApplied = db.prepare(`SELECT id FROM migrations`).all().map((r) => r.id);

for (const file of migrationFiles) {
  if (alreadyApplied.includes(file)) continue;
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  const apply = db.transaction(() => {
    db.exec(sql);
    db.prepare(`INSERT INTO migrations (id) VALUES (?)`).run(file);
  });
  try {
    apply();
    console.log(`[db] Applied migration ${file}`);
  } catch (err) {
    console.error(`[db] Migration ${file} failed:`, err.message);
    throw err;
  }
}

module.exports = db;
