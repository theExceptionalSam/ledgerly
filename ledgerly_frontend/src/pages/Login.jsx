import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const inactiveMessage = searchParams.get("reason") === "inactive";

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      if (err.verificationRequired) {
        navigate("/verify", { state: { email: err.email || email } });
        return;
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo-block">
          <img src="/ledgerly-logo-dark.jpg" alt="Ledgerly" className="auth-wordmark" />
        </div>
        <h1>Sign in</h1>
        <p className="auth-sub">Access your school's fee and finance records.</p>
        {inactiveMessage && (
          <div className="form-error" style={{ background: "#FBF0E2", color: "#C77D22", borderColor: "#F2D9B8" }}>
            You were signed out automatically after 30 minutes of inactivity. Please sign in again.
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
        <label>Email</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label>Password</label>
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
        <div className="auth-switch">No account yet? <Link to="/register">Register your school</Link></div>
        <div className="auth-switch"><Link to="/forgot-password">Forgot password?</Link></div>
      </form>
    </div>
  );
}
