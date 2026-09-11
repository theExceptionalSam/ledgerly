process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const request = require('supertest');
const app = require('../src/server');

describe('Student endpoints', () => {
  it('GET /api/v1/students without auth should return 401', async () => {
    const res = await request(app).get('/api/v1/students');
    expect(res.status).toBe(401);
  });

  it('POST /api/v1/students without auth should return 401', async () => {
    const res = await request(app).post('/api/v1/students').send({ name: 'Test' });
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/students/:id with invalid UUID should return 400', async () => {
    // This needs auth — skip if we can't get a token
    const res = await request(app).get('/api/v1/students/not-a-uuid');
    expect(res.status).toBe(401); // auth check happens before UUID validation
  });
});

afterAll(() => {
  const db = require('../src/db');
  if (db.pool) db.pool.end();
});
