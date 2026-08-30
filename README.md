# Ledgerly

School fee and finance tracker for Nigerian schools. Multi-tenant SaaS built with Node.js, Express, PostgreSQL, and React.

## Features

- **Multi-tenant architecture** — each school's data is isolated by `tenant_id`
- **Itemised fee billing** — assign fee heads (Tuition, Boarding, Feeding, etc.) per student per term
- **Payment recording** — multi-line payments with idempotency keys, reversal support
- **PDF receipts** — sequential per-tenant receipt numbers, branded layout
- **Academic sessions & terms** — sessions group terms (e.g. 2025/2026 → 1st/2nd/3rd Term)
- **Income & expenditure tracking** — term-scoped, with CSV export
- **User management** — owner, bursar, accountant, assistant roles
- **Audit trail** — every mutation logged with actor, IP, and structured metadata
- **Password reset** — forgot-password + reset-password flow
- **Force password change** — invited users must change their temporary password
- **30-minute inactivity auto-logout**
- **Responsive** — optimized for mobile, tablet, and desktop

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 5, React Router 6 |
| Backend | Node.js, Express 4 |
| Database | PostgreSQL (Supabase) |
| Auth | JWT (access token in memory, refresh token in httpOnly cookie) |
| PDF | pdfkit |
| Email | Resend |
| Deployment | Vercel (frontend), Render (backend), Supabase (database) |

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL (local or Supabase)

### Backend
```bash
cd ledgerly_backend
cp .env.example .env
# Edit .env: set DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
npm install
npm start
```

### Frontend
```bash
cd ledgerly_frontend
npm install
npm run dev
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Yes | Secret for access tokens (min 32 chars, not the .env.example placeholder) |
| `JWT_REFRESH_SECRET` | Yes | Secret for refresh tokens |
| `CORS_ORIGINS` | Yes | Comma-separated list of allowed frontend origins |
| `RESEND_API_KEY` | No | For email OTP (if absent, OTPs are logged to console) |
| `RESEND_FROM_EMAIL` | No | From address for OTP emails (defaults to Resend test address) |
| `LEDGERLY_DEV_SHOW_OTP` | No | Set to `true` to expose OTP codes in API responses (dev only) |
| `DB_SSL` | No | Set to `false` to disable SSL (local dev only) |

## License

Proprietary. All rights reserved.
