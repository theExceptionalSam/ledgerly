import { useState } from "react";
import { api } from "../api/client";

// Lets the currently-signed-in user change their own password.
// Live-validates the new password with the same rules as AddUserModal:
// 10+ chars, at least one uppercase letter, at least one number.
// Calls POST /users/change-password with { currentPassword, newPassword }.
export default function ChangePasswordModal({ onClose, forced, onSuccess }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const pwValid = newPassword.length >= 10 && /[A-Z]/.test(newPassword) && /[0-9]/.test(newPassword);
  const confirmMatch = confirmPassword.length > 0 && newPassword === confirmPassword;

  const submit = async (e) => {
    e.preventDefault();
    setError("");

    if (!pwValid) {
      setError("New password must be at least 10 characters, with an uppercase letter and a number.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must be different from your current password.");
      return;
    }

    setBusy(true);
    try {
      await api.post("/users/change-password", { currentPassword, newPassword });
      setSuccess(true);
      if (onSuccess) {
        setTimeout(() => onSuccess(), 1000);
      } else {
        setTimeout(() => onClose(), 1200);
      }
    } catch (err) {
      if (err.details && err.details.length > 0) {
        setError(err.details.map((d) => d.message).join(" · "));
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={forced ? undefined : onClose}>
      <form className="modal-sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <div className="modal-title">{forced ? "Change your password" : "Change password"}</div>
          {!forced && <button type="button" className="modal-close" onClick={onClose} disabled={busy}>✕</button>}
        </div>

        {forced && (
          <div className="form-error" style={{ background: "#FBF0E2", color: "#C77D22", borderColor: "#F2D9B8" }}>
            Your account was created with a temporary password. You must set a new password before you can use Ledgerly.
          </div>
        )}

        {success ? (
          <div className="form-error" style={{ background: "#E7F3EC", color: "#1B7A43", borderColor: "#C5E0CF" }}>
            Password changed successfully.
          </div>
        ) : (
          <>
            {error && <div className="form-error">{error}</div>}

            <label>Current password</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />

            <label>New password</label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <div className="field-hint" style={{ color: pwValid ? "#1B7A43" : "#6B6E72" }}>
              {pwValid ? "✓ " : ""}At least 10 characters, with an uppercase letter and a number.
            </div>

            <label>Confirm new password</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
            {confirmPassword.length > 0 && (
              <div className="field-hint" style={{ color: confirmMatch ? "#1B7A43" : "#B3261E" }}>
                {confirmMatch ? "✓ Passwords match" : "Passwords do not match"}
              </div>
            )}

            <button
              type="submit"
              className="btn-primary btn-full"
              disabled={busy || !pwValid || !confirmMatch || !currentPassword}
            >
              {busy ? "Changing..." : "Change password"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
