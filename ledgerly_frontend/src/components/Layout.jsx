import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { TermProvider } from "../context/TermContext";

export default function Layout({ children }) {
  const { user, logout, schoolName } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-brand-block">
            <img src="/ledgerly-logo.jpg" alt="Ledgerly" className="app-logo" />
            <div className="app-brand-text">
              <div className="app-brand">Ledgerly</div>
              {schoolName && <div className="app-school-name">{schoolName}</div>}
              {user && <div className="app-subbrand">{user.name} · {user.role}</div>}
            </div>
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
            <NavLink to="/fee-heads" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Fee Heads</NavLink>
            <NavLink to="/terms" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Sessions & Terms</NavLink>
            {user.role === "owner" && (
              <NavLink to="/audit-log" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Audit Log</NavLink>
            )}
          </nav>
        )}
      </header>
      <main className="app-main">
        <TermProvider>
          {children}
        </TermProvider>
      </main>
    </div>
  );
}
