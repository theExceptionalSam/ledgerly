import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ForgotPassword() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo-block">
          <img src="/ledgerly-logo-dark.jpg" alt="Ledgerly" className="auth-wordmark" />
        </div>
        <h1>Reset password</h1>
        {sent ? (
          <>
            <p className="auth-sub">If an account exists for {email}, a reset link has been sent. Check your email and follow the link to set a new password.</p>
            <div className="auth-switch"><Link to="/login">Back to sign in</Link></div>
          </>
        ) : (
          <>
            <p className="auth-sub">Enter your email and we'll send you a link to reset your password.</p>
            {error && <div className="form-error">{error}</div>}
            <label htmlFor="forgot-email">Email</label>
            <input id="forgot-email" name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Sending..." : "Send reset link"}</button>
            <div className="auth-switch">Remembered it? <Link to="/login">Sign in</Link></div>
          </>
        )}
      </form>
    </div>
  );
}
