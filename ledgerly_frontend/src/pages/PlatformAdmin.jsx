import { useEffect, useState } from "react";
import { naira } from "../utils/format";

// Platform Admin — separate auth flow for the platform operator.
//
// This page is NOT wrapped in <ProtectedRoute> in App.jsx because it uses a
// completely separate auth mechanism: a long-lived access token stored against
// a row in the `platform_admins` table. The token lives in localStorage under
// `platform_admin_token`. There is no refresh-token flow here.
//
// All API calls go to /api/v1/platform/* with `Authorization: Bearer <token>`.
// We use raw fetch (NOT the regular `api` client) so the platform token never
// mixes with the tenant access-token / cookie flow used elsewhere in the app.

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api/v1";
const TOKEN_KEY = "platform_admin_token";

const HEALTH_DOT = { green: "🟢", yellow: "🟡", red: "🔴" };

async function platformFetch(path, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error(payload?.error || "Platform request failed");
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatRelative(iso) {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - then;
  const day = 24 * 60 * 60 * 1000;
  if (diff < 60 * 1000) return "just now";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < day) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

function StatCard({ label, value, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={accent ? { color: accent } : undefined}>{value}</div>
    </div>
  );
}

export default function PlatformAdmin() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [email, setEmail] = useState("");
  const [accessTokenInput, setAccessTokenInput] = useState("");
  const [authed, setAuthed] = useState(() => !!localStorage.getItem(TOKEN_KEY));
  const [overview, setOverview] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setAuthed(false);
    setOverview(null);
    setHealth(null);
  };

  const loadDashboard = async (tk) => {
    setLoading(true); setError("");
    try {
      const [ov, hl] = await Promise.all([
        platformFetch("/platform/overview", tk),
        platformFetch("/platform/health", tk),
      ]);
      setOverview(ov);
      setHealth(hl);
    } catch (err) {
      if (err.status === 401) {
        // Token is invalid/expired — bounce back to the login form
        localStorage.removeItem(TOKEN_KEY);
        setToken("");
        setAuthed(false);
        setError("Token is no longer valid. Please sign in again.");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Auto-load when a token is present in localStorage on first mount.
  useEffect(() => {
    if (authed) loadDashboard(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e) => {
    e.preventDefault();
    setError("");
    if (!email || !accessTokenInput) {
      setError("Email and access token are both required.");
      return;
    }
    // The "email" field is recorded for the operator's reference; auth is
    // purely token-based on the server (no password endpoint exists). We
    // store the token and try to load the dashboard — a 401 means bad token.
    localStorage.setItem(TOKEN_KEY, accessTokenInput);
    setToken(accessTokenInput);
    setAuthed(true);
    loadDashboard(accessTokenInput);
  };

  const refresh = () => loadDashboard(token);

  // ----- Login screen -----
  if (!authed) {
    return (
      <div className="auth-page">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-logo-block">
            <img src="/ledgerly-logo-dark.jpg" alt="Ledgerly" className="auth-wordmark" />
          </div>
          <h1>Platform admin</h1>
          <p className="auth-sub">Operator dashboard for the Ledgerly platform. Separate credentials from school accounts.</p>
          {error && <div className="form-error">{error}</div>}
          <label>Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <label>Access token</label>
          <input
            type="password"
            required
            value={accessTokenInput}
            onChange={(e) => setAccessTokenInput(e.target.value)}
            autoComplete="off"
            placeholder="Platform admin access token"
          />
          <div className="field-hint">
            Tokens are issued manually to platform operators. They are stored locally in this browser.
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  // ----- Dashboard -----
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-brand-block">
            <img src="/app-icon.jpg" alt="Ledgerly" className="app-logo" />
            <div className="app-brand-text">
              <div className="app-brand">Ledgerly · Platform</div>
              <div className="app-subbrand">{email || "operator"}</div>
            </div>
          </div>
          <div className="app-header-actions">
            <button className="btn-ghost-dark" onClick={refresh} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button className="btn-ghost-dark" onClick={logout}>Log out</button>
          </div>
        </div>
      </header>
      <main className="app-main">
        {error && <div className="form-error">{error}</div>}
        {loading && !overview && <div className="page-loading">Loading platform data…</div>}

        {overview && (
          <>
            <div className="stat-grid">
              <StatCard label="Total schools" value={overview.summary.totalSchools} />
              <StatCard label="Active (7d)" value={overview.summary.activeSchools} accent="#1B7A43" />
              <StatCard label="Total students" value={overview.summary.totalStudents} />
              <StatCard label="Total payments" value={overview.summary.totalPayments} />
            </div>
            <div className="stat-grid stat-grid-3" style={{ marginBottom: 18 }}>
              <StatCard label="Total collected (all schools)" value={naira(overview.summary.totalCollected)} accent="#14213D" />
              <StatCard label="Avg per school" value={naira(
                overview.summary.totalSchools > 0
                  ? Math.round(overview.summary.totalCollected / overview.summary.totalSchools)
                  : 0
              )} />
              <StatCard
                label="Avg payments / school"
                value={overview.summary.totalSchools > 0
                  ? Math.round(overview.summary.totalPayments / overview.summary.totalSchools)
                  : 0}
              />
            </div>

            <div className="card" style={{ marginBottom: 18 }}>
              <div className="card-title">Tenant list ({overview.tenants.length})</div>
              {overview.tenants.length === 0 ? (
                <div className="empty-state">No tenants registered.</div>
              ) : (
                <table className="fee-table">
                  <thead>
                    <tr>
                      <th>School</th>
                      <th className="num">Students</th>
                      <th className="num">Payments</th>
                      <th className="num">Total collected</th>
                      <th>Last active</th>
                      <th>Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.tenants.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <div style={{ fontWeight: 700, color: "#14213D" }}>{t.name}</div>
                          <div style={{ fontSize: 12, color: "#5B5B54" }}>{t.phone || "—"}</div>
                        </td>
                        <td className="num">{t.student_count}</td>
                        <td className="num">{t.payment_count}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{naira(t.total_collected)}</td>
                        <td>{formatRelative(t.last_active)}</td>
                        <td>
                          <span title={t.health}>{HEALTH_DOT[t.health] || "⚪"} {t.health}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {health && (
          <div className="card">
            <div className="card-title">Platform health</div>
            <div className="finance-row">
              <span>Database size</span>
              <span>{formatBytes(health.database?.size)}</span>
            </div>
            <div className="finance-row">
              <span>Connections (total / active)</span>
              <span>{health.connections?.total ?? 0} / {health.connections?.active ?? 0}</span>
            </div>
            <div className="finance-row">
              <span>Connection pool max</span>
              <span>{health.pool?.max ?? "—"}</span>
            </div>

            {health.database?.tables?.length > 0 && (
              <>
                <div className="divider" />
                <div style={{ fontWeight: 700, color: "#14213D", marginBottom: 8 }}>Largest tables</div>
                <table className="fee-table">
                  <thead>
                    <tr>
                      <th>Table</th>
                      <th className="num">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.database.tables.map((t) => (
                      <tr key={t.name}>
                        <td><code>{t.name}</code></td>
                        <td className="num">{formatBytes(t.size)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
