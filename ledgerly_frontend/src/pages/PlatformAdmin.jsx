import { useEffect, useState, useMemo, useCallback } from "react";
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
//
// v2 dashboard — 8 tabs:
//   1. Overview     — tenant table with search + health filter + actions
//   2. Revenue      — MRR / ARPU / plan breakdown / subscription table
//   3. Errors       — recent error audit log, colour-coded by severity
//   4. Usage        — daily API calls bar chart + rate-limit table
//   5. Broadcasts   — create / list / delete platform-wide messages
//   6. Feature Flags — per-tenant feature toggles
//   7. Database     — DB size, table sizes, connection stats
//   8. NPS Feedback — average score + recent feedback list
//
// Tabs 2–6 and 8 call platform endpoints that may not exist yet on the
// backend. Each tab degrades gracefully (shows an inline error + empty state)
// so the dashboard never crashes if an endpoint 404s.

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api/v1";
const TOKEN_KEY = "platform_admin_token";
const EMAIL_KEY = "platform_admin_email";

const HEALTH_DOT = { green: "🟢", yellow: "🟡", red: "🔴" };
const HEALTH_COLOR = { green: "#1B7A43", yellow: "#C77D22", red: "#B3261E" };

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "revenue", label: "Revenue" },
  { id: "errors", label: "Errors & Activity" },
  { id: "usage", label: "Usage" },
  { id: "broadcasts", label: "Broadcasts" },
  { id: "features", label: "Feature Flags" },
  { id: "database", label: "Database" },
  { id: "nps", label: "NPS Feedback" },
];

// ----- Fetch helpers -----

