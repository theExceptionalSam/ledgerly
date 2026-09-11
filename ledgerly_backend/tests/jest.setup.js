// Global Jest setup — runs once per test file before any test code is executed.
//
// Sets env vars required by server.js + tokens.js (without these, requiring
// src/server prints alarming errors and the JWT secret check in tokens.js
// throws). Also mocks the pg db module so the tests don't need a real database
// connection — the controllers' db.query calls resolve with `{ rows: [] }` by
// default (no user found, no records, etc.), which is the correct shape for the
// "auth rejection" / "validation" tests we run. Individual tests can override
// the mock with `db.query.mockResolvedValueOnce(...)` if they need specific
// data.
//
// NODE_ENV=test also gates the `app.listen(PORT)` call in server.js (skipped in
// test mode) so Jest can exit cleanly without a dangling port-4000 listener.

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-not-placeholder';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-not-placeholder';

// Mock the db module globally. The path is relative to this setup file
// (tests/jest.setup.js → ../src/db), and jest registers the mock for the
// resolved module ID so any `require('../db')` from src/ picks up the mock.
jest.mock('../src/db', () => {
  const queryMock = jest.fn().mockResolvedValue({ rows: [] });
  return {
    query: queryMock,
    transaction: jest.fn(async (fn) => fn({ query: queryMock })),
    ready: Promise.resolve(),
    pool: { end: jest.fn().mockResolvedValue(undefined) },
  };
});
