import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { naira, statusMeta } from "../utils/format";
import { api } from "../api/client";

// Parent Portal — a parallel auth surface at /parent.
//
// Parents sign in with phone + password (NOT email — they may not have one).
// Their token is stored in localStorage under PARENT_TOKEN_KEY (separate from the
// staff access token, which lives only in memory). All API calls go through the
// same /api/v1 backend but carry the parent token in the Authorization header.
//
// Backend endpoints used (see parents.controller.js + payments_online.controller.js):
//   POST /parents/login                  → { accessToken, parent }
//   GET  /parents/me                     → { parent, students: [...] }
//   GET  /parents/students/:id/fees      → { fees: [{ id, fee_head_id, fee_head_name,
//                                                     expected_amount, paid, outstanding }] }
//   GET  /parents/students/:id/payments  → { payments: [...] }
//   POST /payments/online/initiate       → { reference, authorizationUrl }
//   GET  /payments/:id/receipt           → PDF (opens in new tab)

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api/v1";
const PARENT_TOKEN_KEY = "ledgerly_parent_token";
const PARENT_KEY = "ledgerly_parent";

async function parentFetch(path, token, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error(payload?.error || "Something went wrong");
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

export default function ParentPortal() {
  const [token, setToken] = useState(() => localStorage.getItem(PARENT_TOKEN_KEY));
  const [parent, setParent] = useState(() => {
    const raw = localStorage.getItem(PARENT_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  });

  const signOut = () => {
    localStorage.removeItem(PARENT_TOKEN_KEY);
    localStorage.removeItem(PARENT_KEY);
    setToken(null);
    setParent(null);
  };

  if (!token || !parent) {
    return <ParentLogin onSignedIn={(t, p) => { setToken(t); setParent(p); }} />;
  }

  return <ParentDashboard token={token} parent={parent} onSignOut={signOut} />;
}

function ParentLogin({ onSignedIn }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [admissionNo, setAdmissionNo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await parentFetch("/parents/login", null, {
        method: "POST",
        body: { phone: phone.trim(), password },
      });
      localStorage.setItem(PARENT_TOKEN_KEY, data.accessToken);
      localStorage.setItem(PARENT_KEY, JSON.stringify(data.parent));
      onSignedIn(data.accessToken, data.parent);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Parent self-registration. The backend `POST /parents/register` requires a
  // `studentId` UUID (the student's guardian_contact must match the parent's
  // phone), but parents only know their child's admission number. We resolve
  // the admission number → studentId via the staff `/search` endpoint, which
  // matches on admission_no ILIKE. We then filter for an exact
  // (case-insensitive, whitespace-normalised) match so that "P1" doesn't
  // accidentally match a class name. After a successful register, we
  // auto-login so the parent lands straight on their dashboard.
  const submitRegister = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const trimmedNo = admissionNo.trim();
      if (!trimmedNo) {
        setError("Enter your child's admission number.");
        return;
      }
      // 1. Look up the student by admission number via the staff search endpoint.
      let studentId = null;
      try {
        const results = await api.get(`/search?q=${encodeURIComponent(trimmedNo)}`);
        const matches = (results.students || []).filter((s) =>
          (s.admission_no || "").replace(/\s+/g, "").toLowerCase() ===
          trimmedNo.replace(/\s+/g, "").toLowerCase()
        );
        if (matches.length === 0) {
          throw new Error("No student found with that admission number. Please check with your school.");
        }
        studentId = matches[0].id;
      } catch (lookupErr) {
        // Re-throw the "no match" error verbatim; rewrite any other failure
        // (e.g. 401 because the visitor isn't staff-logged-in) as a clearer
        // message that points them at the school.
        if (lookupErr.message && lookupErr.message.startsWith("No student found")) throw lookupErr;
        throw new Error(
          "We couldn't verify your child's admission number. Please ask the school to register you, or sign in as a staff member first."
        );
      }

      // 2. Register the parent account (links parent → student if guardian_contact matches).
      await parentFetch("/parents/register", null, {
        method: "POST",
        body: { phone: phone.trim(), name: name.trim(), password, studentId },
      });

      // 3. Auto-login after a successful registration.
      const data = await parentFetch("/parents/login", null, {
        method: "POST",
        body: { phone: phone.trim(), password },
      });
      localStorage.setItem(PARENT_TOKEN_KEY, data.accessToken);
      localStorage.setItem(PARENT_KEY, JSON.stringify(data.parent));
      onSignedIn(data.accessToken, data.parent);
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  if (mode === "register") {
    return (
      <div className="auth-page">
        <form className="auth-card" onSubmit={submitRegister}>
          <div className="auth-logo-block">
            <img src="/ledgerly-logo-dark.jpg" alt="Ledgerly" className="auth-wordmark" />
          </div>
          <h1>Register as parent</h1>
          <p className="auth-sub">Create your parent portal account to view your child's fees and pay online.</p>
          {error && <div className="form-error">{error}</div>}
          <label>Full name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Amaka Johnson"
            autoComplete="name"
            autoFocus
          />
          <label>Phone number</label>
          <input
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 0803 123 4567"
            inputMode="tel"
            autoComplete="tel"
          />
          <div className="field-hint">Must match the phone number the school has on file for your child.</div>
          <label>Password</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
          <label>Child's admission number</label>
          <input
            required
            value={admissionNo}
            onChange={(e) => setAdmissionNo(e.target.value)}
            placeholder="e.g. LED/2024/001"
            autoFocus={false}
          />
          <div className="field-hint">The admission number printed on your child's report card or fee bill.</div>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Registering..." : "Register"}
          </button>
          <div className="auth-switch">
            Already have an account?{" "}
            <button
              type="button"
              className="link-btn"
              style={{ display: "inline", padding: 0, fontSize: "inherit", fontWeight: 600 }}
              onClick={() => { setMode("login"); setError(""); }}
            >
              Sign in
            </button>
          </div>
          <div className="auth-switch"><Link to="/pricing">View pricing</Link></div>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo-block">
          <img src="/ledgerly-logo-dark.jpg" alt="Ledgerly" className="auth-wordmark" />
        </div>
        <h1>Parent portal</h1>
        <p className="auth-sub">Sign in to view your child's fees and pay online.</p>
        {error && <div className="form-error">{error}</div>}
        <label>Phone number</label>
        <input
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. 0803 123 4567"
          inputMode="tel"
          autoComplete="tel"
          autoFocus
        />
        <label>Password</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
        <div className="auth-switch">
          Don't have a parent account?{" "}
          <button
            type="button"
            className="link-btn"
            style={{ display: "inline", padding: 0, fontSize: "inherit", fontWeight: 600 }}
            onClick={() => { setMode("register"); setError(""); }}
          >
            Register as parent
          </button>
        </div>
        <div className="auth-switch"><Link to="/pricing">View pricing</Link></div>
      </form>
    </div>
  );
}

function ParentDashboard({ token, parent, onSignOut }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Per-student fee breakdown (fetched on demand when a card is expanded).
  const [feesByStudent, setFeesByStudent] = useState({});
  const [paymentsByStudent, setPaymentsByStudent] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [tab, setTab] = useState("fees");
  const [paying, setPaying] = useState(null); // { student, fee } when initiating payment

  const load = useCallback(() => {
    setLoading(true);
    parentFetch("/parents/me", token)
      .then((d) => setStudents(d.students || []))
      .catch((e) => {
        if (e.status === 401) {
          // Token expired / revoked — drop and bounce back to login.
          onSignOut();
        } else {
          setError(e.message);
        }
      })
      .finally(() => setLoading(false));
  }, [token, onSignOut]);

  useEffect(() => { load(); }, [load]);

  const expand = async (studentId) => {
    if (expanded === studentId) { setExpanded(null); return; }
    setExpanded(studentId);
    setTab("fees");
    if (!feesByStudent[studentId]) {
      try {
        const f = await parentFetch(`/parents/students/${studentId}/fees`, token);
        setFeesByStudent((s) => ({ ...s, [studentId]: f.fees || [] }));
      } catch (e) { setError(e.message); }
    }
  };

  const loadPayments = async (studentId) => {
    try {
      const p = await parentFetch(`/parents/students/${studentId}/payments`, token);
      setPaymentsByStudent((s) => ({ ...s, [studentId]: p.payments || [] }));
    } catch (e) { setError(e.message); }
  };

  const openReceipt = async (paymentId) => {
    try {
      // Use the parent-scoped receipt endpoint (verifies parent↔student link).
      // The staff endpoint /payments/:id/receipt rejects parent tokens.
      const res = await fetch(`${API_BASE}/parents/payments/${paymentId}/receipt`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        let msg = "Could not open receipt";
        try { const j = await res.json(); msg = j.error || msg; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();

      // Extract filename from Content-Disposition header
      const disposition = res.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch ? filenameMatch[1] : "receipt.pdf";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;  // download attribute — not blocked by popup blockers
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      alert(e.message);
    }
  };

  const switchTab = (t, studentId) => {
    setTab(t);
    if (t === "payments" && !paymentsByStudent[studentId]) loadPayments(studentId);
  };

  const totalOutstanding = (studentId) => {
    const fees = feesByStudent[studentId] || [];
    return fees.reduce((sum, f) => sum + (f.outstanding || 0), 0);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-brand-block">
            <img src="/app-icon.jpg" alt="Ledgerly" className="app-logo" />
            <div className="app-brand-text">
              <div className="app-brand">Ledgerly</div>
              <div className="app-school-name">Parent portal</div>
              <div className="app-subbrand">{parent.name} · {parent.phone}</div>
            </div>
          </div>
          <div className="app-header-actions">
            <button className="btn-ghost-dark" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="app-main">
        <h1>Your children</h1>
        <p className="page-intro">View outstanding fees and pay online. Receipts are emailed to you after each payment.</p>
        {error && <div className="form-error">{error}</div>}
        {loading && <div className="page-loading">Loading…</div>}
        {!loading && students.length === 0 && (
          <div className="empty-state">
            No students are linked to your account yet. Ask your child's school to add your phone number to their record.
          </div>
        )}

        <div className="list">
          {students.map((s) => {
            const fees = feesByStudent[s.id] || [];
            const outstanding = totalOutstanding(s.id);
            const isOpen = expanded === s.id;
            const hasOutstanding = fees.some((f) => f.outstanding > 0);
            return (
              <div key={s.id} className="list-item">
                <div className="list-item-row" onClick={() => expand(s.id)}>
                  <div className="list-item-main">
                    <div className="list-item-title">{s.name}</div>
                    <div className="list-item-sub">
                      {s.class}{s.admission_no ? " · " + s.admission_no : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {isOpen ? (
                      <span className="badge" style={{ color: "#14213D", background: "#E4E3DD" }}>Hide</span>
                    ) : fees.length > 0 ? (
                      <span className="badge" style={{
                        color: hasOutstanding ? statusMeta.outstanding.color : statusMeta.paid.color,
                        background: hasOutstanding ? statusMeta.outstanding.bg : statusMeta.paid.bg,
                      }}>
                        {hasOutstanding ? "Outstanding" : "Paid up"}
                      </span>
                    ) : (
                      <span className="badge" style={{ color: "#8A8A82", background: "#EDECE6" }}>Tap to view</span>
                    )}
                    {fees.length > 0 && (
                      <div className="list-item-amount">
                        Outstanding: {naira(outstanding)}
                      </div>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="list-item-detail">
                    <div className="detail-tabs">
                      <button className={"tab-btn" + (tab === "fees" ? " active" : "")} onClick={() => setTab("fees")}>Fees</button>
                      <button className={"tab-btn" + (tab === "payments" ? " active" : "")} onClick={() => switchTab("payments", s.id)}>Payment history</button>
                    </div>

                    {tab === "fees" && (
                      <div>
                        {!feesByStudent[s.id] ? (
                          <div className="page-loading">Loading fees…</div>
                        ) : fees.length === 0 ? (
                          <div className="empty-state" style={{ padding: "16px" }}>
                            No fees have been assigned for the current term yet. Please check back later.
                          </div>
                        ) : (
                          <div className="table-wrapper">
                          <table className="fee-table">
                            <thead>
                              <tr>
                                <th>Fee head</th>
                                <th className="num">Expected</th>
                                <th className="num">Paid</th>
                                <th className="num">Outstanding</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {fees.map((f) => (
                                <tr key={f.id}>
                                  <td>{f.fee_head_name}</td>
                                  <td className="num">{naira(f.expected_amount)}</td>
                                  <td className="num">{naira(f.paid)}</td>
                                  <td className="num" style={{ color: f.outstanding > 0 ? "#B3261E" : "#1B7A43", fontWeight: 700 }}>{naira(f.outstanding)}</td>
                                  <td>
                                    {f.outstanding > 0 && (
                                      <button
                                        className="btn-primary"
                                        style={{ padding: "6px 12px" }}
                                        onClick={() => setPaying({ student: s, fee: f })}
                                      >
                                        Pay now
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          </div>
                        )}
                      </div>
                    )}

                    {tab === "payments" && (
                      <div>
                        {!paymentsByStudent[s.id] ? (
                          <div className="page-loading">Loading payments…</div>
                        ) : paymentsByStudent[s.id].length === 0 ? (
                          <div className="empty-state" style={{ padding: "16px" }}>No payments recorded yet.</div>
                        ) : (
                          <div className="payment-history">
                            {paymentsByStudent[s.id].map((p) => (
                              <div key={p.id} className="payment-history-row">
                                <span>
                                  {p.paid_on} · {p.fee_head_name || "General"}
                                  {p.term_name ? " · " + p.term_name : ""}
                                  {p.note ? " · " + p.note : ""}
                                </span>
                                <span className="payment-history-right">
                                  {naira(p.amount)}
                                  <button className="link-btn" onClick={() => openReceipt(p.id)}>Receipt</button>
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="legal-footer-nav" style={{ marginTop: 30 }}>
          <Link to="/privacy">Privacy Policy</Link>
          <span>·</span>
          <Link to="/terms">Terms of Service</Link>
          <span>·</span>
          <Link to="/pricing">Pricing</Link>
        </div>
      </main>

      {paying && (
        <PayModal
          student={paying.student}
          fee={paying.fee}
          parentPhone={parent.phone}
          token={token}
          onClose={() => setPaying(null)}
          onPaid={() => {
            // Refresh fees for this student after a successful initiation.
            setFeesByStudent((s) => ({ ...s, [paying.student.id]: null }));
            parentFetch(`/parents/students/${paying.student.id}/fees`, token)
              .then((d) => setFeesByStudent((s) => ({ ...s, [paying.student.id]: d.fees || [] })))
              .catch(() => {});
            setPaying(null);
          }}
        />
      )}
    </div>
  );
}

function PayModal({ student, fee, parentPhone, token, onClose, onPaid }) {
  const [amount, setAmount] = useState(String(fee.outstanding || ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const amt = Number(amount) || 0;
    if (amt <= 0) { setError("Enter an amount greater than ₦0."); return; }
    setBusy(true);
    try {
      const data = await parentFetch("/payments/online/initiate", token, {
        method: "POST",
        body: {
          studentId: student.id,
          feeHeadId: fee.fee_head_id,
          termId: null, // Backend resolves the current term from the student's tenant
          amount: amt,
          parentPhone,
        },
      });
      setResult(data);
      onPaid();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <div className="modal-title">Pay fees · {student.name}</div>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        {result ? (
          <div>
            <div className="form-error" style={{ background: "#E7F3EC", color: "#1B7A43", borderColor: "#C5E0CF" }}>
              Payment initiated. Reference: {result.reference}
            </div>
            <p className="field-hint">
              You'll be redirected to our payment partner to complete the transaction. If a new tab
              didn't open, click the button below.
            </p>
            <a
              className="btn-primary btn-full"
              href={result.authorizationUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-block", textAlign: "center", textDecoration: "none" }}
            >
              Continue to payment
            </a>
            <button type="button" className="btn-ghost btn-full" onClick={onClose} style={{ marginTop: 10 }}>Close</button>
          </div>
        ) : (
          <>
            {error && <div className="form-error">{error}</div>}
            <div className="field-hint" style={{ marginTop: 0 }}>
              {fee.fee_head_name} · Outstanding {naira(fee.outstanding)}
            </div>
            <label>Amount to pay (₦)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              placeholder="0"
              autoFocus
            />
            <div className="field-hint">You can pay in part or in full. Receipts are issued automatically once payment is confirmed.</div>
            <button type="submit" className="btn-primary btn-full" disabled={busy}>
              {busy ? "Starting payment..." : "Continue to Paystack"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
