import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
          <img src="/ledgerly-wordmark.jpg" alt="Ledgerly" className="auth-wordmark" />
        </div>
        <h1>Sign in</h1>
        <p className="auth-sub">Access your school's fee and finance records.</p>
        {error && <div className="form-error">{error}</div>}
        <label>Email</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label>Password</label>
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
        <div className="auth-switch">No account yet? <Link to="/register">Register your school</Link></div>
      </form>
    </div>
  );
}
