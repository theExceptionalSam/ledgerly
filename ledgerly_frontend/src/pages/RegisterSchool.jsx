import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RegisterSchool() {
  const { registerSchool } = useAuth();
  const navigate = useNavigate();
  const [fields, setFields] = useState({
    schoolName: "", ownerName: "", phone: "", email: "", password: "", confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const update = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));
  const mismatch = fields.confirmPassword !== "" && fields.password !== fields.confirmPassword;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (fields.password !== fields.confirmPassword) {
      setError("Passwords do not match. Please re-enter them.");
      return;
    }
    setBusy(true);
    try {
      const { phone, ...rest } = fields;
      await registerSchool({ ...rest, phone: phone.trim() });
      navigate("/verify", { state: { email: fields.email } });
    } catch (err) {
      setError(err.details ? err.details.map((d) => d.message).join(" · ") : err.message);
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
        <h1>Register your school</h1>
        <p className="auth-sub">Creates your school's account and your owner login.</p>
        {error && <div className="form-error">{error}</div>}
        <label htmlFor="register-school-name">School name</label>
        <input id="register-school-name" name="schoolName" required value={fields.schoolName} onChange={update("schoolName")} autoComplete="organization" />
        <label htmlFor="register-owner-name">Your name</label>
        <input id="register-owner-name" name="ownerName" required value={fields.ownerName} onChange={update("ownerName")} autoComplete="name" />
        <label htmlFor="register-phone">School phone number</label>
        <input id="register-phone" name="phone" required value={fields.phone} onChange={update("phone")} placeholder="e.g. 0803 123 4567" inputMode="tel" autoComplete="tel" />
        <label htmlFor="register-email">Email</label>
        <input id="register-email" name="email" type="email" required value={fields.email} onChange={update("email")} autoComplete="email" />
        <label htmlFor="register-password">Password</label>
        <input id="register-password" name="password" type="password" required value={fields.password} onChange={update("password")} autoComplete="new-password" />
        <div className="field-hint">At least 10 characters, with an uppercase letter and a number.</div>
        <label htmlFor="register-confirm-password">Confirm password</label>
        <input id="register-confirm-password" name="confirmPassword" type="password" required value={fields.confirmPassword} onChange={update("confirmPassword")} autoComplete="new-password" />
        {mismatch && <div className="field-hint" style={{ color: "#B3261E" }}>Passwords do not match.</div>}
        <button type="submit" className="btn-primary" disabled={busy || mismatch}>{busy ? "Creating..." : "Create account"}</button>
        <div className="auth-switch">Already registered? <Link to="/login">Sign in</Link></div>
      </form>
    </div>
  );
}
