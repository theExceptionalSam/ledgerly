import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ResetPassword() {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState(searchParams.get("token") || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const mismatch = confirmPassword !== "" && password !== confirmPassword;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      await resetPassword(email, token, password);
      navigate("/login");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="auth-page" role="main">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo-block">
          <img src="/ledgerly-logo-dark.jpg" alt="Ledgerly" className="auth-wordmark" width="180" height="52" fetchpriority="high" />
        </div>
        <h1>Set new password</h1>
        <p className="auth-sub">Enter your email, the reset token from your email, and your new password.</p>
        {error && <div className="form-error">{error}</div>}
        <label htmlFor="reset-email">Email</label>
        <input id="reset-email" name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label htmlFor="reset-token">Reset token</label>
        <input id="reset-token" name="token" required value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste the token from your email" autoComplete="off" />
        <label htmlFor="reset-password">New password</label>
        <input id="reset-password" name="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <div className="field-hint">At least 10 characters, with an uppercase letter and a number.</div>
        <label htmlFor="reset-confirm-password">Confirm new password</label>
        <input id="reset-confirm-password" name="confirmPassword" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
        {mismatch && <div className="field-hint" style={{ color: "#B3261E" }}>Passwords do not match.</div>}
        <button type="submit" className="btn-primary" disabled={busy || mismatch}>{busy ? "Saving..." : "Set new password"}</button>
        <div className="auth-switch"><Link to="/login">Back to sign in</Link></div>
      </form>
    </div>
  );
}
