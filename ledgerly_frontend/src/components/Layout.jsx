import { useState, useEffect, useRef } from "react";
import { NavLink, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import ChangePasswordModal from "./ChangePasswordModal";
import { api } from "../api/client";

// App shell — top brand bar, primary nav, optional notification bell, footer
// with legal links. Used by every authenticated page via <Layout>{children}</Layout>.
//
// The notification bell only renders for signed-in users. It polls GET /notifications
// on mount and exposes a dropdown with the most recent items. The footer renders on
// every page (auth + public legal pages skip it via the legal-page CSS — they don't
// use Layout) and carries Privacy / Terms / Security links.

export default function Layout({ children }) {
  const { user, logout, schoolName } = useAuth();
  const navigate = useNavigate();
  const [showChangePw, setShowChangePw] = useState(false);
  const [forceChangePw, setForceChangePw] = useState(false);

  // Check on mount if the user needs to change their password
  useEffect(() => {
    if (!user) return;
    api.get("/auth/me").then(() => {}).catch((err) => {
      if (err.forceChangePassword) setForceChangePw(true);
    });
  }, [user]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-brand-block">
            <img src="/app-icon.jpg" alt="Ledgerly" className="app-logo" />
            <div className="app-brand-text">
              <div className="app-brand">Ledgerly</div>
              {schoolName && <div className="app-school-name">{schoolName}</div>}
              {user && <div className="app-subbrand">{user.name} · {user.role}</div>}
            </div>
          </div>
          {user && (
            <div className="app-header-actions">
              <NotificationBell />
              <button className="btn-ghost-dark" onClick={() => setShowChangePw(true)}>Change password</button>
              <button className="btn-ghost-dark" onClick={handleLogout}>Log out</button>
            </div>
          )}
        </div>
        {user && (
          <nav className="app-nav">
            <NavLink to="/" end className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Dashboard</NavLink>
            <NavLink to="/students" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Students</NavLink>
            <NavLink to="/finance" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Income & Expenditure</NavLink>
            <NavLink to="/fee-heads" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Fee Heads</NavLink>
            <NavLink to="/sessions" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Sessions & Terms</NavLink>
            {user.role === "owner" && (
              <NavLink to="/reports" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Reports</NavLink>
            )}
            {user.role === "owner" && (
              <NavLink to="/branding" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Branding</NavLink>
            )}
            {user.role === "owner" && (
              <NavLink to="/users" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Users</NavLink>
            )}
            {user.role === "owner" && (
              <NavLink to="/security" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Security</NavLink>
            )}
            {user.role === "owner" && (
              <NavLink to="/audit-log" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Audit Log</NavLink>
            )}
          </nav>
        )}
      </header>
      <main className="app-main">
        {forceChangePw && (
          <div className="form-error" style={{ background: "#FBF0E2", color: "#C77D22", borderColor: "#F2D9B8", marginBottom: 16 }}>
            You must change your password before you can use Ledgerly. Click "Change password" above.
          </div>
        )}
        {children}
      </main>
      <footer className="app-footer">
        <div className="app-footer-inner">
          <div className="app-footer-brand">© {new Date().getFullYear()} Ledgerly · Lagos, Nigeria</div>
          <nav className="app-footer-nav">
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Service</Link>
            <Link to="/pricing">Pricing</Link>
            {user && <Link to="/parent">Parent portal</Link>}
            {user?.role === "owner" && <Link to="/security">Security</Link>}
          </nav>
        </div>
      </footer>
      {(showChangePw || forceChangePw) && (
        <ChangePasswordModal
          forced={forceChangePw}
          onClose={() => {
            if (!forceChangePw) setShowChangePw(false);
          }}
          onSuccess={() => {
            setForceChangePw(false);
            setShowChangePw(false);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}

/* --------------------- Notification bell --------------------- */
//
// Polls GET /notifications on mount. Shows a badge with unread count. Clicking
// opens a dropdown with the most recent notifications + "Mark all as read".
// Closes on outside-click via a window listener.

function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  const load = () => {
    api.get("/notifications")
      .then((d) => setNotifications(d.notifications || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const markAllRead = async () => {
    setBusy(true); setError("");
    try {
      await api.post("/notifications/read-all", {});
      setNotifications([]);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const markOne = async (id) => {
    try {
      await api.post(`/notifications/${id}/read`, {});
      setNotifications((n) => n.filter((x) => x.id !== id));
    } catch (e) { setError(e.message); }
  };

  const fmtTime = (iso) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" });
    } catch { return iso; }
  };

  const count = notifications.length;

  return (
    <div className="notif-bell" ref={ref}>
      <button
        type="button"
        className="notif-bell-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${count > 0 ? `, ${count} unread` : ""}`}
      >
        <span className="notif-bell-icon">🔔</span>
        {count > 0 && <span className="notif-bell-badge">{count > 99 ? "99+" : count}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-header">
            <strong>Notifications</strong>
            {count > 0 && (
              <button className="link-btn" disabled={busy} onClick={markAllRead}>
                {busy ? "Marking..." : "Mark all as read"}
              </button>
            )}
          </div>
          {error && <div className="form-error" style={{ margin: "8px 12px" }}>{error}</div>}
          {loading && <div className="page-loading" style={{ padding: "16px" }}>Loading…</div>}
          {!loading && notifications.length === 0 && (
            <div className="notif-empty">You're all caught up.</div>
          )}
          {!loading && notifications.length > 0 && (
            <div className="notif-list">
              {notifications.slice(0, 20).map((n) => (
                <div key={n.id} className="notif-item">
                  <div className="notif-dot" />
                  <div className="notif-item-body">
                    <div className="notif-item-title">{n.title}</div>
                    {n.body && <div className="notif-item-text">{n.body}</div>}
                    <div className="notif-item-meta">
                      {fmtTime(n.created_at)}
                      <button className="link-btn" style={{ marginLeft: 8 }} onClick={() => markOne(n.id)}>Mark read</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
