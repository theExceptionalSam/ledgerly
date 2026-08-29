import { useEffect, useState, useCallback } from "react";
import QRCode from "qrcode";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

// Security center — owner-only page at /security.
//
// Three sections (not tabs — all rendered on one scrollable page so the owner can
// audit everything at a glance):
//   1. Two-factor authentication (TOTP via otplib on the backend)
//   2. Active sessions (refresh-token rows for this user)
//   3. API keys (programmatic access — raw key shown ONCE at creation)
//
// Backend endpoints (see twofa.controller.js, authSessions.controller.js, apikeys.controller.js):
//   POST /auth/2fa/setup             → { secret, qrCodeUrl }
//   POST /auth/2fa/verify { token }  → { ok: true }
//   POST /auth/2fa/disable { token } → { ok: true }
//   GET  /auth/sessions              → { sessions: [...] }
//   DELETE /auth/sessions/:id        → { ok: true }
//   GET  /api-keys                   → { keys: [...] }   (masked)
//   POST /api-keys { name, permissions } → { id, key, name, permissions }   (raw key shown once)
//   DELETE /api-keys/:id             → { ok: true }

export default function Security() {
  const { user } = useAuth();
  return (
    <div>
      <div className="page-intro">
        Manage two-factor authentication, active sessions, and API keys for your school account.
        Only owners can access this page — every change is recorded in the audit log.
      </div>
      <TwoFASection />
      <SessionsSection />
      <ApiKeysSection />
      {!user || user.role !== "owner" ? (
        <div className="form-error" style={{ marginTop: 20 }}>
          You need owner permissions to use this page.
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------- 2FA ----------------------------- */

function TwoFASection() {
  const { user, setUser } = useAuth();
  // 2FA status comes from /auth/me (twofaEnabled boolean on the user object —
  // shipped by Task E-backend-p2). On a full page reload, AuthContext's /auth/me
  // call populates user.twofaEnabled before this component mounts (ProtectedRoute
  // gates on `initializing`), so the "Enabled"/"Disabled" badge is correct on
  // first paint without a separate API call. On in-app navigation right after
  // login (before any reload), the login/verifyOtp responses don't include
  // twofaEnabled, so we fall back to null (unknown) — the UI then shows the
  // "Enable 2FA" button plus the rotation hint below.
  const [status, setStatus] = useState(user?.twofaEnabled ?? null); // true = enabled, false = disabled, null = unknown
  const [setup, setSetup] = useState(null); // { secret, qrCodeUrl }
  const [qrDataUrl, setQrDataUrl] = useState(""); // data: URL rendered client-side by the bundled qrcode lib
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Generate the QR code client-side from the otpauth:// URL returned by the
  // backend, instead of handing the secret to a third-party QR-image API
  // (previously api.qrserver.com). Regenerates whenever setup.qrCodeUrl changes,
  // and clears the data URL when setup is dismissed (so a stale QR is never shown).
  useEffect(() => {
    if (!setup?.qrCodeUrl) { setQrDataUrl(""); return; }
    QRCode.toDataURL(setup.qrCodeUrl, {
      width: 200,
      margin: 2,
      color: { dark: "#14213D", light: "#FFFFFF" }, // navy ink on paper white — matches brand palette
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [setup?.qrCodeUrl]);

  const beginSetup = async () => {
    setError(""); setSuccess(""); setBusy(true);
    try {
      const data = await api.post("/auth/2fa/setup", {});
      setSetup(data);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const verify = async () => {
    setError(""); setBusy(true);
    try {
      await api.post("/auth/2fa/verify", { token: token.trim() });
      setSetup(null);
      setToken("");
      setSuccess("2FA is now enabled on your account.");
      setStatus(true);
      if (setUser && user) setUser({ ...user, twofaEnabled: true });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const disable = async () => {
    const code = prompt("Enter a current 6-digit code from your authenticator to disable 2FA:");
    if (!code) return;
    setError(""); setSuccess(""); setBusy(true);
    try {
      await api.post("/auth/2fa/disable", { token: code.trim() });
      setSuccess("2FA disabled.");
      setStatus(false);
      if (setUser && user) setUser({ ...user, twofaEnabled: false });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <div className="card-title">Two-factor authentication</div>
      {error && <div className="form-error">{error}</div>}
      {success && (
        <div className="form-error" style={{ background: "#E7F3EC", color: "#1B7A43", borderColor: "#C5E0CF" }}>
          {success}
        </div>
      )}
      {!setup && (
        <div>
          <p className="field-hint" style={{ marginTop: 0 }}>
            2FA adds a second step at sign-in: after your password, you'll enter a 6-digit code from
            an authenticator app (Google Authenticator, Authy, 1Password). Recommended for owners.
          </p>
          {status === true ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span className="badge" style={{ color: "#1B7A43", background: "#E7F4EC" }}>Enabled</span>
              <button className="btn-danger-ghost" disabled={busy} onClick={disable}>
                {busy ? "Disabling..." : "Disable 2FA"}
              </button>
            </div>
          ) : (
            <button className="btn-primary" disabled={busy} onClick={beginSetup}>
              {busy ? "Starting..." : "Enable 2FA"}
            </button>
          )}
          {status === null && (
            <div className="field-hint" style={{ marginTop: 8 }}>
              If 2FA is already enabled on your account, clicking "Enable 2FA" will rotate your secret.
              Contact support if you're unsure.
            </div>
          )}
        </div>
      )}
      {setup && (
        <div>
          <p className="field-hint" style={{ marginTop: 0 }}>
            Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
          </p>
          <div style={{ textAlign: "center", margin: "12px 0" }}>
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="2FA QR code"
                width={200}
                height={200}
                style={{ borderRadius: 8, border: "1px solid var(--line)" }}
              />
            ) : (
              <div
                style={{
                  width: 200,
                  height: 200,
                  background: "#EDECE6",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  color: "#5B5B54",
                  fontSize: 14,
                }}
              >
                Loading QR…
              </div>
            )}
            <div className="field-hint" style={{ wordBreak: "break-all", marginTop: 8 }}>
              Can't scan? Enter this secret manually: <code>{setup.secret}</code>
            </div>
          </div>
          <label>Enter the 6-digit code from your app</label>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            placeholder="123456"
            autoFocus
          />
          <div className="action-row">
            <button className="btn-primary" disabled={busy || token.length !== 6} onClick={verify}>
              {busy ? "Verifying..." : "Verify and enable"}
            </button>
            <button className="btn-ghost" onClick={() => { setSetup(null); setToken(""); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------- Active sessions ------------------------- */

function SessionsSection() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/auth/sessions")
      .then((d) => setSessions(d.sessions || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const revoke = async (id) => {
    if (!confirm("Revoke this session? The device will be signed out next time it tries to refresh.")) return;
    setRevoking(id); setError("");
    try {
      await api.del(`/auth/sessions/${id}`);
      load();
    } catch (e) { setError(e.message); } finally { setRevoking(null); }
  };

  const fmtDate = (iso) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }); }
    catch { return iso; }
  };
  const describeDevice = (ua) => {
    if (!ua) return "Unknown device";
    if (/iphone|ios/i.test(ua)) return "iPhone";
    if (/android/i.test(ua)) return "Android";
    if (/ipad/i.test(ua)) return "iPad";
    if (/mac/i.test(ua)) return "Mac";
    if (/windows/i.test(ua)) return "Windows PC";
    if (/linux/i.test(ua)) return "Linux";
    return ua.slice(0, 60);
  };

  return (
    <div className="card">
      <div className="card-title">Active sessions</div>
      <p className="field-hint" style={{ marginTop: 0 }}>
        These are the devices currently signed into your account. Revoke any you don't recognise.
      </p>
      {error && <div className="form-error">{error}</div>}
      {loading && <div className="page-loading">Loading…</div>}
      {!loading && sessions.length === 0 && (
        <div className="empty-state" style={{ padding: 16 }}>No active sessions.</div>
      )}
      {!loading && sessions.length > 0 && (
        <div className="table-wrapper">
        <table className="fee-table">
          <thead>
            <tr><th>Device</th><th>IP address</th><th>Signed in</th><th>Expires</th><th></th></tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{describeDevice(s.user_agent)}</td>
                <td>{s.ip_address || "—"}</td>
                <td>{fmtDate(s.created_at)}</td>
                <td>{fmtDate(s.expires_at)}</td>
                <td>
                  <button
                    className="btn-danger-ghost"
                    style={{ padding: "6px 12px", fontSize: 13 }}
                    disabled={revoking === s.id}
                    onClick={() => revoke(s.id)}
                  >
                    {revoking === s.id ? "Revoking..." : "Revoke"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

/* --------------------------- API keys --------------------------- */

function ApiKeysSection() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState(null); // { key, name } — shown ONCE

  const load = useCallback(() => {
    setLoading(true);
    api.get("/api-keys")
      .then((d) => setKeys(d.keys || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const revoke = async (id, name) => {
    if (!confirm(`Revoke API key "${name}"? Any integration using it will stop working immediately.`)) return;
    try {
      await api.del(`/api-keys/${id}`);
      load();
    } catch (e) { setError(e.message); }
  };

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("en-NG", { dateStyle: "medium" }) : "—";

  return (
    <div className="card">
      <div className="card-title">API keys</div>
      <p className="field-hint" style={{ marginTop: 0 }}>
        API keys let external systems read your Ledgerly data programmatically. The full key is shown
        <strong> only once</strong> at creation — store it somewhere safe. Lost keys must be revoked and re-issued.
      </p>
      {error && <div className="form-error">{error}</div>}

      {newKey && (
        <div className="form-error" style={{ background: "#E7F3EC", color: "#1B7A43", borderColor: "#C5E0CF" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>API key created — copy it now, you won't see it again:</div>
          <code style={{ display: "block", background: "#fff", padding: 8, borderRadius: 6, color: "#14213D", wordBreak: "break-all" }}>
            {newKey.key}
          </code>
          <button
            className="btn-ghost"
            style={{ marginTop: 8, color: "#1B7A43", borderColor: "#1B7A43" }}
            onClick={() => { navigator.clipboard?.writeText(newKey.key); }}
          >
            Copy to clipboard
          </button>
          <button className="link-btn" style={{ marginLeft: 10 }} onClick={() => setNewKey(null)}>Dismiss</button>
        </div>
      )}

      <div className="toolbar">
        <div></div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ Create key</button>
      </div>

      {loading && <div className="page-loading">Loading…</div>}
      {!loading && keys.length === 0 && (
        <div className="empty-state" style={{ padding: 16 }}>No API keys yet.</div>
      )}
      {!loading && keys.length > 0 && (
        <div className="table-wrapper">
        <table className="fee-table">
          <thead>
            <tr><th>Name</th><th>Key</th><th>Permissions</th><th>Last used</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} style={k.revokedAt ? { opacity: 0.5 } : undefined}>
                <td>{k.name}{k.revokedAt && <span className="badge" style={{ marginLeft: 6, color: "#B3261E", background: "#FBEAE9" }}>Revoked</span>}</td>
                <td><code>{k.masked}</code></td>
                <td>{k.permissions || "read"}</td>
                <td>{fmtDate(k.lastUsedAt)}</td>
                <td>{fmtDate(k.createdAt || k.created_at)}</td>
                <td>
                  {!k.revokedAt && (
                    <button
                      className="btn-danger-ghost"
                      style={{ padding: "6px 12px", fontSize: 13 }}
                      onClick={() => revoke(k.id, k.name)}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {showCreate && (
        <CreateKeyModal
          onClose={() => setShowCreate(false)}
          onCreated={(k) => { setNewKey(k); setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}

function CreateKeyModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState("read");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const data = await api.post("/api-keys", { name: name.trim(), permissions });
      onCreated(data);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <div className="modal-title">Create API key</div>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <label>Key name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Webhook sync · Zapier"
          autoFocus
        />
        <div className="field-hint">A label so you remember what this key is for.</div>
        <label>Permissions</label>
        <select value={permissions} onChange={(e) => setPermissions(e.target.value)}>
          <option value="read">Read only (recommended)</option>
          <option value="read_write">Read &amp; write</option>
          <option value="admin">Admin (full access)</option>
        </select>
        <button type="submit" className="btn-primary btn-full" disabled={busy || !name.trim()}>
          {busy ? "Creating..." : "Create key"}
        </button>
      </form>
    </div>
  );
}
