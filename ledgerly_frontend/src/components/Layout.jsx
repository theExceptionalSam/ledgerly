import { useState, useEffect, useRef } from "react";
import { NavLink, useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import ChangePasswordModal from "./ChangePasswordModal";
import { api } from "../api/client";
import { naira } from "../utils/format";

export default function Layout({ children }) {
  const { user, logout, schoolName } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showChangePw, setShowChangePw] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef(null);

  // Close "More" dropdown on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  // Close the mobile menu whenever the route changes — so navigating via a
  // hamburger link doesn't leave the slide-down panel open over the new page.
  useEffect(() => { setMenuOpen(false); setMoreOpen(false); }, [location.pathname]);

  // Lock body scroll when the mobile menu is open so the page behind doesn't
  // also scroll when the user swipes inside the menu panel.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [menuOpen]);

  // Onboarding auto-trigger — if a freshly-logged-in school has 0 students and
  // hasn't dismissed the wizard, redirect to /onboarding. The flag persists in
  // localStorage so we only check once per browser (until the wizard completes
  // or the user clears the key).
  useEffect(() => {
    if (!user) return;
    if (localStorage.getItem("ledgerly_onboarding_done")) return;
    if (window.location.pathname === "/onboarding") return;

    api.get("/students?pageSize=1")
      .then((d) => {
        const total = d.total || (d.students && d.students.length) || 0;
        if (total === 0) {
          navigate("/onboarding");
        } else {
          // Has students → mark onboarding as done so we don't check again.
          localStorage.setItem("ledgerly_onboarding_done", "1");
        }
      })
      .catch(() => {
        // If the check fails (e.g. 401), don't redirect — the auth handler will deal with it.
      });
  }, [user, navigate]);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate("/login");
  };

  const isOwner = user?.role === "owner";
  const isOwnerOrBursar = isOwner || user?.role === "bursar";
  const isOwnerOrAccountant = isOwner || user?.role === "accountant";
  // Receipts is a core accounting page — visible to owner, accountant, bursar
  // (matches the /receipts route guard in App.jsx).
  const canViewReceipts = isOwner || user?.role === "accountant" || user?.role === "bursar";

  // Close-the-menu handler passed to every NavLink/button inside the mobile
  // panel. Tapping a link navigates (which triggers the location.pathname
  // effect above) but we also close immediately so the panel slides away
  // before the new page paints underneath it.
  const closeMenu = () => setMenuOpen(false);

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
              <GlobalSearch />
              <NotificationBell />
              <button className="btn-ghost-dark app-desktop-only" onClick={() => setShowChangePw(true)}>Change password</button>
              <button className="btn-ghost-dark app-desktop-only" onClick={handleLogout}>Log out</button>
              {/* Hamburger — hidden on desktop (≥1024px) via CSS. Toggles the
                  slide-down mobile nav panel below. */}
              <button
                type="button"
                className={"hamburger" + (menuOpen ? " is-open" : "")}
                onClick={() => setMenuOpen((o) => !o)}
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                aria-expanded={menuOpen}
                aria-controls="app-nav-mobile"
              >
                <span className="hamburger-line" />
                <span className="hamburger-line" />
                <span className="hamburger-line" />
              </button>
            </div>
          )}
        </div>
        {user && (
          <nav className="app-nav app-desktop-only" aria-label="Primary">
            {/* Core links — always visible */}
            <NavLink to="/" end className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Dashboard</NavLink>
            <NavLink to="/students" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Students</NavLink>
            <NavLink to="/finance" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Finance</NavLink>
            {canViewReceipts && (
              <NavLink to="/receipts" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Receipts</NavLink>
            )}
            <NavLink to="/fee-heads" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Fee Heads</NavLink>
            <NavLink to="/sessions" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Terms</NavLink>
            {isOwner && (
              <NavLink to="/reports" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Reports</NavLink>
            )}
            {isOwner && (
              <NavLink to="/users" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Users</NavLink>
            )}

            {/* More dropdown — advanced features */}
            <div className="nav-more" ref={moreRef}>
              <button
                className={"nav-link" + (moreOpen ? " active" : "")}
                onClick={() => setMoreOpen(!moreOpen)}
              >
                More ▾
              </button>
              {moreOpen && (
                <div className="nav-more-dropdown">
                  {isOwnerOrAccountant && (
                    <NavLink to="/bank-reconciliation" onClick={() => setMoreOpen(false)} className={({ isActive }) => isActive ? "nav-more-link active" : "nav-more-link"}>Bank Reconciliation</NavLink>
                  )}
                  {isOwnerOrBursar && (
                    <NavLink to="/fee-templates" onClick={() => setMoreOpen(false)} className={({ isActive }) => isActive ? "nav-more-link active" : "nav-more-link"}>Fee Templates</NavLink>
                  )}
                  {isOwnerOrBursar && (
                    <NavLink to="/payment-plans" onClick={() => setMoreOpen(false)} className={({ isActive }) => isActive ? "nav-more-link active" : "nav-more-link"}>Payment Plans</NavLink>
                  )}
                  {isOwner && (
                    <NavLink to="/branding" onClick={() => setMoreOpen(false)} className={({ isActive }) => isActive ? "nav-more-link active" : "nav-more-link"}>Receipt Branding</NavLink>
                  )}
                  {isOwner && (
                    <NavLink to="/settings" onClick={() => setMoreOpen(false)} className={({ isActive }) => isActive ? "nav-more-link active" : "nav-more-link"}>School Settings</NavLink>
                  )}
                  {isOwner && (
                    <NavLink to="/security" onClick={() => setMoreOpen(false)} className={({ isActive }) => isActive ? "nav-more-link active" : "nav-more-link"}>Security & 2FA</NavLink>
                  )}
                  {isOwner && (
                    <NavLink to="/webhooks" onClick={() => setMoreOpen(false)} className={({ isActive }) => isActive ? "nav-more-link active" : "nav-more-link"}>Webhooks</NavLink>
                  )}
                  {isOwner && (
                    <NavLink to="/data-requests" onClick={() => setMoreOpen(false)} className={({ isActive }) => isActive ? "nav-more-link active" : "nav-more-link"}>Data & Privacy</NavLink>
                  )}
                  {isOwner && (
                    <NavLink to="/audit-log" onClick={() => setMoreOpen(false)} className={({ isActive }) => isActive ? "nav-more-link active" : "nav-more-link"}>Audit Log</NavLink>
                  )}
                </div>
              )}
            </div>
          </nav>
        )}
      </header>

      {/* Mobile / tablet slide-down nav panel — hidden on desktop (≥1024px).
          Renders all core links + More links + Change password + Log out +
          legal/parent-portal links as a single flat list. Closes on link
          click via the closeMenu handler. */}
      {user && (
        <div className={"app-nav-mobile" + (menuOpen ? " is-open" : "")} id="app-nav-mobile">
          <div className="app-nav-mobile-scroll">
            <div className="app-nav-mobile-group">
              <NavLink to="/" end onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>Dashboard</NavLink>
              <NavLink to="/students" onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>Students</NavLink>
              <NavLink to="/finance" onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>Finance</NavLink>
              {canViewReceipts && (
                <NavLink to="/receipts" onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>Receipts</NavLink>
              )}
              <NavLink to="/fee-heads" onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>Fee Heads</NavLink>
              <NavLink to="/sessions" onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>Terms</NavLink>
              {isOwner && (
                <NavLink to="/reports" onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>Reports</NavLink>
              )}
              {isOwner && (
                <NavLink to="/users" onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>Users</NavLink>
              )}
            </div>

            <div className="app-nav-mobile-group">
              <div className="app-nav-mobile-group-title">More</div>
              {isOwnerOrAccountant && (
                <NavLink to="/bank-reconciliation" onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>Bank Reconciliation</NavLink>
              )}
              {isOwnerOrBursar && (
                <NavLink to="/fee-templates" onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>Fee Templates</NavLink>
              )}
              {isOwnerOrBursar && (
                <NavLink to="/payment-plans" onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>Payment Plans</NavLink>
              )}
              {isOwner && (
                <NavLink to="/branding" onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>Receipt Branding</NavLink>
              )}
              {isOwner && (
                <NavLink to="/settings" onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>School Settings</NavLink>
              )}
              {isOwner && (
                <NavLink to="/security" onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>Security & 2FA</NavLink>
              )}
              {isOwner && (
                <NavLink to="/webhooks" onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>Webhooks</NavLink>
              )}
              {isOwner && (
                <NavLink to="/data-requests" onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>Data & Privacy</NavLink>
              )}
              {isOwner && (
                <NavLink to="/audit-log" onClick={closeMenu} className={({ isActive }) => "app-nav-mobile-link" + (isActive ? " active" : "")}>Audit Log</NavLink>
              )}
            </div>

            <div className="app-nav-mobile-group">
              <div className="app-nav-mobile-group-title">Legal</div>
              <Link to="/parent" onClick={closeMenu} className="app-nav-mobile-link">Parent Portal</Link>
              <Link to="/pricing" onClick={closeMenu} className="app-nav-mobile-link">Pricing</Link>
              <Link to="/privacy" onClick={closeMenu} className="app-nav-mobile-link">Privacy</Link>
              <Link to="/terms" onClick={closeMenu} className="app-nav-mobile-link">Terms</Link>
            </div>

            <div className="app-nav-mobile-actions">
              <button className="btn-ghost" onClick={() => { setShowChangePw(true); closeMenu(); }}>Change password</button>
              <button className="btn-danger-ghost" onClick={handleLogout}>Log out</button>
            </div>
          </div>
        </div>
      )}
      {/* Invisible backdrop behind the mobile menu — closes the panel when the
          user taps outside it. Doesn't dim the page (transparent) to preserve
          the see-through feel of the slide-down panel. */}
      {user && menuOpen && (
        <div className="app-nav-mobile-backdrop" onClick={closeMenu} aria-hidden="true" />
      )}

      <main className="app-main">
        {children}
      </main>
      <footer className="app-footer">
        <div className="app-footer-inner">
          <div className="app-footer-brand">© 2026 Ledgerly · School Fee Management</div>
          <nav className="app-footer-nav" aria-label="Legal">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/pricing">Pricing</Link>
            {user && <Link to="/parent">Parent Portal</Link>}
          </nav>
        </div>
      </footer>
      {showChangePw && (
        <ChangePasswordModal
          forced={false}
          onClose={() => setShowChangePw(false)}
          onSuccess={() => {
            setShowChangePw(false);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}

/* --------------------- Notification bell --------------------- */
function NotificationBell() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  const load = () => {
    api.get("/notifications")
      .then((d) => setNotifications(d.notifications || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  // Initial load + 60-second polling. The interval is cleared on unmount or
  // when `user` changes (login/logout) so we never leak a timer or poll with
  // a stale auth context.
  useEffect(() => {
    if (!user) return;
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const markAllRead = async () => {
    setBusy(true);
    try {
      await api.post("/notifications/read-all", {});
      setNotifications([]);
    } catch {} finally { setBusy(false); }
  };

  const markOne = async (id) => {
    try {
      await api.post(`/notifications/${id}/read`, {});
      setNotifications((n) => n.filter((x) => x.id !== id));
    } catch {}
  };

  const fmtTime = (iso) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" }); }
    catch { return iso; }
  };

  const count = notifications.length;

  return (
    <div className="notif-bell" ref={ref}>
      <button type="button" className="notif-bell-btn" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${count > 0 ? `, ${count} unread` : ""}`}>
        <span className="notif-bell-icon">🔔</span>
        {count > 0 && <span className="notif-bell-badge">{count > 99 ? "99+" : count}</span>}
      </button>
      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-header">
            <strong>Notifications</strong>
            {count > 0 && <button className="link-btn" disabled={busy} onClick={markAllRead}>{busy ? "..." : "Mark all read"}</button>}
          </div>
          {loading && <div className="page-loading" style={{ padding: "16px" }}>Loading…</div>}
          {!loading && notifications.length === 0 && <div className="notif-empty">You're all caught up.</div>}
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
                      <button className="link-btn" style={{ marginLeft: 8 }} onClick={() => markOne(n.id)}>Read</button>
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

/* --------------------- Global search --------------------- */
function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);
  const debounceRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults(null); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      api.get(`/search?q=${encodeURIComponent(q)}`)
        .then((d) => { setResults(d); setLoading(false); })
        .catch(() => { setResults({ students: [], payments: [], transactions: [], receipts: [] }); setLoading(false); });
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const fmtShort = (iso) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString("en-NG", { month: "short", day: "2-digit" }); }
    catch { return iso; }
  };

  const pick = (path) => { setOpen(false); setQuery(""); setResults(null); navigate(path); };

  const students = results?.students || [];
  const payments = results?.payments || [];
  const transactions = results?.transactions || [];
  const total = students.length + payments.length + transactions.length;
  const showDropdown = open && query.trim().length >= 2;

  return (
    <div className="global-search" ref={ref}>
      <input
        className="global-search-input"
        type="search"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search…"
        aria-label="Search"
      />
      {showDropdown && (
        <div className="global-search-dropdown">
          {loading && <div className="global-search-section">Searching…</div>}
          {!loading && total === 0 && <div className="global-search-empty">No matches.</div>}
          {!loading && students.length > 0 && (
            <div className="global-search-group">
              <div className="global-search-group-title">Students</div>
              {students.map((s) => (
                <button key={s.id} className="global-search-item" onClick={() => pick(`/students?expand=${s.id}`)}>
                  <div className="global-search-item-title">{s.name}</div>
                  <div className="global-search-item-sub">{s.class || "—"}{s.admission_no ? ` · ${s.admission_no}` : ""}</div>
                </button>
              ))}
            </div>
          )}
          {!loading && payments.length > 0 && (
            <div className="global-search-group">
              <div className="global-search-group-title">Payments</div>
              {payments.map((p) => (
                <button
                  key={p.id}
                  className="global-search-item"
                  onClick={() => pick(
                    // Deep-link to the student's payments list when the backend
                    // exposes `student_id` on the payment row. The current
                    // `/search` endpoint returns `student_name` but NOT
                    // `student_id`, so we fall back to `/finance` (per spec).
                    p.student_id
                      ? `/students?expand=${p.student_id}&highlight=${p.id}`
                      : "/finance"
                  )}
                >
                  <div className="global-search-item-title">{naira(p.amount)} · {fmtShort(p.paid_on)}</div>
                  <div className="global-search-item-sub">{p.student_name || "—"}{p.fee_head_name ? ` · ${p.fee_head_name}` : ""}</div>
                </button>
              ))}
            </div>
          )}
          {!loading && transactions.length > 0 && (
            <div className="global-search-group">
              <div className="global-search-group-title">Transactions</div>
              {transactions.map((t) => (
                <button key={t.id} className="global-search-item" onClick={() => pick("/finance")}>
                  <div className="global-search-item-title">{t.category} · {t.type === "income" ? "+" : "-"}{naira(t.amount)}</div>
                  <div className="global-search-item-sub">{fmtShort(t.occurred_on)}{t.description ? ` · ${t.description}` : ""}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
