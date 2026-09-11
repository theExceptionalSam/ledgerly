process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const request = require('supertest');
const app = require('../src/server');

describe('Receipt endpoints', () => {
  it('GET /api/v1/receipts without auth should return 401', async () => {
    const res = await request(app).get('/api/v1/receipts');
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/payments/:id/receipt without auth should return 401', async () => {
    const res = await request(app).get('/api/v1/payments/00000000-0000-0000-0000-000000000000/receipt');
    expect(res.status).toBe(401);
  });
});

afterAll(() => {
  const db = require('../src/db');
  if (db.pool) db.pool.end();
});
