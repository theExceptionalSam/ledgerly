import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Email verification (OTP) screen — shown right after school registration,
// and whenever an unverified school tries to sign in.
export default function VerifyEmail() {
  const { verifyOtp, resendOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || "");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await verifyOtp(email, code);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError("");
    setInfo("");
    try {
      await resendOtp(email);
      setInfo("A new code has been sent. It is valid for 10 minutes.");
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="auth-page" role="main">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo-block">
          <img src="/ledgerly-logo-dark.jpg" alt="Ledgerly" className="auth-wordmark" width="180" height="52" fetchpriority="high" />
        </div>
        <h1>Verify your email</h1>
        <p className="auth-sub">We sent a 6-digit code to your school email. Enter it below to activate your account.</p>
        {error && <div className="form-error">{error}</div>}
        {info && <div className="field-hint" style={{ color: "#1B7A43" }}>{info}</div>}
        <label htmlFor="verify-email">Email</label>
        <input id="verify-email" name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label htmlFor="verify-code">Verification code</label>
        <input
          id="verify-code"
          name="otp"
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          style={{ letterSpacing: "0.3em", fontSize: 18, textAlign: "center" }}
        />
        <button type="submit" className="btn-primary" disabled={busy || code.length !== 6}>
          {busy ? "Verifying..." : "Verify and continue"}
        </button>
        <button type="button" className="btn-primary" style={{ background: "transparent", color: "#14213D", marginTop: 8 }} onClick={resend} disabled={!email}>
          Resend code
        </button>
        <div className="auth-switch"><Link to="/login">Back to sign in</Link></div>
      </form>
    </div>
  );
}
