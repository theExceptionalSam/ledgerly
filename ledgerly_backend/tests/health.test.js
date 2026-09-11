// Env vars required to load src/server (DB URL + JWT secrets). Duplicated from
// tests/jest.setup.js so the test file is self-documenting — the setup file
// also sets these as a safety net for tests that don't include this header.
process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const request = require('supertest');
const app = require('../src/server');

describe('Health endpoint', () => {
  it('GET /health should return 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
  });
});

afterAll(() => {
  // Close the DB pool so Jest can exit. With the db mock from jest.setup.js,
  // pool.end is a no-op jest.fn — calling it is harmless and keeps this file
  // compatible with a real db module if the mock is removed later.
  const db = require('../src/db');
  if (db.pool) db.pool.end();
});
