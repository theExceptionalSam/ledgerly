process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const request = require('supertest');
const app = require('../src/server');

describe('Uptime monitoring endpoint', () => {
  it('GET /api/monitoring should return 200 with health payload (no auth)', async () => {
    const res = await request(app).get('/api/monitoring');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe(true);
    expect(res.body.uptime).toBeDefined();
    expect(res.body.memory).toBeDefined();
    expect(res.body.memory.rss).toBeDefined();
    expect(res.body.memory.heapUsed).toBeDefined();
    expect(res.body.memory.heapTotal).toBeDefined();
    expect(res.body.responseTime).toBeDefined();
    expect(res.body.timestamp).toBeDefined();
  });

  it('GET /api/monitoring should NOT expose sensitive data', async () => {
    const res = await request(app).get('/api/monitoring');
    const body = JSON.stringify(res.body);
    // No DB connection strings, no JWT secrets, no user data
    expect(body).not.toMatch(/postgresql:\/\//i);
    expect(body).not.toMatch(/JWT_/i);
    expect(body).not.toMatch(/password/i);
    expect(body).not.toMatch(/secret/i);
  });

  it('GET /api/monitoring should return 503 when DB is unreachable', async () => {
    // Override the db mock for this test: make db.query reject so the
    // monitoring controller's try/catch falls into the degraded branch.
    const db = require('../src/db');
    const original = db.query.getMockImplementation();
    db.query.mockRejectedValueOnce(new Error('Connection refused'));

    const res = await request(app).get('/api/monitoring');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.db).toBe(false);
    expect(res.body.error).toBeDefined();

    // Restore the default mock so other tests aren't affected
    if (original) db.query.mockImplementation(original);
    else db.query.mockResolvedValue({ rows: [] });
  });
});

afterAll(() => {
  const db = require('../src/db');
  if (db.pool) db.pool.end();
});
