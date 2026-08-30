import { useEffect, useState } from "react";
import { api } from "../api/client";
import ChangePasswordModal from "../components/ChangePasswordModal";

export default function Users() {
  const [users, setUsers] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [error, setError] = useState("");

  const load = () => api.get("/users").then((d) => setUsers(d.users)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const toggleStatus = async (u) => {
    const newStatus = u.status === "active" ? "disabled" : "active";
    try {
      await api.put(`/users/${u.id}`, { status: newStatus });
      load();
    } catch (e) { setError(e.message); }
  };

  const changeRole = async (u, role) => {
    try {
      await api.put(`/users/${u.id}`, { role });
      load();
    } catch (e) { setError(e.message); }
  };

  const deleteUser = async (u) => {
    if (!window.confirm(`Remove ${u.name} (${u.email}) from the school? This cannot be undone.`)) return;
    try {
      await api.del(`/users/${u.id}`);
      load();
    } catch (e) { setError(e.message); }
  };

  return (
    <div>
      <div className="page-intro">Manage staff accounts for your school. Invite bursars, accountants, and assistants.</div>
      {error && <div className="form-error">{error}</div>}
      <div className="toolbar">
        <button className="btn-ghost" onClick={() => setShowChangePw(true)}>Change password</button>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Invite user</button>
      </div>

      {users.length === 0 && <div className="empty-state">No users yet.</div>}

      <div className="list">
        {users.map((u) => (
          <div key={u.id} className="list-item">
            <div className="list-item-row">
              <div>
                <div className="list-item-title">
                  {u.name}
                  <span className="badge" style={{ marginLeft: 10, color: u.role === "owner" ? "#14213D" : "#5B5B54", background: u.role === "owner" ? "#E4E3DD" : "#F6F6F3" }}>{u.role}</span>
                  {u.status === "disabled" && <span className="badge" style={{ marginLeft: 6, color: "#B3261E", background: "#FBEAE9" }}>Disabled</span>}
                </div>
                <div className="list-item-sub">{u.email}</div>
              </div>
              <div className="user-actions">
                {u.role !== "owner" && (
                  <>
                    <select id={`user-role-${u.id}`} name={`userRole-${u.id}`} value={u.role} onChange={(e) => changeRole(u, e.target.value)} aria-label={`Role for ${u.name}`}>
                      <option value="bursar">Bursar</option>
                      <option value="accountant">Accountant</option>
                      <option value="assistant">Assistant</option>
                    </select>
                    <button className="btn-ghost" onClick={() => toggleStatus(u)}>
                      {u.status === "active" ? "Disable" : "Enable"}
                    </button>
                    <button
                      className="btn-danger-ghost"
                      onClick={() => deleteUser(u)}
                      title={`Remove ${u.name} from the school`}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onDone={load} />}
      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
    </div>
  );
}

function AddUserModal({ onClose, onDone }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("bursar");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      await api.post("/users", { name, email, password, role });
      onDone();
      onClose();
    } catch (err) {
      // Show validation details if available (e.g. password too short)
      if (err.details && err.details.length > 0) {
        setError(err.details.map((d) => d.message).join(" · "));
      } else {
        setError(err.message);
      }
    } finally { setBusy(false); }
  };

  const pwValid = password.length >= 10 && /[A-Z]/.test(password) && /[0-9]/.test(password);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <div className="modal-title">Invite user</div>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <label htmlFor="invite-user-name">Full name</label>
        <input id="invite-user-name" name="name" required value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="name" />
        <label htmlFor="invite-user-email">Email</label>
        <input id="invite-user-email" name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label htmlFor="invite-user-password">Temporary password</label>
        <input id="invite-user-password" name="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <div className="field-hint" style={{ color: pwValid ? "#1B7A43" : "#6B6E72" }}>
          {pwValid ? "✓ " : ""}At least 10 characters, with an uppercase letter and a number.
        </div>
        <label htmlFor="invite-user-role">Role</label>
        <select id="invite-user-role" name="role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="bursar">Bursar</option>
          <option value="accountant">Accountant</option>
          <option value="assistant">Assistant</option>
        </select>
        <button type="submit" className="btn-primary btn-full" disabled={busy || !pwValid || !name || !email}>{busy ? "Creating..." : "Create account"}</button>
      </form>
    </div>
  );
}
