import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div>
            <div className="app-brand">School Finance Tracker</div>
            {user && <div className="app-subbrand">{user.name} · {user.role}</div>}
          </div>
          {user && (
            <button className="btn-ghost-dark" onClick={handleLogout}>Log out</button>
          )}
        </div>
        {user && (
          <nav className="app-nav">
            <NavLink to="/" end className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Dashboard</NavLink>
            <NavLink to="/students" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Students</NavLink>
            <NavLink to="/finance" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Income & Expenditure</NavLink>
            {user.role === "owner" && (
              <NavLink to="/audit-log" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Audit Log</NavLink>
            )}
          </nav>
        )}
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
