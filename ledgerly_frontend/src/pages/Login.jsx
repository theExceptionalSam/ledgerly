import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Generate a fresh math CAPTCHA challenge (two addends 1..10). Returns an
// object with the two operands and the expected sum. We deliberately keep the
// operands small so parents / staff can solve it without a calculator, while
// still blocking naive brute-force bots that don't bother running JS.
function makeCaptcha() {
  const a = Math.floor(Math.random() * 10) + 1;
  const b = Math.floor(Math.random() * 10) + 1;
  return { a, b, answer: a + b };
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState(() => makeCaptcha());
  const [captchaInput, setCaptchaInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const inactiveMessage = searchParams.get("reason") === "inactive";
  const captchaSolved = Number(captchaInput) === captcha.answer;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!captchaSolved) {
      setError("Please answer the math check correctly.");
      return;
    }
    setBusy(true);
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      if (err.verificationRequired) {
        navigate("/verify", { state: { email: err.email || email } });
        return;
      }
      setError(err.message);
      // Regenerate CAPTCHA on failed login — slows brute-force attempts
      // by forcing the attacker to re-solve a new challenge each try.
      setCaptcha(makeCaptcha());
      setCaptchaInput("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page" role="main">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo-block">
          <img src="/ledgerly-logo-dark.jpg" alt="Ledgerly" className="auth-wordmark" width="180" height="52" fetchpriority="high" />
        </div>
        <h1>Sign in</h1>
        <p className="auth-sub">Access your school's fee and finance records.</p>
        {inactiveMessage && (
          <div className="form-error" style={{ background: "#FBF0E2", color: "#C77D22", borderColor: "#F2D9B8" }}>
            You were signed out automatically after 30 minutes of inactivity. Please sign in again.
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
        <label htmlFor="login-email">Email</label>
        <input id="login-email" name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label htmlFor="login-password">Password</label>
        <input id="login-password" name="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <label htmlFor="login-captcha">What is {captcha.a} + {captcha.b}?</label>
        <input
          id="login-captcha"
          name="captcha"
          type="number"
          inputMode="numeric"
          required
          value={captchaInput}
          onChange={(e) => setCaptchaInput(e.target.value)}
          placeholder="Your answer"
          autoComplete="off"
          aria-describedby="login-captcha-hint"
        />
        <div id="login-captcha-hint" className="field-hint">A quick check to keep automated bots out.</div>
        <button type="submit" className="btn-primary" disabled={busy || !captchaSolved}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
        <div className="auth-switch">No account yet? <Link to="/register">Register your school</Link></div>
        <div className="auth-switch"><Link to="/forgot-password">Forgot password?</Link></div>
      </form>
    </div>
  );
}
