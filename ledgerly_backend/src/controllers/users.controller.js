const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// User management — the owner can invite bursars, accountants, and assistants
// to their school. All queries are scoped by tenant_id from the auth token.

async function listUsers(req, res) {
  const { tenantId } = req.user;
  const { rows } = await db.query(`
    SELECT id, name, email, role, status, last_login_at, created_at
    FROM users WHERE tenant_id = $1 ORDER BY created_at ASC
  `, [tenantId]);
  res.json({ users: rows });
}

async function createUser(req, res) {
  const { tenantId, id: userId } = req.user;
  const { name, email, password, role } = req.body;

  // Only owner can create users; roles are limited to non-owner roles.
  const allowedRoles = ['bursar', 'accountant', 'assistant'];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Can only create bursar, accountant, or assistant accounts.' });
  }

  const { rows: existing } = await db.query(`SELECT id FROM users WHERE email = $1`, [email.toLowerCase()]);
  if (existing[0]) return res.status(409).json({ error: 'An account with this email already exists' });

  const id = randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);
  await db.query(`
    INSERT INTO users (id, tenant_id, name, email, password_hash, role, email_verified)
    VALUES ($1, $2, $3, $4, $5, $6, 1)
  `, [id, tenantId, name, email.toLowerCase(), passwordHash, role]);

  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'user', entityId: id, ipAddress: req.ip, metadata: { name, role } });
  res.status(201).json({ id });
}

async function updateUser(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;
  const { name, role, status } = req.body;

  const { rows } = await db.query(`SELECT id, role FROM users WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'owner') return res.status(400).json({ error: 'Cannot modify the owner account' });

  const allowedRoles = ['bursar', 'accountant', 'assistant'];
  const updates = [];
  const params = [];
  let paramIdx = 1;

  if (name !== undefined) { updates.push(`name = $${paramIdx++}`); params.push(name); }
  if (role !== undefined && allowedRoles.includes(role)) { updates.push(`role = $${paramIdx++}`); params.push(role); }
  if (status !== undefined && ['active', 'disabled'].includes(status)) { updates.push(`status = $${paramIdx++}`); params.push(status); }

  if (updates.length === 0) return res.json({ ok: true });
  params.push(id, tenantId);
  await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx++} AND tenant_id = $${paramIdx++}`, params);

  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'user', entityId: id, ipAddress: req.ip, metadata: { name, role, status } });
  res.json({ ok: true });
}

module.exports = { listUsers, createUser, updateUser };
