import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import ChangePasswordModal from "./ChangePasswordModal";

export default function Layout({ children }) {
  const { user, logout, schoolName } = useAuth();
  const navigate = useNavigate();
  const [showChangePw, setShowChangePw] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-brand-block">
            <img src="/app-icon.jpg" alt="Ledgerly" className="app-logo" />
            <div className="app-brand-text">
              <div className="app-brand">Ledgerly</div>
              {schoolName && <div className="app-school-name">{schoolName}</div>}
              {user && <div className="app-subbrand">{user.name} · {user.role}</div>}
            </div>
          </div>
          {user && (
            <div className="app-header-actions">
              <button className="btn-ghost-dark" onClick={() => setShowChangePw(true)}>Change password</button>
              <button className="btn-ghost-dark" onClick={handleLogout}>Log out</button>
            </div>
          )}
        </div>
        {user && (
          <nav className="app-nav">
            <NavLink to="/" end className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Dashboard</NavLink>
            <NavLink to="/students" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Students</NavLink>
            <NavLink to="/finance" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Income & Expenditure</NavLink>
            <NavLink to="/fee-heads" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Fee Heads</NavLink>
            <NavLink to="/terms" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Sessions & Terms</NavLink>
            {user.role === "owner" && (
              <NavLink to="/users" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Users</NavLink>
            )}
            {user.role === "owner" && (
              <NavLink to="/audit-log" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Audit Log</NavLink>
            )}
          </nav>
        )}
      </header>
      <main className="app-main">
        {children}
      </main>
      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
    </div>
  );
}
