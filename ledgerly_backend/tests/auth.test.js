process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const request = require('supertest');
const app = require('../src/server');

describe('Auth endpoints', () => {
  it('POST /api/v1/auth/login with missing fields should return 400', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/v1/auth/login with wrong credentials should return 401', async () => {
    // The db mock (tests/jest.setup.js) makes db.query return { rows: [] }, so
    // login()'s user lookup finds no user and returns the generic 401 error —
    // the same code path as a real DB lookup against a nonexistent email.
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'nonexistent@test.com',
      password: 'wrongpassword'
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('GET /api/v1/auth/me without auth should return 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});

afterAll(() => {
  const db = require('../src/db');
  if (db.pool) db.pool.end();
});