async function platformFetch(path, token, options = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body: options.body
      ? typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body)
      : undefined,
  });
  let payload = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try { payload = await res.json(); } catch { /* ignore */ }
  }
  if (!res.ok) {
    const err = new Error(payload?.error || "Platform request failed");
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function platformDownload(path, token, filename) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let msg = "Export failed";
    try { const j = await res.json(); msg = j.error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ----- Formatters -----

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
  if (Number.isNaN(then)) return "never";
  const now = Date.now();
  const diff = now - then;
  const day = 24 * 60 * 60 * 1000;
  if (diff < 0) return "just now";
  if (diff < 60 * 1000) return "just now";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < day) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ----- Small reusable bits -----

function StatCard({ label, value, accent, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#6B6E72", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div className="detail-tabs" style={{ overflowX: "auto", flexWrap: "nowrap", marginBottom: 18 }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          className={`tab-btn ${active === t.id ? "active" : ""}`}
          onClick={() => onChange(t.id)}
          style={{ whiteSpace: "nowrap" }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function TabError({ message }) {
  if (!message) return null;
  return <div className="form-error" style={{ marginTop: 0, marginBottom: 14 }}>{message}</div>;
}

function InlineLoading({ label = "Loading…" }) {
  return <div className="page-loading" style={{ padding: "30px 0" }}>{label}</div>;
}

// Generic hook: fetch a single platform endpoint on mount.
function usePlatformGet(token, path, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const payload = await platformFetch(path, token);
      setData(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, path]);
  useEffect(() => { load(); }, [load, ...deps]);
  return { data, loading, error, reload: load, setData };
}

// =====================================================================
//  Tab 1 — Overview
// =====================================================================

function OverviewTab({ token, overview, health, loading, onRefresh, onImpersonate }) {
  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState("all");
  const [busyId, setBusyId] = useState(null);
  const [tabError, setTabError] = useState("");
  const [notesFor, setNotesFor] = useState(null);
  const [notesText, setNotesText] = useState("");

  const filtered = useMemo(() => {
    if (!overview?.tenants) return [];
    return overview.tenants.filter((t) => {
      const matchesSearch = !search || (t.name || "").toLowerCase().includes(search.toLowerCase());
      const matchesHealth = healthFilter === "all" || t.health === healthFilter;
      return matchesSearch && matchesHealth;
    });
  }, [overview, search, healthFilter]);

  const exportCsv = async () => {
    setTabError("");
    try {
      await platformDownload("/platform/tenants/export", token, "ledgerly-tenants.csv");
    } catch (err) {
      setTabError(err.message);
    }
  };

  const toggleSuspend = async (t) => {
    setBusyId(t.id); setTabError("");
    try {
      const path = t.suspended
        ? `/platform/tenants/${t.id}/unsuspend`
        : `/platform/tenants/${t.id}/suspend`;
      await platformFetch(path, token, { method: "POST" });
      onRefresh();
    } catch (err) {
      setTabError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const openNotes = (t) => {
    setNotesFor(t);
    setNotesText(t.notes || "");
  };

  const saveNotes = async () => {
    if (!notesFor) return;
    setBusyId(notesFor.id); setTabError("");
    try {
      await platformFetch(`/platform/tenants/${notesFor.id}/notes`, token, {
        method: "PUT",
        body: { notes: notesText },
      });
      setNotesFor(null);
      onRefresh();
    } catch (err) {
      setTabError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading && !overview) return <InlineLoading label="Loading platform data…" />;

  return (
    <>
      <TabError message={tabError} />

      {overview && (
        <>
          <div className="stat-grid">
            <StatCard label="Total schools" value={overview.summary.totalSchools} />
            <StatCard label="Active (7d)" value={overview.summary.activeSchools} accent="#1B7A43" />
            <StatCard label="Total students" value={overview.summary.totalStudents} />
            <StatCard label="Total payments" value={overview.summary.totalPayments} />
          </div>
          <div className="stat-grid" style={{ marginBottom: 18 }}>
            <StatCard label="Total collected" value={naira(overview.summary.totalCollected)} accent="#14213D" />
            <StatCard
              label="Avg per school"
              value={naira(
                overview.summary.totalSchools > 0
                  ? Math.round(overview.summary.totalCollected / overview.summary.totalSchools)
                  : 0
              )}
            />
            <StatCard
              label="Avg payments / school"
              value={
                overview.summary.totalSchools > 0
                  ? Math.round(overview.summary.totalPayments / overview.summary.totalSchools)
                  : 0
              }
            />
            <StatCard label="Db size" value={formatBytes(health?.database?.size)} />
          </div>

          <div className="card">
            <div className="toolbar" style={{ marginBottom: 14 }}>
              <div className="card-title" style={{ margin: 0 }}>Tenant list ({filtered.length})</div>
              <div className="toolbar-actions">
                <input
                  id="admin-tenant-search"
                  name="tenantSearch"
                  className="search-input"
                  type="search"
                  placeholder="Search by school name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ width: 220 }}
                  autoComplete="off"
                />
                <select
                  id="admin-tenant-health-filter"
                  name="healthFilter"
                  value={healthFilter}
                  onChange={(e) => setHealthFilter(e.target.value)}
                  style={{ padding: "8px 12px" }}
                  aria-label="Filter tenants by health"
                >
                  <option value="all">All health</option>
                  <option value="green">🟢 Green</option>
                  <option value="yellow">🟡 Yellow</option>
                  <option value="red">🔴 Red</option>
                </select>
                <button className="btn-ghost" onClick={exportCsv}>Export CSV</button>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="empty-state">No tenants match the current filter.</div>
            ) : (
              <div className="table-wrapper">
              <table className="fee-table">
                <thead>
                  <tr>
                    <th>School</th>
                    <th className="num">Students</th>
                    <th className="num">Payments</th>
                    <th className="num">Collected</th>
                    <th>Last active</th>
                    <th>Health</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} style={t.suspended ? { opacity: 0.55 } : undefined}>
                      <td>
                        <div style={{ fontWeight: 700, color: "#14213D" }}>
                          {t.name}
                          {t.suspended && (
                            <span className="badge" style={{ marginLeft: 8, background: "#FBEAE9", color: "#B3261E" }}>
                              suspended
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "#5B5B54" }}>{t.phone || "—"}</div>
                      </td>
                      <td className="num">{t.student_count}</td>
                      <td className="num">{t.payment_count}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{naira(t.total_collected)}</td>
                      <td>{formatRelative(t.last_active)}</td>
                      <td>
                        <span title={t.health} style={{ color: HEALTH_COLOR[t.health] || "#5B5B54", fontWeight: 700 }}>
                          {HEALTH_DOT[t.health] || "⚪"} {t.health}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button className="link-btn" onClick={() => onImpersonate(t)}>Login as</button>
                          {t.suspended ? (
                            <button className="link-btn" disabled={busyId === t.id}
                              onClick={() => toggleSuspend(t)} style={{ color: "#1B7A43" }}>
                              {busyId === t.id ? "…" : "Unsuspend"}
                            </button>
                          ) : (
                            <button className="link-btn" disabled={busyId === t.id}
                              onClick={() => toggleSuspend(t)} style={{ color: "#B3261E" }}>
                              {busyId === t.id ? "…" : "Suspend"}
                            </button>
                          )}
                          <button className="link-btn" onClick={() => openNotes(t)}>Notes</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </>
      )}

      {notesFor && (
        <div className="modal-overlay" onClick={() => setNotesFor(null)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Notes — {notesFor.name}</div>
              <button className="modal-close" onClick={() => setNotesFor(null)}>✕</button>
            </div>
            <p className="field-hint" style={{ marginTop: 0 }}>
              Internal notes about this tenant — visible only to platform admins.
            </p>
            <textarea
              id="admin-tenant-notes"
              name="notes"
              rows={6}
              value={notesText}
              onChange={(e) => setNotesText(e.target.value)}
              placeholder="Add context, contacts, billing notes…"
            />
            <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button className="btn-ghost" onClick={() => setNotesFor(null)}>Cancel</button>
              <button className="btn-primary" disabled={busyId === notesFor.id} onClick={saveNotes}>
                {busyId === notesFor.id ? "Saving…" : "Save notes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// =====================================================================
//  Tab 2 — Revenue
// =====================================================================

const PLAN_COLORS = {
  free: "#8A8A82",
  starter: "#1B7A43",
  standard: "#14213D",
  premium: "#C77D22",
  enterprise: "#6B6E72",
};

function RevenueTab({ token }) {
  const { data, loading, error, reload } = usePlatformGet(token, "/platform/revenue");
  if (loading) return <InlineLoading />;
  if (error) return <TabError message={error} />;
  if (!data) return <div className="empty-state">No revenue data.</div>;

  const plans = data.planBreakdown || data.plans || [];
  const subscriptions = data.subscriptions || [];
  const maxPlan = Math.max(1, ...plans.map((p) => p.count || 0));

  return (
    <>
      <div className="stat-grid">
        <StatCard label="MRR" value={naira(data.mrr)} accent="#14213D" />
        <StatCard label="ARPU" value={naira(data.arpu)} />
        <StatCard label="Active subscriptions" value={data.activeSubscriptions ?? 0} accent="#1B7A43" />
        <StatCard label="Churned (30d)" value={data.churnedCount ?? 0} accent="#B3261E" />
      </div>

      <div className="card">
        <div className="card-title">Plan breakdown</div>
        {plans.length === 0 ? (
          <div className="empty-state">No subscription plans tracked yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {plans.map((p) => {
              const pct = ((p.count || 0) / maxPlan) * 100;
              const color = PLAN_COLORS[p.plan] || "#14213D";
              return (
                <div key={p.plan}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, color: "#14213D", textTransform: "capitalize" }}>{p.plan}</span>
                    <span style={{ color: "#6B6E72", fontWeight: 600 }}>
                      {p.count} {p.amount ? `· ${naira(p.amount)}` : ""}
                    </span>
                  </div>
                  <div style={{ background: "#E4E3DD", borderRadius: 999, height: 10, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 999 }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Subscriptions ({subscriptions.length})</div>
        {subscriptions.length === 0 ? (
          <div className="empty-state">No subscriptions yet.</div>
        ) : (
          <div className="table-wrapper">
          <table className="fee-table">
            <thead>
              <tr>
                <th>School</th>
                <th>Plan</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>Billing cycle</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((s, idx) => (
                <tr key={s.id || idx}>
                  <td style={{ fontWeight: 700, color: "#14213D" }}>{s.tenantName || s.school || "—"}</td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        background: (PLAN_COLORS[s.plan] || "#14213D") + "22",
                        color: PLAN_COLORS[s.plan] || "#14213D",
                        textTransform: "capitalize",
                      }}
                    >
                      {s.plan}
                    </span>
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>{naira(s.amount)}</td>
                  <td>
                    <span style={{ color: s.status === "active" ? "#1B7A43" : "#B3261E", fontWeight: 700 }}>
                      {s.status || "—"}
                    </span>
                  </td>
                  <td style={{ textTransform: "capitalize" }}>{s.billingCycle || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn-ghost" onClick={reload}>Refresh</button>
      </div>
    </>
  );
}

// =====================================================================
//  Tab 3 — Errors & Activity
// =====================================================================

const ERROR_RED_ACTIONS = new Set(["delete", "login_failed", "suspend", "revoke", "expire"]);

function ErrorsTab({ token }) {
  const { data, loading, error, reload } = usePlatformGet(token, "/platform/errors");
  if (loading) return <InlineLoading />;
  if (error) return <TabError message={error} />;

  const rows = Array.isArray(data) ? data : data?.errors || data?.items || [];
  return (
    <>
      <div className="card">
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <div className="card-title" style={{ margin: 0 }}>Recent errors ({rows.length})</div>
          <button className="btn-ghost" onClick={reload}>Refresh</button>
        </div>
        <p className="field-hint" style={{ marginTop: 0, marginBottom: 12 }}>
          Red rows are destructive or auth-failure events (delete, login_failed, suspend, revoke).
          Amber rows are other tracked actions.
        </p>
        {rows.length === 0 ? (
          <div className="empty-state">No recent errors logged.</div>
        ) : (
          <div className="table-wrapper">
          <table className="fee-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Entity type</th>
                <th>Actor</th>
                <th>IP</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const isRed = ERROR_RED_ACTIONS.has((r.action || "").toLowerCase());
                const color = isRed ? "#B3261E" : "#C77D22";
                const bg = isRed ? "#FBEAE9" : "#FBF0E2";
                return (
                  <tr key={r.id || idx} style={{ background: bg }}>
                    <td style={{ fontWeight: 700, color }}>{r.action || "—"}</td>
                    <td><code>{r.entityType || r.entity_type || "—"}</code></td>
                    <td>{r.actor || r.actorEmail || "—"}</td>
                    <td><code>{r.ip || "—"}</code></td>
                    <td style={{ fontSize: 13 }}>{formatDate(r.createdAt || r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </>
  );
}

// =====================================================================
//  Tab 4 — Usage
// =====================================================================

function UsageTab({ token }) {
  const { data, loading, error, reload } = usePlatformGet(token, "/platform/usage");
  if (loading) return <InlineLoading />;
  if (error) return <TabError message={error} />;
  if (!data) return <div className="empty-state">No usage data.</div>;

  const dailyCalls = data.dailyCalls || data.daily_calls || [];
  const rateLimits = data.rateLimits || data.rate_limits || [];
  const maxCount = Math.max(1, ...dailyCalls.map((d) => d.count || 0));

  return (
    <>
      <div className="stat-grid">
        <StatCard label="Daily active users" value={data.dailyActiveUsers ?? data.daily_active_users ?? 0} accent="#1B7A43" />
        <StatCard label="API calls (24h)" value={dailyCalls.length > 0 ? dailyCalls[dailyCalls.length - 1].count : 0} />
        <StatCard label="Rate-limited tenants" value={rateLimits.length} />
        <StatCard label="Window" value="last 30 days" />
      </div>

      <div className="card">
        <div className="card-title">Daily API calls (last 30 days)</div>
        {dailyCalls.length === 0 ? (
          <div className="empty-state">No API call data yet.</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 140, marginTop: 12 }}>
              {dailyCalls.map((d, idx) => {
                const pct = ((d.count || 0) / maxCount) * 100;
                const date = d.date || d.day;
                return (
                  <div
                    key={idx}
                    title={`${date}: ${(d.count || 0).toLocaleString()} calls`}
                    style={{
                      flex: 1,
                      minWidth: 4,
                      height: `${Math.max(2, pct)}%`,
                      background: "#14213D",
                      borderRadius: "2px 2px 0 0",
                    }}
                  />
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6B6E72", marginTop: 6 }}>
              <span>{dailyCalls[0]?.date || dailyCalls[0]?.day || ""}</span>
              <span>{dailyCalls[dailyCalls.length - 1]?.date || dailyCalls[dailyCalls.length - 1]?.day || ""}</span>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-title">Rate limit stats (24h)</div>
        {rateLimits.length === 0 ? (
          <div className="empty-state">No rate-limit data yet.</div>
        ) : (
          <div className="table-wrapper">
          <table className="fee-table">
            <thead>
              <tr>
                <th>Tenant</th>
                <th className="num">Request count</th>
                <th className="num">Avg response time</th>
              </tr>
            </thead>
            <tbody>
              {rateLimits.map((r, idx) => (
                <tr key={r.tenantId || idx}>
                  <td style={{ fontWeight: 700, color: "#14213D" }}>{r.tenantName || r.tenant_name || "—"}</td>
                  <td className="num">{(r.requestCount || r.request_count || 0).toLocaleString()}</td>
                  <td className="num">{r.avgResponseTime || r.avg_response_time ? `${Math.round(r.avgResponseTime || r.avg_response_time)} ms` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn-ghost" onClick={reload}>Refresh</button>
      </div>
    </>
  );
}

// =====================================================================
//  Tab 5 — Broadcasts
// =====================================================================

const BROADCAST_LEVELS = [
  { value: "info", label: "Info", color: "#14213D", bg: "#F0F4FA" },
  { value: "warning", label: "Warning", color: "#C77D22", bg: "#FBF0E2" },
  { value: "success", label: "Success", color: "#1B7A43", bg: "#E7F4EC" },
];

function levelMeta(v) {
  return BROADCAST_LEVELS.find((l) => l.value === v) || BROADCAST_LEVELS[0];
}

function BroadcastsTab({ token, tenants }) {
  const { data, loading, error, reload, setData } = usePlatformGet(token, "/platform/broadcasts");
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState("info");
  const [tenantId, setTenantId] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [busyId, setBusyId] = useState(null);

  if (loading) return <InlineLoading />;

  const list = Array.isArray(data) ? data : data?.broadcasts || data?.items || [];

  const submit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!message.trim()) { setFormError("Message is required."); return; }
    setSaving(true);
    try {
      const created = await platformFetch("/platform/broadcasts", token, {
        method: "POST",
        body: {
          message: message.trim(),
          level,
          ...(tenantId ? { tenantId } : {}),
        },
      });
      // Optimistic prepend
      if (created) {
        setData((prev) => {
          const arr = Array.isArray(prev) ? prev : (prev?.broadcasts || prev?.items || []);
          return [created, ...arr];
        });
      } else {
        reload();
      }
      setMessage("");
      setTenantId("");
      setLevel("info");
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (b) => {
    setBusyId(b.id); setFormError("");
    try {
      await platformFetch(`/platform/broadcasts/${b.id}`, token, { method: "DELETE" });
      setData((prev) => {
        const arr = Array.isArray(prev) ? prev : (prev?.broadcasts || prev?.items || []);
        return arr.filter((x) => x.id !== b.id);
      });
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <TabError message={error || formError} />

      <div className="card">
        <div className="card-title">New broadcast</div>
        <form onSubmit={submit}>
          <label htmlFor="broadcast-message">Message</label>
          <textarea
            id="broadcast-message"
            name="message"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Broadcast message — shown to all tenant dashboards…"
            maxLength={500}
          />
          <div className="field-hint">{message.length}/500 characters</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
            <div>
              <label htmlFor="broadcast-level">Level</label>
              <select id="broadcast-level" name="level" value={level} onChange={(e) => setLevel(e.target.value)}>
                {BROADCAST_LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="broadcast-tenant">Tenant (optional — leave empty for all)</label>
              <select id="broadcast-tenant" name="tenantId" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
                <option value="">All tenants</option>
                {(tenants || []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Sending…" : "Send broadcast"}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <div className="card-title" style={{ margin: 0 }}>Active broadcasts ({list.length})</div>
          <button className="btn-ghost" onClick={reload}>Refresh</button>
        </div>
        {list.length === 0 ? (
          <div className="empty-state">No active broadcasts.</div>
        ) : (
          <div className="list">
            {list.map((b) => {
              const meta = levelMeta(b.level);
              return (
                <div className="list-item" key={b.id}>
                  <div className="list-item-row" style={{ cursor: "default" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span className="badge" style={{ background: meta.bg, color: meta.color }}>
                          {meta.label}
                        </span>
                        <span className="list-item-sub">
                          {b.tenantName ? `→ ${b.tenantName}` : "→ all tenants"} · {formatRelative(b.createdAt || b.created_at)}
                        </span>
                      </div>
                      <div className="list-item-title" style={{ whiteSpace: "pre-wrap" }}>{b.message}</div>
                    </div>
                    <button
                      className="btn-danger-ghost"
                      disabled={busyId === b.id}
                      onClick={() => remove(b)}
                      style={{ padding: "6px 12px", fontSize: 13 }}
                    >
                      {busyId === b.id ? "Removing…" : "Delete"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// =====================================================================
//  Tab 6 — Feature Flags
// =====================================================================

function FeatureFlagsTab({ token, tenants }) {
  const { data, loading, error, reload, setData } = usePlatformGet(token, "/platform/feature-flags");
  const [tenantId, setTenantId] = useState("");
  const [feature, setFeature] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [busyId, setBusyId] = useState(null);

  if (loading) return <InlineLoading />;

  const list = Array.isArray(data) ? data : data?.flags || data?.items || [];

  const submit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!tenantId) { setFormError("Select a tenant."); return; }
    if (!feature.trim()) { setFormError("Feature name is required."); return; }
    setSaving(true);
    try {
      const created = await platformFetch("/platform/feature-flags", token, {
        method: "POST",
        body: { tenantId, feature: feature.trim(), enabled },
      });
      if (created) {
        setData((prev) => {
          const arr = Array.isArray(prev) ? prev : (prev?.flags || prev?.items || []);
          return [created, ...arr];
        });
      } else {
        reload();
      }
      setFeature("");
      setEnabled(false);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (f) => {
    setBusyId(f.id); setFormError("");
    try {
      const updated = await platformFetch(`/platform/feature-flags/${f.id}`, token, {
        method: "PUT",
        body: { enabled: !f.enabled },
      });
      setData((prev) => {
        const arr = Array.isArray(prev) ? prev : (prev?.flags || prev?.items || []);
        return arr.map((x) => (x.id === f.id ? (updated || { ...x, enabled: !x.enabled }) : x));
      });
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <TabError message={error || formError} />

      <div className="card">
        <div className="card-title">Add feature flag</div>
        <form onSubmit={submit}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label htmlFor="feature-flag-tenant">Tenant</label>
              <select id="feature-flag-tenant" name="tenantId" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
                <option value="">Select tenant…</option>
                {(tenants || []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="feature-flag-name">Feature name</label>
              <input
                id="feature-flag-name"
                name="feature"
                type="text"
                value={feature}
                onChange={(e) => setFeature(e.target.value)}
                placeholder="e.g. sms_reminders, bulk_import…"
                autoComplete="off"
              />
            </div>
          </div>
          <label className="checkbox-row">
            <input id="feature-flag-enabled" name="enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enabled
          </label>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Adding…" : "Add flag"}
          </button>
        </form>
      </div>

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <div className="card-title" style={{ margin: 0 }}>Feature flags ({list.length})</div>
          <button className="btn-ghost" onClick={reload}>Refresh</button>
        </div>
        {list.length === 0 ? (
          <div className="empty-state">No feature flags configured.</div>
        ) : (
          <div className="table-wrapper">
          <table className="fee-table">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Feature</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {list.map((f) => (
                <tr key={f.id}>
                  <td style={{ fontWeight: 700, color: "#14213D" }}>{f.tenantName || f.tenant_name || "—"}</td>
                  <td><code>{f.feature}</code></td>
                  <td>
                    <button
                      className="link-btn"
                      disabled={busyId === f.id}
                      onClick={() => toggle(f)}
                      style={{ color: f.enabled ? "#1B7A43" : "#8A8A82" }}
                    >
                      {busyId === f.id ? "…" : f.enabled ? "✅ Enabled" : "⚪ Disabled"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </>
  );
}

// =====================================================================
//  Tab 7 — Database
// =====================================================================

function DatabaseTab({ token, health, loading, onRefresh }) {
  if (loading && !health) return <InlineLoading />;
  if (!health) return <div className="empty-state">No database stats available.</div>;

  const tables = health.database?.tables || [];
  const conn = health.connections || {};
  const pool = health.pool || {};

  return (
    <>
      <div className="stat-grid">
        <StatCard label="DB size" value={formatBytes(health.database?.size)} accent="#14213D" />
        <StatCard label="Connections (total)" value={conn.total ?? 0} />
        <StatCard label="Active connections" value={conn.active ?? 0} accent="#1B7A43" />
        <StatCard label="Pool max" value={pool.max ?? "—"} />
      </div>

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <div className="card-title" style={{ margin: 0 }}>Largest tables ({tables.length})</div>
          <button className="btn-ghost" onClick={onRefresh}>Refresh</button>
        </div>
        {tables.length === 0 ? (
          <div className="empty-state">No table size data.</div>
        ) : (
          <div className="table-wrapper">
          <table className="fee-table">
            <thead>
              <tr>
                <th>Table</th>
                <th className="num">Size</th>
                <th>Formatted</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.name}>
                  <td><code>{t.name}</code></td>
                  <td className="num" style={{ color: "#6B6E72" }}>{Number(t.size).toLocaleString()} B</td>
                  <td style={{ fontWeight: 700 }}>{formatBytes(t.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Connection stats</div>
        <div className="finance-row"><span>Total connections</span><span>{conn.total ?? 0}</span></div>
        <div className="finance-row"><span>Active connections</span><span>{conn.active ?? 0}</span></div>
        <div className="finance-row"><span>Idle connections</span><span>{Math.max(0, (conn.total ?? 0) - (conn.active ?? 0))}</span></div>
        <div className="finance-row"><span>Pool max</span><span>{pool.max ?? "—"}</span></div>
      </div>
    </>
  );
}

// =====================================================================
//  Tab 8 — NPS Feedback
// =====================================================================

function npsColor(score) {
  if (score >= 9) return "#1B7A43"; // promoter
  if (score >= 7) return "#C77D22"; // passive
  return "#B3261E"; // detractor
}

function npsLabel(score) {
  if (score >= 9) return "Promoter";
  if (score >= 7) return "Passive";
  return "Detractor";
}

function NpsTab({ token }) {
  const { data, loading, error, reload } = usePlatformGet(token, "/platform/nps");
  if (loading) return <InlineLoading />;
  if (error) return <TabError message={error} />;
  if (!data) return <div className="empty-state">No NPS data.</div>;

  const feedback = Array.isArray(data) ? data : data?.feedback || data?.items || [];
  const avg = data.averageScore ?? data.average_score ?? null;
  const count = data.count ?? feedback.length;

  return (
    <>
      <div className="stat-grid">
        <StatCard
          label="Average NPS score"
          value={avg !== null ? Number(avg).toFixed(1) : "—"}
          accent={avg !== null ? npsColor(avg) : undefined}
          sub={avg !== null ? npsLabel(avg) : undefined}
        />
        <StatCard label="Responses" value={count} />
        <StatCard
          label="Promoters (9-10)"
          value={feedback.filter((f) => (f.score ?? 0) >= 9).length}
          accent="#1B7A43"
        />
        <StatCard
          label="Detractors (0-6)"
          value={feedback.filter((f) => (f.score ?? 0) <= 6).length}
          accent="#B3261E"
        />
      </div>

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <div className="card-title" style={{ margin: 0 }}>Recent feedback ({feedback.length})</div>
          <button className="btn-ghost" onClick={reload}>Refresh</button>
        </div>
        {feedback.length === 0 ? (
          <div className="empty-state">No NPS feedback collected yet.</div>
        ) : (
          <div className="table-wrapper">
          <table className="fee-table">
            <thead>
              <tr>
                <th>School</th>
                <th className="num">Score</th>
                <th>Comment</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {feedback.map((f, idx) => {
                const score = f.score ?? 0;
                const color = npsColor(score);
                return (
                  <tr key={f.id || idx}>
                    <td style={{ fontWeight: 700, color: "#14213D" }}>{f.tenantName || f.tenant_name || "—"}</td>
                    <td className="num">
                      <span
                        className="badge"
                        style={{ background: color + "22", color, fontSize: 13 }}
                        title={npsLabel(score)}
                      >
                        {score}/10
                      </span>
                    </td>
                    <td style={{ maxWidth: 360, color: "#5B5B54" }}>{f.comment || "—"}</td>
                    <td style={{ fontSize: 13 }}>{formatDate(f.createdAt || f.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </>
  );
}

// =====================================================================
//  Main component
// =====================================================================

export default function PlatformAdmin() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [email, setEmail] = useState(() => localStorage.getItem(EMAIL_KEY) || "");
  const [emailInput, setEmailInput] = useState(() => localStorage.getItem(EMAIL_KEY) || "");
  const [accessTokenInput, setAccessTokenInput] = useState("");
  const [authed, setAuthed] = useState(() => !!localStorage.getItem(TOKEN_KEY));
  const [overview, setOverview] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [impersonateMsg, setImpersonateMsg] = useState("");

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    setToken("");
    setEmail("");
    setAuthed(false);
    setOverview(null);
    setHealth(null);
  };

  const loadDashboard = useCallback(async (tk) => {
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
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(EMAIL_KEY);
        setToken("");
        setEmail("");
        setAuthed(false);
        setError("Token is no longer valid. Please sign in again.");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed && token) loadDashboard(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e) => {
    e.preventDefault();
    setError("");
    if (!emailInput || !accessTokenInput) {
      setError("Email and access token are both required.");
      return;
    }
    localStorage.setItem(TOKEN_KEY, accessTokenInput);
    localStorage.setItem(EMAIL_KEY, emailInput);
    setToken(accessTokenInput);
    setEmail(emailInput);
    setAuthed(true);
    loadDashboard(accessTokenInput);
  };

  const refresh = () => loadDashboard(token);

  // ----- Impersonation -----
  // POST /platform/impersonate/:tenantId → { accessToken, user }
  // Open the tenant app in a new tab with the impersonation token in the URL
  // (per spec — don't modify AuthContext). For the flow to be seamless
  // end-to-end, AuthContext's session-restore useEffect would need to check
  // for `?impersonated=<token>` and call setAccessToken(token) + setUser(user)
  // instead of going through /auth/refresh. That change is intentionally out
  // of scope here.
  const impersonate = async (t) => {
    setError(""); setImpersonateMsg("");
    try {
      const data = await platformFetch(`/platform/impersonate/${t.id}`, token, { method: "POST" });
      if (!data?.accessToken) {
        throw new Error("Impersonation response missing access token");
      }
      const newTab = window.open(`/?impersonated=${encodeURIComponent(data.accessToken)}`, "_blank");
      if (!newTab) {
        setImpersonateMsg(
          `Popup blocked — copy this URL and open it manually: /?impersonated=${encodeURIComponent(data.accessToken)}`
        );
      } else {
        setImpersonateMsg(`Opened ${t.name} dashboard in a new tab.`);
      }
    } catch (err) {
      setError(err.message);
    }
  };

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
          <label htmlFor="platform-admin-email">Email</label>
          <input
            id="platform-admin-email"
            name="email"
            type="email"
            required
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            autoComplete="email"
          />
          <label htmlFor="platform-admin-token">Access token</label>
          <input
            id="platform-admin-token"
            name="accessToken"
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
          <button type="submit" className="btn-primary btn-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  // ----- Dashboard -----
  const tenants = overview?.tenants || [];

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
        {impersonateMsg && (
          <div className="form-error" style={{ background: "#E7F4EC", color: "#1B7A43", borderColor: "#C5DECF" }}>
            {impersonateMsg}
          </div>
        )}

        <TabBar tabs={TABS} active={activeTab} onChange={setActiveTab} />

        {activeTab === "overview" && (
          <OverviewTab
            token={token}
            overview={overview}
            health={health}
            loading={loading}
            onRefresh={refresh}
            onImpersonate={impersonate}
          />
        )}
        {activeTab === "revenue" && <RevenueTab token={token} />}
        {activeTab === "errors" && <ErrorsTab token={token} />}
        {activeTab === "usage" && <UsageTab token={token} />}
        {activeTab === "broadcasts" && <BroadcastsTab token={token} tenants={tenants} />}
        {activeTab === "features" && <FeatureFlagsTab token={token} tenants={tenants} />}
        {activeTab === "database" && (
          <DatabaseTab token={token} health={health} loading={loading} onRefresh={refresh} />
        )}
        {activeTab === "nps" && <NpsTab token={token} />}
      </main>
    </div>
  );
}
