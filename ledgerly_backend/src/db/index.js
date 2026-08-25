const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/app.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

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

module.exports = db;
