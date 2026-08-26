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
      // Registration now requires email verification — continue at the OTP screen.
      navigate("/verify", { state: { email: fields.email } });
    } catch (err) {
      setError(err.details ? err.details.map((d) => d.message).join(" · ") : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1>Register your school</h1>
        <p className="auth-sub">Creates your school's account and your owner login.</p>
        {error && <div className="form-error">{error}</div>}
        <label>School name</label>
        <input required value={fields.schoolName} onChange={update("schoolName")} />
        <label>Your name</label>
        <input required value={fields.ownerName} onChange={update("ownerName")} />
        <label>School phone number</label>
        <input required value={fields.phone} onChange={update("phone")} placeholder="e.g. 0803 123 4567" inputMode="tel" autoComplete="tel" />
        <label>Email</label>
        <input type="email" required value={fields.email} onChange={update("email")} autoComplete="email" />
        <label>Password</label>
        <input type="password" required value={fields.password} onChange={update("password")} autoComplete="new-password" />
        <div className="field-hint">At least 10 characters, with an uppercase letter and a number.</div>
        <label>Confirm password</label>
        <input type="password" required value={fields.confirmPassword} onChange={update("confirmPassword")} autoComplete="new-password" />
        {mismatch && <div className="field-hint" style={{ color: "#B3261E" }}>Passwords do not match.</div>}
        <button type="submit" className="btn-primary" disabled={busy || mismatch}>{busy ? "Creating..." : "Create account"}</button>
        <div className="auth-switch">Already registered? <Link to="/login">Sign in</Link></div>
      </form>
    </div>
  );
}
